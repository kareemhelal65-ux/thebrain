const { pipeline, cos_sim } = require('@xenova/transformers');
const { captureException } = require('./errorTracker');

/**
 * ============================================================
 * SEMANTIC ROUTER — Routes user queries to tool categories
 * ============================================================
 * 
 * Each route has a name, example utterances (used for zero-shot
 * semantic matching), and the tool categories it unlocks.
 * 
 * CRITICAL: Never return empty tools on low confidence. Fall back
 * to a minimal essential toolset so the LLM can always act.
 */

const routes = [
  {
    name: 'DocumentRoute',
    utterances: [
      'create a document', 'draft a proposal', 'write a report',
      'make a file', 'generate csv', 'edit a draft', 'save this document',
      'create a contract', 'write a memo', 'draft a strategy document',
      'create an invoice', 'generate a report', 'summarize this document',
      'create a new file', 'make a document', 'write up a brief',
      'draft an agreement', 'compose a document', 'create meeting notes',
      'draft a proposal', 'draft an email', 'create a presentation',
      'generate a pdf', 'export as csv', 'write a document'
    ],
    categories: ['storage', 'communications']
  },
  {
    name: 'ResearchRoute',
    utterances: [
      'search the web', 'look up information', 'research this topic',
      'find out about', 'what does the internet say', 'google this',
      'scrape website', 'analyze website', 'do research on',
      'find information about', 'search for', 'look into',
      'investigate', 'gather intelligence on', 'find data about',
      'what are the latest trends', 'analyze market', 'competitor analysis',
      'find sources about', 'search the internet for',
      'check google', 'pull up data on', 'get me the latest',
      'current news', 'latest news', 'what is happening with',
      'tell me about', 'what do you know about', 'i want to know',
      'compare', 'analyze', 'explain how', 'how does',
      'look up', 'find me', 'search for information',
      'is it true', 'fact check', 'verify',
      'what are the', 'how much', 'how many', 'what was',
      'market size', 'industry', 'trends in',
      'latest developments', 'news about', 'recent',
      'price of', 'cost of', 'stock price',
      'who is', 'what is', 'where is',
    ],
    categories: ['research', 'analytics', 'storage']
  },
  {
    name: 'MeetingRoute',
    utterances: [
      'summarize the meeting', 'what happened in the meeting',
      'show me action items', 'what decisions were made',
      'transcribe meeting', 'process meeting notes',
      'meeting summary', 'what was discussed in',
      'meeting recap', 'give me the meeting highlights',
      'what did we decide in', 'meeting minutes',
      'summarize my meetings', 'meeting insights',
      'show me recent meetings', 'analyze this meeting'
    ],
    categories: ['storage', 'project-management']
  },
  {
    name: 'ActionRoute',
    utterances: [
      'what are my action items', 'what do I need to do',
      'show me tasks', 'list open tasks', 'what is overdue',
      'my to-do list', 'action items for', 'what needs to be done',
      'show pending tasks', 'overdue items', 'my deadlines',
      'what tasks are assigned to me', 'show my reminders',
      'list all action items', 'follow up on tasks',
      'what is due this week', 'show my priorities'
    ],
    categories: ['project-management', 'crm']
  },
  {
    name: 'CommsRoute',
    utterances: [
      'draft an email', 'schedule a meeting', 'summarize the thread',
      'send a message', 'compose an email', 'send a slack message',
      'check my inbox', 'read my emails', 'reply to',
      'send a notification', 'broadcast message', 'contact customer',
      'send a calendar invite', 'check availability', 'book a meeting',
      'create calendar event', 'email the team about',
      'message the channel', 'post an announcement',
      'send a newsletter', 'communicate with'
    ],
    categories: ['communications', 'marketing']
  },
  {
    name: 'FinanceRoute',
    utterances: [
      'process payment', 'what is the cash flow', 'generate a P&L report',
      'authorize transaction', 'show me financials', 'check balance',
      'run payroll', 'create invoice', 'what is our revenue',
      'show mrr', 'burn rate', 'financial report',
      'budget analysis', 'expense report', 'profit and loss',
      'balance sheet', 'cash flow statement', 'financial metrics',
      'transaction history', 'approve payment'
    ],
    categories: ['finance', 'analytics', 'legal']
  },
  {
    name: 'DirectoryRoute',
    utterances: [
      'onboard new employee', 'look up customer', 'find broker details',
      'find a person', 'who works in', 'show me the team',
      'employee directory', 'customer information', 'contact details',
      'find vendor', 'look up partner', 'who is the manager of',
      'show me contacts', 'add a contact', 'update profile',
      'employee records', 'org chart', 'team directory'
    ],
    categories: ['crm', 'hr']
  },
  {
    name: 'CommerceRoute',
    utterances: [
      'check inventory', 'update shipping status', 'process order',
      'show products', 'sales report', 'order history',
      'check stock', 'fulfill order', 'create product listing',
      'pricing update', 'discount campaign', 'cart analysis',
      'customer orders', 'track shipment', 'return processing',
      'catalog management', 'product catalog'
    ],
    categories: ['commerce', 'analytics']
  },
  {
    name: 'KnowledgeRoute',
    utterances: [
      'what does the brain know about', 'search my documents',
      'find information in my files', 'what do we have on',
      'show me documents about', 'search my knowledge base',
      'what is stored in memory', 'brain search for',
      'retrieve information about', 'do we have a document about',
      'show me what the brain remembers', 'search company knowledge',
      'find relevant information', 'look up in my documents',
      'what do we know about', 'tell me about'
    ],
    categories: ['storage', 'research', 'project-management']
  }
];

