const supabase = require('../models/supabaseClient');
const { groq } = require('./llmService');

/**
 * Fact Extractor — The Brain's Persistent Memory Over Time
 * 
 * Extracts key facts from conversations and stores them in the key_facts
 * table. This enables:
 * - Cross-session memory (remembered across chat sessions)
 * - Personalization (preferences, style, names)
 * - Context continuity ("you mentioned last week that...")
 * 
 * Uses a lightweight LLM call to extract structured facts from messages.
 * Falls back to simple extraction if LLM is unavailable.
 */

const FACT_EXTRACTION_PROMPT = `You are a memory extraction assistant. Given a conversation between a user and an AI assistant, extract key factual information that should be remembered for future conversations.

Focus on extracting:
1. PERSONAL: User's name, role, preferences, stated opinions, habits
2. PROJECT: Project names, goals, timelines, stakeholders  
3. DECISION: Decisions made, choices selected, approaches agreed upon
4. PREFERENCE: User's preferred style, format, communication preferences, tools they like/dislike
5. DEADLINE: Dates, deadlines, time commitments mentioned
6. RELATIONSHIP: Connections between people, documents, and companies mentioned
7. GENERAL: Any other important factual information

Rules:
- Only extract facts that are explicit and clearly stated
- Do not extract opinions presented as hypotheticals
- Do not extract instructions or commands (those are acted on, not remembered)
- Be concise — each fact should be 1 sentence
- Assign a confidence score (0.0-1.0) based on how clearly the fact was stated
- Categorize each fact appropriately

Return a JSON object:
{
  "facts": [
    {
      "fact": "The user prefers markdown-formatted responses with tables.",
      "category": "preference",
      "confidence": 0.85
    }
  ]
}

If no new facts are extractable, return {"facts": []}.`;

/**
 * Extract key facts from a conversation exchange.
 * 
 * @param {string} userMessage - The user's message
 * @param {string} assistantReply - The assistant's reply  
 * @param {Array} conversationHistory - Recent conversation history [{role, content}]
 * @returns {Promise<Array>} Array of { fact, category, confidence }
 */
async function extractFactsFromExchange(userMessage, assistantReply, conversationHistory = []) {
  // Skip very short or trivial messages
  if (!userMessage || userMessage.length < 20) {
    return [];
  }

  try {
    // Build a compact conversation sample for the LLM
    const recentExchanges = conversationHistory
      .slice(-6) // Last 3 exchanges
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 500)}`)
      .join('\n\n');

    const conversationSample = recentExchanges
      ? `${recentExchanges}\n\nUser: ${userMessage.substring(0, 1000)}\nAssistant: ${assistantReply ? assistantReply.substring(0, 1000) : ''}`
      : `User: ${userMessage.substring(0, 1000)}\nAssistant: ${assistantReply ? assistantReply.substring(0, 1000) : ''}`;

    const response = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'system', content: FACT_EXTRACTION_PROMPT },
        { role: 'user', content: conversationSample }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 500
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content);
    const facts = Array.isArray(parsed.facts) ? parsed.facts : [];

    // Filter low-confidence facts
    return facts.filter(f => f.confidence >= 0.6 && f.fact && f.fact.length > 5);
  } catch (err) {
    // Fallback: simple pattern-based extraction
    console.warn('[FactExtractor] LLM extraction failed, using fallback:', err.message);
    return extractFactsFallback(userMessage, assistantReply);
  }
}

/**
 * Simple fallback fact extraction using regex patterns.
 * Catches common fact patterns without requiring an LLM call.
 */
function extractFactsFallback(userMessage, assistantReply) {
  const facts = [];

  // Pattern: "I am [name]" or "my name is [name]"
  const nameMatch = userMessage.match(/\b(?:I am|I'm|my name is|call me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i);
  if (nameMatch) {
    facts.push({
      fact: `User's name is ${nameMatch[1]}.`,
      category: 'personal',
      confidence: 0.9
    });
  }

  // Pattern: "I work at [company]" or "my company is [company]"
  const companyMatch = userMessage.match(/\b(?:I work at|my company is|work for|at)\s+([A-Z][A-Za-z0-9\s.]+?)(?:\s|,|\.|$)/i);
  if (companyMatch && companyMatch[1].length < 50) {
    facts.push({
      fact: `User works at ${companyMatch[1].trim()}.`,
      category: 'personal',
      confidence: 0.8
    });
  }

  // Pattern: "I like/prefer [something]"
  const prefMatch = userMessage.match(/\b(?:I like|I prefer|I'd like|I'd prefer|my favorite)\s+(.+?)(?:\.|,|$)/i);
  if (prefMatch && prefMatch[1].length > 5 && prefMatch[1].length < 100) {
    facts.push({
      fact: `User prefers ${prefMatch[1].trim()}.`,
      category: 'preference',
      confidence: 0.75
    });
  }

  // Pattern: Date or deadline references
  const dateMatch = userMessage.match(/\b(due|deadline|by)\s+(.+?)(?:\.|,|$)/i);
  if (dateMatch) {
    facts.push({
      fact: `Deadline mentioned: ${dateMatch[2].trim()}.`,
      category: 'deadline',
      confidence: 0.7
    });
  }

  return facts;
}

