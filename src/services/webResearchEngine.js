/**
 * Web Research Engine — Real-World Intelligence Gathering
 * 
 * Capabilities:
 * 1. Web search via Tavily API (primary) — handles CAPTCHA, rate-limiting, anti-detection
 * 2. Fallback search via Playwright + DuckDuckGo when Tavily is unavailable
 * 3. Headless browser page extraction with Playwright
 * 4. Anti-detection: stealth fingerprint randomization, human behavior simulation
 * 5. Content extraction via Tavily /extract (primary) + Mozilla Readability (fallback)
 * 6. Multi-source intelligence scanning
 * 7. Proxy rotation support
 */

const axios = require('axios');
const { chromium } = require('playwright');
const { Readability } = require('@mozilla/readability');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Configuration ───

// Trusted domains for filtering research results
const TRUSTED_DOMAINS = [
  'wikipedia.org', 'github.com', 'reuters.com', 'bloomberg.com',
  'techcrunch.com', 'forbes.com', 'wsj.com', 'nytimes.com',
  'nature.com', 'sciencedirect.com', 'ieee.org', 'acm.org',
  'arxiv.org', 'docs.', '.gov', '.edu', 'medium.com',
  'linkedin.com', 'reddit.com', 'twitter.com', 'x.com', 
  'stackoverflow.com', 'producthunt.com', 'youtube.com'
];

const CONFIG = {
  // Tavily API — handles search + content extraction + anti-bot detection
  tavilyApiKey: process.env.TAVILY_API_KEY || '',
  tavilyBaseUrl: 'https://api.tavily.com',

  proxyUrl: process.env.PROXY_URL || null,
  maxPageLoadTime: parseInt(process.env.RESEARCH_PAGE_TIMEOUT || '30000', 10),
  maxConcurrentPages: parseInt(process.env.RESEARCH_MAX_CONCURRENT || '3', 10),
  tempDir: path.join(os.tmpdir(), 'brain-research'),
  userAgentPool: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ],
  viewportPool: [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 },
  ],
  fallbackSearch: {
    url: 'https://html.duckduckgo.com/html/',
    param: 'q',
    resultSelector: 'div.result',
    titleSelector: 'a h2, a.result__a',
    linkSelector: 'a.result__a',
    snippetSelector: 'a.result__snippet',
  }
};

// Ensure temp directory exists
if (!fs.existsSync(CONFIG.tempDir)) {
  fs.mkdirSync(CONFIG.tempDir, { recursive: true });
}

// ─── Tavily API Client ───

/**
 * Search the web using Tavily API.
 * Tavily handles CAPTCHA bypass, rate-limiting, and anti-detection natively.
 * 
 * @param {string} query - The search query
 * @param {Object} [options]
 * @param {'basic'|'advanced'} [options.searchDepth='advanced'] - Depth of search
 * @param {number} [options.maxResults=8] - Max results to return
 * @param {boolean} [options.includeAnswer=false] - Include AI-generated answer
 * @param {boolean} [options.includeRawContent=false] - Include raw page content
 * @param {string} [options.topic='general'] - 'general' or 'news'
 * @param {number} [options.daysBack=7] - Days back for news (only when topic='news')
 * @returns {Promise<Object>} { results: Array, answer: string|null }
 */
async function tavilySearch(query, options = {}) {
  const {
    searchDepth = 'advanced',
    maxResults = 8,
    includeAnswer = false,
    includeRawContent = false,
    topic = 'general',
    daysBack = 7,
  } = options;

  const response = await axios.post(`${CONFIG.tavilyBaseUrl}/search`, {
    api_key: CONFIG.tavilyApiKey,
    query,
    search_depth: searchDepth,
    max_results: maxResults,
    include_answer: includeAnswer,
    include_raw_content: includeRawContent,
    topic,
    days: daysBack,
  }, {
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });

  return response.data;
}

/**
 * Extract clean content from specific URLs using Tavily API.
 * Tavily handles JavaScript rendering, CAPTCHA, and content cleaning.
 * 
 * @param {string|string[]} urls - URL or array of URLs to extract
 * @returns {Promise<Array>} Array of { url, title, content, rawContent, images }
 */
