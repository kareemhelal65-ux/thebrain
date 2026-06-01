/**
 * Marketing Strategy Service (Phase D2)
 *
 * The Marketing tab's auto-updating 7-week strategy. Follows the roadmapService
 * generate→store→re-eval pattern: `generateMarketingStrategy` runs the marketing
 * 7-week strategy grounded in the company profile + department setup answers +
 * Brain marketing context, stores it (one row per company), and is re-runnable on
 * demand ("Refresh") or when new marketing context lands.
 */

const supabase = require('../models/supabaseClient');
const { callLLMWithTools } = require('./llmService');

async function getStoredStrategy(companyId) {
  const { data } = await supabase
    .from('marketing_strategy')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();
  return data || null;
}

function normalizeWeeks(raw) {
  if (!Array.isArray(raw)) return null;
  const weeks = raw.slice(0, 7).map((w, i) => ({
    week: Number(w.week) || i + 1,
    focus: String(w.focus || w.theme || w.title || `Week ${i + 1}`).slice(0, 120),
    objectives: asList(w.objectives),
    channels: asList(w.channels),
    experiments: asList(w.experiments),
    kpis: asList(w.kpis),
  }));
  return weeks.length ? weeks : null;
}

function asList(v) {
  if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x : (x?.label || x?.name || JSON.stringify(x)))).filter(Boolean).slice(0, 6);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

/** Build a grounded context block: profile + dept setup answers + Brain marketing context. */
async function buildMarketingContext(companyId) {
  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single();
  const p = company || {};

  const profileLines = [
    `Company: ${p.name || 'Unknown'}`,
    p.industry ? `Industry: ${p.industry}` : null,
    p.description ? `What they do: ${p.description}` : null,
    p.mission_vision ? `Mission/Vision: ${p.mission_vision}` : null,
    p.business_model ? `Business model: ${p.business_model}` : null,
    p.target_customer ? `Target customer: ${p.target_customer}` : null,
    p.competitors ? `Competitors: ${p.competitors}` : null,
    p.company_stage ? `Stage: ${p.company_stage}` : null,
    p.roadmap_type ? `Growth path: ${p.roadmap_type}` : null,
  ].filter(Boolean);

  // Department setup answers (marketing) + Brain marketing summary.
  let setupBlock = '';
  let brainBlock = '';
  try {
    const deptSvc = require('./departmentService');
    const settings = await deptSvc.getDepartmentSettings(companyId, 'marketing');
    const answers = settings?.answers?.setupAnswers || {};
    if (Object.keys(answers).length) {
      setupBlock = '\nMarketing setup answers:\n' + Object.entries(answers).map(([k, v]) => `- ${k}: ${v}`).join('\n');
    }
    const brain = await deptSvc.getDepartmentBrainSummary(companyId, 'marketing');
    if (brain && brain.length) brainBlock = '\nBrain marketing context:\n' + brain.join('\n---\n');
  } catch (err) {
    console.warn('[MarketingStrategy] context enrichment failed:', err.message);
  }

  return { company: p, text: profileLines.join('\n') + setupBlock + brainBlock };
}

/**
 * Generate (or regenerate) and store the 7-week marketing strategy for a company.
 */
async function generateMarketingStrategy(companyId) {
  const { text } = await buildMarketingContext(companyId);

  const prompt = `You are an expert CMO building a concrete, week-by-week marketing strategy for THIS specific company. Generic advice is unacceptable — every week must reflect what this company actually does, who they sell to, and their stage/channels.

=== COMPANY ===
${text}

Produce a 7-WEEK marketing strategy. Each week builds on the last toward the company's primary goal.
Return STRICT JSON only:
{
  "weeks": [
    {
      "week": 1,
      "focus": "the theme/objective of this week",
      "objectives": ["specific objective", "..."],
      "channels": ["channel", "..."],
      "experiments": ["a concrete experiment to run", "..."],
      "kpis": ["measurable KPI", "..."]
    }
  ]
}
- Exactly 7 weeks.
- Make every item specific to this company (name their product, audience, channels, competitors where relevant).
- Keep each list to 2-4 tight items.`;

  let weeks = null;
  let isTailored = false;
  try {
    const result = await callLLMWithTools(
      [{ role: 'system', content: prompt }],
      [],
      { model: 'llama-3.3-70b-versatile', temperature: 0.5, response_format: { type: 'json_object' }, companyId }
    );
    if (result?.content) {
      const parsed = JSON.parse(result.content);
      weeks = normalizeWeeks(parsed.weeks || parsed.strategy || parsed);
      isTailored = !!weeks;
    }
  } catch (err) {
    console.warn('[MarketingStrategy] generation failed, using fallback skeleton:', err.message);
  }

  if (!weeks) weeks = fallbackWeeks();

  const row = {
    company_id: companyId,
    weeks,
    is_tailored: isTailored,
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('marketing_strategy')
    .upsert([row], { onConflict: 'company_id' })
    .select()
    .single();
  if (error) {
    console.error('[MarketingStrategy] store failed:', error.message);
    return { ...row, _stored: false };
  }
  return data;
}

async function getOrCreateMarketingStrategy(companyId) {
  const existing = await getStoredStrategy(companyId);
  if (existing && Array.isArray(existing.weeks) && existing.weeks.length) return existing;
  return generateMarketingStrategy(companyId);
}

function fallbackWeeks() {
  // Neutral skeleton so the UI always renders 7 weeks even if the LLM is unavailable.
  const themes = [
    'Foundations & positioning', 'Audience & messaging', 'Content engine',
    'Channel experiments', 'Lead capture & nurture', 'Conversion & offers', 'Review & scale',
  ];
  return themes.map((focus, i) => ({
    week: i + 1, focus, objectives: [], channels: [], experiments: [], kpis: [],
  }));
}

module.exports = {
  generateMarketingStrategy,
  getOrCreateMarketingStrategy,
  getStoredStrategy,
};
