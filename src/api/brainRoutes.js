const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const supabase = require('../models/supabaseClient');
const { generateEmbedding } = require('../services/embeddingService');
const { groq } = require('../services/llmService');

// ─── v3 Scope Clarification Helpers (§7.5) ───
const TIME_RANGE_PATTERNS = /\b(last\s+(week|month|quarter|year|few\s+months|few\s+weeks)|recently|this\s+(quarter|year|month)|Q[1-4]|past\s+(month|quarter|year|week))\b/i;
const MEETING_QUERY_PATTERNS = /\b(meeting|meetings|discussed|talked|mentioned|call|calls|standup|sync|retrospective)\b/i;

async function checkScopeClarification(question, tenantId) {
  // Only trigger for meeting-related queries with broad time ranges
  if (!TIME_RANGE_PATTERNS.test(question) || !MEETING_QUERY_PATTERNS.test(question)) {
    return null;
  }

  try {
    // Count meetings for this tenant (all meetings — broad scope)
    const { data, error } = await supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', tenantId);

    const meetingCount = data?.length ?? 0;

    // Only trigger clarification if 20+ meetings exist
    if (meetingCount >= 20) {
      return {
        needs_clarification: true,
        meeting_count: meetingCount,
        question: `I found ${meetingCount} meetings that could be relevant. Would you like me to search all of them, or narrow down?`,
        choices: [
          `Search all ${meetingCount} meetings`,
          'Narrow by person',
          'Narrow by project',
          'Just the last 5 meetings',
        ],
      };
    }
  } catch (e) {
    // Don't block the query if the clarification check fails
    console.warn('[ScopeClarification] Check failed:', e.message);
  }

  return null;
}

const router = express.Router();

const BRAIN_SYSTEM_PROMPT = `You are "The Brain" — an AI Operating System that answers questions about a company's internal data.

KEY RULES:
1. Answer based on the provided company context or the ongoing conversation history. If the user asks a meta-question or a follow-up about the conversation history (e.g., "why did you say that?" or "explain your previous answer"), rely on the conversation history to answer. If the context and conversation history do not contain the answer, say "I don't have enough context to answer that. Try syncing more meetings or documents."
2. ALWAYS cite which source your answer came from. Use the format: [Source: Meeting Title, Date] or [Source: Document Name].
3. Be concise but thorough. Use bullet points for lists.
4. When listing action items, include the owner and deadline if available.
5. If multiple sources are relevant, cite all of them.
6. Never make up information not present in the context.`;

/**
 * POST /api/brain/query
 * 
 * The core RAG endpoint — The Magic Moment.
 * Takes a question, searches The Brain's memory via pgvector,
 * builds context, and returns an LLM answer with source citations.
 */
