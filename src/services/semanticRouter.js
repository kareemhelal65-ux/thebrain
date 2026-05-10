const { pipeline, cos_sim } = require('@xenova/transformers');
const { captureException } = require('./errorTracker');

// Define Routes and map them to categories
const routes = [
  {
    name: 'FinanceRoute',
    utterances: ['process payment', 'what is the cash flow', 'generate a P&L report', 'authorize transaction'],
    categories: ['finance', 'analytics', 'legal']
  },
  {
    name: 'ResourceRoute',
    utterances: ['check inventory', 'is the room available', 'update shipping status', 'property listings'],
    categories: ['commerce', 'storage', 'it-ops', 'project-management']
  },
  {
    name: 'DirectoryRoute',
    utterances: ['onboard new employee', 'look up customer', 'find broker details'],
    categories: ['crm', 'hr']
  },
  {
    name: 'CommsRoute',
    utterances: ['draft an email', 'schedule a meeting', 'summarize the thread'],
    categories: ['communications', 'support', 'marketing']
  }
];

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
 * Interceptor Logic: Embed user prompt, evaluate against routes, return relevant tool schemas.
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
  const THRESHOLD = 0.40; // Confidence threshold adjusted for cross-lingual vector space
  
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
  
  // Fallback to General Chat
  if (maxScore < THRESHOLD || !bestRoute) {
    console.log(`[SemanticRouter] No confident route match (score: ${maxScore.toFixed(2)}). Fallback to General Chat (No tools).`);
    return [];
  }
  
  console.log(`[SemanticRouter] Matched ${bestRoute.name} with score ${maxScore.toFixed(2)}`);
  
  // Return ONLY the tools belonging to the winning route's categories
  return companyTools.filter(tool => bestRoute.categories.includes(tool.category));
}

module.exports = {
  getRelevantTools,
  initRouter
};
