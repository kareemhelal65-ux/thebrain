/**
 * Company Research Service
 * 
 * Scans a company's website, social media profiles, and other public sources
 * to build a structured knowledge profile stored in The Brain.
 * 
 * Flow:
 * 1. User completes onboarding → triggerResearchScan(companyId)
 * 2. Scrapes company website → extracts products, services, mission, team
 * 3. Scrapes social media (LinkedIn, X/Twitter, Instagram) → extracts profile info
 * 4. Synthesizes all data into structured company_insights records
 * 5. Stores a comprehensive profile into document_chunks (The Brain's memory)
 * 6. Returns the structured profile for the agent system to use
 */

const supabase = require('../models/supabaseClient');
const { searchWeb, extractSourceContent } = require('./webResearchEngine');
const { callLLMWithTools } = require('./llmService');
const { generateEmbedding } = require('./embeddingService');
const { v4: uuidv4 } = require('uuid');

// ─── Platform-Specific Research ───

/**
 * Extract the domain from a URL for labeling.
 */
function extractDomain(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace('www.', '');
  } catch {
    return url;
  }
}

/**
 * Research a company website — extract products, services, about, team, pricing.
 * @param {string} url
 * @returns {Promise<Object>} Structured website insights
 */
async function researchWebsite(url) {
  if (!url) return { summary: 'No website provided', details: {}, sources: [] };

  const domain = extractDomain(url);
  console.log(`[CompanyResearch] Scanning website: ${domain}`);

  // Extract homepage content
  const homepage = await extractSourceContent(url, { maxChars: 10000 });

  // Try to find key pages
  const keyPages = ['/about', '/team', '/products', '/services', '/pricing', '/mission'];
  const pageContents = [];

  for (const page of keyPages) {
    try {
      const pageUrl = new URL(page, url).href;
      const content = await extractSourceContent(pageUrl, { maxChars: 5000 });
      if (content && content.textContent && content.textContent.length > 200) {
        pageContents.push({ path: page, title: content.title, content: content.textContent.substring(0, 4000) });
      }
    } catch {
      // Page doesn't exist, skip
    }
  }

  // Synthesize website insights via LLM
  const combinedContent = [
    `Homepage: ${homepage.textContent?.substring(0, 5000) || ''}`,
    ...pageContents.map(p => `${p.path} (${p.title}): ${p.content}`),
  ].join('\n\n---\n\n');

  try {
    const llmResponse = await callLLMWithTools([
      { role: 'system', content: 'You are a business research analyst. Extract structured company information from website content. Return ONLY valid JSON.' },
      { role: 'user', content: `Extract the following from this company's website content. Return as JSON with these fields (use null for missing):\n
{
  "companyName": "Full legal name",
  "tagline": "Tagline or headline",
  "description": "2-3 sentence company description",
  "whatTheyDo": "What products/services they offer",
  "targetAudience": "Who they serve",
  "uniqueValueProp": "What makes them different",
  "teamSize": "Any mention of team size or employees",
  "foundedYear": null,
  "pricingModel": "Pricing info if found",
  "keyFeatures": ["List of key product features"],
  "industryKeywords": ["Relevant industry terms"],
  "websiteSections": ["What sections the site has"]
}\n\nWEBSITE CONTENT:\n${combinedContent.substring(0, 8000)}` }
    ], [], { temperature: 0.2 });

    const parsed = JSON.parse(llmResponse.content);
    return {
      summary: parsed.description || `Website of ${domain}`,
      details: parsed,
      sources: [
        { url, label: `Website — ${domain}` },
        ...pageContents.map(p => ({ url: new URL(p.path, url).href, label: `${p.title || p.path}` })),
      ],
    };
  } catch (err) {
    // Fallback: extract basic info from page title and content
    const title = homepage.title || domain;
    return {
      summary: `Website: ${title}`,
      details: {
        companyName: title,
        description: homepage.excerpt?.substring(0, 500) || '',
      },
      sources: [{ url, label: `Website — ${domain}` }],
    };
  }
}

/**
 * Research social media profiles.
 * @param {Object} socialUrls - { linkedin_url, x_url, instagram_url, tiktok_url }
 * @returns {Promise<Object>} Structured social insights
 */