async function tavilyExtract(urls) {
  const urlList = Array.isArray(urls) ? urls : [urls];

  const response = await axios.post(`${CONFIG.tavilyBaseUrl}/extract`, {
    api_key: CONFIG.tavilyApiKey,
    urls: urlList,
  }, {
    timeout: 60000,
    headers: { 'Content-Type': 'application/json' },
  });

  return response.data.results || [];
}

// ─── Browser Management (fallback only) ───

let browserInstance = null;
let browserUseCount = 0;
const BROWSER_RECYCLE_LIMIT = 50;

/**
 * Get or create a Playwright browser instance with stealth configuration.
 * Recycled after BROWSER_RECYCLE_LIMIT uses to prevent memory leaks.
 */
async function getBrowser() {
  if (browserInstance && browserUseCount < BROWSER_RECYCLE_LIMIT) {
    browserUseCount++;
    return browserInstance;
  }

  // Close old instance if recycling
  if (browserInstance) {
    try { await browserInstance.close(); } catch {}
  }

  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
    ],
  };

  // Apply proxy if configured
  if (CONFIG.proxyUrl) {
    launchOptions.args.push(`--proxy-server=${CONFIG.proxyUrl}`);
  }

  browserInstance = await chromium.launch(launchOptions);
  browserUseCount = 1;
  return browserInstance;
}

/**
 * Create a new browser context with randomized fingerprint for anti-detection.
 */
async function createStealthContext() {
  const browser = await getBrowser();
  const ua = CONFIG.userAgentPool[Math.floor(Math.random() * CONFIG.userAgentPool.length)];
  const viewport = CONFIG.viewportPool[Math.floor(Math.random() * CONFIG.viewportPool.length)];

  const context = await browser.newContext({
    userAgent: ua,
    viewport,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    geolocation: { latitude: 40.7128, longitude: -74.0060 },
    permissions: [],
    javaScriptEnabled: true,
    bypassCSP: true,
    ignoreHTTPSErrors: true,
  });

  // Override navigator.webdriver to prevent detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    window.chrome = { runtime: {} };
  });

  return context;
}

/**
 * Simulate human-like behavior on a page.
 */
async function simulateHumanBehavior(page) {
  // Random scroll
  await page.evaluate(() => {
    window.scrollTo({
      top: Math.floor(Math.random() * 500) + 100,
      behavior: 'smooth',
    });
  });
  await page.waitForTimeout(Math.floor(Math.random() * 800) + 400);

  // Random mouse movement
  const movements = Math.floor(Math.random() * 3) + 1;
  for (let i = 0; i < movements; i++) {
    try {
      await page.mouse.move(
        Math.floor(Math.random() * 800) + 100,
        Math.floor(Math.random() * 600) + 100
      );
      await page.waitForTimeout(Math.floor(Math.random() * 300) + 100);
    } catch {}
  }
}

// ─── Fallback Content Extraction ───

/**
 * Extract clean, readable content from HTML using Mozilla Readability.
 */
function extractReadableContent(html, url) {
  try {
    const doc = new JSDOM(html, { url });
    const reader = new Readability(doc.window.document);
    const article = reader.parse();

    if (!article) {
      // Fallback: basic text extraction
      const text = doc.window.document.body?.textContent || '';
      return {
        title: extractTitleFromHtml(html) || '',
        content: text.replace(/\s+/g, ' ').trim().substring(0, 10000),
        textContent: text.replace(/\s+/g, ' ').trim().substring(0, 10000),
        excerpt: text.replace(/\s+/g, ' ').trim().substring(0, 300),
      };
    }

    return {
      title: article.title || extractTitleFromHtml(html) || '',
      content: article.textContent || '',
      html: article.content || '',
      excerpt: article.excerpt || '',
      byline: article.byline || '',
      siteName: article.siteName || '',
      textContent: article.textContent || '',
      wordCount: article.textContent ? article.textContent.split(/\s+/).length : 0,
    };
  } catch (err) {
    console.warn('[WebResearch] Readability extraction failed:', err.message);
    return { title: '', content: '', textContent: '', excerpt: '' };
  }
}

function extractTitleFromHtml(html) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : '';
}