router.post('/query', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { question, sessionId, semanticType, department, subType } = req.body;
    if (!question || typeof question !== 'string' || question.trim() === '') {
      return res.status(400).json({ error: 'Question is required.' });
    }

    const tenantId = req.user.company_id;

    // Create session if it doesn't exist
    let activeSessionId = sessionId;
    if (!activeSessionId) {
      const { data: newSession, error: sessErr } = await supabase.from('chat_sessions').insert([{
        tenant_id: tenantId,
        user_id: req.user.id,
        title: question.substring(0, 40) + (question.length > 40 ? '...' : '')
      }]).select().single();
      if (!sessErr && newSession) activeSessionId = newSession.id;
    }

    // Step 1: Embed the question
    const questionEmbedding = await generateEmbedding(question.trim());

    // Step 2: Search pgvector for similar chunks
    let sources = [];
    const vectorStore = process.env.VECTOR_STORE || 'supabase';

    if (vectorStore === 'supabase') {
      const { data, error } = await supabase.rpc('match_documents', {
        query_embedding: JSON.stringify(questionEmbedding),
        match_threshold: 0.15,
        match_count: 8,
        filter_tenant_id: tenantId,
        filter_semantic_type: semanticType || null,
        filter_department: department || null,
        filter_sub_type: subType || null
      });

      if (error) {
        console.error('pgvector search error:', error);
        // Fallback: try direct query
        const { data: fallbackData } = await supabase
          .from('document_chunks')
          .select('id, content, source_type, source_id, source_title, metadata')
          .eq('tenant_id', tenantId)
          .limit(5);
        sources = (fallbackData || []).map(d => ({ ...d, similarity: 0.5 }));
      } else {
        sources = data || [];
      }
    } else {
      // Pinecone fallback (post-raise)
      const { similaritySearch } = require('../services/embeddingService');
      const chunks = await similaritySearch(question, tenantId, 5);
      sources = chunks.map((content, i) => ({
        content,
        source_type: 'unknown',
        source_title: `Source ${i + 1}`,
        similarity: 0.8
      }));
    }

    // Step 3: Build context string
    let contextString = '';
    const sourceCitations = [];

    if (sources.length > 0) {
      const contextParts = sources.map((src, i) => {
        const title = src.source_title || src.metadata?.document_name || `Source ${i + 1}`;
        const type = src.source_type || 'document';
        const date = src.metadata?.meeting_date || src.metadata?.created_at || '';
        
        sourceCitations.push({
          id: src.source_id,
          title,
          source_type: type,
          meeting_date: date,
          excerpt: src.content?.substring(0, 150) + '...',
          score: src.similarity
        });

        return `[Source: ${title} (${type}${date ? ', ' + date : ''})]\n${src.content}`;
      });
      contextString = contextParts.join('\n\n---\n\n');
    }

    // Fetch conversation history from chat_history table
    let conversationHistory = [];
    if (activeSessionId) {
      try {
        const { data: historyData, error: historyErr } = await supabase
          .from('chat_history')
          .select('role, content')
          .eq('session_id', activeSessionId)
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: true })
          .limit(20);

        if (!historyErr && historyData) {
          conversationHistory = historyData;
        }
      } catch (err) {
        console.warn('[BrainQuery] Failed to fetch chat history:', err.message);
      }
    }

    // Step 4: Call Groq LLM with context
    const messages = [
      { role: 'system', content: BRAIN_SYSTEM_PROMPT },
    ];

    if (contextString) {
      messages.push({
        role: 'system',
        content: `Here is the relevant company context retrieved from The Brain's memory:\n\n${contextString}`
      });
    }

    if (conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      }
    }

    messages.push({ role: 'user', content: question.trim() });

    // ─── v3 §7.5: Scope Clarification Check ───
    // Before the LLM call, check if this is a broad meeting query that needs narrowing
    const clarification = await checkScopeClarification(question.trim(), tenantId);
    if (clarification?.needs_clarification) {
      // Return clarification prompt to the user instead of a direct answer
      // Save the clarification to chat history so the user sees it
      try {
        await supabase.from('chat_history').insert([
          {
            session_id: activeSessionId,
            tenant_id: tenantId,
            user_id: req.user.id,
            role: 'user',
            content: question.trim(),
            sources: [],
          },
          {
            session_id: activeSessionId,
            tenant_id: tenantId,
            user_id: req.user.id,
            role: 'assistant',
            content: clarification.question,
            sources: [],
          },
        ]);
      } catch (e) { /* non-critical */ }

      return res.status(200).json({
        answer: clarification.question,
        clarification: clarification,
        sources: [],
        chunks_searched: sources.length,
        model: 'scope-clarification',
        sessionId: activeSessionId,
      });
    }

    // ─── Phase 1: Primary LLM Draft ───
    const startTime = Date.now();

    const llmResponse = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages,
      temperature: 0.2,
      max_tokens: 2048,
    });

    let answer = llmResponse.choices[0].message.content;
    let selfCheckResult = null;

    // ─── Phase 2: Self-Check (v3 §7.4) ───
    // Lightweight verification pass — does the answer address the question and cite sources correctly?
    try {
      const selfCheckResponse = await groq.chat.completions.create({
        model: 'qwen/qwen3-32b',
        messages: [
          {
            role: 'system',
            content: `You are a quality checker for AI responses. Evaluate the following answer against the original question and source context.

Rules:
1. Does the answer directly address the question asked?
2. Is every factual claim supported by the provided context?
3. Are there any uncertain or potentially incorrect claims?
4. Is the answer missing any critical information from the context?

Respond ONLY with valid JSON (no markdown, no explanation):
{"pass": true/false, "issues": ["issue1", "issue2"], "score": 0-100}`
          },
          {
            role: 'user',
            content: `Question: ${question.trim()}\n\nContext provided:\n${contextString.substring(0, 2000)}\n\nAnswer to evaluate:\n${answer}`
          }
        ],
        temperature: 0.1,
        max_tokens: 300,
      });

      const selfCheckText = selfCheckResponse.choices[0].message.content;
      // Extract JSON from response (handle potential markdown wrapping)
      const jsonMatch = selfCheckText.match(/\{[^}]*"pass"[^}]*\}/s);
      if (jsonMatch) {
        selfCheckResult = JSON.parse(jsonMatch[0]);
        console.log(`[BrainQuery] Self-check: pass=${selfCheckResult.pass}, score=${selfCheckResult.score}, issues=${selfCheckResult.issues?.length || 0}`);

        // If self-check fails and has specific issues, regenerate ONCE with constraints
        if (!selfCheckResult.pass && selfCheckResult.issues?.length > 0) {
          console.log('[BrainQuery] Self-check failed, regenerating with constraints...');
          const constraintMsg = `IMPORTANT: Your previous answer had these issues that MUST be fixed:\n${selfCheckResult.issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n')}\n\nPlease provide a corrected answer that addresses ALL of these issues.`;

          const retryMessages = [
            ...messages,
            { role: 'assistant', content: answer },
            { role: 'user', content: constraintMsg }
          ];

          const retryResponse = await groq.chat.completions.create({
            model: 'openai/gpt-oss-120b',
            messages: retryMessages,
            temperature: 0.15,
            max_tokens: 2048,
          });

          answer = retryResponse.choices[0].message.content;
          console.log('[BrainQuery] Regenerated answer after self-check.');
        }
      }
    } catch (selfCheckErr) {
      // Self-check is non-critical — don't block the response
      console.warn('[BrainQuery] Self-check failed (non-critical):', selfCheckErr.message);
    }

    const latencyMs = Date.now() - startTime;

    // Step 5: Persist conversation to chat_history
    try {
      await supabase.from('chat_history').insert([
        {
          session_id: activeSessionId,
          tenant_id: tenantId,
          user_id: req.user.id,
          role: 'user',
          content: question.trim(),
          sources: [],
        },
        {
          session_id: activeSessionId,
          tenant_id: tenantId,
          user_id: req.user.id,
          role: 'assistant',
          content: answer,
          sources: sourceCitations,
        },
      ]);
    } catch (historyErr) {
      console.warn('[BrainQuery] Failed to save chat history:', historyErr.message);
    }

    // ─── v3 §7.6: Task Logging ───
    // Log every orchestrator dispatch for investor DD and Phase 2 learning loop
    try {
      const contextHash = crypto.createHash('md5').update(contextString.substring(0, 5000)).digest('hex');
      await supabase.from('task_log').insert([{
        tenant_id: tenantId,
        user_id: req.user.id,
        session_id: activeSessionId,
        intent: question.trim().substring(0, 500),
        intent_class: 'brain_query',
        context_hash: contextHash,
        agent_used: 'brain_rag',
        result_summary: answer.substring(0, 200),
        latency_ms: latencyMs,
        tool_calls_count: 0,
        sources_count: sourceCitations.length,
        quality_score: selfCheckResult?.score || null,
        status: 'completed',
      }]);
    } catch (taskLogErr) {
      // Non-critical — don't block response if task_log table doesn't exist yet
      if (taskLogErr?.code !== '42P01') {
        console.warn('[BrainQuery] Task log failed:', taskLogErr.message);
      }
    }

    // Step 6: Return answer with sources
    res.status(200).json({
      answer,
      sources: sourceCitations,
      chunks_searched: sources.length,
      model: 'openai/gpt-oss-120b',
      sessionId: activeSessionId,
      quality_score: selfCheckResult?.score || null,
      self_check_pass: selfCheckResult?.pass ?? null,
      latency_ms: latencyMs,
    });

  } catch (error) {
    console.error('[BrainQuery] Error:', error);
    next(error);
  }
});

