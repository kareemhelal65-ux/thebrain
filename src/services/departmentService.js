/**
 * Department Service (Phase D1 / D1.5)
 *
 * Turns each "agent" into a department dashboard that tailors itself to WHAT THE
 * COMPANY DOES. A static `DEPARTMENT_BLUEPRINTS` map declares the *candidate*
 * building blocks (widgets, recipes, setup questions, proactive focus) per
 * department; `configureDepartment()` resolves a company-specific config from:
 *   1. the onboarding profile (what they sell, to whom, how they make money),
 *   2. connected integrations (`getCompanyConfig().enabled_services`),
 *   3. a department-filtered Brain summary,
 * via a hybrid rule pass (hard constraints) + fail-open LLM pass (prioritization +
 * framing). The resolved config is persisted into `department_settings.answers`.
 *
 * Team (people) is intentionally treated as STATIC by the frontend — it is included
 * here for relevance/setup bookkeeping only and never marked dormant.
 */

const supabase = require('../models/supabaseClient');
const { v4: uuidv4 } = require('uuid');
const { getCompanyConfig } = require('../models/companyConfig');
const { retrieveCompanyContextDetailed } = require('./retrievalService');
const { callLLMWithTools } = require('./llmService');
const { AGENT_RECIPES, AGENT_DEFINITIONS } = require('./agentOrchestrator');

// ─── Department → agent type + Brain taxonomy mapping ───
// `agentType` keys into AGENT_RECIPES / agent execution. `brainDept` maps a UI
// department onto the document_chunks.department taxonomy (operations/product/
// commercial/finance/hr/general) so retrieval can be department-filtered.
const DEPARTMENTS = {
  marketing:   { label: 'Marketing',          agentType: 'marketing',   brainDept: 'commercial' },
  finance:     { label: 'Finance',            agentType: 'finance',     brainDept: 'finance' },
  sales:       { label: 'Sales',              agentType: 'sales',       brainDept: 'commercial' },
  crm:         { label: 'CRM',                agentType: 'crm',         brainDept: 'commercial' },
  investment:  { label: 'Investment',         agentType: 'investment',  brainDept: 'finance' },
  product:     { label: 'Product / PM',       agentType: 'product',     brainDept: 'product' },
  people:      { label: 'Team',               agentType: 'people',      brainDept: 'hr' },
  engineering: { label: 'Engineering',        agentType: 'engineering', brainDept: 'product' },
};

function isKnownDepartment(dept) {
  return Object.prototype.hasOwnProperty.call(DEPARTMENTS, dept);
}

// ─── Blueprints ───────────────────────────────────────────────────────────────
// relevantWhen / neededWhen / relevanceRule all receive the resolved `ctx`
// (see buildCompanyContext). They are plain predicates so the rule pass is cheap
// and deterministic; the LLM pass only re-prioritizes what survives.

const W = (id, title, dataSource, relevantWhen = () => true) => ({ id, title, dataSource, relevantWhen });