/**
 * Save extracted facts to the key_facts table.
 * Deduplicates against existing active facts by content similarity.
 * 
 * @param {Array} facts - Array of { fact, category, confidence }
 * @param {string} tenantId - Company UUID
 * @param {string} userId - User UUID
 * @param {string} sessionId - Chat session ID
 * @param {string} sourceMessage - The original user message
 */
async function saveFacts(facts, tenantId, userId, sessionId, sourceMessage) {
  if (!facts || facts.length === 0) return [];

  const savedFacts = [];

  try {
    // Get existing active facts for this user to avoid duplicates
    const { data: existingFacts } = await supabase
      .from('key_facts')
      .select('fact')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .eq('is_active', true);

    const existingTexts = new Set((existingFacts || []).map(f => f.fact.toLowerCase().trim()));

    for (const fact of facts) {
      const factLower = fact.fact.toLowerCase().trim();

      // Check for near-duplicate (simple substring check)
      let isDuplicate = false;
      for (const existing of existingTexts) {
        // Check if they share significant overlap
        const words1 = new Set(factLower.split(/\s+/));
        const words2 = new Set(existing.split(/\s+/));
        const intersection = new Set([...words1].filter(w => w.length > 3 && words2.has(w)));
        const overlap = words1.size > 0 ? intersection.size / Math.max(words1.size, 1) : 0;

        if (overlap > 0.6 && words1.size > 2) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        const { data, error } = await supabase
          .from('key_facts')
          .insert([{
            tenant_id: tenantId,
            user_id: userId,
            session_id: sessionId,
            fact: fact.fact,
            category: fact.category || 'general',
            confidence: fact.confidence || 0.8,
            source_message: sourceMessage ? sourceMessage.substring(0, 500) : null
          }])
          .select()
          .single();

        if (!error && data) {
          savedFacts.push(data);
          existingTexts.add(factLower);
        }
      }
    }

    if (savedFacts.length > 0) {
      console.log(`[FactExtractor] Saved ${savedFacts.length} new fact(s) for user ${userId}.`);
    }
  } catch (err) {
    console.error('[FactExtractor] Error saving facts:', err.message);
  }

  return savedFacts;
}

/**
 * Retrieve active key facts for a user to inject into context.
 * 
 * @param {string} tenantId - Company UUID
 * @param {string} userId - User UUID
 * @param {number} [limit=10] - Max facts to return
 * @returns {Promise<Array>} Array of fact strings
 */
async function getKeyFactsForUser(tenantId, userId, limit = 10) {
  try {
    const { data, error } = await supabase
      .from('key_facts')
      .select('fact, category, confidence')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('confidence', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    return data;
  } catch (err) {
    console.warn('[FactExtractor] Failed to retrieve key facts:', err.message);
    return [];
  }
}

/**
 * Process a completed conversation turn: extract facts and save them.
 * Called from orchestrator.js after each response.
 * 
 * @param {Object} params
 * @param {string} params.userMessage - The user's message
 * @param {string} params.assistantReply - The assistant's reply
 * @param {Array} params.conversationHistory - Recent conversation history
 * @param {string} params.tenantId - Company UUID
 * @param {string} params.userId - User UUID
 * @param {string} params.sessionId - Chat session ID
 */
async function processTurn({ userMessage, assistantReply, conversationHistory, tenantId, userId, sessionId }) {
  try {
    // Extract facts from this exchange
    const facts = await extractFactsFromExchange(userMessage, assistantReply, conversationHistory);

    if (facts.length > 0) {
      await saveFacts(facts, tenantId, userId, sessionId, userMessage);
    }

    return facts;
  } catch (err) {
    console.warn('[FactExtractor] processTurn error:', err.message);
    return [];
  }
}

module.exports = {
  extractFactsFromExchange,
  saveFacts,
  getKeyFactsForUser,
  processTurn
};