/**
 * GET /api/brain/chat/sessions
 * Return chat sessions for the current user
 */
router.get('/chat/sessions', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('chat_sessions')
      .select('id, title, created_at, updated_at')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      // Table might not exist yet
      if (error.code === '42P01') return res.json({ sessions: [] });
      throw error;
    }
    res.json({ sessions: data || [] });
  } catch (error) {
    console.error('[Sessions] Error:', error.message);
    res.json({ sessions: [] });
  }
});

/**
 * DELETE /api/brain/chat/sessions/:id
 * Delete a chat: its conversation history, the session, and any still-PENDING
 * drafts/actions it spawned. Already-approved documents/artifacts (now permanent
 * brain_documents / approved agent_outputs) are intentionally left untouched.
 */
router.delete('/chat/sessions/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const sessionId = req.params.id;

    // Verify the session belongs to this user.
    const { data: session } = await supabase
      .from('chat_sessions')
      .select('id, user_id')
      .eq('id', sessionId)
      .single();
    if (!session || session.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    // Pending drafts spawned by this chat (approved ones already became brain_documents).
    await supabase
      .from('document_drafts')
      .delete()
      .eq('session_id', sessionId)
      .eq('status', 'pending');

    // Conversation messages, then the session itself.
    await supabase.from('chat_history').delete().eq('session_id', sessionId);
    const { error: delErr } = await supabase.from('chat_sessions').delete().eq('id', sessionId);
    if (delErr) throw delErr;

    res.json({ success: true, message: 'Chat deleted' });
  } catch (error) {
    console.error('[Sessions] Delete error:', error.message);
    next(error);
  }
});