const DEPARTMENT_BLUEPRINTS = {
  marketing: {
    widgets: [
      W('positioning', 'Positioning & Messaging', 'brain'),
      W('strategy_7week', '7-Week Strategy', 'strategy'),
      W('funnel', 'Funnel & Channels', 'brain'),
      W('shopify_products', 'Top Products', 'integration:shopify', c => c.hasShopify),
      W('shopify_roas', 'Orders & Revenue', 'integration:shopify', c => c.hasShopify),
      W('client_pipeline', 'Client Pipeline', 'brain', c => c.isAgency),
      W('proposals', 'Marketing Automations', 'proposals'),
    ],
    recipes: ['market_research', 'strategy_7week', 'content_calendar', 'brand_identity', 'logos', 'landing_page'],
    setupQuestions: [
      { id: 'primary_goal', question: "What's the primary marketing goal right now?", choices: ['Awareness', 'Lead generation', 'Product launch', 'Revenue / sales'], profileKey: null, neededWhen: () => true },
      { id: 'channels', question: 'Which channels do you want to focus on?', choices: ['Content / SEO', 'Paid ads', 'Social', 'Email', 'Partnerships'], profileKey: null, neededWhen: () => true },
      { id: 'budget', question: "What's your rough monthly marketing budget?", choices: ['Bootstrapped (<$1k)', '$1k–$5k', '$5k–$25k', '$25k+'], profileKey: null, neededWhen: () => true },
    ],
    proactiveFocus: ['cross_doc_connection', 'scheduled_action'],
    relevanceRule: (c) => (c.isEcommerce || c.isAgency || c.isSaaS) ? 'primary' : 'secondary',
  },

  finance: {
    widgets: [
      W('runway', 'Runway & Burn', 'brain', c => !c.hasPaymentProvider || c.isPreRevenue),
      W('mrr', 'MRR / Revenue', 'integration:stripe', c => c.hasStripe),
      W('paymob_balance', 'Transactions & Balance', 'integration:paymob', c => c.hasPaymob),
      W('unit_economics', 'Unit Economics', 'brain', c => c.hasPaymentProvider),
      W('fundraise_readiness', 'Fundraise Readiness', 'brain', c => c.isVc),
      W('proposals', 'Finance Automations', 'proposals'),
    ],
    recipes: ['financial_model', 'runway_analysis', 'board_update', 'fundraise_readiness'],
    setupQuestions: [
      { id: 'finance_focus', question: 'What matters most for finance right now?', choices: ['Extending runway', 'Growing revenue', 'Profitability', 'Fundraising'], profileKey: null, neededWhen: () => true },
      { id: 'accounting_tool', question: 'How do you track finances today?', choices: ['Spreadsheets', 'QuickBooks / Xero', 'Stripe / payment dashboards', 'Accountant / bookkeeper'], profileKey: 'current_tools', neededWhen: () => true },
    ],
    proactiveFocus: ['upcoming_deadline', 'overdue_task'],
    relevanceRule: (c) => (c.hasPaymentProvider || c.isVc) ? 'primary' : 'secondary',
  },

  sales: {
    widgets: [
      W('icp', 'ICP & Lead List', 'brain', c => !c.isEcommerce),
      W('pipeline', 'Pipeline', 'brain', c => !c.isEcommerce),
      W('orders_aov', 'Orders & AOV', 'integration:shopify', c => c.hasShopify),
      W('conversion', 'Conversion', 'integration:shopify', c => c.hasShopify),
      W('proposals', 'Sales Automations', 'proposals'),
    ],
    recipes: ['lead_list', 'outreach_sequence', 'pipeline_review', 'sales_playbook'],
    setupQuestions: [
      { id: 'motion', question: "What's your primary sales motion?", choices: ['Self-serve / e-commerce', 'Inbound', 'Outbound', 'Partnerships / channel'], profileKey: null, neededWhen: () => true },
      { id: 'target_segment', question: 'Who is your target customer?', choices: ['SMBs', 'Mid-market', 'Enterprise', 'Consumers'], profileKey: 'target_customer', neededWhen: () => true },
    ],
    proactiveFocus: ['overdue_task', 'scheduled_action'],
    relevanceRule: (c) => (c.isEcommerce || c.isAgency || c.isSaaS) ? 'primary' : 'secondary',
  },

  crm: {
    widgets: [
      W('relationships', 'Relationship Report', 'brain'),
      W('follow_ups', 'Pending Follow-ups', 'brain'),
      W('proposals', 'CRM Automations', 'proposals'),
    ],
    recipes: ['relationship_report', 'follow_up_pack', 'account_health', 'renewal_plan'],
    setupQuestions: [
      { id: 'relationship_type', question: 'Which relationships matter most to track?', choices: ['Customers', 'Partners', 'Investors', 'Suppliers'], profileKey: null, neededWhen: () => true },
    ],
    proactiveFocus: ['overdue_task', 'scheduled_action'],
    relevanceRule: (c) => c.isAgency ? 'primary' : 'secondary',
  },

  investment: {
    widgets: [
      W('investor_shortlist', 'Investor Shortlist', 'brain'),
      W('readiness', 'Fundraise Readiness', 'brain'),
      W('proposals', 'Investment Automations', 'proposals'),
    ],
    recipes: ['investor_shortlist', 'pitch_review', 'readiness_score', 'data_room'],
    setupQuestions: [
      { id: 'raising', question: 'Are you actively raising?', choices: ['Yes, now', 'Soon (3–6 months)', 'Not yet', 'Not raising'], profileKey: null, neededWhen: () => true },
      { id: 'round', question: 'Which round are you targeting?', choices: ['Pre-seed', 'Seed', 'Series A', 'Later'], profileKey: 'company_stage', neededWhen: (c) => c.isVc },
    ],
    proactiveFocus: ['scheduled_action'],
    relevanceRule: (c) => c.isVc ? 'primary' : 'dormant',
  },

  product: {
    widgets: [
      W('roadmap_framing', 'Product Roadmap', 'brain'),
      W('sprint', 'Current Focus', 'brain'),
      W('handoff', 'Engineering Handoff', 'brain'),
      W('proposals', 'Product Automations', 'proposals'),
    ],
    recipes: ['prd', 'sprint_plan', 'feature_prioritization', 'competitive_teardown'],
    setupQuestions: [
      { id: 'product_stage', question: 'Where is the product today?', choices: ['Idea / spec', 'Building MVP', 'Launched', 'Scaling'], profileKey: 'company_stage', neededWhen: () => true },
      { id: 'eng_tool', question: 'Which coding tool does your team use to build?', choices: ['Claude Code', 'Codex', 'Cursor / IDE', 'In-house engineers', 'No external tool'], profileKey: null, neededWhen: () => true },
    ],
    proactiveFocus: ['scheduled_action', 'decision_gap'],
    relevanceRule: (c) => 'primary',
  },

  people: {
    // Team is rendered as a STATIC tab; blueprint kept minimal for relevance/setup only.
    widgets: [],
    recipes: ['hiring_plan', 'comp_benchmark', 'onboarding_program'],
    setupQuestions: [],
    proactiveFocus: [],
    relevanceRule: () => 'primary',
  },

  engineering: {
    widgets: [
      W('handoff', 'Code Handoff Package', 'brain'),
      W('proposals', 'Engineering Automations', 'proposals'),
    ],
    recipes: ['tech_spec', 'code_project', 'build_vs_buy', 'architecture_review'],
    setupQuestions: [
      { id: 'external_tool', question: 'Which agentic coding tool will run the build?', choices: ['Claude Code', 'Codex', 'Antigravity', 'Hermes', 'Other / in-house'], profileKey: null, neededWhen: () => true },
    ],
    proactiveFocus: [],
    relevanceRule: () => 'secondary',
  },
};

