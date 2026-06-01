const { generateEmbedding } = require('./embeddingService');
const supabase = require('../models/supabaseClient');

/**
 * Retrieval Service — Context Search for The Brain
 * 
 * Multi-strategy retrieval engine that combines:
 * 1. Precise vector search (high threshold)
 * 2. Broad vector search (low threshold)
 * 3. Keyword-augmented query expansion
 * 4. Conversation-aware context (using recent messages to disambiguate)
 * 5. Structured entity retrieval (open action items, recent decisions)
 * 
 * Falls back gracefully if no documents are indexed yet.
 * Pinecone is optional (for cold/historical memory).
 */

/**
 * Extract meaningful keywords from text, removing stop words.
 */
function extractKeywords(text) {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 
    'should', 'may', 'might', 'shall', 'can', 'need', 'to', 'of', 'in', 'for', 
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before',
    'after', 'above', 'below', 'between', 'out', 'off', 'over', 'under', 'again',
    'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how',
    'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
    'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'just', 'about', 'up', 'this', 'that', 'these', 'those', 'i', 'me', 'my',
    'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'please',
    'can', 'could', 'tell', 'show', 'give', 'make', 'get', 'find', 'what']);
  
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

/**
 * Build an expanded query by incorporating conversation context.
 * For example: user says "what did it say about pricing?" — we expand
 * with the last user message to resolve "it" and "pricing".
 * 
 * @param {string} currentMessage - The user's current message
 * @param {Array} conversationHistory - Array of {role, content} recent messages
 * @returns {string} Expanded query for better retrieval
 */
function buildExpandedQuery(currentMessage, conversationHistory = []) {
  // If no history, just use the message as-is
  if (!conversationHistory || conversationHistory.length === 0) {
    return currentMessage;
  }
  
  // Check if the message has vague references (pronouns, "it", "that", "this", "the")
  const vagueRefPattern = /\b(it|that|this|those|these|they|them|the|what about|how about|tell me more|explain|why|go on)\b/i;
  const isVague = vagueRefPattern.test(currentMessage) && currentMessage.split(/\s+/).length <= 10;
  
  if (!isVague && currentMessage.split(/\s+/).length > 5) {
    // Message is self-contained — use as-is
    return currentMessage;
  }
  
  // Get the last user message for context
  const lastUserMessages = conversationHistory
    .filter(m => m.role === 'user')
    .slice(-2)
    .map(m => m.content);
  
  if (lastUserMessages.length === 0) return currentMessage;
  
  // Build expansion from last user query if current is vague
  if (isVague && lastUserMessages.length > 0) {
    return `${currentMessage} ${lastUserMessages[lastUserMessages.length - 1]}`;
  }
  
  // Otherwise combine current message with keywords from history
  const historyKeywords = lastUserMessages
    .flatMap(m => extractKeywords(m))
    .filter((k, i, arr) => arr.indexOf(k) === i) // unique
    .slice(0, 5);
  
  return `${currentMessage} ${historyKeywords.join(' ')}`;
}

/**
 * Retrieve relevant company context using multi-strategy Supabase pgvector search.
 * 
 * Uses THREE parallel strategies and merges results:
 * - Precise search (threshold 0.25, high relevance)
 * - Broad search (threshold 0.15, more coverage)
 * - Keyword-augmented search for additional recall
 * 
 * @param {string} userQuery - The search query
 * @param {string} companyId - The target company ID for tenant isolation
 * @returns {Promise<string[]>} Top relevant document chunks
 */
async function retrieveCompanyContext(userQuery, companyId, filters = {}) {
  const results = [];

  // ─── MULTI-STRATEGY: Supabase pgvector (Hot Memory) ───
  try {
    const queryEmbedding = await generateEmbedding(userQuery);

    // Strategy 1: Precise (higher threshold, fewer but more relevant results)
    const { data: preciseData, error: preciseError } = await supabase.rpc('match_documents', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: filters.preciseThreshold || 0.25,
      match_count: 5,
      filter_tenant_id: companyId,
      filter_semantic_type: filters.semanticType || null,
      filter_department: filters.department || null,
      filter_sub_type: filters.subType || null
    });

    if (!preciseError && preciseData && preciseData.length > 0) {
      for (const match of preciseData) {
        const source = match.source_title ? ` [Source: ${match.source_title}]` : '';
        results.push(`${match.content}${source}`);
      }
    }

    // Strategy 2: Broad (lower threshold, more coverage)
    const { data: broadData, error: broadError } = await supabase.rpc('match_documents', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: filters.broadThreshold || 0.12,
      match_count: 8,
      filter_tenant_id: companyId,
      filter_semantic_type: filters.semanticType || null,
      filter_department: filters.department || null,
      filter_sub_type: filters.subType || null
    });

    if (!broadError && broadData && broadData.length > 0) {
      for (const match of broadData) {
        const source = match.source_title ? ` [Source: ${match.source_title}]` : '';
        results.push(`${match.content}${source}`);
      }
    }
  } catch (err) {
    console.warn('[RetrievalService] pgvector search failed:', err.message);
  }

  // ─── SECONDARY: Pinecone (Cold Memory) — only if configured ───
  if (results.length < 3 && process.env.PINECONE_API_KEY && process.env.PINECONE_API_KEY !== 'your_pinecone_api_key_here') {
    try {
      const { Pinecone } = require('@pinecone-database/pinecone');
      const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
      const index = pinecone.Index(process.env.PINECONE_INDEX || 'the-brain-memory');

      const queryEmbedding = await generateEmbedding(userQuery);
      const pineconeResults = await index.query({
        vector: queryEmbedding,
        topK: 10,
        includeMetadata: true,
        filter: { company_id: { "$eq": companyId } }
      });

      if (pineconeResults.matches && pineconeResults.matches.length > 0) {
        for (const match of pineconeResults.matches) {
          if (match.metadata?.text_chunk) {
            const source = match.metadata.source_title ? ` [Source: ${match.metadata.source_title}]` : '';
            results.push(`${match.metadata.text_chunk}${source}`);
          }
        }
      }
    } catch (err) {
      console.warn('[RetrievalService] Pinecone search skipped:', err.message);
    }
  }

  // Deduplicate and return top 8
  const unique = [...new Set(results)];
  return unique.slice(0, 8);
}