/**
 * GET /api/brain/chat/sessions/:id/history
 * Return chat history for a specific session
 */
router.get('/chat/sessions/:id/history', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('chat_history')
      .select('id, role, content, agent_name, sources, choices, created_at')
      .eq('session_id', req.params.id)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) {
      if (error.code === '42P01') return res.json({ messages: [] });
      throw error;
    }
    res.json({ messages: data || [] });
  } catch (error) {
    console.error('[History] Error:', error.message);
    res.json({ messages: [] });
  }
});

/**
 * GET /api/brain/chat/starters
 * Generate dynamic suggested questions based on recent tenant data
 */
router.get('/chat/starters', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const agentId = req.query.agentId;
    let agentRole = 'General Assistant';
    let agentPrompt = '';

    if (agentId) {
      try {
        const { getAgentById } = require('../models/agentConfig');
        const agent = await getAgentById(agentId);
        if (agent) {
          agentRole = agent.role;
          agentPrompt = agent.system_prompt;
        }
      } catch (err) {
        console.warn('Could not fetch agent for starters:', err.message);
      }
    }

    const { data, error } = await supabase
      .from('document_chunks')
      .select('source_title, content')
      .eq('tenant_id', req.user.company_id)
      .order('created_at', { ascending: false })
      .limit(3);

    if (error || !data || data.length === 0) {
      // Agent-aware fallbacks when Brain has no context yet
      if (agentId && agentPrompt) {
        const agentFallbacks = {
          'Finance': ['Analyze our monthly expenses', 'Check our current MRR', 'Draft a budget report', 'Review last quarter revenue'],
          'Sales': ['Find new leads this week', 'Draft a cold outreach email', 'Check pipeline conversion rates', 'Summarize recent deals'],
          'Marketing': ['Draft a social media post', 'Analyze competitor campaigns', 'Plan content for next week', 'Research trending topics'],
          'Product': ['Create a sprint plan', 'List open feature requests', 'Draft a PRD document', 'Review backlog priorities'],
          'Strategy': ['Prepare investor update email', 'Research competitor funding', 'Draft a board meeting agenda', 'Analyze market positioning'],
          'Growth': ['Track user signup metrics', 'Plan a referral campaign', 'Analyze funnel drop-offs', 'Draft a growth experiment'],
        };
        const fallback = agentFallbacks[agentRole] || [
          `What can you help me with?`,
          `Draft a document for me`,
          `Summarize recent activity`,
          `What are my priorities?`
        ];
        return res.json({ starters: fallback });
      }
      return res.json({ starters: [
        'What did we decide about pricing?',
        'What are my open action items?',
        'Summarize our last meeting.',
        'Draft a status update document'
      ] });
    }

    const context = data.map(d => `Title: ${d.source_title}\nPreview: ${d.content.substring(0, 200)}`).join('\n\n');

    let systemInstruction = `You are an AI assistant. Based on the following recent company context, generate 4 short (under 8 words) suggested questions the user could ask. Return ONLY a valid JSON object with a single key "starters" containing an array of strings. Example: {"starters": ["What are my priorities?", "Summarize last meeting"]}`;
    if (agentId && agentPrompt) {
      systemInstruction = `You are an AI assistant acting as a ${agentRole}. Your system prompt is: "${agentPrompt}". Based on this role and the recent company context below, generate 4 short (under 8 words) highly relevant suggested tasks or questions the user could ask YOU. Return ONLY a valid JSON object with a single key "starters" containing an array of strings. Example: {"starters": ["Analyze our financials", "Find new leads"]}`;
    }

    const llmResponse = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: `Context:\n${context}` }
      ],
      temperature: 0.7,
      max_tokens: 150,
      response_format: { type: 'json_object' }
    });

    let starters = [];
    try {
      // Depending on the model, it might wrap it in an object like { "questions": [...] }
      const parsed = JSON.parse(llmResponse.choices[0].message.content);
      starters = Array.isArray(parsed) ? parsed : Object.values(parsed)[0];
      if (!Array.isArray(starters)) throw new Error('Not array');
      // Limit length
      starters = starters.map(s => s.length > 60 ? s.substring(0, 57) + '...' : s).slice(0, 4);
    } catch {
      // Fallback
      starters = ['What is the summary of recent documents?', 'List my recent action items', 'What are our current priorities?'];
    }

    res.json({ starters });
  } catch (error) {
    console.error('[Starters] Error:', error);
    res.json({ starters: ['What is the summary of recent documents?', 'List my recent action items', 'What are our current priorities?'] });
  }
});