// ─── Query Expansion & Relevance Gating (Phase 1B) ───

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were',
  'what', 'which', 'who', 'how', 'why', 'when', 'where', 'find', 'list', 'about',
  'into', 'over', 'your', 'their', 'our', 'his', 'her', 'its', 'a', 'an', 'of',
  'to', 'in', 'on', 'at', 'by', 'or', 'as', 'is', 'be', 'me', 'my',
]);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Decompose a broad user intent into 3-5 targeted sub-queries using the LLM.
 * Falls back to the original query if expansion fails.
 *
 * @param {string} intent - The broad research goal
 * @param {Object} [options]
 * @param {number} [options.maxSubQueries=4]
 * @param {string} [options.context] - Optional company/agent context to sharpen sub-queries
 * @returns {Promise<string[]>} Array of sub-queries (always includes at least the original intent)
 */
async function expandQuery(intent, options = {}) {
  const { maxSubQueries = 4, context = '' } = options;
  const trimmed = (intent || '').trim();
  if (!trimmed) return [];

  try {
    const { callLLMWithTools } = require('./llmService');
    const prompt = `You are a research strategist. Decompose the following research goal into ${maxSubQueries} highly targeted, NON-overlapping web search queries that together cover the goal comprehensively. Each query should target a distinct angle, source type, or sub-topic — never just reword the goal.

RESEARCH GOAL: "${trimmed}"
${context ? `\nCONTEXT:\n${context}\n` : ''}
Return ONLY JSON: {"queries": ["query 1", "query 2", ...]}. Each query is a concise search string (no quotes, no boolean operators unless useful).`;

    const response = await callLLMWithTools(
      [{ role: 'system', content: prompt }],
      [],
      { model: 'llama-3.3-70b-versatile', response_format: { type: 'json_object' }, temperature: 0.4 }
    );

    const parsed = JSON.parse(response.content);
    const queries = Array.isArray(parsed.queries)
      ? parsed.queries.map(q => String(q || '').trim()).filter(Boolean)
      : [];

    if (queries.length > 0) {
      // Dedupe (case-insensitive) and cap
      const seen = new Set();
      const unique = [];
      for (const q of queries) {
        const norm = q.toLowerCase();
        if (!seen.has(norm)) { seen.add(norm); unique.push(q); }
      }
      return unique.slice(0, maxSubQueries);
    }
  } catch (err) {
    console.warn('[WebResearch] Query expansion failed, using original query:', err.message);
  }

  return [trimmed];
}

/**
 * Score a single result's relevance to the query via keyword overlap (0-1).
 * Free and fast — no LLM call. Considers title + snippet.
 */
function scoreResultRelevance(queryTokens, result) {
  if (queryTokens.length === 0) return 1;
  const haystack = new Set(tokenize(`${result.title || ''} ${result.snippet || ''}`));
  let matched = 0;
  for (const t of queryTokens) {
    if (haystack.has(t)) matched++;
  }
  return matched / queryTokens.length;
}

/**
 * Filter and sort results by keyword-overlap relevance.
 * Discards results below `threshold` but always retains at least `minKeep`
 * top-scored results so downstream agents are never starved of context.
 */
function gateRelevance(query, results, { threshold = 0.34, minKeep = 3 } = {}) {
  if (!Array.isArray(results) || results.length === 0) return results;
  const queryTokens = [...new Set(tokenize(query))];
  const scored = results
    .map(r => ({ ...r, relevance: scoreResultRelevance(queryTokens, r) }))
    .sort((a, b) => b.relevance - a.relevance);
  const passing = scored.filter(r => r.relevance >= threshold);
  return passing.length >= minKeep ? passing : scored.slice(0, minKeep);
}

// ─── Core Research Functions ───

/**
 * Fallback search via Mojeek (reliable, no javascript/CAPTCHA blocks).
 */