// ─── Context (the "what they do" anchor) ────────────────────────────────────────

async function buildCompanyContext(companyId) {
  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single();

  const profile = company || {};

  // Connected integrations (decrypt-free path is fine here — we only need provider names).
  let connectedProviders = new Set();
  let enabledServices = {};
  try {
    const cfg = await getCompanyConfig(companyId);
    enabledServices = cfg.enabled_services || {};
    for (const list of Object.values(enabledServices)) {
      for (const svc of list) {
        if (svc && svc.provider) connectedProviders.add(String(svc.provider).toLowerCase());
      }
    }
  } catch (err) {
    console.warn('[DepartmentService] getCompanyConfig failed:', err.message);
  }

  const text = [
    profile.industry, profile.description, profile.mission_vision, profile.business_model,
    profile.onboarding_type, profile.target_customer, profile.roadmap_type,
  ].filter(Boolean).join(' ').toLowerCase();

  const hasShopify = connectedProviders.has('shopify') || connectedProviders.has('woocommerce') || connectedProviders.has('magento');
  const hasStripe = connectedProviders.has('stripe');
  const hasPaymob = connectedProviders.has('paymob');
  const hasPaymentProvider = hasStripe || hasPaymob || connectedProviders.has('quickbooks') || connectedProviders.has('xero');

  const roadmapType = (profile.roadmap_type || '').toLowerCase();
  const stage = (profile.company_stage || '').toLowerCase();

  return {
    companyId,
    profile,
    connectedProviders,
    enabledServices,
    hasShopify,
    hasStripe,
    hasPaymob,
    hasPaymentProvider,
    isEcommerce: hasShopify || /e-?commerce|online store|retail|d2c|dtc|merch|shop/.test(text),
    isSaaS: /saas|software|platform|\bapp\b|\bapi\b|b2b/.test(text),
    isAgency: roadmapType === 'agency' || (profile.onboarding_type || '').toLowerCase() === 'agency' || /agency|consult|studio|services firm/.test(text),
    isNonprofit: roadmapType === 'nonprofit' || /non-?profit|charity|ngo|foundation/.test(text),
    isVc: roadmapType === 'vc' || /raising|venture|\bvc\b|fundrais|pre-seed|seed round|series [a-c]/.test(text),
    isPreRevenue: ['idea', 'concept', 'pre-seed', 'pre_seed', 'mvp', 'building'].includes(stage),
  };
}

