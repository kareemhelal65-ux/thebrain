/**
 * Research Routes — Real Intelligence Backend
 * 
 * Provides HTTP endpoints for all research tools defined in research.tools.json.
 * Routes are mounted at /api/research and require authentication.
 * 
 * Endpoints:
 *   POST /api/research/search              → Web search (multi-engine)
 *   POST /api/research/extract              → Extract content from URL
 *   POST /api/research/synthesize           → Multi-source intelligence scan
 *   POST /api/research/report               → LLM-synthesized report from collected data
 *   POST /api/research/producthunt          → Track product hunt launch
 *   POST /api/research/early-adopters       → Early adopter discovery
 *   GET  /api/research/capabilities         → List available research capabilities
 *   POST /api/research/intelligence-scan    → Deep intelligence scan on entity
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const crypto = require('crypto');

// ─── Web Research Engine ───
let webResearch = null;
try {
  webResearch = require('../services/webResearchEngine');
} catch (err) {
  console.warn('[ResearchRoutes] Web Research Engine not available:', err.message);
}

// ─── Tool Executor ───
let toolExecutor = null;
try {
  toolExecutor = require('../services/toolExecutor');
} catch (err) {
  console.warn('[ResearchRoutes] Tool Executor not available:', err.message);
}

// ─── LLM Service ───
let llmService = null;
try {
  llmService = require('../services/llmService');
} catch (err) {
  console.warn('[ResearchRoutes] LLM Service not available:', err.message);
}

// ─── Utility ───

/**
 * Check if the research engine is available and return appropriate error.
 */
function requireResearchEngine(res) {
  if (!webResearch) {
    res.status(503).json({
      error: 'Research Engine Unavailable',
      message: 'The Web Research Engine is not loaded. Ensure Playwright and dependencies are installed.',
      resolution: 'Run: npm install playwright && npx playwright install chromium',
    });
    return false;
  }
  return true;
}

// ─── Endpoints ───

/**
 * GET /api/research/capabilities
 * Returns the available research capabilities and their status.
 */
router.get('/capabilities', (req, res) => {
  const capabilities = [
    {
      name: 'web_search',
      description: 'Web search via Tavily API (primary) with Playwright+DuckDuckGo fallback',
      available: !!webResearch,
      endpoints: ['POST /api/research/search'],
    },
    {
      name: 'content_extraction',
      description: 'Full page content extraction with Playwright, Readability, and JS rendering',
      available: !!webResearch,
      endpoints: ['POST /api/research/extract'],
    },
    {
      name: 'intelligence_scan',
      description: 'Multi-source deep intelligence scan on companies, products, or entities',
      available: !!webResearch,
      endpoints: ['POST /api/research/synthesize', 'POST /api/research/intelligence-scan'],
    },
    {
      name: 'report_synthesis',
      description: 'LLM-powered research report generation from collected data',
      available: !!(webResearch && llmService),
      endpoints: ['POST /api/research/report'],
    },
    {
      name: 'product_hunt_tracking',
      description: 'Track Product Hunt launch performance',
      available: !!webResearch,
      endpoints: ['POST /api/research/producthunt'],
    },
    {
      name: 'early_adopter_discovery',
      description: 'Find potential early adopters across social platforms',
      available: !!webResearch,
      endpoints: ['POST /api/research/early-adopters'],
    },
  ];

  res.json({
    engineLoaded: !!webResearch,
    llmAvailable: !!llmService,
    capabilities,
    config: {
      timeoutMs: 30000,
      maxConcurrentPages: 3,
      proxyConfigured: !!process.env.PROXY_URL,
      tavilyConfigured: !!process.env.TAVILY_API_KEY,
    },
  });
});

/**
 * POST /api/research/search
 * Search the web using the configured search engine.
 * 
 * Body: { query, options: { engine, maxResults, trustedDomainsOnly, recencyFilter } }
 */