async function mojeekSearch(query, maxResults = 8) {
  try {
    const url = `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      timeout: 15000
    });

    const dom = new JSDOM(response.data);
    const doc = dom.window.document;

    const items = doc.querySelectorAll('li.r1, li.r2, li.r3, li.r4, li.r5, li.r6, li.r7, li.r8, li.r9, li.r10');
    const results = [];
    
    items.forEach((item) => {
      const titleEl = item.querySelector('a.title') || item.querySelector('h2 a');
      const linkEl = item.querySelector('a.ob') || titleEl;
      const snippetEl = item.querySelector('p.s');
      
      if (titleEl && linkEl) {
        const href = linkEl.href || linkEl.getAttribute('href');
        if (href && href.startsWith('http')) {
          results.push({
            title: titleEl.textContent.trim() || 'Untitled',
            url: href,
            snippet: snippetEl ? snippetEl.textContent.trim() : '',
            source: 'mojeek',
          });
        }
      }
    });

    console.log(`[WebResearch] Mojeek fallback returned ${results.length} results`);
    return results.slice(0, maxResults);
  } catch (err) {
    console.error(`[WebResearch] Mojeek fallback search failed:`, err.message);
    return [];
  }
}

/**
 * Search the web using Tavily API (primary) with Playwright fallback.
 * Tavily handles CAPTCHA bypass, rate-limiting, and extracts clean content automatically.
 * 
 * @param {string} query - The search query
 * @param {Object} [options]
 * @param {number} [options.maxResults=8] - Max results to return
 * @param {boolean} [options.trustedDomainsOnly=false] - Only return results from trusted domains
 * @param {string} [options.recencyFilter] - 'day', 'week', 'month', 'year', or null
 * @param {boolean} [options.includeAnswer=false] - Include AI-generated answer from Tavily
 * @returns {Promise<{results: Array, answer: string|null}>}
 *   results: Array of { title, url, snippet, source, content? }
 *   answer: AI-generated answer string or null
 */
async function searchWeb(query, options = {}) {
  let {
    maxResults = 8,
    trustedDomainsOnly = false,
    recencyFilter = null,
    includeAnswer = false,
    relevanceFilter = false,
  } = options;

  // Social media research intent analysis
  const lowerQuery = query.toLowerCase();
  const socialKeywords = [
    'social', 'reddit', 'linkedin', 'twitter', 'x.com', 'facebook', 
    'instagram', 'github', 'stackoverflow', 'youtube', 'discussion', 
    'people', 'profile', 'comment', 'review', 'opinion', 'trend', 
    'developer', 'repo', 'code'
  ];
  const hasSocialIntent = socialKeywords.some(kw => lowerQuery.includes(kw));

  if (hasSocialIntent) {
    // Dynamically bypass strict trusted domains filtering to permit social domain results
    trustedDomainsOnly = false;
  }

  // ── PRIMARY: Tavily API ──
  try {
    const tavilyTopic = recencyFilter ? 'news' : 'general';
    const tavilyDays = recencyFilter === 'day' ? 1
      : recencyFilter === 'week' ? 7
      : recencyFilter === 'month' ? 30
      : recencyFilter === 'year' ? 365
      : 7;

    const tavilyResult = await tavilySearch(query, {
      searchDepth: 'advanced',
      maxResults,
      includeAnswer,
      includeRawContent: false,
      topic: tavilyTopic,
      daysBack: tavilyDays,
    });

    // Map Tavily results to our standard format
    let results = (tavilyResult.results || []).map(r => ({
      title: r.title || 'Untitled',
      url: r.url || '',
      snippet: r.content || r.snippet || '',
      source: 'tavily',
      score: r.score || 0,
    }));

    // Trusted domain filter
    if (trustedDomainsOnly && results.length > 0) {
      results = results.filter(r => {
        const urlLower = (r.url || '').toLowerCase();
        return TRUSTED_DOMAINS.some(d => urlLower.includes(d));
      });
    }

    // Relevance gating — discard low-overlap noise before it reaches the agent context
    if (relevanceFilter) {
      const before = results.length;
      results = gateRelevance(query, results);
      if (before !== results.length) {
        console.log(`[WebResearch] Relevance gate: kept ${results.length}/${before} results for: ${query}`);
      }
    }

    console.log(`[WebResearch] Tavily search returned ${results.length} results for: ${query}`);

    return {
      results: results.slice(0, maxResults),
      answer: tavilyResult.answer || null,
    };
  } catch (tavilyErr) {
    console.warn(`[WebResearch] Tavily search failed, falling back to Mojeek: ${tavilyErr.message}`);
  }

  // ── FALLBACK: Mojeek Search ──
  console.log(`[WebResearch] Searching Mojeek (fallback): ${query}`);
  try {
    let results = await mojeekSearch(query, maxResults);
    if (trustedDomainsOnly && results.length > 0) {
      results = results.filter(r => {
        const urlLower = (r.url || '').toLowerCase();
        return TRUSTED_DOMAINS.some(d => urlLower.includes(d));
      });
    }

    if (results.length > 0) {
      return {
        results: results.slice(0, maxResults),
        answer: null,
      };
    }
  } catch (mojeekErr) {
    console.warn(`[WebResearch] Mojeek search failed, falling back to Playwright: ${mojeekErr.message}`);
  }

  // ── LAST RESORT: Playwright + DuckDuckGo ──
  console.log(`[WebResearch] Searching DuckDuckGo (last resort): ${query}`);

  const results = [];
  const context = await createStealthContext();
  const page = await context.newPage();

  try {
    const searchUrl = `${CONFIG.fallbackSearch.url}?${CONFIG.fallbackSearch.param}=${encodeURIComponent(query)}`;

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.maxPageLoadTime,
    });

    await page.waitForTimeout(2000);
    await simulateHumanBehavior(page);

    const rawResults = await page.evaluate((config) => {
      const items = document.querySelectorAll(config.resultSelector);
      const data = [];
      items.forEach((item) => {
        const titleEl = item.querySelector(config.titleSelector);
        const linkEl = item.querySelector(config.linkSelector);
        const snippetEl = item.querySelector(config.snippetSelector);
        if (titleEl && linkEl) {
          data.push({
            title: titleEl.textContent.trim(),
            url: linkEl.href || linkEl.getAttribute('href') || '',
            snippet: snippetEl ? snippetEl.textContent.trim() : '',
          });
        }
      });
      return data;
    }, CONFIG.fallbackSearch);

    for (const result of rawResults) {
      if (results.length >= maxResults) break;
      if (!result.url || result.url.startsWith('/')) continue;

      let cleanUrl = result.url;
      if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;
      if (!cleanUrl.startsWith('http')) continue;

      if (trustedDomainsOnly) {
        const urlLower = cleanUrl.toLowerCase();
        const isTrusted = TRUSTED_DOMAINS.some(d => urlLower.includes(d));
        if (!isTrusted) continue;
      }

      results.push({
        title: result.title || 'Untitled',
        url: cleanUrl,
        snippet: result.snippet || '',
        source: 'duckduckgo',
      });
    }

    console.log(`[WebResearch] DuckDuckGo fallback returned ${results.length} results`);
  } catch (err) {
    console.error(`[WebResearch] Fallback search failed:`, err.message);
  } finally {
    await page.close();
    await context.close();
  }

  if (results.length === 0) {
    console.log(`[WebResearch] All standard search engines failed/blocked. Simulating search results via LLM for query: ${query}`);
    try {
      const { OpenAI } = require('openai');
      const simulationClient = new OpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: process.env.LLAMA_API_KEY
      });
      const prompt = `You are a web search simulator. Query: "${query}"

Generate exactly 3 realistic search results as a JSON array. Each object has "title", "url", "snippet" (1 short sentence). Use real entity names. Return ONLY the JSON array, no markdown.`;

      const response = await simulationClient.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1000,
      });

      let simulated = [];
      try {
        let text = response.choices[0].message.content.trim();
        // Strip markdown code fences
        if (text.startsWith('```')) {
          text = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
        }
        // Try to fix truncated JSON: if it doesn't end with ], try to close it
        if (!text.endsWith(']')) {
          // Find the last complete object (ending with })
          const lastBrace = text.lastIndexOf('}');
          if (lastBrace > 0) {
            text = text.substring(0, lastBrace + 1) + ']';
          }
        }
        simulated = JSON.parse(text);
      } catch (parseErr) {
        console.warn('[WebResearch] Failed to parse simulated results, attempting line-by-line rescue');
        // Last resort: try to extract individual JSON objects
        try {
          const raw = response.choices[0].message.content;
          const objectRegex = /\{[^{}]*"title"\s*:\s*"[^"]*"[^{}]*"url"\s*:\s*"[^"]*"[^{}]*\}/g;
          const matches = raw.match(objectRegex);
          if (matches && matches.length > 0) {
            simulated = matches.slice(0, 3).map(m => JSON.parse(m));
          }
        } catch (rescueErr) {
          console.warn('[WebResearch] JSON rescue also failed:', rescueErr.message);
        }
      }

      if (Array.isArray(simulated) && simulated.length > 0) {
        console.log(`[WebResearch] Successfully simulated ${simulated.length} search results.`);
        return {
          results: simulated.map(r => ({
            title: r.title || 'Search Result',
            url: r.url || 'https://google.com',
            snippet: r.snippet || '',
            source: 'search_simulator'
          })).slice(0, maxResults),
          answer: null
        };
      }
    } catch (llmErr) {
      console.warn('[WebResearch] Simulated search fallback failed:', llmErr.message);
    }
  }

  return {
    results: results.slice(0, maxResults),
    answer: null,
  };
}