/** A short department-filtered Brain summary used to tailor + ground the dept. */
async function getDepartmentBrainSummary(companyId, dept) {
  const meta = DEPARTMENTS[dept];
  const query = `${meta.label} strategy, priorities, status, and recent context for the company`;
  try {
    // Optimization: Check if there are any external/uploaded documents besides default onboarding profiles.
    // If not, return empty list immediately to save embedding pipeline / vector search latency.
    const { data: nonProfileChunks, error: checkErr } = await supabase
      .from('document_chunks')
      .select('id')
      .eq('tenant_id', companyId)
      .not('source_type', 'in', '("company_profile","user_profile")')
      .limit(1);

    if (checkErr) {
      console.warn(`[DepartmentService] non-profile chunks query failed:`, checkErr.message);
    }

    if (!nonProfileChunks || nonProfileChunks.length === 0) {
      return [];
    }

    // Try the department-filtered taxonomy first; fall back to an unfiltered
    // semantic query (chunk department tagging is sparse for new companies).
    let chunks = await retrieveCompanyContextDetailed(query, companyId, { department: meta.brainDept });
    if (!chunks || chunks.length === 0) {
      chunks = await retrieveCompanyContextDetailed(query, companyId, {});
    }
    return (chunks || []).map(c => (c.content || '').slice(0, 600)).filter(Boolean).slice(0, 6);
  } catch (err) {
    console.warn(`[DepartmentService] Brain summary failed for ${dept}:`, err.message);
    return [];
  }
}

// ─── Settings persistence ───────────────────────────────────────────────────────

async function getDepartmentSettings(companyId, dept) {
  const { data } = await supabase
    .from('department_settings')
    .select('*')
    .eq('company_id', companyId)
    .eq('department', dept)
    .maybeSingle();
  return data || null;
}