/**
 * Retrieve company context with full document details.
 * Multi-strategy: precise + broad searches merged.
 */
async function retrieveCompanyContextDetailed(userQuery, companyId, filters = {}) {
  const allData = [];

  try {
    const queryEmbedding = await generateEmbedding(userQuery);

    // Strategy 1: Precise search
    const { data: preciseData, error: preciseError } = await supabase.rpc('match_documents', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: filters.preciseThreshold || 0.25,
      match_count: 5,
      filter_tenant_id: companyId,
      filter_semantic_type: filters.semanticType || null,
      filter_department: filters.department || null,
      filter_sub_type: filters.subType || null
    });

    if (!preciseError && preciseData) {
      allData.push(...preciseData);
    }

    // Strategy 2: Broad search
    const { data: broadData, error: broadError } = await supabase.rpc('match_documents', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: filters.broadThreshold || 0.12,
      match_count: 8,
      filter_tenant_id: companyId,
      filter_semantic_type: filters.semanticType || null,
      filter_department: filters.department || null,
      filter_sub_type: filters.subType || null
    });

    if (!broadError && broadData) {
      allData.push(...broadData);
    }

    if (allData.length === 0) return [];

    // Deduplicate by source_id + content prefix
    const seen = new Set();
    const deduplicated = allData.filter(item => {
      const key = `${item.source_id || ''}_${(item.content || '').substring(0, 80)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return deduplicated.slice(0, 10);
  } catch (err) {
    console.warn('[RetrievalService] Detailed multi-strategy search failed:', err.message);
    return [];
  }
}

/**
 * Smart retrieval — the main entry point for the orchestrator.
 * Combines vector search, conversation-aware query expansion, 
 * and structured entity retrieval (action items, decisions).
 * 
 * @param {string} userMessage - The user's current message
 * @param {Array} conversationHistory - Recent chat messages [{role, content}]
 * @param {string} companyId - Company UUID
 * @returns {Promise<Object>} { chunks, openItems, recentDecisions }
 */
async function retrieveSmartContext(userMessage, conversationHistory, companyId) {
  // 1. Build conversation-aware expanded query
  const expandedQuery = buildExpandedQuery(userMessage, conversationHistory);
  
  // 2. Run multi-strategy vector search
  const chunks = await retrieveCompanyContextDetailed(expandedQuery, companyId);
  
  // 3. Fetch open action items for context
  let openItems = [];
  try {
    const { data: items } = await supabase
      .from('action_items')
      .select('task, assignee, due_date, department, status')
      .eq('tenant_id', companyId)
      .eq('status', 'open')
      .order('due_date', { ascending: true, nullsLast: true })
      .limit(5);
    
    if (items) openItems = items;
  } catch (err) {
    console.warn('[RetrievalService] Failed to fetch open action items:', err.message);
  }
  
  // 4. Fetch recent decisions
  let recentDecisions = [];
  try {
    const { data: decisions } = await supabase
      .from('decisions')
      .select('text, made_by, date')
      .eq('tenant_id', companyId)
      .order('date', { ascending: false })
      .limit(5);
    
    if (decisions) recentDecisions = decisions;
  } catch (err) {
    console.warn('[RetrievalService] Failed to fetch recent decisions:', err.message);
  }
  
  // 5. Fetch recent meetings for context
  let recentMeetings = [];
  try {
    const { data: meetings } = await supabase
      .from('meetings')
      .select('title, meeting_date, insights->summary')
      .eq('company_id', companyId)
      .order('meeting_date', { ascending: false })
      .limit(3);
    
    if (meetings) recentMeetings = meetings;
  } catch (err) {
    console.warn('[RetrievalService] Failed to fetch recent meetings:', err.message);
  }
  
  return {
    chunks,
    openItems,
    recentDecisions,
    recentMeetings,
    expandedQuery
  };
}

/**
 * Simple reranker: scores each document against the query using keyword overlap.
 * In production, replace with a cross-encoder model.
 */
function simpleRerank(query, docs) {
  if (!docs || docs.length === 0) return [];

  const queryTokens = query.toLowerCase().split(/\s+/);

  const scored = docs.map(doc => {
    const docLower = doc.toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (token.length > 2 && docLower.includes(token)) score++;
    }
    return { doc, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.doc);
}

module.exports = {
  retrieveCompanyContext,
  retrieveCompanyContextDetailed,
  retrieveSmartContext,
  buildExpandedQuery,
  simpleRerank
};