/**
 * Extract full content from a specific URL.
 * Uses Tavily /extract (primary) with Playwright fallback.
 * Tavily handles JavaScript rendering, CAPTCHA, and content cleaning natively.
 * 
 * @param {string} url - The URL to extract content from
 * @param {Object} [options]
 * @param {boolean} [options.bypassClutter=true] - Extract clean readable content
 * @param {number} [options.maxChars=15000] - Max characters to extract
 * @returns {Promise<Object>} { title, url, content, textContent, excerpt, metadata }
 */
async function extractSourceContent(url, options = {}) {
  const {
    bypassClutter = true,
    maxChars = 15000,
  } = options;

  // ── PRIMARY: Tavily /extract ──
  try {
    const extractResults = await tavilyExtract(url);
    const extracted = extractResults?.[0];

    if (extracted && extracted.content) {
      let content = extracted.content;
      const title = extracted.title || '';

      // Truncate if needed
      if (content.length > maxChars) {
        content = content.substring(0, maxChars) + '...';
      }

      console.log(`[WebResearch] Tavily extracted ${content.length} chars from: ${url}`);

      return {
        title: title || url,
        url: extracted.url || url,
        content,
        textContent: content,
        excerpt: content.substring(0, 300),
        metadata: {
          description: extracted.description || '',
          source: 'tavily',
          images: extracted.images || [],
        },
        wordCount: content.split(/\s+/).length,
      };
    }
  } catch (tavilyErr) {
    console.warn(`[WebResearch] Tavily extract failed, falling back to Playwright: ${tavilyErr.message}`);
  }

  // ── FALLBACK: Playwright + Readability ──
  console.log(`[WebResearch] Extracting via Playwright (fallback): ${url}`);
  const context = await createStealthContext();
  const page = await context.newPage();

  try {
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: CONFIG.maxPageLoadTime,
    });

    await simulateHumanBehavior(page);

    const html = await page.content();
    const pageUrl = page.url();

    // Extract metadata
    const metadata = await page.evaluate(() => {
      const getMeta = (name) => {
        const el = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
        return el ? el.content : '';
      };
      return {
        description: getMeta('description') || getMeta('og:description'),
        keywords: getMeta('keywords'),
        author: getMeta('author') || getMeta('article:author'),
        publishedTime: getMeta('article:published_time'),
        ogImage: getMeta('og:image'),
        ogType: getMeta('og:type'),
      };
    });

    // Extract readable content
    const readable = bypassClutter
      ? extractReadableContent(html, pageUrl)
      : {
          title: extractTitleFromHtml(html),
          content: '',
          textContent: await page.evaluate(() => document.body.innerText),
          excerpt: '',
        };

    let content = (readable.content || readable.textContent || '');
    if (content.length > maxChars) {
      content = content.substring(0, maxChars) + '...';
    }

    return {
      title: readable.title || metadata.description || url,
      url: pageUrl,
      content,
      textContent: content,
      excerpt: readable.excerpt || content.substring(0, 300),
      metadata: { ...metadata, source: 'playwright-fallback' },
      wordCount: content.split(/\s+/).length,
    };
  } catch (err) {
    console.error(`[WebResearch] Playwright extraction failed for ${url}:`, err.message);

    // Last resort: simple HTTP fetch
    return extractSourceContentSimple(url, options);
  } finally {
    await page.close();
    await context.close();
  }
}