async function saveDepartmentSettings(companyId, dept, patch) {
  const existing = await getDepartmentSettings(companyId, dept);
  const row = {
    company_id: companyId,
    department: dept,
    answers: patch.answers !== undefined ? patch.answers : (existing?.answers || {}),
    setup_complete: patch.setup_complete !== undefined ? patch.setup_complete : (existing?.setup_complete || false),
    relevance: patch.relevance !== undefined ? patch.relevance : (existing?.relevance || 'secondary'),
    last_configured_at: patch.last_configured_at !== undefined ? patch.last_configured_at : existing?.last_configured_at,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('department_settings')
    .upsert([row], { onConflict: 'company_id,department' })
    .select()
    .single();
  if (error) {
    console.error('[DepartmentService] saveDepartmentSettings failed:', error.message);
    throw new Error(error.message);
  }
  return data;
}

// ─── Gap-only setup questions ────────────────────────────────────────────────────

function profileAnswers(question, ctx) {
  if (question.id === 'motion') {
    if (ctx.isEcommerce) {
      return 'Self-serve / e-commerce';
    }
    const text = [
      ctx.profile?.industry, ctx.profile?.description, ctx.profile?.mission_vision,
      ctx.profile?.business_model, ctx.profile?.target_customer
    ].filter(Boolean).join(' ').toLowerCase();

    if (/self-?serve|product-?led|freemium|plg/i.test(text)) {
      return 'Self-serve / e-commerce';
    }
    if (/enterprise|sales-?led|b2b enterprise|mid-market/i.test(text)) {
      return 'Outbound';
    }
    if (/inbound|content marketing|seo|inbound lead/i.test(text)) {
      return 'Inbound';
    }
    if (/partner|channel|reseller|referral|distributor/i.test(text)) {
      return 'Partnerships / channel';
    }
    if (ctx.isAgency || /consulting|agency|services/i.test(text)) {
      return 'Inbound';
    }
    if (ctx.isSaaS) {
      return 'Self-serve / e-commerce';
    }
  }

  if (!question.profileKey) return null;
  const v = ctx.profile?.[question.profileKey];
  if (v === undefined || v === null || String(v).trim() === '') return null;
  return String(v);
}

/** Returns { gaps: [questions to ask], autoAnswered: { id: value } }. */
function resolveSetupQuestions(blueprint, ctx, priorAnswers = {}) {
  const gaps = [];
  const autoAnswered = {};
  for (const q of (blueprint.setupQuestions || [])) {
    if (typeof q.neededWhen === 'function' && !q.neededWhen(ctx)) continue;
    if (priorAnswers && priorAnswers[q.id] !== undefined) {
      autoAnswered[q.id] = priorAnswers[q.id];
      continue;
    }
    const fromProfile = profileAnswers(q, ctx);
    if (fromProfile) {
      autoAnswered[q.id] = fromProfile;
      continue;
    }
    gaps.push({ id: q.id, question: q.question, choices: q.choices });
  }
  return { gaps, autoAnswered };
}

// ─── The resolver ────────────────────────────────────────────────────────────────

/**
 * Resolve a company-specific, tailored config for one department.
 * Rule pass (hard constraints) → fail-open LLM pass (prioritization + framing) →
 * gap-only questions → relevance. Persists the result into department_settings.
 */
async function configureDepartment(companyId, dept, { force = false } = {}) {
  if (!isKnownDepartment(dept)) throw new Error(`Unknown department: ${dept}`);
  const meta = DEPARTMENTS[dept];
  const blueprint = DEPARTMENT_BLUEPRINTS[dept];

  const ctx = await buildCompanyContext(companyId);
  const existing = await getDepartmentSettings(companyId, dept);
  const priorAnswers = existing?.answers?.setupAnswers || {};

  // ── Rule pass: keep widgets whose data source is available AND relevantWhen matches ──
  const ruleFiltered = (blueprint.widgets || []).filter(w => {
    if (typeof w.relevantWhen === 'function' && !w.relevantWhen(ctx)) return false;
    if (w.dataSource && w.dataSource.startsWith('integration:')) {
      const provider = w.dataSource.split(':')[1];
      if (provider === 'shopify') return ctx.hasShopify;
      if (provider === 'stripe') return ctx.hasStripe;
      if (provider === 'paymob') return ctx.hasPaymob;
      return ctx.connectedProviders.has(provider);
    }
    return true;
  });

  let selectedWidgets = ruleFiltered.map(w => ({ id: w.id, title: w.title, dataSource: w.dataSource }));
  let subtitle = defaultSubtitle(dept, ctx);

  // ── LLM pass (fail-open): prioritize widgets + craft a tailored subtitle ──
  if (ruleFiltered.length > 0) {
    try {
      const brain = await getDepartmentBrainSummary(companyId, dept);
      const llm = await llmPrioritize(meta, ctx, ruleFiltered, brain);
      if (llm) {
        if (Array.isArray(llm.widgetOrder) && llm.widgetOrder.length) {
          const byId = new Map(selectedWidgets.map(w => [w.id, w]));
          const ordered = llm.widgetOrder.map(id => byId.get(id)).filter(Boolean);
          // Keep any rule-filtered widgets the model omitted, appended after.
          const omitted = selectedWidgets.filter(w => !llm.widgetOrder.includes(w.id));
          if (ordered.length) selectedWidgets = [...ordered, ...omitted];
        }
        if (llm.subtitle && typeof llm.subtitle === 'string') subtitle = llm.subtitle.slice(0, 160);
      }
    } catch (err) {
      console.warn(`[DepartmentService] LLM prioritization failed for ${dept} (fail-open):`, err.message);
    }
  }

  // ── Gap-only questions + relevance ──
  const { gaps, autoAnswered } = resolveSetupQuestions(blueprint, ctx, priorAnswers);
  const relevance = blueprint.relevanceRule ? blueprint.relevanceRule(ctx) : 'secondary';
  const mergedAnswers = { ...autoAnswered, ...priorAnswers };

  const recipeDefs = (AGENT_RECIPES[meta.agentType] || []).filter(r => (blueprint.recipes || []).includes(r.id))
    .map(r => ({ id: r.id, label: r.label, icon: r.icon, description: r.description, output_type: r.output_type, render: r.render }));

  const resolvedConfig = {
    widgets: selectedWidgets,
    recipes: recipeDefs,
    subtitle,
    relevance,
    askedQuestions: gaps.map(g => g.id),
    autoAnswered: Object.keys(autoAnswered),
  };

  const setupComplete = existing?.setup_complete || gaps.length === 0;

  await saveDepartmentSettings(companyId, dept, {
    answers: { ...(existing?.answers || {}), setupAnswers: mergedAnswers, resolvedConfig },
    relevance,
    setup_complete: setupComplete,
    last_configured_at: new Date().toISOString(),
  });

  return {
    department: dept,
    label: meta.label,
    agentType: meta.agentType,
    subtitle,
    relevance,
    widgets: selectedWidgets,
    recipes: recipeDefs,
    setupQuestions: setupComplete ? [] : gaps,
    setupAnswers: mergedAnswers,
    setup_complete: setupComplete,
  };
}

function defaultSubtitle(dept, ctx) {
  const kind = ctx.isEcommerce ? 'e-commerce' : ctx.isAgency ? 'agency' : ctx.isNonprofit ? 'nonprofit' : ctx.isVc ? 'venture-backed startup' : ctx.isSaaS ? 'SaaS company' : 'company';
  const map = {
    marketing: `Marketing for your ${kind} — grounded in the Brain.`,
    finance: `Finance for your ${kind} — runway, revenue, and readiness.`,
    sales: `Sales for your ${kind} — pipeline and outreach.`,
    crm: `Relationships and follow-ups for your ${kind}.`,
    investment: `Fundraising and investor readiness.`,
    product: `Product planning for your ${kind}.`,
    people: `Your team and potential hires.`,
    engineering: `Build specs ready to hand to your coding tool.`,
  };
  return map[dept] || `${DEPARTMENTS[dept].label} dashboard.`;
}

async function llmPrioritize(meta, ctx, ruleFiltered, brain) {
  const p = ctx.profile;
  const companyBlock = [
    `Company: ${p.name || 'Unknown'}`,
    p.industry ? `Industry: ${p.industry}` : null,
    p.description ? `What they do: ${p.description}` : null,
    p.business_model ? `Business model: ${p.business_model}` : null,
    p.target_customer ? `Target customer: ${p.target_customer}` : null,
    p.company_stage ? `Stage: ${p.company_stage}` : null,
    p.roadmap_type ? `Growth path: ${p.roadmap_type}` : null,
    `Connected integrations: ${[...ctx.connectedProviders].join(', ') || 'none'}`,
  ].filter(Boolean).join('\n');

  const widgetList = ruleFiltered.map(w => `- ${w.id}: ${w.title} (${w.dataSource})`).join('\n');
  const brainBlock = (brain && brain.length) ? `\n\nRelevant Brain context:\n${brain.join('\n---\n')}` : '';

  const prompt = `You are the ${meta.label} department agent configuring your OWN dashboard for this specific company. Pick and order the most useful widgets for THIS company, and write a one-line tailored subtitle.

=== COMPANY ===
${companyBlock}${brainBlock}

=== AVAILABLE WIDGETS (already filtered to what's possible) ===
${widgetList}

Return STRICT JSON only:
{ "widgetOrder": ["widget_id", ...], "subtitle": "one concise line tailored to what this company does" }
- widgetOrder: the widget ids above, ordered most-useful-first for THIS company. Omit any that are genuinely not useful.
- subtitle: <= 140 chars, concrete to this company (not generic).`;

  const result = await callLLMWithTools(
    [{ role: 'system', content: prompt }],
    [],
    { model: 'llama-3.3-70b-versatile', temperature: 0.3, response_format: { type: 'json_object' }, companyId: ctx.companyId }
  );
  if (!result?.content) return null;
  try {
    const parsed = JSON.parse(result.content);
    return {
      widgetOrder: Array.isArray(parsed.widgetOrder) ? parsed.widgetOrder.filter(x => typeof x === 'string') : null,
      subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : null,
    };
  } catch {
    return null;
  }
}

// ─── Overview aggregation (drives the D1 shell) ──────────────────────────────────

/** Department's pending proactive proposals + suggestions (department-filtered, with legacy fallback). */
async function getDepartmentProposals(companyId, dept) {
  const meta = DEPARTMENTS[dept];
  const out = { automations: [], suggestions: [] };
  try {
    const { data: autos } = await supabase
      .from('proposed_automations')
      .select('id, type, description, action_payload, is_recurring, department, created_at')
      .eq('tenant_id', companyId)
      .eq('status', 'pending')
      .or(`department.eq.${dept},department.eq.${meta.brainDept}`)
      .order('created_at', { ascending: false })
      .limit(10);
    out.automations = autos || [];
  } catch (err) {
    console.warn('[DepartmentService] proposals fetch failed:', err.message);
  }
  try {
    const { data: sugg } = await supabase
      .from('proactive_suggestions')
      .select('id, title, description, category, priority, department, created_at')
      .eq('tenant_id', companyId)
      .eq('is_dismissed', false)
      .or(`department.eq.${dept},department.eq.${meta.brainDept}`)
      .order('created_at', { ascending: false })
      .limit(10);
    out.suggestions = sugg || [];
  } catch (err) {
    console.warn('[DepartmentService] suggestions fetch failed:', err.message);
  }
  return out;
}

/** Recent deliverables produced by this department's agent (agent_outputs joined via execution). */
async function getDepartmentDeliverables(companyId, dept) {
  const meta = DEPARTMENTS[dept];
  try {
    const { data: execs } = await supabase
      .from('agent_executions')
      .select('id')
      .eq('company_id', companyId)
      .eq('agent_type', meta.agentType)
      .order('created_at', { ascending: false })
      .limit(40);
    const execIds = (execs || []).map(e => e.id);
    if (execIds.length === 0) return [];

    const { data: outputs } = await supabase
      .from('agent_outputs')
      .select('id, output_type, title, summary, status, version, created_at')
      .in('agent_execution_id', execIds)
      .order('created_at', { ascending: false })
      .limit(12);
    return outputs || [];
  } catch (err) {
    console.warn('[DepartmentService] deliverables fetch failed:', err.message);
    return [];
  }
}

/**
 * Aggregate everything the department page needs: resolved config (auto-configuring
 * if absent or forced), Brain widget data, integration stats, proposals, deliverables.
 * Integration stats are resolved lazily by departmentStatsService (D2).
 */
async function getDepartmentOverview(companyId, dept, { reconfigure = false } = {}) {
  if (!isKnownDepartment(dept)) throw new Error(`Unknown department: ${dept}`);
  const meta = DEPARTMENTS[dept];

  let settings = await getDepartmentSettings(companyId, dept);
  let resolved;
  if (!settings || reconfigure || !settings.answers?.resolvedConfig) {
    resolved = await configureDepartment(companyId, dept, { force: reconfigure });
    settings = await getDepartmentSettings(companyId, dept);
  } else {
    const rc = settings.answers.resolvedConfig;
    resolved = {
      department: dept,
      label: meta.label,
      agentType: meta.agentType,
      subtitle: rc.subtitle || defaultSubtitle(dept, await buildCompanyContext(companyId)),
      relevance: settings.relevance || rc.relevance || 'secondary',
      widgets: rc.widgets || [],
      recipes: rc.recipes || [],
      setupQuestions: settings.setup_complete ? [] : (rc.askedQuestions || []).map(id => {
        const q = (DEPARTMENT_BLUEPRINTS[dept].setupQuestions || []).find(x => x.id === id);
        return q ? { id: q.id, question: q.question, choices: q.choices } : null;
      }).filter(Boolean),
      setupAnswers: settings.answers?.setupAnswers || {},
      setup_complete: settings.setup_complete,
    };
  }

  const [proposals, deliverables] = await Promise.all([
    getDepartmentProposals(companyId, dept),
    getDepartmentDeliverables(companyId, dept),
  ]);

  // Integration widget stats (D2) — resolved if the stats service is available.
  let stats = {};
  try {
    const statsSvc = require('./departmentStatsService');
    stats = await statsSvc.getStatsForWidgets(companyId, resolved.widgets);
  } catch (err) {
    // Stats service is optional until D2 lands.
  }

  return {
    ...resolved,
    proposals,
    deliverables,
    stats,
  };
}

/** Save first-run wizard answers, then re-resolve the config with them in hand. */
async function saveDepartmentSetup(companyId, dept, answers = {}) {
  if (!isKnownDepartment(dept)) throw new Error(`Unknown department: ${dept}`);
  const existing = await getDepartmentSettings(companyId, dept);
  const mergedAnswers = { ...(existing?.answers?.setupAnswers || {}), ...answers };
  await saveDepartmentSettings(companyId, dept, {
    answers: { ...(existing?.answers || {}), setupAnswers: mergedAnswers },
    setup_complete: true,
  });
  // Re-resolve so the new answers flow into widget framing immediately.
  return configureDepartment(companyId, dept, { force: true });
}

/**
 * Promote a chat-produced deliverable into the Workspace as a real, reviewable
 * agent_output. The chat orchestrator is conversational and never creates
 * agent_outputs, so a great deliverable written in the agent chat would otherwise
 * be invisible in the Workspace. This mints a lightweight completed execution for
 * this department's agent and creates a pending_approval output from the content,
 * so it can be previewed, commented on, revised, approved (→ stored to Brain +
 * feeds the self-learning loop) or rejected like any other deliverable.
 */
async function saveChatDeliverable(companyId, dept, { title, content, summary, outputType } = {}) {
  if (!isKnownDepartment(dept)) throw new Error(`Unknown department: ${dept}`);
  if (!content || (typeof content === 'string' && !content.trim())) {
    throw new Error('Deliverable content is required');
  }
  const meta = DEPARTMENTS[dept];
  const def = (AGENT_DEFINITIONS && AGENT_DEFINITIONS[meta.agentType]) || {};

  const executionId = uuidv4();
  const execution = {
    id: executionId,
    company_id: companyId,
    agent_type: meta.agentType,
    agent_label: def.label || meta.label,
    status: 'completed',
    icon: def.icon || null,
    color: def.color || null,
    priority: def.priority || 0,
    conversation_history: [],
    output_data: { source: 'chat' },
    progress_pct: 100,
    current_action: 'Saved from chat',
    iterations: 0,
    mode: 'executing',
    require_plan: false,
    completed_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('agent_executions').insert([execution]);
  if (error) throw new Error(`Failed to create execution: ${error.message}`);

  const { createApproval } = require('./approvalService');
  const output = await createApproval({
    executionId,
    companyId,
    outputType: outputType || 'document',
    title: title || `${meta.label} deliverable`,
    summary: summary || '',
    content: typeof content === 'string' ? { markdown: content, source: 'chat' } : (content || {}),
  });
  return output;
}

/** Lightweight relevance map for the nav (configures any missing departments). */
async function getDepartmentRelevance(companyId) {
  const result = {};
  const ctx = await buildCompanyContext(companyId);
  for (const [dept, blueprint] of Object.entries(DEPARTMENT_BLUEPRINTS)) {
    const existing = await getDepartmentSettings(companyId, dept);
    if (existing?.relevance) {
      result[dept] = existing.relevance;
    } else {
      result[dept] = blueprint.relevanceRule ? blueprint.relevanceRule(ctx) : 'secondary';
    }
  }
  // Team is always present and never dormant.
  result.people = 'primary';
  return result;
}

module.exports = {
  DEPARTMENTS,
  DEPARTMENT_BLUEPRINTS,
  isKnownDepartment,
  buildCompanyContext,
  configureDepartment,
  getDepartmentOverview,
  saveDepartmentSetup,
  saveChatDeliverable,
  getDepartmentSettings,
  getDepartmentRelevance,
  getDepartmentBrainSummary,
};