/**
 * Essential fallback categories — always available even when no route matches confidently.
 * Prevents the LLM from being powerless during general chat.
 * 'research' is always included to enable web lookups.
 */
const ESSENTIAL_FALLBACK_CATEGORIES = ['storage', 'communications', 'research'];

/**
 * Research tool names that should be injected as background capability
 * for nearly any conversation turn.
 */
const RESEARCH_BACKGROUND_TOOLS = ['web_search_trusted', 'web_extract_source_content', 'web_scrape_and_analyze'];

let extractor = null;
let routeEmbeddings = null;

/**
 * Initialize the embedding pipeline and pre-compute route embeddings
 */
async function initRouter() {
  if (!extractor) {
    try {
      // Use multilingual model for cross-language zero-shot semantic routing
      extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
      
      // Pre-embed the route utterances to save time later
      routeEmbeddings = {};
      for (const route of routes) {
        const output = await extractor(route.utterances, { pooling: 'mean', normalize: true });
        routeEmbeddings[route.name] = output.tolist();
      }
      console.log('[SemanticRouter] Initialized and pre-computed route embeddings.');
    } catch (error) {
      captureException(error, { component: 'SemanticRouter', extra: { phase: 'initialization' } });
      console.error('[SemanticRouter] CRITICAL: Failed to initialize:', error.message);
      throw error;
    }
  }
}

/**
 * Helper: Extract keywords from a prompt for intent matching fallback.
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
 * Fallback keyword-based route matcher when semantic confidence is low.
 */
function matchByKeywords(keywords, allowedRoutes) {
  const keywordRouteMap = [
    { route: 'DocumentRoute', keywords: ['document', 'draft', 'create', 'write', 'file', 'report', 'csv', 'memo', 'proposal', 'contract', 'presentation', 'export', 'generate'] },
    { route: 'ResearchRoute', keywords: ['search', 'research', 'find', 'look', 'google', 'internet', 'web', 'investigate', 'analyze', 'scrape'] },
    { route: 'MeetingRoute', keywords: ['meeting', 'meet', 'summarize', 'transcribe', 'recap', 'minutes', 'discuss', 'agenda', 'action items'] },
    { route: 'ActionRoute', keywords: ['task', 'action', 'todo', 'to-do', 'overdue', 'deadline', 'reminder', 'assign', 'priority', 'follow'] },
    { route: 'CommsRoute', keywords: ['email', 'message', 'slack', 'channel', 'inbox', 'calendar', 'invite', 'schedule', 'meeting', 'communicate', 'announce', 'notification'] },
    { route: 'FinanceRoute', keywords: ['payment', 'finance', 'revenue', 'invoice', 'budget', 'expense', 'mrr', 'burn', 'profit', 'financial', 'cash', 'transaction', 'payroll'] },
    { route: 'DirectoryRoute', keywords: ['employee', 'customer', 'contact', 'person', 'vendor', 'partner', 'hire', 'onboard', 'team', 'directory'] },
    { route: 'CommerceRoute', keywords: ['inventory', 'order', 'product', 'shipping', 'stock', 'catalog', 'pricing', 'commerce', 'sale'] },
    { route: 'KnowledgeRoute', keywords: ['know', 'memory', 'document', 'brain', 'information', 'search', 'find', 'what is', 'tell me', 'remember'] }
  ];

  let bestKeywordMatch = null;
  let bestKeywordCount = 0;

  for (const mapping of keywordRouteMap) {
    if (allowedRoutes && !allowedRoutes.includes(mapping.route)) continue;
    const matchCount = keywords.filter(k => mapping.keywords.includes(k)).length;
    if (matchCount > bestKeywordCount) {
      bestKeywordCount = matchCount;
      bestKeywordMatch = routes.find(r => r.name === mapping.route);
    }
  }

  return bestKeywordCount >= 2 ? bestKeywordMatch : null;
}

/**
 * Interceptor Logic: Embed user prompt, evaluate against routes, return relevant tool schemas.
 * 
 * CRITICAL IMPROVEMENT: Never returns empty tools. If no route matches confidently, returns
 * a minimal essential toolset so the LLM is never powerless.
 * 
 * @param {string} userPrompt 
 * @param {Array} companyTools 
 * @param {Array<string>} allowedRoutes - Optional. List of permitted routes for Soft Agents.
 * @returns {Array} Array of tool schemas for the winning route
 */