async function researchSocialMedia(socialUrls) {
  const insights = { profiles: [], summary: '' };
  const profiles = [];

  for (const [platform, url] of Object.entries(socialUrls)) {
    if (!url) continue;

    const platformLabel = platform.replace('_url', '').replace('_', ' ').toUpperCase();
    console.log(`[CompanyResearch] Scanning ${platformLabel}: ${url}`);

    try {
      // Search for the company on this platform
      const searchQuery = url.includes('linkedin.com')
        ? `site:linkedin.com/company ${url.split('/').pop()}`
        : `${url.split('/').pop()} site:${new URL(url).hostname}`;

      const searchResult = await searchWeb(searchQuery, { maxResults: 3 });
      const profileContent = await extractSourceContent(url, { maxChars: 8000 });

      profiles.push({
        platform: platformLabel,
        url,
        title: profileContent.title || url,
        snippet: profileContent.excerpt?.substring(0, 500) || '',
        content: profileContent.textContent?.substring(0, 3000) || '',
        searchResults: searchResult.results.slice(0, 3),
      });
    } catch (err) {
      console.warn(`[CompanyResearch] Failed to scan ${platformLabel}: ${err.message}`);
      profiles.push({
        platform: platformLabel,
        url,
        title: platformLabel,
        snippet: 'Could not extract profile content',
        content: '',
        error: err.message,
      });
    }
  }

  return {
    profiles,
    summary: profiles.map(p => `${p.platform}: ${p.title}`).join(' | '),
  };
}

/**
 * Search the web for additional company context (news, reviews, competitors).
 * @param {string} companyName
 * @param {string} industry
 * @returns {Promise<Object>} Web research insights
 */
async function researchWebContext(companyName, industry) {
  console.log(`[CompanyResearch] Searching web context for: ${companyName}`);

  const queries = [
    `${companyName} ${industry} company overview`,
    `${companyName} news`,
    `${companyName} products services`,
  ];

  const allResults = [];
  for (const query of queries) {
    try {
      const result = await searchWeb(query, { maxResults: 4 });
      allResults.push(...result.results);
    } catch { /* skip */ }
  }

  // Deduplicate
  const seen = new Set();
  const uniqueResults = allResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  return {
    totalSources: uniqueResults.length,
    sources: uniqueResults.slice(0, 10).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
    })),
  };
}

// ─── Main Research Orchestrator ───

/**
 * Trigger a full company research scan.
 * Called after onboarding completes, or on demand.
 * 
 * @param {string} companyId - UUID of the company
 * @returns {Promise<Object>} Research results with insights
 */