router.post('/search', async (req, res, next) => {
  try {
    if (!requireResearchEngine(res)) return;

    const { query, options = {} } = req.body;
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    console.log(`[Research] Web search: "${query.substring(0, 80)}" (engine: ${options.engine || 'auto'})`);

    const searchResult = await webResearch.searchWeb(query.trim(), {
      maxResults: Math.min(options.maxResults || 8, 20),
      trustedDomainsOnly: options.trustedDomainsOnly || false,
      recencyFilter: options.recencyFilter || null,
      includeAnswer: options.includeAnswer || false,
    });

    res.json({
      query: query.trim(),
      resultCount: searchResult.results.length,
      results: searchResult.results,
      answer: searchResult.answer,
      engine: 'tavily',
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Research] Search error:', err.message);
    res.status(500).json({
      error: 'Search failed',
      message: err.message,
      fallback: 'Try again with a different query or engine.',
    });
  }
});

/**
 * POST /api/research/extract
 * Extract full content from a URL.
 * 
 * Body: { url, options: { bypassClutter, maxChars } }
 */
router.post('/extract', async (req, res, next) => {
  try {
    if (!requireResearchEngine(res)) return;

    const { url, options = {} } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    console.log(`[Research] Extracting content from: ${url}`);

    const content = await webResearch.extractSourceContent(url, {
      bypassClutter: options.bypassClutter !== false,
      maxChars: Math.min(options.maxChars || 15000, 50000),
    });

    res.json({
      ...content,
      extractedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Research] Extraction error:', err.message);
    res.status(500).json({
      error: 'Content extraction failed',
      message: err.message,
      url: req.body.url,
    });
  }
});

/**
 * POST /api/research/synthesize
 * Multi-source intelligence scan on a company, product, or topic.
 * Searches multiple queries and extracts top pages.
 * 
 * Body: { entityName, options: { includeCompetitors, depth } }
 */
router.post('/synthesize', async (req, res, next) => {
  try {
    if (!requireResearchEngine(res)) return;

    const { entityName, options = {} } = req.body;
    if (!entityName || typeof entityName !== 'string') {
      return res.status(400).json({ error: 'entityName is required' });
    }

    console.log(`[Research] Intelligence scan: "${entityName}" (depth: ${options.depth || 'standard'})`);

    const intelligence = await webResearch.intelligenceScan(entityName.trim(), {
      includeCompetitors: options.includeCompetitors !== false,
      depth: options.depth || 'standard',
    });

    res.json({
      ...intelligence,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Research] Intelligence scan error:', err.message);
    res.status(500).json({
      error: 'Intelligence scan failed',
      message: err.message,
    });
  }
});

/**
 * POST /api/research/report
 * LLM-synthesized research report from collected data.
 * 
 * Body: { topic, collectedData, sources, formatStyle }
 */
router.post('/report', async (req, res, next) => {
  try {
    if (!webResearch) {
      return res.status(503).json({ error: 'Research Engine Unavailable' });
    }
    if (!llmService) {
      return res.status(503).json({ error: 'LLM Service Unavailable — cannot synthesize report' });
    }

    const { topic, collectedData, sources, formatStyle } = req.body;
    if (!topic || !collectedData || collectedData.length === 0) {
      return res.status(400).json({ error: 'topic and collectedData (non-empty array) are required' });
    }

    console.log(`[Research] Synthesizing report: "${topic}" (${collectedData.length} sources)`);

    const report = await webResearch.synthesizeReport({
      topic,
      collectedData: Array.isArray(collectedData) ? collectedData : [collectedData],
      sources: sources || [],
      formatStyle: formatStyle || 'detailed_analysis',
    });

    res.json(report);
  } catch (err) {
    console.error('[Research] Report synthesis error:', err.message);
    res.status(500).json({
      error: 'Report synthesis failed',
      message: err.message,
    });
  }
});

/**
 * POST /api/research/producthunt
 * Track a Product Hunt product launch.
 * 
 * Body: { productSlug }
 */
router.post('/producthunt', async (req, res, next) => {
  try {
    if (!requireResearchEngine(res)) return;

    const { productSlug } = req.body;
    if (!productSlug) {
      return res.status(400).json({ error: 'productSlug is required (e.g., "my-product")' });
    }

    console.log(`[Research] Tracking Product Hunt: ${productSlug}`);

    const data = await webResearch.trackProductHunt(productSlug);
    res.json(data);
  } catch (err) {
    console.error('[Research] Product Hunt tracking error:', err.message);
    res.status(500).json({
      error: 'Product Hunt tracking failed',
      message: err.message,
    });
  }
});

/**
 * POST /api/research/early-adopters
 * Discover potential early adopters for a niche.
 * 
 * Body: { niche, platforms }
 */
router.post('/early-adopters', async (req, res, next) => {
  try {
    if (!requireResearchEngine(res)) return;

    const { niche, platforms } = req.body;
    if (!niche) {
      return res.status(400).json({ error: 'niche is required (e.g., "AI note-taking app")' });
    }

    console.log(`[Research] Early adopter discovery: "${niche}"`);

    const data = await webResearch.discoverEarlyAdopters(niche, platforms || ['reddit', 'twitter', 'linkedin']);
    res.json(data);
  } catch (err) {
    console.error('[Research] Early adopter discovery error:', err.message);
    res.status(500).json({
      error: 'Early adopter discovery failed',
      message: err.message,
    });
  }
});

/**
 * POST /api/research/intelligence-scan
 * Deep intelligence scan on a company/entity.
 * Combines search, extraction, and analysis.
 * 
 * Body: { entityName, depth }
 */
router.post('/intelligence-scan', async (req, res, next) => {
  try {
    if (!requireResearchEngine(res)) return;
    if (!llmService) {
      return res.status(503).json({ error: 'LLM Service required for intelligence analysis' });
    }

    const { entityName, depth = 'standard' } = req.body;
    if (!entityName) {
      return res.status(400).json({ error: 'entityName is required' });
    }

    console.log(`[Research] Deep intelligence scan: "${entityName}" (depth: ${depth})`);

    // Step 1: Run intelligence scan to gather raw data
    const rawData = await webResearch.intelligenceScan(entityName, {
      includeCompetitors: true,
      depth,
    });

    // Step 2: Collect the extracted content
    const collectedData = rawData.extractedPages.map(p => `[${p.title}](${p.url}):\n${p.content}`);

    // Step 3: Synthesize into a structured report
    const report = await webResearch.synthesizeReport({
      topic: `Comprehensive analysis of ${entityName}`,
      collectedData,
      sources: rawData.sources.map(s => s.url),
      formatStyle: depth === 'deep' ? 'white_paper' : 'detailed_analysis',
    });

    res.json({
      entity: entityName,
      scanDate: new Date().toISOString(),
      depth,
      totalSources: rawData.totalSources,
      rawSources: rawData.sources,
      ...report,
    });
  } catch (err) {
    console.error('[Research] Intelligence scan error:', err.message);
    res.status(500).json({
      error: 'Intelligence scan failed',
      message: err.message,
    });
  }
});

// ─── Tool Executor Registration ───

/**
 * Register research tool handlers with the Tool Executor.
 * Called on module load.
 */
function registerResearchTools() {
  if (!toolExecutor || !webResearch) {
    console.warn('[ResearchRoutes] Cannot register tools — executor or engine unavailable');
    return;
  }

  const handlers = {
    'web_search_trusted': async (args) => {
      const searchResult = await webResearch.searchWeb(args.query, {
        maxResults: args.max_results || 8,
        trustedDomainsOnly: args.trusted_domains_only || false,
        recencyFilter: args.time_range || null,
        includeAnswer: args.include_answer || false,
      });
      return {
        results: searchResult.results,
        answer: searchResult.answer,
        resultCount: searchResult.results.length,
      };
    },

    'web_scrape_and_analyze': async (args) => {
      const content = await webResearch.extractSourceContent(args.url, {
        maxChars: args.max_chars || 15000,
        bypassClutter: true,
      });
      return {
        url: content.url,
        title: content.title,
        content: content.textContent,
        wordCount: content.wordCount,
        excerpt: content.excerpt,
        metadata: content.metadata,
      };
    },

    'web_extract_source_content': async (args) => {
      return await webResearch.extractSourceContent(args.url, {
        maxChars: args.max_chars || 15000,
        bypassClutter: args.bypass_clutter !== false,
      });
    },

    'research_multi_source_synthesis': async (args) => {
      return await webResearch.intelligenceScan(args.entity_name || args.topic, {
        includeCompetitors: args.include_competitors !== false,
        depth: args.depth || 'standard',
      });
    },

    'research_track_product_hunt': async (args) => {
      return await webResearch.trackProductHunt(args.product_slug);
    },

    'research_early_adopter_discovery': async (args) => {
      return await webResearch.discoverEarlyAdopters(
        args.niche,
        args.platforms || ['reddit', 'twitter', 'linkedin']
      );
    },
  };

  for (const [name, handler] of Object.entries(handlers)) {
    toolExecutor.registerHandler(name, handler);
  }

  console.log(`[ResearchRoutes] Registered ${Object.keys(handlers).length} research tool handlers`);
}

// Register immediately on module load
try {
  registerResearchTools();
} catch (err) {
  console.warn('[ResearchRoutes] Tool registration deferred:', err.message);
}

// ─── Export ───

module.exports = router;