async function getRelevantTools(userPrompt, companyTools, allowedRoutes = null) {
  await initRouter();
  
  // Embed user prompt
  const promptOutput = await extractor(userPrompt, { pooling: 'mean', normalize: true });
  const promptEmbedding = promptOutput.tolist()[0];
  
  let bestRoute = null;
  let maxScore = -1;
  const HIGH_CONFIDENCE_THRESHOLD = 0.40;
  const LOW_CONFIDENCE_THRESHOLD = 0.25;
  
  // Evaluate against all routes
  for (const route of routes) {
    // If allowedRoutes is strictly provided by a Soft Agent, skip unauthorized routes
    if (allowedRoutes && !allowedRoutes.includes(route.name)) {
      continue;
    }

    const embeddings = routeEmbeddings[route.name];
    let routeMaxScore = -1;
    
    // Check against all utterances in this route
    for (const utteranceEmbedding of embeddings) {
      const score = cos_sim(promptEmbedding, utteranceEmbedding);
      if (score > routeMaxScore) {
        routeMaxScore = score;
      }
    }
    
    if (routeMaxScore > maxScore) {
      maxScore = routeMaxScore;
      bestRoute = route;
    }
  }
  
  // ---- DECISION LOGIC ----
  
  if (maxScore >= HIGH_CONFIDENCE_THRESHOLD && bestRoute) {
    console.log(`[SemanticRouter] Matched ${bestRoute.name} with score ${maxScore.toFixed(2)}`);
    return companyTools.filter(tool => bestRoute.categories.includes(tool.category));
  }
  
  // Below high threshold but above low threshold — try keyword matching as tiebreaker
  if (maxScore >= LOW_CONFIDENCE_THRESHOLD && bestRoute) {
    const keywords = extractKeywords(userPrompt);
    const keywordMatch = matchByKeywords(keywords, allowedRoutes);
    
    if (keywordMatch) {
      console.log(`[SemanticRouter] Keyword fallback matched ${keywordMatch.name} (semantic: ${maxScore.toFixed(2)}, keywords: matched)`);
      return companyTools.filter(tool => keywordMatch.categories.includes(tool.category));
    }
    
    // Use the best match even at low confidence — better than returning empty
    console.log(`[SemanticRouter] Weak semantic match ${bestRoute.name} (score: ${maxScore.toFixed(2)}). Using best guess.`);
    return companyTools.filter(tool => bestRoute.categories.includes(tool.category));
  }
  
  // Very low confidence — use keyword matching or essential fallback
  if (bestRoute) {
    const keywords = extractKeywords(userPrompt);
    const keywordMatch = matchByKeywords(keywords, allowedRoutes);
    
    if (keywordMatch) {
      console.log(`[SemanticRouter] Keyword fallback: ${keywordMatch.name} (semantic too low: ${maxScore.toFixed(2)})`);
      return companyTools.filter(tool => keywordMatch.categories.includes(tool.category));
    }
  }
  
  // ---- FINAL FALLBACK: Essential tools ----
  // NEVER return empty — give the LLM at least document creation, communications, and research
  console.log(`[SemanticRouter] No route matched confidently (score: ${maxScore.toFixed(2)}). Returning essential fallback tools.`);
  
  let fallbackCategories = ESSENTIAL_FALLBACK_CATEGORIES;
  
  // If allowedRoutes is set, filter fallback categories to only those routes' categories
  if (allowedRoutes) {
    const allowedCategories = new Set();
    for (const route of routes) {
      if (allowedRoutes.includes(route.name)) {
        route.categories.forEach(c => allowedCategories.add(c));
      }
    }
    fallbackCategories = ESSENTIAL_FALLBACK_CATEGORIES.filter(c => allowedCategories.has(c));
    // If filtering removed everything, use the first allowed route's categories
    if (fallbackCategories.length === 0 && allowedRoutes.length > 0) {
      const firstAllowed = routes.find(r => allowedRoutes.includes(r.name));
      if (firstAllowed) {
        fallbackCategories = firstAllowed.categories;
      }
    }
  }
  
  let matchedTools = companyTools.filter(tool => fallbackCategories.includes(tool.category));
  
  // Always inject research background tools — they're universally useful
  // and don't compromise security since they only access public web data
  for (const toolName of RESEARCH_BACKGROUND_TOOLS) {
    if (!matchedTools.some(t => t.name === toolName)) {
      const researchTool = companyTools.find(t => t.name === toolName);
      if (researchTool) {
        matchedTools.push(researchTool);
      }
    }
  }
  
  return matchedTools;
}

module.exports = {
  getRelevantTools,
  initRouter,
  RESEARCH_BACKGROUND_TOOLS
};