async function triggerCompanyResearch(companyId) {
  console.log(`[CompanyResearch] Starting research for company: ${companyId}`);

  // Fetch company config
  const { data: company, error } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single();

  if (error || !company) {
    throw new Error(`Company not found: ${companyId}`);
  }

  // ─── STEP 1: Research website ───
  let websiteInsight = { summary: 'No website', details: {}, sources: [] };
  if (company.website) {
    websiteInsight = await researchWebsite(company.website);
    await storeInsight(companyId, {
      insight_type: 'website_scan',
      source_url: company.website,
      source_label: 'Company Website',
      summary: websiteInsight.summary,
      details: websiteInsight.details,
      confidence: 0.85,
      tags: ['website', extractDomain(company.website)],
    });
  }

  // ─── STEP 2: Research social media ───
  const socialUrls = {
    linkedin_url: company.linkedin_url,
    x_url: company.x_url,
    instagram_url: company.instagram_url,
    tiktok_url: company.tiktok_url,
  };

  const socialInsight = await researchSocialMedia(socialUrls);
  for (const profile of socialInsight.profiles) {
    if (!profile.error) {
      await storeInsight(companyId, {
        insight_type: 'social_media',
        source_url: profile.url,
        source_label: `${profile.platform} Profile`,
        summary: `${profile.platform}: ${profile.title}`,
        details: { title: profile.title, snippet: profile.snippet, content: profile.content },
        confidence: 0.8,
        tags: ['social_media', profile.platform.toLowerCase()],
      });
    }
  }

  // ─── STEP 3: Web context search ───
  const webContext = await researchWebContext(company.name, company.industry);
  if (webContext.sources.length > 0) {
    await storeInsight(companyId, {
      insight_type: 'market_position',
      source_url: null,
      source_label: 'Web Research',
      summary: `Found ${webContext.totalSources} external sources about ${company.name}`,
      details: { sources: webContext.sources },
      confidence: 0.7,
      tags: ['web_research', 'market_context'],
    });
  }

  // ─── STEP 4: Synthesize company profile into Brain memory ───
  await storeCompanyProfileToBrain(company, websiteInsight, socialInsight, webContext);

  console.log(`[CompanyResearch] Research complete for ${company.name}`);

  return {
    companyId,
    companyName: company.name,
    website: websiteInsight,
    social: socialInsight,
    webContext,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Store a single insight record in the company_insights table.
 */
async function storeInsight(companyId, { insight_type, source_url, source_label, summary, details, confidence, tags }) {
  try {
    const { error } = await supabase.from('company_insights').insert([{
      company_id: companyId,
      insight_type,
      source_url,
      source_label,
      summary,
      details,
      confidence: confidence || 0.8,
      tags: tags || [],
    }]);
    if (error) console.error('[CompanyResearch] Failed to store insight:', error.message);
  } catch (err) {
    console.error('[CompanyResearch] storeInsight error:', err.message);
  }
}

/**
 * Synthesize and store the full company profile into The Brain's document_chunks.
 * This makes it available for semantic search via the retrieval service.
 */
async function storeCompanyProfileToBrain(company, websiteInsight, socialInsight, webContext) {
  try {
    const profileSections = [];

    // Basic info
    profileSections.push(`Company Name: ${company.name}`);
    profileSections.push(`Industry: ${company.industry || 'Not specified'}`);
    profileSections.push(`Description: ${company.description || 'N/A'}`);

    if (company.website) profileSections.push(`Website: ${company.website}`);
    if (company.mission_vision) profileSections.push(`Mission & Vision: ${company.mission_vision}`);
    if (company.target_customer) profileSections.push(`Target Customer: ${company.target_customer}`);
    if (company.company_stage) profileSections.push(`Stage: ${company.company_stage}`);
    if (company.team_size) profileSections.push(`Team Size: ${company.team_size}`);
    if (company.location) profileSections.push(`Location: ${company.location}`);

    // Website research findings
    const webDetails = websiteInsight.details;
    if (webDetails && typeof webDetails === 'object') {
      if (webDetails.whatTheyDo) profileSections.push(`Products/Services: ${webDetails.whatTheyDo}`);
      if (webDetails.tagline) profileSections.push(`Tagline: ${webDetails.tagline}`);
      if (webDetails.uniqueValueProp) profileSections.push(`Unique Value: ${webDetails.uniqueValueProp}`);
      if (webDetails.targetAudience) profileSections.push(`Target Audience: ${webDetails.targetAudience}`);
      if (webDetails.keyFeatures && Array.isArray(webDetails.keyFeatures)) {
        profileSections.push(`Key Features: ${webDetails.keyFeatures.join(', ')}`);
      }
    }

    // Social profiles
    if (socialInsight.profiles && socialInsight.profiles.length > 0) {
      profileSections.push(`Social Media: ${socialInsight.profiles.map(p => `${p.platform}: ${p.url}`).join(' | ')}`);
    }

    // External sources
    if (webContext.sources && webContext.sources.length > 0) {
      profileSections.push(`External References: ${webContext.sources.map(s => s.title).join(', ')}`);
    }

    const profileText = profileSections.join('\n');

    // Generate embedding and store
    const embedding = await generateEmbedding(profileText);
    const { error } = await supabase.from('document_chunks').insert([{
      id: uuidv4(),
      tenant_id: company.id,
      content: profileText,
      embedding: JSON.stringify(embedding),
      source_type: 'company_research',
      source_id: company.id,
      source_title: `${company.name} — Company Research Profile`,
      metadata: {
        company_name: company.name,
        industry: company.industry,
        website: company.website,
        research_date: new Date().toISOString(),
        source_count: (webContext.sources?.length || 0) + (socialInsight.profiles?.length || 0) + 1,
      }
    }]);

    if (error) {
      console.error('[CompanyResearch] Failed to store brain profile:', error.message);
    } else {
      console.log(`[CompanyResearch] Stored research profile to Brain for "${company.name}"`);
    }
  } catch (err) {
    console.error('[CompanyResearch] storeCompanyProfileToBrain error:', err.message);
  }
}

module.exports = {
  triggerCompanyResearch,
  researchWebsite,
  researchSocialMedia,
  researchWebContext,
};