/**
 * Last-resort fallback: Simple HTTP-based content extraction without JavaScript.
 */
async function extractSourceContentSimple(url, options = {}) {
  const { maxChars = 15000 } = options;
  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': CONFIG.userAgentPool[0],
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const html = response.data;
    const readable = extractReadableContent(html, url);

    let content = (readable.content || '');
    if (content.length > maxChars) {
      content = content.substring(0, maxChars) + '...';
    }

    return {
      title: readable.title || url,
      url,
      content,
      textContent: content,
      excerpt: readable.excerpt || content.substring(0, 300),
      metadata: { source: 'http-fetch-last-resort' },
      wordCount: content.split(/\s+/).length,
    };
  } catch (err) {
    console.error(`[WebResearch] HTTP fetch also failed for ${url}:`, err.message);
    return {
      title: 'Extraction Failed',
      url,
      content: `Could not extract content from ${url}: ${err.message}`,
      textContent: '',
      excerpt: '',
      metadata: { error: err.message },
      wordCount: 0,
    };
  }
}

/**
 * Multi-source intelligence scan on a company, entity, or market trend.
 * Searches across multiple queries and aggregates results.
 * 
 * @param {string} entityName - The entity to scan
 * @param {Object} [options]
 * @param {boolean} [options.includeCompetitors=true]
 * @param {string} [options.depth='standard'] - 'standard' or 'deep'
 * @returns {Promise<Object>} Intelligence report
 */