/**
 * GET /api/brain/sources
 * List all ingested sources for the tenant (Memory Health Dashboard)
 */
router.get('/sources', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('document_chunks')
      .select('source_type, source_title, source_id, created_at')
      .eq('tenant_id', req.user.company_id);

    if (error) throw error;

    // Group by source_id to calculate chunk_count and last_sync_time
    const sourceMap = {};
    for (const chunk of (data || [])) {
      const key = chunk.source_id || chunk.source_title;
      if (!sourceMap[key]) {
        sourceMap[key] = {
          source_type: chunk.source_type,
          source_title: chunk.source_title,
          source_id: chunk.source_id,
          chunk_count: 0,
          last_sync_time: chunk.created_at,
        };
      }
      
      sourceMap[key].chunk_count += 1;
      
      // Update last_sync_time if this chunk is newer
      if (new Date(chunk.created_at) > new Date(sourceMap[key].last_sync_time)) {
        sourceMap[key].last_sync_time = chunk.created_at;
      }
    }

    const uniqueSources = Object.values(sourceMap).sort((a, b) => 
      new Date(b.last_sync_time) - new Date(a.last_sync_time)
    );

    res.status(200).json({ sources: uniqueSources });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/brain/sources/:source_id
 * Scrubs a source and ALL associated data from The Brain, including:
 * - document chunks (vector embeddings)
 * - brain_documents record (cascades to decisions & action_items via FK)
 * - proactive suggestions
 * - contacts
 * - proposed automations
 * - physical file on disk
 */
router.delete('/sources/:source_id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const sourceId = req.params.source_id;
    const tenantId = req.user.company_id;

    if (!sourceId) {
      return res.status(400).json({ error: 'source_id is required' });
    }

    // 1. Get the document info (for file path) before deleting
    const { data: doc } = await supabase
      .from('brain_documents')
      .select('id, file_path')
      .eq('id', sourceId)
      .eq('company_id', tenantId)
      .single();

    // 2. Delete document chunks (vector embeddings)
    await supabase
      .from('document_chunks')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('source_id', sourceId);

    // 3. Delete proactive suggestions linked to this source
    await supabase
      .from('proactive_suggestions')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('source_entity_id', sourceId);

    // 4. Delete contacts linked to this source
    await supabase
      .from('contacts')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('source_doc_id', sourceId);

    // 5. Delete proposed automations linked to this source
    await supabase
      .from('proposed_automations')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('source_doc_id', sourceId);

    // 6. Delete the brain_documents record
    //    (ON DELETE CASCADE handles decisions & action_items automatically)
    await supabase
      .from('brain_documents')
      .delete()
      .eq('id', sourceId)
      .eq('company_id', tenantId);

    // 7. Delete physical file from disk
    if (doc && doc.file_path) {
      const filePath = path.join(__dirname, '../..', doc.file_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[Memory Health] Deleted physical file: ${filePath}`);
      }
    }

    res.status(200).json({ success: true, message: `Successfully scrubbed source ${sourceId} and all associated data.` });
  } catch (error) {
    console.error('[Memory Health] Error scrubbing source:', error);
    next(error);
  }
});

module.exports = router;