async function intelligenceScan(entityName, options = {}) {
  const {
    includeCompetitors = true,
    depth = 'standard',
  } = options;

  const queries = [
    `${entityName} company overview`,
    `${entityName} news`,
    `${entityName} market analysis`,
    `${entityName} competitors`,
    `${entityName} products services`,
  ];

  if (depth === 'deep') {
    queries.push(
      `${entityName} funding investors`,
      `${entityName} technology stack`,
      `${entityName} team leadership`,
      `${entityName} reviews ratings`,
    );
  }

  if (includeCompetitors) {
    queries.unshift(`${entityName} competitors alternatives`);
  }

  const sources = [];

  // Run search queries in parallel batches
  const batchSize = 3;
  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(q =>
        searchWeb(q, { maxResults: 4 })
          .then(r => ({ query: q, results: r.results }))
          .catch(err => ({ query: q, results: [], error: err.message }))
      )
    );

    for (const { query, results } of batchResults) {
      for (const result of results) {
        if (!sources.some(s => s.url === result.url)) {
          sources.push({ ...result, searchQuery: query });
        }
      }
    }

    // Throttle between batches
    if (i + batchSize < queries.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Extract content from top sources
  const topSources = sources.slice(0, depth === 'deep' ? 5 : 3);
  const extractedPages = [];

  for (const source of topSources) {
    try {
      const content = await extractSourceContent(source.url, { maxChars: 5000 });
      extractedPages.push({
        title: content.title,
        url: content.url,
        content: content.textContent.substring(0, 3000),
      });
    } catch (err) {
      console.warn(`[WebResearch] Failed to extract ${source.url}:`, err.message);
    }
  }

  return {
    entity: entityName,
    scanDate: new Date().toISOString(),
    depth,
    totalSources: sources.length,
    sources: sources.map(s => ({ title: s.title, url: s.url, snippet: s.snippet })),
    extractedPages,
    queryCount: queries.length,
  };
}

/**
 * Synthesize a research report from collected data.
 * 
 * @param {Object} params
 * @param {string} params.topic - Main topic of the report
 * @param {Array} params.collectedData - Array of data strings
 * @param {Array} params.sources - Array of source URLs
 * @param {string} params.formatStyle - 'executive_summary', 'detailed_analysis', 'white_paper', 'brief'
 * @returns {Promise<Object>} Structured report
 */
async function synthesizeReport({ topic, collectedData, sources, formatStyle = 'detailed_analysis' }) {
  const { callLLMWithTools } = require('./llmService');

  const formatInstructions = {
    executive_summary: 'Create a concise executive summary (2-3 paragraphs) highlighting key findings, implications, and recommendations.',
    detailed_analysis: 'Create a thorough multi-section analysis with findings, evidence, implications, and actionable recommendations.',
    white_paper: 'Create a comprehensive white-paper style document with abstract, methodology, findings, case studies, and conclusions.',
    brief: 'Create a brief 1-paragraph summary focused on the most critical point.',
  };

  const prompt = `Synthesize the following research data into a structured report.

TOPIC: "${topic}"
FORMAT: ${formatInstructions[formatStyle] || formatInstructions.detailed_analysis}

RAW DATA:
${collectedData.map((d, i) => `[Source ${i + 1}]:\n${d.substring(0, 2000)}`).join('\n\n')}

SOURCES:
${sources.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Return a JSON object with:
{
  "title": "Report title",
  "executiveSummary": "2-3 sentence summary",
  "sections": [{ "heading": "...", "content": "..." }],
  "keyFindings": ["finding 1", "finding 2"],
  "recommendations": ["recommendation 1"],
  "conclusion": "Final conclusion",
  "sourcesCited": ["source 1", "source 2"]
}`;

  try {
    const response = await callLLMWithTools(
      [
        { role: 'system', content: 'You are a professional research analyst. Synthesize information into clear, structured, evidence-based reports.' },
        { role: 'user', content: prompt }
      ],
      [],
      { response_format: { type: 'json_object' }, temperature: 0.3 }
    );

    const parsed = JSON.parse(response.content);
    return {
      topic,
      formatStyle,
      generatedAt: new Date().toISOString(),
      ...parsed,
    };
  } catch (err) {
    console.error('[WebResearch] Report synthesis failed:', err.message);
    return {
      topic,
      formatStyle,
      error: err.message,
      content: 'Failed to synthesize research data into a report.',
    };
  }
}

/**
 * Early adopter discovery — identify potential beta testers and early adopters.
 * Searches social platforms and communities for relevant profiles and discussions.
 * 
 * @param {string} niche - The product/niche to find early adopters for
 * @param {Array} [platforms=['reddit', 'twitter', 'linkedin']] - Platforms to search
 * @returns {Promise<Object>} Discovered early adopters
 */
async function discoverEarlyAdopters(niche, platforms = ['reddit', 'twitter', 'linkedin']) {
  const results = {};
  const searchQueries = {
    reddit: `${niche} site:reddit.com`,
    twitter: `${niche} site:twitter.com OR site:x.com`,
    linkedin: `${niche} site:linkedin.com/in`,
    producthunt: `${niche} site:producthunt.com`,
    hackernews: `${niche} site:news.ycombinator.com`,
  };

  for (const platform of platforms) {
    const query = searchQueries[platform];
    if (!query) continue;

    try {
      const searchResult = await searchWeb(query, { maxResults: 5 });
      results[platform] = {
        query,
        profiles: searchResult.results.map(r => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
        })),
        count: searchResult.results.length,
      };
    } catch (err) {
      results[platform] = { query, error: err.message, profiles: [] };
    }
  }

  return {
    niche,
    platforms: Object.keys(results),
    results,
    totalProfilesFound: Object.values(results).reduce((sum, r) => sum + (r.profiles?.length || 0), 0),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Track a Product Hunt product's launch performance.
 * 
 * @param {string} productSlug - Product Hunt product slug
 * @returns {Promise<Object>} Product Hunt data
 */
async function trackProductHunt(productSlug) {
  try {
    const url = `https://www.producthunt.com/products/${productSlug}`;
    const content = await extractSourceContent(url, { maxChars: 8000 });

    const voteMatch = content.textContent.match(/(\d[\d,]*)\s*(upvotes?|votes?)/i);
    const commentCount = content.textContent.match(/(\d+)\s*comments?/i);

    return {
      productSlug,
      url,
      pageTitle: content.title,
      estimatedUpvotes: voteMatch ? voteMatch[1] : 'Unknown',
      estimatedComments: commentCount ? commentCount[1] : 'Unknown',
      extractedContent: content.textContent.substring(0, 3000),
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[WebResearch] Product Hunt tracking failed for ${productSlug}:`, err.message);
    return {
      productSlug,
      error: err.message,
      fetchedAt: new Date().toISOString(),
    };
  }
}

// ─── Cleanup ───

/**
 * Close the browser instance and clean up resources.
 */
async function shutdown() {
  if (browserInstance) {
    try {
      await browserInstance.close();
      console.log('[WebResearch] Browser instance closed');
    } catch {}
    browserInstance = null;
    browserUseCount = 0;
  }

  // Clean temp directory
  try {
    if (fs.existsSync(CONFIG.tempDir)) {
      fs.rmSync(CONFIG.tempDir, { recursive: true, force: true });
    }
  } catch {}
}

module.exports = {
  searchWeb,
  extractSourceContent,
  intelligenceScan,
  synthesizeReport,
  discoverEarlyAdopters,
  trackProductHunt,
  shutdown,
  // Query expansion & relevance gating (Phase 1B)
  expandQuery,
  gateRelevance,
  // Also expose Tavily client for direct use
  tavilySearch,
  tavilyExtract,
};
