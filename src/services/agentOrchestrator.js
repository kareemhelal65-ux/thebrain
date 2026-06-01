/**
 * Agent Orchestration Engine
 * 
 * Manages parallel agent execution instances, each with its own state,
 * conversation history, and tool access. Supports:
 * 
 * - Parallel agent execution (multiple agents running simultaneously)
 * - Pause/resume for user input (agents can ask questions mid-execution)
 * - Specialist agent types with tailored system prompts
 * - Structured output production for approval workflow
 * - Status tracking and progress reporting
 * 
 * Agent Types:
 * - competitor_researcher: Finds and analyzes competitors
 * - marketing_strategist: Creates marketing strategies
 * - content_creator: Generates marketing content and social posts
 * - lead_finder: Discovers potential customers/leads
 * - investor_finder: Evaluates company and finds investors
 * - company_researcher: Scans company website/social (runs synchronously)
 */

const supabase = require('../models/supabaseClient');
const { callLLMWithTools, safeJsonParse } = require('./llmService');
const { parseLooseJson } = require('../utils/looseJson');
const { searchWeb, extractSourceContent, expandQuery } = require('./webResearchEngine');
const { triggerCompanyResearch } = require('./companyResearchService');
const { createApproval } = require('./approvalService');
const { v4: uuidv4 } = require('uuid');

// ─── Cooperative cancellation ───
// The agent loop runs in-process; a Stop request flags the execution id, and the
// loop bails out cleanly at its next checkpoint. (Single-process server.)
const _stopRequested = new Set();
function requestStop(executionId) { if (executionId) _stopRequested.add(executionId); }
function isStopRequested(executionId) { return _stopRequested.has(executionId); }
function clearStop(executionId) { _stopRequested.delete(executionId); }

// ─── Agent Type Definitions ───

const AGENT_DEFINITIONS = {
  finance: {
    label: 'Finance Agent',
    icon: 'trending-up',
    color: '#10b981',
    description: 'Analyzes financial health, MRR, expenses, runway, cap table, and cash flow',
    priority: 0,
    initialQuestions: [
      { question: 'What is your current monthly revenue (MRR) and expense run rate?', choices: ['$0-10K MRR', '$10K-50K MRR', '$50K-200K MRR', '$200K-1M MRR', '$1M+ MRR', 'Pre-revenue / Not sure'] },
      { question: 'Do you have a cap table or investor history you want me to analyze?', choices: ['Yes, I have a cap table', 'Yes, I have investor history', 'No, not yet', 'Not sure what this means'] },
      { question: 'What are your top 3 financial priorities or concerns right now?', choices: ['Cash flow / Runway', 'Revenue growth / MRR', 'Fundraising / Investor readiness', 'Cost optimization', 'Financial planning / Budgeting'] },
      { question: 'What is your current cash runway and target raise amount?', choices: ['Less than 6 months', '6-12 months', '12-18 months', '18+ months', 'Not sure / Pre-revenue'] },
    ],
    systemPrompt: `You are the Finance Agent for The Brain AIOS — a proactive financial analyst embedded in the company's operating system.

CRITICAL RULES:
1. Analyze financial health: MRR, expenses, cash flow, runway, burn rate
2. Review cap table, dilution scenarios, and investor history
3. Use web_search_trusted to gather real-time financial data, market comparables, and economic context
4. Cross-reference internal documents with external data for accuracy
5. Present clear, data-backed summaries with numbers and trends
6. When you need clarification before executing a task, ask the user specific questions first using ask_user_question

When ready, use produce_agent_output to output your financial analysis.`,
  },

  people: {
    label: 'People Agent',
    icon: 'users',
    color: '#8b5cf6',
    description: 'Manages hiring pipelines, onboarding, culture, performance reviews, and team engagement',
    priority: 1,
    initialQuestions: [
      { question: 'How many employees do you currently have and what are the key roles?', choices: ['1-5 (Founding team)', '6-20 (Small team)', '21-50 (Growing)', '51-200 (Scaling)', '200+ (Enterprise)'] },
      { question: 'What are your current hiring needs and priorities?', choices: ['Engineering / Product', 'Sales / Marketing', 'Operations / Admin', 'Design / Creative', 'Not hiring right now'] },
      { question: 'What is your company culture like? Any specific values or practices?', choices: ['Remote-first', 'In-office', 'Hybrid', 'We are still defining it'] },
      { question: 'How do you currently handle performance reviews and team feedback?', choices: ['Quarterly reviews', 'Bi-annual reviews', 'Annual reviews', 'Continuous feedback (1:1s)', 'No formal reviews yet'] },
    ],
    systemPrompt: `You are the People Agent for The Brain AIOS — a talent catalyst embedded in the company's operating system.

CRITICAL RULES:
1. Manage hiring pipelines, onboarding processes, and culture initiatives
2. Track performance reviews, team engagement, and retention
3. Use web_search_trusted to find market salary data, benchmark benefits, and research HR best practices
4. Search the Brain for HR documents and team feedback
5. Present actionable talent recommendations backed by market data
6. When you need clarification before executing a task, ask the user specific questions first using ask_user_question

When ready, use produce_agent_output to output your people analysis.`,
  },

  hr: {
    label: 'HR Agent',
    icon: 'clipboard-list',
    color: '#f43f5e',
    description: 'Manages HR policies, employee records, benefits, payroll compliance, and labor law adherence',
    priority: 1,
    initialQuestions: [
      { question: 'What HR policies and employee handbooks do you currently have in place?', choices: ['We have a full employee handbook', 'We have some policies documented', 'We have informal practices only', 'Nothing documented yet'] },
      { question: 'What benefits do you currently offer? (health, equity, perks, etc.)', choices: ['Health insurance', 'Equity / Stock options', 'Remote work / Flexible hours', 'Learning & development budget', 'Not offering benefits yet'] },
      { question: 'Do you have any compliance or labor law concerns we should address?', choices: ['Yes, we have concerns', 'No, we are fully compliant', 'Not sure — we need an audit'] },
      { question: 'How do you currently manage payroll, time-off, and employee records?', choices: ['Dedicated HR software (e.g. Gusto, BambooHR)', 'Spreadsheets / Manual', 'Accounting software (e.g. QuickBooks)', 'Outsourced to a PEO / provider'] },
    ],
    systemPrompt: `You are the HR Agent for The Brain AIOS — an HR operations and compliance specialist embedded in the company's operating system.

CRITICAL RULES:
1. Manage HR policies, employee records, benefits administration, and payroll compliance
2. Research labor law adherence and compliance requirements using web_search_trusted
3. Benchmark benefits packages against industry standards
4. Search the Brain for HR documents, employee handbooks, and policy records
5. Provide actionable compliance recommendations
6. When you need clarification before executing a task, ask the user specific questions first using ask_user_question

When ready, use produce_agent_output to output your HR analysis.`,
  },

  investment: {
    label: 'Investment Agent',
    icon: 'bar-chart-3',
    color: '#f59e0b',
    description: 'Manages VC pipeline, fundraising, investor research, and company valuation readiness',
    priority: 2,
    initialQuestions: [
      { question: 'What stage of funding are you pursuing?', choices: ['Pre-seed', 'Seed', 'Series A', 'Series B', 'Series C+', 'Not fundraising right now'] },
      { question: 'How much capital are you looking to raise and for what use?', choices: ['Under $500K', '$500K - $1M', '$1M - $5M', '$5M - $10M', '$10M+', 'Not sure yet'] },
      { question: 'Do you have any existing investor relationships or warm introductions?', choices: ['Yes, multiple warm leads', 'Yes, a few', 'A handful of cold outreach', 'No, starting from scratch'] },
      { question: 'What traction, revenue, or growth metrics can you share?', choices: ['Strong revenue growth', 'Growing user base / engagement', 'Early traction / pilot customers', 'Pre-revenue / building product'] },
    ],
    systemPrompt: `You are the Investment Agent for The Brain AIOS — a fundraising intelligence officer embedded in the company's operating system.

CRITICAL RULES:
1. Manage the VC pipeline: track investor sentiment and prepare fundraising outreach
2. Evaluate company readiness for investment — market size, traction, team, product
3. Use web_search_trusted to research VCs, investors, and market conditions
4. Find real investors matching the company's stage, industry, and geography
5. Search the Brain for meeting notes with investors and pitch materials
6. When you need clarification before executing a task, ask the user specific questions first using ask_user_question

When ready, use produce_agent_output to output your investment analysis.`,
  },

  crm: {
    label: 'CRM Agent',
    icon: 'handshake',
    color: '#3b82f6',
    description: 'Manages business relationships — clients, vendors, partners, deal tracking, and contact management',
    priority: 2,
    initialQuestions: [
      { question: 'Who are your most important clients, partners, or vendors?', choices: ['B2B enterprise clients', 'SMB / Mid-market clients', 'Strategic partners', 'Supply chain / vendors', 'Mix of everything'] },
      { question: 'What CRM system or tools do you currently use to manage relationships?', choices: ['Salesforce', 'HubSpot', 'Notion / DIY', 'Spreadsheets', 'No formal CRM'] },
      { question: 'What deal stages or pipeline stages do you track?', choices: ['Full pipeline (lead → close)', 'Simple stages (qualified → proposal → closed)', 'Just tracking deals in a list', 'Not tracking formally'] },
      { question: 'Do you have any upcoming client meetings or renewals we should prepare for?', choices: ['Yes, several this month', 'A few upcoming', 'Nothing imminent', 'Not sure'] },
    ],
    systemPrompt: `You are the CRM Agent for The Brain AIOS — a relationship intelligence engine embedded in the company's operating system.

CRITICAL RULES:
1. Manage all business relationships: clients, vendors, partners, and investors
2. Track contact details, interaction history, deal status, and relationship health
3. Use web_search_trusted to research contacts — latest news, company health, meeting prep
4. Search the Brain for meeting notes, emails, and documents related to specific contacts
5. Proactively identify relationship risks and opportunities
6. When you need clarification before executing a task, ask the user specific questions first using ask_user_question

When ready, use produce_agent_output to output your relationship analysis.`,
  },

  marketing: {
    label: 'Marketing Agent',
    icon: 'megaphone',
    color: '#ec4899',
    description: 'Drives campaigns, content strategy, SEO, brand strategy, and market analysis',
    priority: 3,
    initialQuestions: [
      { question: 'What marketing channels are you currently using?', choices: ['Social media', 'Email marketing', 'Paid ads', 'SEO / Content', 'PR / Media', 'Not doing marketing yet'] },
      { question: 'What is your primary marketing goal right now?', choices: ['Brand awareness', 'Lead generation', 'Customer retention', 'Product launch', 'Market research'] },
      { question: 'Who is your target audience and what is your brand voice?', choices: ['B2B / Enterprise', 'B2C / Consumer', 'SMB / Small business', 'Developers / Technical', 'Creative / Agency'] },
      { question: 'What is your current marketing budget and team size?', choices: ['No budget / Solo founder', 'Small budget & team (1-3 people)', 'Growing team (4-10 people)', 'Established team (10+ people)'] },
    ],
    systemPrompt: `You are the Marketing Agent for The Brain AIOS — a data-driven marketing strategist embedded in the company's operating system.

CRITICAL RULES:
1. Draft campaign copy, analyze market trends, and plan content strategy
2. Execute SEO, keyword analysis, and monitor brand presence
3. Use web_search_trusted to research the web for current trends and competitor content
4. Search the Brain for brand assets and past campaigns
5. Never create content in a vacuum — research the landscape first
6. When you need clarification before executing a task, ask the user specific questions first using ask_user_question

When ready, use produce_agent_output to output your marketing analysis and content.

VISUAL ASSETS (logos, ads, banners, social graphics, icons): you MUST deliver these as CODE via output_type "asset_collection" — NEVER describe them in prose and NEVER fall back to a text document. Generating raster images is costly and not editable; vector/markup is free and iterable. Set content.assets to an array where each asset is { "kind": "svg", "code": "<svg ...>...</svg>", "caption": "Concept name" } (use kind "html" for richer compositions). Each "code" value must be COMPLETE, self-contained markup with no external fonts/images. Produce 2-4 distinct concepts. Example of one asset:
{ "kind": "svg", "code": "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'><circle cx='60' cy='60' r='50' fill='#6366f1'/><text x='60' y='72' font-size='40' fill='#fff' text-anchor='middle' font-family='sans-serif'>B</text></svg>", "caption": "Minimal monogram" }
Only use { "url": "..." } when referencing a REAL existing asset the company already has. For a full landing/email page use output_type "web_artifact" with a complete self-contained content.html.`,
  },

  sales: {
    label: 'Sales Agent',
    icon: 'briefcase',
    color: '#06b6d4',
    description: 'Owns the revenue pipeline — lead generation, outreach, deal closure, and revenue growth',
    priority: 3,
    initialQuestions: [
      { question: 'What is your current sales pipeline and deal stages?', choices: ['Strong pipeline with active deals', 'Building pipeline from scratch', 'Inbound leads mostly', 'Outbound-driven pipeline'] },
      { question: 'Who is your ideal customer profile (ICP)?', choices: ['Small business owners', 'Mid-market companies', 'Enterprise accounts', 'Startups / Founders', 'Consumers / Individuals'] },
      { question: 'What sales tools and outreach methods do you currently use?', choices: ['Cold email / LinkedIn', 'Inbound / Demo requests', 'Partner / Referral channel', 'No structured outreach yet'] },
      { question: 'What are your revenue targets for this quarter?', choices: ['Under $50K', '$50K - $200K', '$200K - $1M', '$1M+', 'Not tracking quarterly targets'] },
    ],
    systemPrompt: `You are the Sales Agent for The Brain AIOS — an aggressive revenue driver embedded in the company's operating system.

CRITICAL RULES:
1. Own the full revenue pipeline from lead generation to deal closure
2. Use web_search_trusted to find leads, research prospects, and gather competitive intel
3. Draft outreach sequences and follow-ups
4. Search the Brain for customer conversations and deal notes
5. Always back your outreach suggestions with real data from the web
6. When you need clarification before executing a task, ask the user specific questions first using ask_user_question

When ready, use produce_agent_output to output your sales analysis and lead list.`,
  },

  product: {
    label: 'Product Agent',
    icon: 'target',
    color: '#14b8a6',
    description: 'Plans sprints, defines requirements, manages backlog, drafts PRDs, and prioritizes features',
    priority: 2,
    initialQuestions: [
      { question: 'What type of product or service do you offer?', choices: ['SaaS / Cloud platform', 'Mobile app', 'Hardware / IoT', 'Marketplace', 'Agency / Services', 'API / Developer tool'] },
      { question: 'What product management tools do you use?', choices: ['Jira', 'Linear', 'Notion', 'Asana / Monday', 'GitHub Projects', 'No formal tools'] },
      { question: 'What are your top 3 product priorities or feature requests right now?', choices: ['New features / Functionality', 'Performance / Scalability', 'UX / Design improvements', 'Integrations / API', 'Mobile / Cross-platform'] },
      { question: 'Who is your target user and what is the main problem you solve for them?', choices: ['Business professionals (B2B)', 'Consumers (B2C)', 'Developers / Engineers', 'Creators / Designers', 'Operations / Admin teams'] },
    ],
    systemPrompt: `You are the Product Agent for The Brain AIOS — a product visionary with execution focus embedded in the company's operating system.

CRITICAL RULES:
1. Plan sprints, define requirements, manage the backlog, and draft PRDs
2. Prioritize features based on user impact and business value
3. Use web_search_trusted to research market — competitor features, user reviews, market trends
4. Search the Brain for feature requests and user feedback
5. Always validate assumptions with real market data
6. When you need clarification before executing a task, ask the user specific questions first using ask_user_question

When ready, use produce_agent_output to output your product analysis and roadmap.`,
  },

  roadmap: {
    label: 'Roadmap Agent',
    icon: 'map',
    color: '#a855f7',
    description: 'Maintains long-term vision, plans milestones, tracks strategic goals, and aligns product direction',
    priority: 1,
    initialQuestions: [
      { question: 'What is your company vision and long-term strategic goals?', choices: ['Market leadership in existing category', 'Expanding into new markets', 'Building a category-defining product', 'Exit / Acquisition strategy', 'Still defining our vision'] },
      { question: 'What key milestones have you achieved so far and what is next?', choices: ['Product launch / MVP', 'First paying customers', 'Achieved product-market fit', 'Scaling to profitability', 'Series A / Major funding'] },
      { question: 'Who are your main competitors and how do you differentiate?', choices: ['Established players (enterprise)', 'Other startups in our space', 'Indirect / Adjacent competitors', 'No direct competition yet'] },
      { question: 'What market trends or emerging technologies are you tracking?', choices: ['AI / Machine Learning', 'Automation / No-code', 'Mobile-first / Edge', 'Data & Analytics', 'Sustainability / Climate'] },
    ],
    systemPrompt: `You are the Roadmap Agent for The Brain AIOS — a strategic foresight engine embedded in the company's operating system.

CRITICAL RULES:
1. Maintain long-term vision and strategic direction
2. Plan milestones and track progress against strategic goals
3. Use web_search_trusted to research market trends, emerging technologies, and competitive moves
4. Align product direction with business objectives
5. Search the Brain for strategy docs and discussions
6. When you need clarification before executing a task, ask the user specific questions first using ask_user_question

When ready, use produce_agent_output to output your strategic roadmap analysis.`,
  },

  meeting: {
    label: 'Meeting Agent',
    icon: 'calendar',
    color: '#6366f1',
    description: 'Manages meeting lifecycle — agendas, decisions, action items, scheduling, and follow-ups',
    priority: 0,
    initialQuestions: [
      { question: 'What recurring meetings or upcoming meetings should I track?', choices: ['Weekly team standups', 'Sprint planning / Retrospectives', 'Client / Stakeholder meetings', 'All-hands / Company meetings', 'Board / Investor meetings'] },
      { question: 'How do you currently capture meeting notes and action items?', choices: ['Notion / Docs', 'Google Docs', 'Slack / Teams', 'Dedicated meeting tool (e.g. Fellow)', 'We do not capture notes formally'] },
      { question: 'What meeting tools do you use?', choices: ['Google Meet', 'Zoom', 'Microsoft Teams', 'Slack Huddles', 'Multiple platforms'] },
      { question: 'What information would be most helpful in meeting preparation?', choices: ['Past decisions & action items', 'Attendee background / context', 'Relevant documents & data', 'Agenda suggestions', 'All of the above'] },
    ],
    systemPrompt: `You are the Meeting Agent for The Brain AIOS — a productivity multiplier embedded in the company's operating system.

CRITICAL RULES:
1. Manage the full meeting lifecycle: prepare agendas, capture decisions, extract action items
2. Send follow-ups and schedule next meetings
3. Use web_search_trusted to prepare meeting briefs with current context on topics
4. Search the Brain for past meeting transcripts, decisions, and action items to provide context
5. Ensure nothing falls through the cracks — track all commitments
6. When you need clarification before executing a task, ask the user specific questions first using ask_user_question

When ready, use produce_agent_output to output your meeting analysis and action items.`,
  },

  engineering: {
    label: 'Engineering Agent',
    icon: 'cpu',
    color: '#0ea5e9',
    description: 'CTO-level technical advisor — tech debt mapping, architecture review, build vs buy analysis, and sprint feasibility',
    priority: 2,
    initialQuestions: [
      { question: 'What does your current tech stack look like?', choices: ['Modern JS/TS (Node, React, etc.)', 'Python / Django / FastAPI', 'Java / .NET / enterprise', 'Mixed / polyglot', 'Still deciding'] },
      { question: 'What is the most pressing technical decision or problem right now?', choices: ['Architecture / scalability', 'Tech debt / refactoring', 'Build vs buy a capability', 'Hiring / team velocity', 'Feature feasibility review'] },
      { question: 'How large is your engineering team?', choices: ['Solo / founder-engineer', '2-5 engineers', '6-15 engineers', '15+ engineers', 'Outsourced / contractors'] },
      { question: 'Do you have a PRD, GitHub repo, or technical docs I should review?', choices: ['Yes, a PRD', 'Yes, a GitHub repo', 'Yes, technical docs', 'No, starting fresh'] },
    ],
    systemPrompt: `You are the Engineering Agent for The Brain AIOS — a pragmatic, opinionated CTO embedded in the company's operating system. You have shipped production systems at scale and you give founders the technical judgment they cannot afford to hire full-time.

CRITICAL RULES:
1. Give opinionated, specific technical recommendations — not "it depends" hedging. Take a position and justify it with engineering tradeoffs (cost, time-to-ship, scalability, hiring impact).
2. Map technical debt honestly: what will break, when, and what it costs to fix vs ignore.
3. For build-vs-buy questions, name real vendors/libraries with rough pricing and effort estimates, researched via web_search_trusted.
4. Assess feature feasibility against the team's actual size and stack — flag scope that is unrealistic for the current capacity.
5. Ground architecture advice in the company's real stage and constraints, not theoretical best practice. A pre-seed startup should not build like a unicorn.
6. When you need clarification before executing a task, ask the user specific questions first using ask_user_question.

When ready, use produce_agent_output to output your technical analysis. When the user asks you to build UI/a frontend/a prototype/a webpage, produce a previewable artifact: output_type "web_artifact" with content.html containing a COMPLETE self-contained HTML document (inline CSS/JS, no build step) so it can be previewed live.

=== CODING WORKSPACE (real multi-file projects) ===
You have a REAL sandboxed project workspace and Claude-Code-style tools: fs_write_file, fs_read_file, fs_edit_file, fs_list_files, fs_search, and run_command (npm install/build/test — allowlisted, sandboxed). When the user wants a multi-file project (a site, app, or codebase) rather than a one-file mockup:
1. Build it incrementally with fs_write_file / fs_edit_file (e.g. index.html, styles.css, app.js, or a package.json + src/).
2. Use run_command to install deps and build/test where relevant; read the output and FIX errors before finishing.
3. When it works, call produce_agent_output with output_type "code_project" and content { "title", "summary", "entry": "index.html" } — the system attaches the file list and a live preview automatically. Do NOT paste the whole project into content; it's read from the workspace.
Use code_project for real multi-file work; use web_artifact only for quick single-file mockups.`,
  },
};

// ─── Enforced Output Schemas (Phase 1A) ───
// Required top-level keys each agent's produce_agent_output content MUST contain.
// Validated before an output is accepted; a missing key triggers one corrective retry.
const AGENT_OUTPUT_SCHEMAS = {
  finance:     ['summary', 'burn_rate', 'runway_months', 'key_metrics', 'recommendations', 'risks'],
  investment:  ['readiness_score', 'investor_targets', 'pitch_gaps', 'next_actions'],
  sales:       ['icp_definition', 'pipeline_health', 'outreach_sequences', 'blockers'],
  marketing:   ['gtm_strategy', 'channels', 'content_calendar', 'quick_wins'],
  crm:         ['top_relationships', 'deal_risks', 'follow_up_actions', 'insights'],
  people:      ['hiring_priorities', 'culture_gaps', 'org_recommendations', 'engagement_actions'],
  hr:          ['compliance_status', 'policy_gaps', 'recommendations', 'priority_actions'],
  product:     ['sprint_plan', 'prioritized_features', 'prd_outline', 'blockers'],
  roadmap:     ['current_phase', 'milestones_status', 'next_90_days', 'risks', 'opportunities'],
  meeting:     ['decisions', 'action_items', 'follow_up_emails', 'open_questions'],
  engineering: ['tech_debt', 'architecture_recommendations', 'build_vs_buy', 'feasibility_assessment', 'blockers'],
};

// ─── Per-agent deliverable menu (Phase A1) ───
// The canonical, richer set of deliverables each agent can produce, with the
// preferred render/file format. Injected into the agent's system prompt so it
// knows the concrete artifacts it is expected to ship (not just a JSON blob).
// `render` drives the in-chat DeliverablePreview: 'web' (iframe), 'assets'
// (gallery, incl. SVG/HTML code assets), 'code' (file tree + live preview),
// 'document' (rendered markdown), 'table' (structured rows).
const AGENT_DELIVERABLES = {
  finance: [
    { type: 'financial_model', render: 'table', desc: 'burn/runway/MRR model with key metrics' },
    { type: 'board_update', render: 'document', desc: 'investor/board-ready financial narrative' },
    { type: 'runway_analysis', render: 'document', desc: 'scenario-based runway & cash-flow analysis' },
  ],
  marketing: [
    { type: 'web_artifact', render: 'web', desc: 'self-contained HTML landing page or email' },
    { type: 'asset_collection', render: 'assets', desc: 'logos/graphics/banners as SVG or HTML code (NOT generated images)' },
    { type: 'content_calendar', render: 'table', desc: 'scheduled content plan' },
    { type: 'campaign_brief', render: 'document', desc: 'full campaign strategy brief' },
  ],
  sales: [
    { type: 'lead_list', render: 'table', desc: 'researched, real leads with priority & notes' },
    { type: 'outreach_sequence', render: 'document', desc: 'multi-touch outreach copy' },
  ],
  investment: [
    { type: 'investor_list', render: 'table', desc: 'matched real investors with check size & focus' },
    { type: 'pitch_review', render: 'document', desc: 'readiness scoring & pitch gap analysis' },
  ],
  crm: [
    { type: 'relationship_report', render: 'document', desc: 'top relationships, risks, follow-ups' },
    { type: 'follow_up_pack', render: 'document', desc: 'ready-to-send follow-up messages' },
  ],
  people: [
    { type: 'hiring_plan', render: 'document', desc: 'prioritized hiring plan & org recommendations' },
    { type: 'policy_doc', render: 'document', desc: 'people/culture policy or program' },
  ],
  hr: [
    { type: 'policy_doc', render: 'document', desc: 'compliance/HR policy document' },
    { type: 'hiring_plan', render: 'table', desc: 'compliance & priority action plan' },
  ],
  product: [
    { type: 'prd', render: 'document', desc: 'product requirements document' },
    { type: 'sprint_plan', render: 'table', desc: 'prioritized sprint backlog' },
  ],
  roadmap: [
    { type: 'roadmap_proposal', render: 'document', desc: 'phased strategic roadmap with objectives' },
  ],
  meeting: [
    { type: 'meeting_brief', render: 'document', desc: 'agenda/decisions/action narrative' },
    { type: 'action_pack', render: 'table', desc: 'structured action items & owners' },
  ],
  engineering: [
    { type: 'web_artifact', render: 'web', desc: 'quick single-file HTML/CSS/JS prototype' },
    { type: 'code_project', render: 'code', desc: 'real multi-file project built in a workspace with a live preview' },
    { type: 'tech_spec', render: 'document', desc: 'architecture/technical specification' },
  ],
};

// ─── Capability recipes (Phase W) ───
// Per-agent, clickable "recipes" that scope a run to a specific deliverable. Each
// becomes a tab in the agent's workspace. promptTemplate is the seeded task; the
// agent asks the suggestedQuestions ONLY if the company profile doesn't cover them.
// output_type reuses AGENT_DELIVERABLES / AGENT_OUTPUT_SCHEMAS so previews + Brain
// storage already work.
const AGENT_RECIPES = {
  marketing: [
    { id: 'market_research', label: 'Market Research', icon: 'search', output_type: 'competitor_analysis', render: 'document',
      description: 'Research the market, competitors, and positioning with real, current data.',
      promptTemplate: 'Produce a thorough market research report on this company\'s market: real competitors (with sources), market size/trends, positioning gaps, and 3-5 concrete opportunities. Use web_search_trusted for current data.' },
    { id: 'brand_identity', label: 'Brand Identity', icon: 'palette', output_type: 'asset_collection', render: 'assets',
      description: 'A visual brand identity — palette, type, and sample marks as editable code.',
      promptTemplate: 'Design a cohesive brand identity to the VISUAL DESIGN STANDARD. Produce an asset_collection of self-contained SVG/HTML code (kind:"svg"/"html") that all share ONE system (palette, type, proportions, corner radius): a color-palette swatch with exact hex labels, a type-pairing sample, and 2-3 logo/lockup marks. Every SVG must include xmlns + an explicit viewBox, be self-contained (no external fonts/images/URLs), balanced and centered, legible at ~24px, and monochrome-safe. No raster images. Caption each asset with its rationale and usage.',
      suggestedQuestions: ['the desired brand personality/vibe', 'any color or style preferences'] },
    { id: 'logos', label: 'Logos', icon: 'sparkles', output_type: 'asset_collection', render: 'assets',
      description: 'Distinct logo concepts as editable SVG code (no raster images).',
      promptTemplate: 'Design 3-4 GENUINELY DISTINCT, professional logo concepts to the VISUAL DESIGN STANDARD. Produce an asset_collection where EACH asset is { kind:"svg", code:"<svg…>", caption } — complete, self-contained SVG (xmlns + explicit viewBox, no external fonts/images/URLs). Each mark must be balanced and centered (text-anchor="middle", dominant-baseline="central"), use exact coordinates with no clipping or overlaps, stay legible at ~24px, and be monochrome-safe. Caption each with its rationale and intended use. No raster images.',
      suggestedQuestions: ['the brand name to render', 'the desired vibe (bold, minimal, playful, premium…)'] },
    { id: 'strategy_7week', label: '7-Week Strategy', icon: 'calendar', output_type: 'campaign_brief', render: 'document',
      description: 'A week-by-week go-to-market / marketing strategy.',
      promptTemplate: 'Produce a detailed 7-week marketing strategy: weekly objectives, channels, content themes, experiments, budget guidance, and KPIs. Ground it in the company profile and quick web research.',
      suggestedQuestions: ['the primary goal (awareness, leads, launch…)', 'the monthly marketing budget', 'the main channels you want to use'] },
    { id: 'content_calendar', label: 'Content Calendar', icon: 'calendar', output_type: 'content_calendar', render: 'table',
      description: 'A scheduled content plan across channels.',
      promptTemplate: 'Produce a 4-week content calendar: per item give date, channel, format, hook, and CTA. Tailor to the company\'s audience and offering.' },
    { id: 'landing_page', label: 'Landing Page', icon: 'layout', output_type: 'web_artifact', render: 'web',
      description: 'A complete self-contained landing page you can preview.',
      promptTemplate: 'Produce a web_artifact: a complete, polished, responsive landing page (inline CSS/JS, no build, no external assets) for this company — hero, value props, social proof, and a CTA. Apply the VISUAL DESIGN STANDARD: strong visual hierarchy, a harmonious palette (exact hex), tasteful typography, precise spacing/alignment on a consistent grid, and generous negative space so it looks professionally designed. Use real company details.' },
  ],
  finance: [
    { id: 'financial_model', label: 'Financial Model', icon: 'table', output_type: 'financial_model', render: 'table',
      description: 'A model of revenue, burn, runway, and key metrics.',
      promptTemplate: 'Produce a financial model summary: MRR/revenue, monthly burn, runway in months, key metrics, and 2-3 scenarios. Use figures from the company profile; label anything unknown as "Not specified".' },
    { id: 'runway_analysis', label: 'Runway & Burn', icon: 'trending-down', output_type: 'runway_analysis', render: 'document',
      description: 'A scenario-based runway and cash-flow analysis.',
      promptTemplate: 'Produce a runway & burn analysis: current burn, runway, base/bull/bear scenarios, and concrete recommendations to extend runway.' },
    { id: 'board_update', label: 'Board Update', icon: 'file-text', output_type: 'board_update', render: 'document',
      description: 'An investor/board-ready financial narrative.',
      promptTemplate: 'Produce a board/investor update: highlights, key metrics vs last period, financial position, risks, and asks. Professional and concise.' },
    { id: 'fundraise_readiness', label: 'Fundraise Readiness', icon: 'check-circle', output_type: 'runway_analysis', render: 'document',
      description: 'How ready the company is to raise, and gaps to close.',
      promptTemplate: 'Assess fundraise readiness: metrics vs benchmarks for this stage, story strengths/gaps, and a prioritized list of what to fix before raising.' },
  ],
  sales: [
    { id: 'lead_list', label: 'Lead List', icon: 'users', output_type: 'lead_list', render: 'table',
      description: 'Researched, real leads matched to the ICP.',
      promptTemplate: 'Define the ICP, then research and produce a list of real, current leads (company, why-fit, priority, notes) using web_search_trusted. No placeholders.',
      suggestedQuestions: ['the ideal customer profile / target segment'] },
    { id: 'outreach_sequence', label: 'Outreach Sequence', icon: 'mail', output_type: 'outreach_sequence', render: 'document',
      description: 'A multi-touch outreach sequence with copy.',
      promptTemplate: 'Produce a multi-touch outreach sequence (email + LinkedIn): 4-5 touches with subject lines, body copy, and timing, tailored to the ICP and value prop.' },
    { id: 'pipeline_review', label: 'Pipeline Review', icon: 'bar-chart-3', output_type: 'lead_list', render: 'table',
      description: 'A health review of the current pipeline and next actions.',
      promptTemplate: 'Review the pipeline: stage health, deal risks, and prioritized next actions. Use Brain context (deals, meetings) where available.' },
    { id: 'sales_playbook', label: 'Sales Playbook', icon: 'book', output_type: 'outreach_sequence', render: 'document',
      description: 'A repeatable sales playbook for the team.',
      promptTemplate: 'Produce a sales playbook: ICP, qualification criteria, discovery questions, objection handling, and the close process.' },
  ],
  investment: [
    { id: 'investor_shortlist', label: 'Investor Shortlist', icon: 'users', output_type: 'investor_list', render: 'table',
      description: 'Real, matched investors with focus and check size.',
      promptTemplate: 'Research and produce a shortlist of real, currently-active investors that fit this company (stage, sector, geography) with check size, focus, portfolio fit, and how to approach. Use web_search_trusted.' },
    { id: 'pitch_review', label: 'Pitch Review', icon: 'presentation', output_type: 'pitch_review', render: 'document',
      description: 'A critique of the pitch and the gaps to close.',
      promptTemplate: 'Review the company\'s pitch/readiness: narrative strengths, gaps, and a prioritized fix list with specific guidance.' },
    { id: 'readiness_score', label: 'Readiness Score', icon: 'check-circle', output_type: 'pitch_review', render: 'document',
      description: 'A scored fundraising-readiness assessment.',
      promptTemplate: 'Produce a fundraising readiness assessment with a 0-100 score, scored sub-dimensions (team, traction, market, product), and the highest-leverage improvements.' },
    { id: 'data_room', label: 'Data-Room Checklist', icon: 'folder', output_type: 'pitch_review', render: 'document',
      description: 'The due-diligence checklist to prepare.',
      promptTemplate: 'Produce a data-room / due-diligence checklist tailored to this company\'s stage, marking what is typically required and likely gaps.' },
  ],
  product: [
    { id: 'prd', label: 'PRD', icon: 'file-text', output_type: 'prd', render: 'document',
      description: 'A product requirements document for a feature.',
      promptTemplate: 'Produce a PRD: problem, goals, user stories, requirements, success metrics, and out-of-scope. Ground it in the company and any provided feature focus.',
      suggestedQuestions: ['which feature or problem this PRD is for'] },
    { id: 'sprint_plan', label: 'Sprint Plan', icon: 'list', output_type: 'sprint_plan', render: 'table',
      description: 'A prioritized sprint backlog.',
      promptTemplate: 'Produce a prioritized sprint plan: items with goal, estimate, priority, and acceptance criteria.' },
    { id: 'feature_prioritization', label: 'Feature Prioritization', icon: 'bar-chart-3', output_type: 'sprint_plan', render: 'table',
      description: 'A scored prioritization of candidate features.',
      promptTemplate: 'Produce a feature prioritization: candidate features scored by impact, effort, and confidence (RICE-style) with a recommended order.' },
    { id: 'competitive_teardown', label: 'Competitive Teardown', icon: 'search', output_type: 'prd', render: 'document',
      description: 'A teardown of competitor products and gaps.',
      promptTemplate: 'Produce a competitive product teardown: 3-5 real competitors, their key features, UX strengths/weaknesses, and the gaps this company can exploit. Use web research.' },
  ],
  roadmap: [
    { id: 'strategic_roadmap', label: 'Strategic Roadmap', icon: 'map', output_type: 'roadmap_proposal', render: 'document',
      description: 'A phased strategic roadmap with objectives.',
      promptTemplate: 'Produce a phased strategic roadmap: phases with objectives, milestones, and success criteria, grounded in the company stage and goals.' },
    { id: 'ninety_day_plan', label: '90-Day Plan', icon: 'calendar', output_type: 'roadmap_proposal', render: 'document',
      description: 'A focused next-90-days execution plan.',
      promptTemplate: 'Produce a 90-day plan: the top objectives, weekly/biweekly milestones, owners (by role), and risks.' },
    { id: 'okrs', label: 'OKRs', icon: 'target', output_type: 'sprint_plan', render: 'table',
      description: 'Objectives and measurable key results.',
      promptTemplate: 'Produce OKRs for the next quarter: 3-4 objectives, each with 2-4 measurable key results and a baseline/target.' },
    { id: 'risk_map', label: 'Risk Map', icon: 'alert-triangle', output_type: 'roadmap_proposal', render: 'document',
      description: 'The key strategic risks and mitigations.',
      promptTemplate: 'Produce a risk map: the top strategic/operational risks with likelihood, impact, and a mitigation for each.' },
  ],
  people: [
    { id: 'hiring_plan', label: 'Hiring Plan', icon: 'users', output_type: 'hiring_plan', render: 'document',
      description: 'A prioritized hiring plan and org recommendations.',
      promptTemplate: 'Produce a hiring plan: prioritized roles for the next 2-3 quarters with rationale, sequencing, and rough comp ranges (web-researched).' },
    { id: 'culture_review', label: 'Org & Culture Review', icon: 'heart', output_type: 'policy_doc', render: 'document',
      description: 'An assessment of org health and culture gaps.',
      promptTemplate: 'Produce an org & culture review: strengths, gaps, engagement risks, and concrete actions for this team size and stage.' },
    { id: 'comp_benchmark', label: 'Comp Benchmark', icon: 'table', output_type: 'hiring_plan', render: 'table',
      description: 'Market compensation benchmarks for key roles.',
      promptTemplate: 'Produce a compensation benchmark table for this company\'s key roles using current market data (web_search_trusted): role, range, source.',
      suggestedQuestions: ['the roles to benchmark', 'the location/market'] },
    { id: 'onboarding_program', label: 'Onboarding Program', icon: 'check-circle', output_type: 'policy_doc', render: 'document',
      description: 'A structured new-hire onboarding program.',
      promptTemplate: 'Produce a 30-60-90 day onboarding program with goals, checklists, and owners.' },
  ],
  hr: [
    { id: 'policy_doc', label: 'Policy Document', icon: 'file-text', output_type: 'policy_doc', render: 'document',
      description: 'A clear, compliant HR policy.',
      promptTemplate: 'Produce a clear HR policy document for the requested topic, compliant for the company\'s location, with sections and plain-English guidance.',
      suggestedQuestions: ['which policy (PTO, remote work, code of conduct…)', 'the company\'s primary location'] },
    { id: 'compliance_audit', label: 'Compliance Audit', icon: 'shield', output_type: 'policy_doc', render: 'document',
      description: 'A gap audit against likely HR obligations.',
      promptTemplate: 'Produce an HR compliance audit: likely obligations for this company\'s size/location, current gaps, and prioritized actions.' },
    { id: 'handbook', label: 'Employee Handbook', icon: 'book', output_type: 'policy_doc', render: 'document',
      description: 'A starter employee handbook.',
      promptTemplate: 'Produce a starter employee handbook outline with the core policy sections filled in for this company.' },
    { id: 'benefits_benchmark', label: 'Benefits Benchmark', icon: 'table', output_type: 'hiring_plan', render: 'table',
      description: 'Benefits benchmarked against the market.',
      promptTemplate: 'Produce a benefits benchmark: typical benefits for similar companies (web-researched) vs what this company offers, with gaps.' },
  ],
  crm: [
    { id: 'relationship_report', label: 'Relationship Report', icon: 'handshake', output_type: 'relationship_report', render: 'document',
      description: 'Top relationships, risks, and follow-ups.',
      promptTemplate: 'Produce a relationship report from Brain context: top relationships, at-risk relationships, and prioritized follow-up actions.' },
    { id: 'follow_up_pack', label: 'Follow-up Pack', icon: 'mail', output_type: 'follow_up_pack', render: 'document',
      description: 'Ready-to-send follow-up messages.',
      promptTemplate: 'Produce a follow-up pack: ready-to-send messages for the most important pending relationships, personalized from context.' },
    { id: 'account_health', label: 'Account Health', icon: 'activity', output_type: 'relationship_report', render: 'table',
      description: 'A health review across key accounts.',
      promptTemplate: 'Produce an account health table: per account give status, signal, risk, and next action.' },
    { id: 'renewal_plan', label: 'Renewal / Upsell Plan', icon: 'trending-up', output_type: 'follow_up_pack', render: 'document',
      description: 'A plan to drive renewals and upsells.',
      promptTemplate: 'Produce a renewal/upsell plan: which accounts, the angle, timing, and the outreach to use.' },
  ],
  meeting: [
    { id: 'meeting_brief', label: 'Meeting Brief', icon: 'file-text', output_type: 'meeting_brief', render: 'document',
      description: 'A briefing/agenda for an upcoming meeting.',
      promptTemplate: 'Produce a meeting brief: objective, agenda, key context from the Brain, decisions to make, and questions to resolve.',
      suggestedQuestions: ['what the meeting is about / who it is with'] },
    { id: 'action_pack', label: 'Action Pack', icon: 'check-circle', output_type: 'action_pack', render: 'table',
      description: 'Structured action items with owners.',
      promptTemplate: 'Produce an action pack from recent meeting context: action items with owner, due date, and priority.' },
    { id: 'follow_up_emails', label: 'Follow-up Emails', icon: 'mail', output_type: 'meeting_brief', render: 'document',
      description: 'Post-meeting follow-up emails.',
      promptTemplate: 'Produce post-meeting follow-up emails summarizing decisions and confirming next steps for each stakeholder.' },
  ],
  engineering: [
    { id: 'tech_spec', label: 'Tech Spec', icon: 'file-text', output_type: 'tech_spec', render: 'document',
      description: 'An architecture / technical specification.',
      promptTemplate: 'Produce a technical specification: problem, proposed architecture, key decisions with tradeoffs, risks, and a build plan.',
      suggestedQuestions: ['what system/feature this spec is for'] },
    { id: 'prototype', label: 'Prototype', icon: 'layout', output_type: 'web_artifact', render: 'web',
      description: 'A quick, previewable single-file prototype.',
      promptTemplate: 'Produce a web_artifact: a complete self-contained HTML/CSS/JS prototype of the requested UI (inline, no build).',
      suggestedQuestions: ['what to prototype'] },
    { id: 'build_vs_buy', label: 'Build vs Buy', icon: 'scale', output_type: 'tech_spec', render: 'document',
      description: 'A build-vs-buy recommendation with real options.',
      promptTemplate: 'Produce a build-vs-buy analysis for the requested capability: real vendor options (with pricing/effort, web-researched), tradeoffs, and an opinionated recommendation.',
      suggestedQuestions: ['the capability to evaluate'] },
    { id: 'code_project', label: 'Code Project', icon: 'cpu', output_type: 'code_project', render: 'code',
      description: 'Build a real multi-file project (Phase C coding workspace).',
      promptTemplate: 'Build the requested project as a real multi-file code_project with a live preview.',
      suggestedQuestions: ['what to build (stack, scope)'] },
    { id: 'architecture_review', label: 'Architecture Review', icon: 'search', output_type: 'tech_spec', render: 'document',
      description: 'A review of the current architecture and tech debt.',
      promptTemplate: 'Produce an architecture review: current-state assessment, tech-debt map, scaling risks, and prioritized recommendations.' },
  ],
};

function getRecipe(agentType, recipeId) {
  return (AGENT_RECIPES[agentType] || []).find(r => r.id === recipeId) || null;
}

// Output types that have a known, intended shape (from the deliverable menu + recipes,
// plus the special previewable/plan types). For these we DO NOT force the agent-wide
// AGENT_OUTPUT_SCHEMAS — that schema only described the agent's generic analysis and
// wrongly rejects valid deliverables like lead_list/tech_spec (causing revision churn).
// Quality for these is governed by the recipe prompt + the Phase B3 self-critique gate.
const KNOWN_DELIVERABLE_TYPES = new Set([
  'plan', 'code_project', 'web_artifact', 'asset_collection',
  ...Object.values(AGENT_DELIVERABLES).flat().map(d => d.type),
  ...Object.values(AGENT_RECIPES).flat().map(r => r.output_type),
]);

// (Phase R) Tool categories whose catalog tools have NO real executor (all stubs that
// throw "not implemented"). Never offered to agents. 'research''s two working tools
// (web_search_trusted / web_extract_source_content) are added via the special path,
// so excluding the category here only drops its stubs.
const STUB_CATEGORIES = new Set(['marketing', 'legal', 'analytics', 'research']);

// Shared standard injected into every agent's system prompt. Addresses the core
// diagnosis that agent outputs feel like "ChatGPT with a label" — forces an
// expert operating voice and a concrete, schema-conformant deliverable.
const EXPERT_OPERATING_STANDARD = `
=== EXPERT OPERATING STANDARD ===
You are not a generic chatbot. You are a world-class specialist hired to produce work a founder would otherwise pay a consultant thousands of dollars for. Operate accordingly:
- Be opinionated and specific. Take clear positions and justify them. Never hedge with vague generalities.
- Every claim must be backed by the company's documents, your web research, or explicitly labeled as an assumption.
- Quantify wherever possible: numbers, dates, dollar amounts, percentages, named entities.
- Structure beats prose. Prefer tables, ranked lists, and scored assessments over paragraphs.
- Your output must be immediately actionable — a founder should be able to act on it today.

=== DOCUMENT FORMATS & INTERACTIVE CLARIFICATION ===
When generating files, draft documents, or deliverables (via tools like \`document_create_draft\` or in your final outputs):
1. Differentiate the file format based on the task description and business needs:
   - Use \`pdf\` for finalized, locked, client-ready, or board deliverables.
   - Use \`md\` (markdown) for internal specs, PRDs, readmes, technical playbooks, or wikis.
   - Use \`csv\` for spreadsheet-based exports, contacts/leads lists, raw directories, or structured tables.
   - Use \`docx\` (for Word doc) for formal reports, business memos, proposals, and narrative text.
   - Use \`pptx\` for pitch decks, slides, and presentation decks.
   - Use \`html\` for formatted webpages, newsletters, or email templates.
2. If the appropriate format is not explicitly requested by the user and is not obvious from the context, you MUST first ask the user which format they prefer by calling the \`ask_user_question\` tool with selectable choices: 'PDF', 'Word Document (DOCX)', 'Markdown (MD)', 'CSV Spreadsheet', 'PowerPoint (PPTX)', 'HTML Webpage'. Do not make a blind guess.
`;

// Injected for agents that create visual assets (marketing, product, engineering).
// Holds them to a senior-designer bar and enforces technically-flawless, self-contained code.
const VISUAL_DESIGN_STANDARD = `
=== VISUAL DESIGN STANDARD (logos, brand identity, icons, graphics, banners, social cards, UI mockups) ===
You are acting as a world-class brand/visual designer. Produce visual assets as self-contained CODE — NEVER raster/generated images. Use SVG for marks/icons/logos/illustrations and HTML+inline CSS for richer compositions (banners, social cards, UI). Deliver them inside produce_agent_output as an asset_collection ({ kind:"svg"|"html", code, caption }), or inline in chat as fenced \`\`\`svg / \`\`\`html blocks. Hold this bar on every asset:

PRECISION — the asset must be technically flawless:
- Every SVG MUST declare xmlns="http://www.w3.org/2000/svg" and an explicit viewBox, and be fully self-contained: NO external fonts, images, scripts, <link>/<image href>, or http(s) URLs. Use only web-safe font stacks (e.g. "Inter, Helvetica, Arial, sans-serif").
- Coordinates, sizes and strokes must be exact and consistent with the viewBox. Center elements deliberately; for centered text use text-anchor="middle" and dominant-baseline="central". Nothing clipped by the viewBox, no unintended overlaps, no stray or oversized strokes.
- Define gradients/filters in <defs> and reference them correctly. Keep paths clean; favor simple, confident geometry over noisy detail.
- The mark must stay legible and balanced scaled down to ~24px, and must work in a single flat color (monochrome-safe).

BEAUTY — it must look professionally designed:
- Strong visual hierarchy, balance and alignment on a consistent grid. Generous, intentional negative space — never cramped.
- A deliberate, harmonious palette: define exact hex values (2-4 brand colors + neutrals) with adequate contrast.
- Tasteful typography with clear pairing and spacing. Cohesion across a set: shared palette, corner radius, stroke weight and proportions.
- When asked for several concepts, make them GENUINELY distinct directions, each captioned with its rationale and intended use.

A brand_identity set must include at minimum: a color-palette swatch (with hex labels), a type-pairing sample, and 2-3 logo/lockup marks — all sharing one cohesive system.
Self-review each asset against this standard and FIX any issue (clipping, misalignment, weak palette, invalid/again-external SVG) BEFORE producing it.`;

/** The visual standard is only relevant for agents that ship visual assets. */
function buildVisualStandard(agentType) {
  return ['marketing', 'product', 'engineering'].includes(agentType) ? VISUAL_DESIGN_STANDARD : '';
}

/**
 * Build the per-agent output schema contract injected into the system prompt so the
 * model knows exactly which keys produce_agent_output.content must contain.
 */
function buildOutputSchemaContract(agentType) {
  const keys = AGENT_OUTPUT_SCHEMAS[agentType];
  if (!keys || keys.length === 0) return '';
  return `
=== OUTPUT SCHEMA (for a GENERAL ${agentType} analysis) ===
If you produce a general analysis (i.e. you are NOT producing one of the specific deliverable types in YOUR DELIVERABLE MENU), the "content" object should contain these top-level keys with real, specific data:
${keys.map(k => `  - "${k}"`).join('\n')}
Array-typed keys must contain at least 2 substantive, fully-specified items each — never empty arrays or placeholders.
If instead you are producing a specific deliverable type (e.g. lead_list, asset_collection, tech_spec, code_project, a recipe output), use THAT type's natural structure — these keys do not apply.
`;
}

/**
 * Build the per-agent deliverable menu (Phase A1) injected into the system prompt
 * so the agent knows the concrete artifacts it can ship via produce_agent_output.
 */
function buildDeliverableMenu(agentType) {
  const deliverables = AGENT_DELIVERABLES[agentType];
  if (!deliverables || deliverables.length === 0) return '';
  return `
=== YOUR DELIVERABLE MENU ===
When you call produce_agent_output, set output_type to one of these (pick the best fit for the task):
${deliverables.map(d => `  - "${d.type}" — ${d.desc}`).join('\n')}
Produce a real, complete deliverable of the chosen type. Prefer a previewable/structured deliverable over plain prose.
`;
}

// ─── Pre-review self-critique (Phase B3) ───
// Before an output is shown to the user, score it and surface concrete deficiencies
// so the agent can self-revise once. Fail-open: any error returns pass=true so it
// never blocks delivery. Disable with AGENT_SELF_CRITIQUE=off.
const SELF_CRITIQUE_ENABLED = process.env.AGENT_SELF_CRITIQUE !== 'off';
async function runSelfCritique(execution, args) {
  try {
    const requiredKeys = AGENT_OUTPUT_SCHEMAS[execution.agent_type] || [];
    const isArtifact = args.output_type === 'web_artifact' || args.output_type === 'asset_collection';
    const schemaLine = (!isArtifact && requiredKeys.length)
      ? `It MUST cover these required aspects with real, specific data: ${requiredKeys.join(', ')}. `
      : '';
    const prompt = isArtifact
      ? `You are a strict senior brand/visual designer reviewing a ${args.output_type}. Examine the actual SVG/HTML code and score 0-100 across:
1. VALID & SELF-CONTAINED — SVG has xmlns + an explicit viewBox + a closing </svg>; no external URLs, <image>, <link>, scripts or fonts; HTML uses inline styles only.
2. COMPOSITION — clear visual hierarchy, balance, alignment on a consistent grid, intentional negative space (not cramped).
3. COLOR — a deliberate, harmonious palette (specific hex) with adequate contrast.
4. PRECISION — exact coordinates; elements centered; nothing clipped by the viewBox or overlapping; legible at ~24px and monochrome-safe.
5. POLISH & COHESION — refined detailing and a consistent system across multiple assets.
Be exacting — ugly, generic, misaligned, clipped, or externally-dependent assets must score low. Return ONLY JSON: {"score": <0-100>, "deficiencies": ["short, fixable VISUAL issue", ...]}. Leave deficiencies empty only if score >= 75.

DELIVERABLE (${args.output_type}) — ${args.title}
${JSON.stringify(args.content || {}).substring(0, 6000)}`
      : `You are a strict senior reviewer for a "${execution.agent_type}" specialist. Score the deliverable 0-100 on: specificity, completeness, freedom from placeholders/vagueness, and immediate usefulness to a founder. ${schemaLine}Return ONLY JSON: {"score": <0-100>, "deficiencies": ["short, fixable issue", ...]}. Leave deficiencies empty if score >= 75.

DELIVERABLE (${args.output_type}) — ${args.title}
${JSON.stringify(args.content || {}).substring(0, 4000)}`;
    const resp = await callLLMWithTools(
      [{ role: 'system', content: prompt }],
      [],
      { companyId: execution.company_id, response_format: { type: 'json_object' }, temperature: 0.2, max_tokens: 600 }
    );
    const j = safeJsonParse(resp.content, { score: 100, deficiencies: [] });
    const score = Number(j.score) || 0;
    const deficiencies = Array.isArray(j.deficiencies) ? j.deficiencies.slice(0, 5) : [];
    return { pass: score >= 75 || deficiencies.length === 0, score, deficiencies };
  } catch (e) {
    return { pass: true, score: 100, deficiencies: [] }; // fail-open
  }
}

// ─── Agent Execution Engine ───

/**
 * Launch a new agent execution for a company.
 * @param {Object} params
 * @param {string} params.companyId
 * @param {string} params.agentType - Key from AGENT_DEFINITIONS
 * @param {Object} params.companyProfile - Company data from onboarding
 * @param {Object} params.user - User who launched the agent
 * @param {Object} [params.initialData] - Any pre-filled data
 * @param {boolean} [params.autonomous] - If true, the agent auto-answers its own
 *        discovery questions from the company profile instead of blocking on the
 *        user (used for the post-onboarding auto-launch so agents run unattended).
 * @returns {Promise<Object>} Created agent execution record
 */
async function launchAgent({ companyId, agentType, companyProfile, user, initialData = {}, autonomous = false, requirePlan }) {
  const definition = AGENT_DEFINITIONS[agentType];
  if (!definition) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }

  // Plan mode → Execute mode (Phase A0). Autonomous (unattended) launches never
  // require a plan. Otherwise honor the explicit flag; default ON for engineering
  // (nothing should be built/run before the user approves the plan).
  const requirePlanResolved = autonomous
    ? false
    : (requirePlan !== undefined ? !!requirePlan : agentType === 'engineering');

  // Create execution record
  const executionId = uuidv4();
  const execution = {
    id: executionId,
    company_id: companyId,
    agent_type: agentType,
    agent_label: definition.label,
    status: 'running',
    icon: definition.icon,
    color: definition.color,
    priority: definition.priority || 0,
    conversation_history: [],
    output_data: initialData,
    progress_pct: 0,
    current_action: 'Initializing...',
    iterations: 0,
    mode: requirePlanResolved ? 'planning' : 'executing',
    require_plan: requirePlanResolved,
  };

  const { error } = await supabase.from('agent_executions').insert([execution]);
  if (error) throw new Error(`Failed to create agent execution: ${error.message}`);

  // Start execution asynchronously (non-blocking)
  runAgentLoop(executionId, companyProfile, user, { autonomous }).catch(err => {
    console.error(`[AgentOrchestrator] Agent ${agentType} (${executionId}) failed:`, err.message);
    updateExecution(executionId, {
      status: 'failed',
      error_message: err.message,
      current_action: 'Failed',
    });
  });

  return { id: executionId, ...execution };
}

/**
 * Launch an agent seeded with explicit context, skipping the discovery-question phase.
 * Used for auto-triggered runs (e.g. the Meeting agent after a transcript is ingested)
 * where the context IS the full input and no clarifying questions are needed.
 *
 * @param {Object} params
 * @param {string} params.companyId
 * @param {string} params.agentType
 * @param {Object} params.companyProfile
 * @param {Object} params.user
 * @param {string} params.contextMessage - Pre-seeded user message (e.g. transcript + insights)
 * @returns {Promise<Object>} Created execution record
 */
async function launchAgentWithContext({ companyId, agentType, companyProfile, user, contextMessage, requirePlan = false, recipe = null }) {
  const definition = AGENT_DEFINITIONS[agentType];
  if (!definition) throw new Error(`Unknown agent type: ${agentType}`);

  const executionId = uuidv4();
  const seededHistory = contextMessage
    ? [{ role: 'user', content: contextMessage, timestamp: new Date().toISOString() }]
    : [];

  const execution = {
    id: executionId,
    company_id: companyId,
    agent_type: agentType,
    agent_label: definition.label,
    status: 'running',
    icon: definition.icon,
    color: definition.color,
    priority: definition.priority || 0,
    conversation_history: seededHistory,
    // Tag the run with its capability recipe (Phase W) so the workspace can group
    // runs/deliverables under the right capability tab — no migration needed.
    output_data: recipe ? { recipe_id: recipe.id, recipe_label: recipe.label } : {},
    progress_pct: 20,
    current_action: 'Analyzing provided context...',
    iterations: 0,
    mode: requirePlan ? 'planning' : 'executing',
    require_plan: !!requirePlan,
  };

  const { error } = await supabase.from('agent_executions').insert([execution]);
  if (error) throw new Error(`Failed to create agent execution: ${error.message}`);

  // Skip discovery — go straight to work with the seeded context
  executeAgentWork(executionId, companyProfile, user, seededHistory).catch(err => {
    console.error(`[AgentOrchestrator] Context-seeded agent ${agentType} (${executionId}) failed:`, err.message);
    updateExecution(executionId, { status: 'failed', error_message: err.message, current_action: 'Failed' });
  });

  return { id: executionId, ...execution };
}

/**
 * Launch a capability recipe run (Phase W). Builds the scoped seed message from the
 * recipe's promptTemplate + output_type, asking the recipe's suggestedQuestions only
 * when the company profile doesn't already cover them, then runs through the normal
 * execution loop (with plan mode if requirePlan).
 */
async function launchRecipe({ companyId, agentType, recipeId, companyProfile, user, requirePlan = false }) {
  const recipe = getRecipe(agentType, recipeId);
  if (!recipe) throw new Error(`Unknown recipe '${recipeId}' for agent '${agentType}'`);

  const askLine = (recipe.suggestedQuestions && recipe.suggestedQuestions.length)
    ? `\n\nBefore producing the deliverable, check the company profile/context. ONLY if it does not already make clear: ${recipe.suggestedQuestions.join('; ')} — then ask the user with ONE ask_user_question call (offer sensible choices). If the context is sufficient, proceed without asking.`
    : '';

  const contextMessage =
    `TASK: ${recipe.label} — ${recipe.description}\n` +
    `${recipe.promptTemplate}\n\n` +
    `Deliver this as produce_agent_output with output_type "${recipe.output_type}".` +
    askLine;

  return launchAgentWithContext({ companyId, agentType, companyProfile, user, contextMessage, requirePlan, recipe });
}

/**
 * Launch all startup agents for a new company after onboarding.
 * Runs company researcher first, then launches the other 5 in parallel.
 * @param {Object} params
 * @param {string} params.companyId
 * @param {Object} params.companyProfile - Company data from onboarding
 * @param {Object} params.user - User who completed onboarding
 * @returns {Promise<Array>} Array of launched agent execution IDs
 */
async function launchStartupAgents({ companyId, companyProfile, user }) {
  const agentIds = [];

  // Launch all 10 agents in parallel
  const agentTypes = ['finance', 'people', 'hr', 'investment', 'crm', 'marketing', 'sales', 'product', 'roadmap', 'meeting'];

  const launchPromises = agentTypes.map(agentType =>
    launchAgent({ companyId, agentType, companyProfile, user, autonomous: true })
      .then(exec => { agentIds.push(exec); return exec; })
      .catch(err => {
        console.error(`[AgentOrchestrator] Failed to launch ${agentType}:`, err.message);
        return null;
      })
  );

  await Promise.all(launchPromises);
  return agentIds;
}

// ─── Agent Loop (Internal) ───

/**
 * Generate 3 dynamic discovery questions using the LLM based on company profile and specialty.
 */
/**
 * Helper to check if a question is redundant based on existing company profile fields.
 */
function isQuestionRedundant(qText, profile) {
  if (!profile) return false;
  const txt = qText.toLowerCase();
  if (txt.includes('stage') || txt.includes('funding')) {
    if (profile.company_stage && profile.company_stage.toLowerCase() !== 'not specified' && profile.company_stage.trim() !== '') return true;
  }
  if (txt.includes('mrr') || txt.includes('revenue') || txt.includes('expense') || txt.includes('run rate') || txt.includes('runrate')) {
    if (profile.mrr || profile.revenue_runrate || (profile.description && profile.description.toLowerCase().includes('mrr'))) return true;
  }
  if (txt.includes('employee') || txt.includes('team size') || txt.includes('how many people')) {
    if (profile.team_size && profile.team_size.toLowerCase() !== 'not specified' && profile.team_size.trim() !== '') return true;
  }
  if (txt.includes('target customer') || txt.includes('target audience') || txt.includes('ideal customer') || txt.includes('icp')) {
    if (profile.target_customer && profile.target_customer.toLowerCase() !== 'not specified' && profile.target_customer.trim() !== '') return true;
  }
  if (txt.includes('competitor')) {
    if (profile.competitors && profile.competitors.toLowerCase() !== 'not specified' && profile.competitors.trim() !== '') return true;
  }
  if (txt.includes('tool') || txt.includes('software')) {
    if (profile.current_tools && profile.current_tools.toLowerCase() !== 'not specified' && profile.current_tools.trim() !== '') return true;
  }
  return false;
}

/**
 * Generate 3 dynamic discovery questions using the LLM based on company profile and specialty.
 */
async function generateAgentDiscoveryQuestions(companyId, agentType, companyProfile) {
  const companyContext = buildCompanyContext(companyProfile);
  
  let docsContext = '';
  try {
    const { retrieveSmartContext } = require('./retrievalService');
    const smartContext = await retrieveSmartContext(`Discovery questions for ${agentType} agent`, [], companyId);
    const chunksStr = (smartContext.chunks || []).map(c => `- ${c.content}`).join('\n\n');
    if (chunksStr) {
      docsContext = `\nRetrieved Company Documents Context:\n${chunksStr}\n`;
    }
  } catch (err) {
    console.warn('[Discovery Questions] Context retrieval failed:', err.message);
  }

  const prompt = `You are the ${agentType} agent for a startup/company. 
Your goal is to generate exactly 3 highly specific, context-relevant alignment questions to ask the user. These questions will help you tailor your execution and produce the best possible output.

Company Profile:
${companyContext}
${docsContext}

CRITICAL REQUIREMENT:
DO NOT ask questions for which the answers are already clearly defined in the Company Profile.
For example, check the "Stage", "Team Size", "Target Customer", "MRR", "Current Tools", etc. If any of these are present and have concrete values, do not generate questions asking about them. Only ask questions to discover information NOT already documented in the profile.
If you find that all crucial information is already present in the Company Profile and no further alignment questions are necessary, you may return an empty array: {"questions": []}.

Generate exactly 3 discovery questions (or fewer if some details are already known). Each question must be tailored to the company's profile and your agent specialty (e.g., finance, marketing, product, sales, investment, etc.). Do not ask generic questions.
For each question, provide exactly 3 specific, context-relevant choice options. Do NOT include a fourth "Other" option in the choices (the system adds it automatically).

Return your response as JSON in this format:
{
  "questions": [
    {
      "question": "Question 1 text",
      "choices": ["Choice 1", "Choice 2", "Choice 3"]
    }
  ]
}
`;

  try {
    const response = await callLLMWithTools([
      { role: 'system', content: prompt }
    ], [], {
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' }
    });
    
    const parsed = safeJsonParse(response.content, {});
    if (parsed && Array.isArray(parsed.questions)) {
      const sanitized = parsed.questions.map((q, idx) => {
        let questionText = '';
        let choicesList = [];

        if (q && typeof q === 'object') {
          questionText = String(q.question || q.text || q.title || `Question ${idx + 1}`).trim();
          const rawChoices = q.choices || q.options || q.answers || [];
          if (Array.isArray(rawChoices)) {
            choicesList = rawChoices.map(c => String(c || '').trim()).filter(Boolean);
          } else if (typeof rawChoices === 'string') {
            choicesList = rawChoices.split(',').map(c => c.trim()).filter(Boolean);
          }
        } else if (typeof q === 'string') {
          questionText = q.trim();
        }

        // Clean other
        choicesList = choicesList.filter(c => c.toLowerCase() !== 'other');

        if (choicesList.length === 0) {
          choicesList = ['Option 1', 'Option 2', 'Option 3'];
        }

        return {
          question: questionText,
          choices: choicesList
        };
      }).filter(q => q.question !== '' && !isQuestionRedundant(q.question, companyProfile));

      return sanitized;
    }
  } catch (error) {
    console.error(`[Discovery Questions] LLM generation failed for agent ${agentType}:`, error.message);
  }

  // Fallback to definition.initialQuestions if generation fails
  const definition = AGENT_DEFINITIONS[agentType];
  const initial = definition?.initialQuestions || [
    { question: 'What is your main priority for this stage?', choices: ['Product development', 'Sales & traction', 'Marketing & outreach'] },
    { question: 'What is the biggest bottleneck you face?', choices: ['Lack of resources', 'Unclear positioning', 'Technical constraints'] },
    { question: 'What is your target timeline for this milestone?', choices: ['1-3 months', '3-6 months', '6-12 months'] }
  ];
  return initial.slice(0, 3)
    .map(q => ({
      question: q.question,
      choices: q.choices
    }))
    .filter(q => !isQuestionRedundant(q.question, companyProfile));
}

/**
 * Auto-answer an agent's discovery questions from the company profile so the agent
 * can run unattended (used for post-onboarding auto-launch). Acts as the founder:
 * picks the best-fitting provided choice when one applies, otherwise gives a concise
 * answer grounded in the profile, and flags genuine unknowns as reasonable assumptions.
 *
 * @returns {Promise<Array<{question: string, answer: string}>>}
 */
async function autoAnswerDiscoveryQuestions(companyId, agentType, companyProfile, questions) {
  if (!Array.isArray(questions) || questions.length === 0) return [];

  // Sensible fallback: take the first listed choice, or a profile-deferral note.
  const fallback = () => questions.map(q => ({
    question: q.question,
    answer: (Array.isArray(q.choices) && q.choices[0])
      ? q.choices[0]
      : 'Use your best judgment based on the company profile and industry norms.',
  }));

  const companyContext = buildCompanyContext(companyProfile);

  let docsContext = '';
  try {
    const { retrieveSmartContext } = require('./retrievalService');
    const smartContext = await retrieveSmartContext(`Context for ${agentType} agent alignment`, [], companyId);
    const chunksStr = (smartContext.chunks || []).map(c => `- ${c.content}`).join('\n\n');
    if (chunksStr) docsContext = `\nRetrieved Company Documents Context:\n${chunksStr}\n`;
  } catch (err) {
    console.warn('[Auto-Answer] Context retrieval failed:', err.message);
  }

  const questionsBlock = questions.map((q, i) =>
    `${i + 1}. ${q.question}${Array.isArray(q.choices) && q.choices.length ? `\n   Options: ${q.choices.join(' | ')}` : ''}`
  ).join('\n');

  const prompt = `You are answering on behalf of the founder/operator of the company below, so the ${agentType} agent can begin work WITHOUT interrupting the user. Answer each alignment question using ONLY what is supported by the company profile and documents. When one of the provided Options clearly fits, choose it verbatim. When no option fits, write a concise, specific answer (one sentence) grounded in the profile. If the profile genuinely lacks the information, give the most reasonable default for a company of this type/stage and keep it brief — never reply "unknown" or "not sure".

Company Profile:
${companyContext}
${docsContext}

Questions:
${questionsBlock}

Return JSON exactly as:
{ "answers": [ { "question": "<question text verbatim>", "answer": "<your answer>" } ] }`;

  try {
    const response = await callLLMWithTools(
      [{ role: 'system', content: prompt }],
      [],
      { model: 'llama-3.3-70b-versatile', response_format: { type: 'json_object' }, temperature: 0.4 }
    );
    const parsed = safeJsonParse(response.content, {});
    const raw = Array.isArray(parsed?.answers) ? parsed.answers : [];

    // Re-align answers to the original question order; backfill any gaps.
    return questions.map((q, idx) => {
      const match = raw.find(a => a && typeof a.question === 'string'
        && a.question.trim().toLowerCase() === q.question.trim().toLowerCase());
      const byIndex = raw[idx];
      const answer = (match && match.answer) || (byIndex && byIndex.answer);
      const clean = answer != null ? String(answer).trim() : '';
      return {
        question: q.question,
        answer: clean || (Array.isArray(q.choices) && q.choices[0]) || 'Use your best judgment based on the company profile.',
      };
    });
  } catch (err) {
    console.error(`[Auto-Answer] Failed to auto-answer discovery questions for ${agentType}:`, err.message);
    return fallback();
  }
}

/**
 * Run the main agent execution loop.
 * Each iteration: process LLM response → handle tool calls → check for user questions → produce output
 * @param {Object} [options]
 * @param {boolean} [options.autonomous] - Auto-answer discovery questions instead of awaiting the user.
 */
async function runAgentLoop(executionId, companyProfile, user, options = {}) {
  const { autonomous = false } = options;
  const { data: execution } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', executionId)
    .single();

  if (!execution) throw new Error('Execution record not found');

  await logExecutionStep(executionId, 'Agent execution started.');

  // ─── PHASE 1: Generate & Ask Dynamic Discovery Questions ───
  let discoveryQuestions = [];
  try {
    discoveryQuestions = await generateAgentDiscoveryQuestions(execution.company_id, execution.agent_type, companyProfile);
  } catch (err) {
    console.error(`[AgentOrchestrator] Failed to generate discovery questions for agent ${execution.agent_type}:`, err.message);
  }

  if (discoveryQuestions && discoveryQuestions.length > 0) {
    // ─── Autonomous mode: auto-answer from the company profile and run unattended ───
    if (autonomous) {
      await logExecutionStep(executionId, `Auto-answering ${discoveryQuestions.length} alignment questions from the company profile...`);
      const autoAnswers = await autoAnswerDiscoveryQuestions(
        execution.company_id, execution.agent_type, companyProfile, discoveryQuestions
      );

      const seededHistory = [];
      for (const item of autoAnswers) {
        seededHistory.push({ role: 'assistant', content: item.question, timestamp: new Date().toISOString() });
        seededHistory.push({ role: 'user', content: item.answer || '', timestamp: new Date().toISOString() });
      }

      await updateExecution(executionId, {
        status: 'running',
        current_action: 'Auto-aligned from company profile. Starting analysis...',
        current_question: null,
        current_question_choices: null,
        current_question_id: null,
        conversation_history: seededHistory,
        output_data: {
          ...execution.output_data,
          discovery_questions: discoveryQuestions,
          discovery_auto_answered: true,
        },
        progress_pct: 25,
      });

      await logExecutionStep(executionId, 'Discovery auto-seeded from company profile. Proceeding without user input.');
      await executeAgentWork(executionId, companyProfile, user, seededHistory);
      return;
    }

    await logExecutionStep(executionId, `Awaiting answers to ${discoveryQuestions.length} dynamic alignment questions...`);
    await updateExecution(executionId, {
      status: 'awaiting_input',
      current_action: 'Awaiting discovery wizard...',
      current_question: discoveryQuestions[0].question,
      current_question_choices: discoveryQuestions[0].choices,
      current_question_id: 'q_discovery_0',
      output_data: { ...execution.output_data, discovery_questions: discoveryQuestions },
      progress_pct: 10,
    });
    return;
  }

  await logExecutionStep(executionId, 'All necessary company profile data is present. Skipping discovery questions.');

  // ─── PHASE 2: Research and execute ───
  await executeAgentWork(executionId, companyProfile, user);
}

/**
 * Handle user's response to an agent question.
 * Supports submitting an array of answers for the wizard or a single string response.
 * Runs asynchronously in the background.
 */
async function respondToAgent(executionId, answerPayload, companyProfile, user) {
  const { data: execution } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', executionId)
    .single();

  if (!execution) throw new Error('Execution not found');
  
  const allowedStatuses = ['awaiting_input', 'awaiting_approval', 'completed'];
  if (!allowedStatuses.includes(execution.status)) {
    throw new Error(`Agent is in ${execution.status} status and cannot receive responses.`);
  }

  const currentStatus = execution.status;

  // If agent was awaiting approval, reject the output first with the payload as feedback
  if (currentStatus === 'awaiting_approval') {
    try {
      const { data: output } = await supabase
        .from('agent_outputs')
        .select('*')
        .eq('agent_execution_id', executionId)
        .eq('status', 'pending_approval')
        .order('created_at', { descending: false })
        .limit(1)
        .maybeSingle();

      if (output) {
        await supabase
          .from('agent_outputs')
          .update({
            status: 'rejected',
            feedback: typeof answerPayload === 'string' ? answerPayload : JSON.stringify(answerPayload),
            updated_at: new Date().toISOString()
          })
          .eq('id', output.id);
      }
    } catch (err) {
      console.warn('[respondToAgent] Failed to reject pending approval output:', err.message);
    }
  }

  const history = execution.conversation_history || [];

  // Parse answers from payload
  let answers = [];
  if (Array.isArray(answerPayload)) {
    answers = answerPayload;
  } else if (answerPayload && typeof answerPayload === 'object' && Array.isArray(answerPayload.answers)) {
    answers = answerPayload.answers;
  } else if (typeof answerPayload === 'string') {
    answers = [{ question: execution.current_question || 'User Feedback', answer: answerPayload }];
  } else {
    answers = [{ question: execution.current_question || 'User Feedback', answer: String(answerPayload) }];
  }

  // Store Q&As in conversation history
  for (const item of answers) {
    if (item.question && item.question !== 'User Feedback') {
      history.push({ role: 'assistant', content: item.question, timestamp: new Date().toISOString() });
    }
    history.push({ role: 'user', content: item.answer || '', timestamp: new Date().toISOString() });
  }

  await logExecutionStep(executionId, `Received response from user. Resuming background execution.`);

  await updateExecution(executionId, {
    status: 'running',
    current_action: currentStatus === 'awaiting_approval' 
      ? 'Revising based on feedback...' 
      : 'Resuming work based on user request...',
    current_question: null,
    current_question_choices: null,
    current_question_id: null,
    conversation_history: history,
    progress_pct: 35,
  });

  // Run in background asynchronously (non-blocking)
  setImmediate(() => {
    executeAgentWork(executionId, companyProfile, user, history).catch(err => {
      console.error(`[AgentOrchestrator] Background execution failed for ${executionId}:`, err.message);
      updateExecution(executionId, {
        status: 'failed',
        error_message: err.message,
        current_action: 'Failed',
      });
    });
  });
}

/**
 * Execute the agent's main work loop: research + synthesize + produce output.
 */
/**
 * Execute the agent's main work loop: research + synthesize + produce output.
 */
async function executeAgentWork(executionId, companyProfile, user, priorConversation = []) {
  const { data: execution } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', executionId)
    .single();

  if (!execution) throw new Error('Execution not found');

  await logExecutionStep(executionId, 'Starting research and analysis loop.');

  const definition = AGENT_DEFINITIONS[execution.agent_type];
  const history = [...priorConversation];

  // ─── Build system prompt with company context ───
  const companyContext = buildCompanyContext(companyProfile);

  // Retrieve relevant company documents/meetings/decisions context from the vector store
  const { retrieveSmartContext } = require('./retrievalService');
  let docsContext = '';
  try {
    const taskPrompt = buildExecutionPrompt(execution.agent_type, companyProfile);
    const smartContext = await retrieveSmartContext(taskPrompt, [], execution.company_id);
    
    const chunksStr = (smartContext.chunks || []).map(c => `- ${c.content}`).join('\n\n');
    const decisionsStr = (smartContext.recentDecisions || []).map(d => `- [${d.date}] ${d.text} (Decided by: ${d.made_by || 'System'})`).join('\n');
    const meetingsStr = (smartContext.recentMeetings || []).map(m => `- [${m.meeting_date}] ${m.title}: ${m.summary || ''}`).join('\n');
    
    docsContext = `
=== RETRIEVED COMPANY DOCUMENTS & KNOWLEDGE ===
Below is the context retrieved from the company's uploaded files, documents, and meeting notes. Use this information to ground your analysis:

**Relevant Document Segments:**
${chunksStr || 'No specific document segments found.'}

**Recent Decisions:**
${decisionsStr || 'No recent decisions logged.'}

**Recent Meetings:**
${meetingsStr || 'No recent meetings logged.'}
`;
  } catch (retrievalErr) {
    console.warn('[AgentOrchestrator] Failed to retrieve context for agent:', retrievalErr.message);
  }

  // ─── Resolve and Merge Category-Specific Tools from Registry ───
  let dbAgent = null;
  try {
    const { getAgentById } = require('../models/agentConfig');
    dbAgent = await getAgentById(definition.label);
  } catch (err) {
    console.warn('[AgentOrchestrator] Failed to fetch dbAgent in executeAgentWork:', err.message);
  }

  const DEFAULT_AGENT_CATEGORIES = {
    finance: ['finance', 'analytics', 'storage', 'legal', 'research'],
    people: ['hr', 'communications', 'research'],
    hr: ['hr', 'communications', 'storage', 'legal', 'research'],
    investment: ['crm', 'research', 'communications'],
    crm: ['crm', 'communications', 'research'],
    marketing: ['marketing', 'communications', 'storage', 'research', 'analytics'],
    sales: ['crm', 'communications', 'research', 'commerce', 'marketing', 'analytics'],
    product: ['project-management', 'communications', 'research'],
    roadmap: ['project-management', 'communications', 'research'],
    meeting: ['communications', 'project-management', 'storage', 'research'],
    engineering: ['project-management', 'research', 'engineering'],
  };

  const registry = require('../providers/registry');
  const toolNames = new Set();

  // Only offer category tools the company has actually enabled — otherwise the agent
  // wastes turns calling tools the Sentinel denies ("category not enabled"). The
  // 'engineering' workspace tools execute directly (bypassing the Sentinel), so they
  // stay available regardless. web_search / produce_output / ask_user are added
  // separately below and are always available.
  let enabledCategories = [];
  try {
    const { getCompanyConfig } = require('../models/companyConfig');
    const cfg = await getCompanyConfig(execution.company_id);
    enabledCategories = (cfg && cfg.enabled_categories) || [];
  } catch (e) {
    console.warn('[AgentOrchestrator] Could not load enabled categories:', e.message);
  }

  if (dbAgent && Array.isArray(dbAgent.tools)) {
    dbAgent.tools.forEach(name => toolNames.add(name));
  } else {
    const categories = DEFAULT_AGENT_CATEGORIES[execution.agent_type] || [];
    for (const cat of categories) {
      const catTools = registry.getToolsByCategory(cat) || [];
      catTools.forEach(t => toolNames.add(t.name));
    }
  }

  const resolvedTools = [];
  const lowerHistoryText = (history || []).map(h => (h.content || '').toLowerCase()).join(' ') + ' ' + (execution.current_action || '').toLowerCase();
  const requiresEmail = lowerHistoryText.includes('email') || lowerHistoryText.includes('mail') || lowerHistoryText.includes('send');
  const requiresSlack = lowerHistoryText.includes('slack') || lowerHistoryText.includes('message') || lowerHistoryText.includes('notify');
  const requiresCalendar = lowerHistoryText.includes('calendar') || lowerHistoryText.includes('schedule') || lowerHistoryText.includes('meet') || lowerHistoryText.includes('availability');
  const requiresCrm = lowerHistoryText.includes('crm') || lowerHistoryText.includes('hubspot') || lowerHistoryText.includes('deal') || lowerHistoryText.includes('contact') || execution.agent_type === 'crm' || execution.agent_type === 'sales';

  for (const name of toolNames) {
    if (name === 'web_search_trusted' || name === 'web_extract_source_content' || name === 'ask_user_question' || name === 'produce_agent_output') {
      continue;
    }

    const isEmailTool = name.includes('email') || name.includes('inbox');
    const isSlackTool = name.includes('slack') || name === 'send_message' || name === 'list_channels';
    const isCalendarTool = name.includes('calendar') || name === 'check_availability';
    const isNotificationTool = name.includes('notification') || name === 'internal_announcement';

    if (isEmailTool && !requiresEmail && execution.agent_type !== 'meeting') continue;
    if (isSlackTool && !requiresSlack && execution.agent_type !== 'meeting') continue;
    if (isCalendarTool && !requiresCalendar && execution.agent_type !== 'meeting') continue;
    if (isNotificationTool && !requiresSlack && !requiresEmail) continue;

    const isCrmTool = name.includes('contact') || name.includes('deal') || name === 'lead_scoring' || name === 'pipeline_forecast' || name === 'churn_prediction' || name.startsWith('campaign_') || name === 'territory_management' || name === 'customer_health_score' || name === 'nps_survey' || name === 'sales_leaderboard' || name === 'automated_followup' || name === 'duplicate_detection' || name === 'revenue_attribution' || name === 'lead_intelligence' || name === 'pipeline_audit' || name === 'proposal_generator' || name === 'external_sync' || name === 'investor_pipeline_mgmt' || name === 'founder_cold_outreach';
    
    if (isCrmTool && !requiresCrm && execution.agent_type !== 'investment') continue;

    if (execution.agent_type === 'investment' && isCrmTool && name !== 'investor_pipeline_mgmt' && name !== 'founder_cold_outreach' && !requiresCrm) {
      continue;
    }

    const toolDef = registry.getToolByName(name);
    if (toolDef) {
      // (R2) Never offer all-stub categories — they have no real executor and only
      // waste turns. 'research' is here too: its working tools (web_search_trusted /
      // web_extract_source_content) are added via the special path below; the rest
      // (early_adopter_discovery, synthesize_report, …) are stubs.
      if (STUB_CATEGORIES.has(toolDef.category)) continue;
      // Skip tools whose category the company hasn't CONNECTED a provider for (the
      // Sentinel would deny them). Engineering workspace tools bypass the Sentinel.
      if (toolDef.category !== 'engineering' && !enabledCategories.includes(toolDef.category)) {
        continue;
      }
      resolvedTools.push(toolDef);
    }
  }

  const formattedCategoryTools = registry.toFunctionCallingFormat(resolvedTools);

  const hasAsked = history.some(msg => 
    msg.role === 'assistant' || 
    (msg.tool_calls && msg.tool_calls.some(tc => tc.function.name === 'ask_user_question'))
  );

  const availableToolsList = [
    "1. web_search_trusted - Search the web for information",
    "2. web_extract_source_content - Extract full content from a URL",
  ];
  if (!hasAsked) {
    availableToolsList.push("3. ask_user_question - Ask the user a question if you need clarification (use sparingly)");
  }
  availableToolsList.push(`${hasAsked ? '3' : '4'}. produce_agent_output - When your work is complete, produce the final structured output`);

  resolvedTools.forEach((t) => {
    availableToolsList.push(`${availableToolsList.length + 1}. ${t.name} - ${t.description}`);
  });

  const protocolRules = hasAsked
    ? '- You have ALREADY asked a clarifying question and the user has responded. Alignment is established. You MUST NOT ask another question. Do not ask multiple rounds of questions. Proceed directly to complete the task.'
    : `- ONLY call \`ask_user_question\` if there is a critical ambiguity that makes the task impossible to begin.
- If you have already called \`ask_user_question\` in a previous turn (check the conversation history below) and the user has responded, DO NOT call it again. You MUST proceed to use your other tools (like \`web_search_trusted\` or \`produce_agent_output\`) and complete the task.
- NEVER enter a loop of asking questions. One round of clarification is the absolute maximum.`;

  // ─── Retrieve feedback events (corrections) to close the self-learning loop for this agent ───
  let feedbackContext = '';
  try {
    const { data: feedbackData, error: feedbackErr } = await supabase
      .from('feedback_events')
      .select('rating, correction_text, agent_name')
      .eq('tenant_id', execution.company_id)
      .eq('rating', 'down')
      .not('correction_text', 'is', null)
      .or(`agent_name.eq."${definition.label}",agent_name.eq."${execution.agent_type}",agent_name.ilike.%${execution.agent_type}%)`)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!feedbackErr && feedbackData && feedbackData.length > 0) {
      const correctionsList = feedbackData.map(f => `- User correction: "${f.correction_text}"`).join('\n');
      feedbackContext = `\n\n=== SYSTEM LEARNING: PAST USER CORRECTIONS & CRITIQUE ===\n` +
        `The user has previously corrected your outputs. You MUST strictly follow these corrections to avoid repeating the same mistakes:\n` +
        `${correctionsList}\n` +
        `========================================================\n`;
    }
  } catch (err) {
    console.warn('[AgentOrchestrator] Failed to fetch feedback for learning loop:', err.message);
  }

  // ─── Retrieve specific revision feedback if this output was previously rejected ───
  let revisionFeedbackContext = '';
  try {
    const { data: outputData, error: outputErr } = await supabase
      .from('agent_outputs')
      .select('feedback, status')
      .eq('agent_execution_id', executionId)
      .eq('status', 'rejected')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (!outputErr && outputData && outputData.length > 0 && outputData[0].feedback) {
      revisionFeedbackContext = `\n\n=== CRITICAL: REVISION DIRECTIVE ===\n` +
        `Your previous draft was REJECTED by the user with the following feedback:\n` +
        `"${outputData[0].feedback}"\n\n` +
        `You MUST revise your analysis and output to address this feedback directly. Do not deliver the same output. Correct all points raised.\n` +
        `====================================\n`;
    }
  } catch (err) {
    console.warn('[AgentOrchestrator] Failed to fetch revision feedback:', err.message);
  }

  // ─── Open reviewer comments (Phase A4): threaded + section-level feedback on the
  // most recent output of this execution. These drive iterative revision without a
  // hard reject. Section-scoped comments quote their anchor so the model edits precisely.
  try {
    const { data: latestOutput } = await supabase
      .from('agent_outputs')
      .select('id, output_type')
      .eq('agent_execution_id', executionId)
      .order('version', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);

    if (latestOutput && latestOutput.length > 0) {
      const { data: comments } = await supabase
        .from('agent_output_comments')
        .select('body, section_ref')
        .eq('agent_output_id', latestOutput[0].id)
        .eq('status', 'open')
        .order('created_at', { ascending: true });

      if (comments && comments.length > 0) {
        const commentList = comments.map(c =>
          c.section_ref ? `- [on "${c.section_ref}"]: ${c.body}` : `- ${c.body}`
        ).join('\n');
        revisionFeedbackContext += `\n\n=== REVISION DIRECTIVE — ADDRESS THESE REVIEWER COMMENTS ===\n` +
          `The user reviewed your "${latestOutput[0].output_type}" deliverable and left these comments. ` +
          `Produce a REVISED version that resolves every one. Keep everything that was good; change only what the comments ask for.\n` +
          `${commentList}\n` +
          `===========================================================\n`;
      }
    }
  } catch (err) {
    console.warn('[AgentOrchestrator] Failed to fetch reviewer comments:', err.message);
  }

  // ─── Closed feedback loop (Phase 1C): seed approved examples + learned preferences ───
  let learningContext = '';
  try {
    const { data: examples } = await supabase
      .from('agent_examples')
      .select('title, content_summary, full_content')
      .eq('company_id', execution.company_id)
      .eq('agent_type', execution.agent_type)
      .order('created_at', { ascending: false })
      .limit(2);

    if (examples && examples.length > 0) {
      const exStr = examples.map((e, i) =>
        `Example ${i + 1}: ${e.title}\n${e.content_summary || ''}\n${JSON.stringify(e.full_content).substring(0, 1200)}`
      ).join('\n\n');
      learningContext += `\n\n=== APPROVED EXAMPLES (MATCH THIS QUALITY & STYLE) ===\n` +
        `Here ${examples.length === 1 ? 'is an example' : 'are examples'} of outputs this company has previously approved. Match this depth, structure, and style:\n${exStr}\n`;
    }

    const prefs = companyProfile && companyProfile.agent_preferences && companyProfile.agent_preferences[execution.agent_type];
    if (prefs) {
      learningContext += `\n=== LEARNED STYLE PREFERENCES ===\n` +
        `This company has consistently preferred: ${JSON.stringify(prefs)}. Honor these preferences. ` +
        `If "avoid_rules" are present, treat them as hard constraints you MUST follow.\n`;
    }

    // ─── PROVEN PLAYS (Phase B2): reuse distilled, previously-winning approaches. ───
    try {
      const { getRelevantPlaybooks } = require('./approvalService');
      const taskText = buildExecutionPrompt(execution.agent_type, companyProfile) +
        ' ' + (history.map(h => h.content).join(' ').substring(0, 800));
      const plays = await getRelevantPlaybooks(execution.company_id, execution.agent_type, taskText, 3);
      if (plays && plays.length > 0) {
        const playStr = plays.map((p, i) => `${i + 1}. WHEN: ${p.trigger}\n   PLAY: ${p.play}`).join('\n');
        learningContext += `\n=== PROVEN PLAYS (approaches that got approved before — reuse them) ===\n${playStr}\n`;
      }
    } catch (pbErr) {
      console.warn('[AgentOrchestrator] Failed to load playbooks:', pbErr.message);
    }
  } catch (err) {
    console.warn('[AgentOrchestrator] Failed to load learning context:', err.message);
  }

  const truthfulnessRules = `
=== TRUTH, RESEARCH & QUALITY ENFORCEMENT PROTOCOL ===
1. PROACTIVE REAL-WORLD RESEARCH REQUIRED: You MUST NOT generate generic lists, placeholder templates, or fabricated/mock information. If a task requires researching investors, competitors, leads, marketing benchmarks, or salaries, you MUST perform at least one web search (using web_search_trusted) to find actual, real-world data first.
2. NO PLACEHOLDERS: Your final output must contain real names, actual websites, real figures, and concrete data. Do not write '[Insert Name]', '[Company X]', or similar placeholder symbols.
3. ANTI-HALLUCINATION: Rely strictly on provided context and actual search results. Do not invent details for this company (e.g., claiming it has paying customers, specific MRR, or products not in the profile).
4. MISSING DATA: If specific company metrics (like MRR, team size, or funding target) are missing and you cannot find them in the context, explicitly label them as "Not specified" or "Unknown".
5. SUBSTANTIVE DELIVERABLES: Any drafts, plans, or documents you produce must be comprehensive, highly detailed, and fully structured (aim for 500-1000 words). Low-effort summaries or generic text are unacceptable.
`;

  const schemaContract = buildOutputSchemaContract(execution.agent_type);
  const deliverableMenu = buildDeliverableMenu(execution.agent_type);

  // ─── Plan mode (Phase A0) ───
  const isPlanning = execution.mode === 'planning';
  const planModeDirective = isPlanning ? `
=== PLAN MODE — DO NOT EXECUTE YET ===
You are in PLANNING mode. You must NOT build, write files, run commands, send anything, or produce the final deliverable yet. Do only light research needed to plan well, then call produce_agent_output with output_type "plan" and content:
{ "objective": "...", "approach": "...", "deliverables": ["..."], "steps": [{ "id": "s1", "title": "...", "detail": "..." }], "assumptions": ["..."] }
The user will review and approve (or comment on) this plan. Only after approval will you execute. Keep the plan concrete and specific.
` : '';

  const messages = [
    { role: 'system', content: `${definition.systemPrompt}\n${EXPERT_OPERATING_STANDARD}\n${buildVisualStandard(execution.agent_type)}\n\nCOMPANY CONTEXT:\n${companyContext}\n\n${docsContext}${feedbackContext}${revisionFeedbackContext}${learningContext}\n\n${truthfulnessRules}\n${schemaContract}\n${deliverableMenu}\n${planModeDirective}` },
    { role: 'system', content: `AVAILABLE TOOLS:
${availableToolsList.join('\n')}

CLARIFICATION PROTOCOL RULES:
${protocolRules}` },
  ];

  // Add the execution prompt first to establish the initial task instruction
  messages.push({ role: 'user', content: buildExecutionPrompt(execution.agent_type, companyProfile) });

  // Add conversation history (subsequent clarifications and user answers) chronologically
  for (const msg of history) {
    messages.push({ 
      role: msg.role === 'assistant' ? 'assistant' : 'user', 
      content: msg.content 
    });
  }

  // ─── Tool definitions for the agent ───
  const tools = [
    {
      type: 'function',
      function: {
        name: 'web_search_trusted',
        description: 'Search the web for information',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query' },
            maxResults: { type: 'number', description: 'Max results (1-10)' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'web_extract_source_content',
        description: 'Extract readable content from a URL',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The URL to extract' },
            maxChars: { type: 'number', description: 'Max characters' },
          },
          required: ['url'],
        },
      },
    },
  ];

  if (!hasAsked) {
    tools.push({
      type: 'function',
      function: {
        name: 'ask_user_question',
        description: 'Ask the user a question when you need clarification or additional information. Use this SPARINGLY — prefer to make reasonable assumptions. Optionally provide answer choices for the user to select from.',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The question to ask the user' },
            choices: { type: 'array', items: { type: 'string' }, description: 'Optional predefined answer choices the user can pick from. Include 3-5 relevant options. The user can also type a custom answer.' },
          },
          required: ['question'],
        },
      },
    });
  }

  tools.push({
    type: 'function',
    function: {
      name: 'produce_agent_output',
      description: 'Call when your work is complete. Produces the final structured output for user approval.',
      parameters: {
        type: 'object',
        properties: {
          output_type: { type: 'string', description: 'The type of output. Use a type from YOUR DELIVERABLE MENU when one fits. Visual/previewable deliverables: "web_artifact" (a self-contained HTML page/site/landing page — put the full HTML string in content.html), "asset_collection" (logos/graphics/marketing assets — put them in content.assets; prefer code assets { kind: "svg"|"html", code, caption } over generated images, which are costly; only use { url OR dataUri, caption } for a real existing asset). "plan" = a proposal for the user to approve BEFORE you execute (see PLAN MODE).' },
          title: { type: 'string', description: 'Descriptive title for this output' },
          summary: { type: 'string', description: 'One-paragraph summary for the approval card' },
          content: { type: 'object', description: 'Full structured content as JSON. For web_artifact use { "html": "<!doctype html>..." }. For asset_collection use { "assets": [{ "kind": "svg", "code": "<svg…>", "caption": "…" }] } (code assets preferred) or [{ "url": "https://…", "caption": "…" }]. For plan use { "objective", "approach", "deliverables": [...], "steps": [{ "id", "title", "detail" }], "assumptions": [...] }.' },
        },
        required: ['output_type', 'title', 'summary', 'content'],
      },
    },
  });

  // In planning mode (Phase A0), withhold mutating workspace tools — nothing should
  // be written or run until the plan is approved. Read-only tools stay available.
  const MUTATING_WS_TOOLS = new Set(['fs_write_file', 'fs_edit_file', 'run_command']);
  const categoryToolsForMode = isPlanning
    ? formattedCategoryTools.filter(t => !MUTATING_WS_TOOLS.has(t.function?.name))
    : formattedCategoryTools;
  tools.push(...categoryToolsForMode);

  // The exact set of tool names the model may call — used to gracefully recover from
  // typo'd / hallucinated tool names instead of failing hard with "Unknown tool".
  const validToolNames = new Set(tools.map(t => t.function && t.function.name).filter(Boolean));
  const normalizeKey = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const _lev = (a, b) => {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 4) return 99;
    const dp = Array.from({ length: m + 1 }, (_, i) => i);
    for (let j = 1; j <= n; j++) {
      let prev = dp[0]; dp[0] = j;
      for (let i = 1; i <= m; i++) {
        const tmp = dp[i];
        dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return dp[m];
  };
  const resolveToolName = (raw) => {
    if (validToolNames.has(raw)) return raw;
    const nk = normalizeKey(raw);
    if (!nk) return null;
    // Exact normalized match (handles casing/underscore differences).
    for (const v of validToolNames) if (normalizeKey(v) === nk) return v;
    // Substring either direction.
    for (const v of validToolNames) { const vk = normalizeKey(v); if (vk.includes(nk) || nk.includes(vk)) return v; }
    // Edit-distance fallback for typos like 'web_search_trtrusted' → 'web_search_trusted'.
    let best = null, bestD = 99;
    for (const v of validToolNames) {
      const d = _lev(nk, normalizeKey(v));
      if (d < bestD) { bestD = d; best = v; }
    }
    if (best && bestD <= Math.max(2, Math.floor(nk.length * 0.25))) return best;
    return null;
  };

  // ─── Execution Loop ───
  let iterations = 0;
  const MAX_ITERATIONS = 15;
  let totalSearches = 0;
  const MAX_SEARCHES = 8;
  const searchedQueries = new Set();
  let schemaRetries = 0;
  const MAX_SCHEMA_RETRIES = 1;
  // Phase B3: pre-review self-critique budget (separate from schema retries).
  let selfCritiques = 0;
  const MAX_SELF_CRITIQUES = 1;
  // (R2) Tools that failed as unavailable this run — filtered out of subsequent calls
  // so the model can't churn on a broken/denied tool.
  const disabledTools = new Set();
  // Phase 1B: source diversity + diminishing-returns tracking
  const searchedDomains = new Set();
  const discoveredUrls = new Set();
  let consecutiveNoNewFacts = 0;
  let convergenceInjected = false;
  let isFirstSearch = true;
  const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // Stop requested by the user → bail out cleanly.
    if (await haltIfStopped(executionId, history)) return;

    await updateExecution(executionId, {
      current_action: `Researching & analyzing... (step ${iterations})`,
      progress_pct: Math.round(Math.min(30 + (iterations / MAX_ITERATIONS) * 50, 80)),
    });
    await logExecutionStep(executionId, `Step ${iterations}: Running analysis and planning next actions.`);

    // Force convergence: if we've done enough searching, inject a directive to produce output NOW
    if (totalSearches >= MAX_SEARCHES || iterations >= MAX_ITERATIONS - 2) {
      messages.push({
        role: 'user',
        content: `SYSTEM DIRECTIVE: You have completed ${totalSearches} web searches and gathered sufficient data. You MUST now call produce_agent_output with your findings immediately. Do NOT call web_search_trusted again. Synthesize all gathered research into a comprehensive, detailed deliverable and call produce_agent_output NOW.`
      });
    }

    let llmResponse;
    try {
      // Use a reliable tool-calling model for agent work. The default (gpt-oss-120b)
      // is a REASONING model that under tool-calling spends its budget on hidden
      // reasoning and frequently returns no/invalid tool call → agents fall back to a
      // generic doc. llama-3.3-70b-versatile is far more reliable at function calling.
      // (When the company configured a custom chat model, callLLMWithTools overrides
      // this with the custom model regardless.)
      // (R2) Drop any tools that failed as unavailable earlier this run.
      const activeTools = disabledTools.size ? tools.filter(t => !disabledTools.has(t.function && t.function.name)) : tools;
      llmResponse = await callLLMWithTools(messages, activeTools, { model: 'llama-3.3-70b-versatile', temperature: 0.4, companyId: execution.company_id, max_tokens: 8000 });
    } catch (llmErr) {
      // Handle tool_use_failed — the model generated text instead of a tool call
      const isToolUseFailed = llmErr.status === 400 && (llmErr.code === 'tool_use_failed' || llmErr.message?.includes('Failed to call a function'));
      if (isToolUseFailed && llmErr.error?.failed_generation) {
        // Rescue the content the model tried to generate and produce it as output
        await logExecutionStep(executionId, `⚠️ Model generated text instead of tool call. Rescuing content as output.`);
        const rescuedContent = llmErr.error.failed_generation;
        await createApproval({
          executionId,
          companyId: execution.company_id,
          outputType: `${execution.agent_type}_analysis`,
          title: `${execution.agent_label} — Analysis`,
          summary: rescuedContent.substring(0, 200) + '...',
          content: {
            analysis: rescuedContent,
            generatedAt: new Date().toISOString(),
            note: 'Auto-rescued from model text generation'
          },
        });
        await updateExecution(executionId, {
          status: 'awaiting_approval',
          current_action: 'Awaiting your approval',
          output_data: { analysis: rescuedContent },
          output_summary: rescuedContent.substring(0, 200) + '...',
          progress_pct: 95,
          completed_at: new Date().toISOString(),
        });
        return;
      }
      // For other errors, retry up to 2 times then produce fallback
      if (iterations >= 3) {
        await logExecutionStep(executionId, `⚠️ LLM error after ${iterations} iterations: ${llmErr.message}. Producing fallback output.`);
        await produceFallbackOutput(executionId, execution.agent_type, companyProfile, history);
        return;
      }
      continue;
    }

    // Stop requested while the model was thinking → bail before doing more work.
    if (await haltIfStopped(executionId, history)) return;

    // ─── No tool calls → final answer or stuck ───
    if (!llmResponse.tool_calls || llmResponse.tool_calls.length === 0) {
      // If the agent just replied with text, treat that as a message to the user and PAUSE to wait for them
      if (llmResponse.content && llmResponse.content.length > 10) {
        history.push({ role: 'assistant', content: llmResponse.content, timestamp: new Date().toISOString() });
        await logExecutionStep(executionId, `Awaiting your response to: "${llmResponse.content.substring(0, 60)}..."`);
        await updateExecution(executionId, {
          status: 'awaiting_input',
          current_question: llmResponse.content,
          current_question_choices: null,
          current_question_id: `q_text_${iterations}`,
          current_action: 'Waiting for your response...',
          conversation_history: history,
          progress_pct: Math.round(Math.min(30 + (iterations / MAX_ITERATIONS) * 50, 80)),
        });
        return; // Pause execution
      }
      
      // If no tools used and no content, we're stuck — produce what we have
      if (iterations >= 3 && !llmResponse.content) {
        await logExecutionStep(executionId, `No actions planned. Finalizing execution with fallback output.`);
        await produceFallbackOutput(executionId, execution.agent_type, companyProfile, history);
        return;
      }
      continue;
    }

    // ─── Process tool calls ───
    for (const toolCall of llmResponse.tool_calls) {
      // Tolerant parse — repairs truncated/fenced JSON some providers emit so the
      // agent still completes instead of silently skipping its final output.
      let args = parseLooseJson(toolCall.function.arguments);
      if (args === undefined || typeof args !== 'object') {
        await logExecutionStep(executionId, `⚠️ Could not parse tool args for ${toolCall.function.name}; asking the model to re-emit valid JSON.`);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: true, message: `Your previous ${toolCall.function.name} call had invalid/truncated JSON arguments. Re-call ${toolCall.function.name} with COMPLETE, valid JSON only (no markdown, no commentary). Keep it concise enough to finish.` }),
        });
        continue;
      }

      // Gracefully recover from typo'd / hallucinated tool names (fix for
      // "web_search_trtrusted", "I don't have a budget yet", etc.).
      const rawToolName = toolCall.function.name;
      const corrected = resolveToolName(rawToolName);
      if (!corrected) {
        await logExecutionStep(executionId, `⚠️ Unknown tool "${rawToolName}" — guiding the model back to valid tools.`);
        messages.push({ role: 'assistant', content: llmResponse.content || null, tool_calls: [toolCall] });
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: true,
            message: `"${rawToolName}" is not a valid tool and was NOT executed. Call one of these EXACT tool names: ${[...validToolNames].join(', ')}. ` +
              `To ask the user something, use ask_user_question. To finish, use produce_agent_output. Do not invent tool names.`,
          }),
        });
        continue;
      }
      if (corrected !== rawToolName) {
        await logExecutionStep(executionId, `↪️ Interpreted "${rawToolName}" as "${corrected}".`);
        toolCall.function.name = corrected;
      }

      const assistantMsg = {
        role: 'assistant',
        content: llmResponse.content || null,
        tool_calls: [toolCall],
      };
      messages.push(assistantMsg);

      switch (toolCall.function.name) {
        case 'web_search_trusted': {
          // Deduplicate and cap searches
          const queryNorm = (args.query || '').toLowerCase().trim();
          if (searchedQueries.has(queryNorm)) {
            await logExecutionStep(executionId, `⏭️ Skipping duplicate search: "${args.query}"`);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: false, message: `You already searched for "${args.query}". Use the results you already have. Do NOT repeat searches. Call produce_agent_output with your findings now.`, results: [] }),
            });
            break;
          }
          if (totalSearches >= MAX_SEARCHES) {
            await logExecutionStep(executionId, `⏭️ Search cap reached (${MAX_SEARCHES}). Skipping: "${args.query}"`);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: false, message: `Search limit reached (${MAX_SEARCHES} searches completed). You have gathered enough data. Call produce_agent_output with your findings NOW.`, results: [] }),
            });
            break;
          }
          try {
            searchedQueries.add(queryNorm);
            totalSearches++;

            // ─── Query expansion on the first search (Phase 1B) ───
            // Decompose the broad intent into focused, non-overlapping sub-queries
            // and run them within the remaining search budget.
            let queriesToRun = [args.query];
            if (isFirstSearch) {
              isFirstSearch = false;
              try {
                const remainingBudget = Math.max(1, MAX_SEARCHES - totalSearches + 1);
                const expanded = await expandQuery(args.query, {
                  maxSubQueries: Math.min(3, remainingBudget),
                  context: buildCompanyContext(companyProfile),
                });
                if (expanded.length > 1) {
                  queriesToRun = expanded;
                  await logExecutionStep(executionId, `🧭 Expanded research into ${expanded.length} angles: ${expanded.map(q => `"${q}"`).join(', ')}`);
                }
              } catch { /* fall back to single query */ }
            }

            await updateExecution(executionId, {
              current_action: `🔍 Searching web (${totalSearches}/${MAX_SEARCHES}): "${args.query}"`,
            });
            await logExecutionStep(executionId, `🔍 Searching web (${totalSearches}/${MAX_SEARCHES}): "${args.query}"`);

            const aggregated = [];
            const seenUrls = new Set();
            let newFactsThisTurn = 0;

            for (let qi = 0; qi < queriesToRun.length; qi++) {
              const subQuery = queriesToRun[qi];
              const subNorm = subQuery.toLowerCase().trim();
              // First sub-query already counted; subsequent ones consume budget + dedupe
              if (qi > 0) {
                if (searchedQueries.has(subNorm) || totalSearches >= MAX_SEARCHES) continue;
                searchedQueries.add(subNorm);
                totalSearches++;
              }

              const result = await searchWeb(subQuery, { maxResults: args.maxResults || 8, relevanceFilter: true });
              for (const r of (result.results || [])) {
                if (!r.url || seenUrls.has(r.url)) continue;
                seenUrls.add(r.url);
                const dom = domainOf(r.url);
                // Source diversity: down-rank domains we've already pulled from repeatedly
                if (dom) {
                  if (searchedDomains.has(dom) && aggregated.length >= 3) continue;
                  searchedDomains.add(dom);
                }
                aggregated.push(r);
                if (!discoveredUrls.has(r.url)) { discoveredUrls.add(r.url); newFactsThisTurn++; }
              }
            }

            await logExecutionStep(executionId, `✅ Web search complete. ${aggregated.length} relevant results, ${newFactsThisTurn} new sources.`);

            // ─── Diminishing-returns detection (Phase 1B) ───
            if (newFactsThisTurn === 0) {
              consecutiveNoNewFacts++;
            } else {
              consecutiveNoNewFacts = 0;
            }

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(aggregated.slice(0, 10)),
            });

            if (consecutiveNoNewFacts >= 2 && !convergenceInjected) {
              convergenceInjected = true;
              await logExecutionStep(executionId, `📉 Research has converged — no new sources in 2 consecutive searches. Directing agent to synthesize.`);
              messages.push({
                role: 'user',
                content: `SYSTEM DIRECTIVE: Your last two searches returned no new sources — further searching has hit diminishing returns. Do NOT search again. Synthesize everything you have gathered and call produce_agent_output now.`,
              });
            }
          } catch (err) {
            await logExecutionStep(executionId, `⚠️ Web search failed: ${err.message}`);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: true, message: err.message }),
            });
          }
          break;
        }

        case 'web_extract_source_content': {
          try {
            await updateExecution(executionId, {
              current_action: `📄 Reading webpage: ${args.url}`,
            });
            await logExecutionStep(executionId, `📄 Reading webpage: ${args.url}`);
            
            const content = await extractSourceContent(args.url, { maxChars: args.maxChars || 8000 });
            
            await logExecutionStep(executionId, `✅ Page reading complete. Extracted ${content.textContent?.substring(0, 5000).length || 0} characters.`);
            
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                title: content.title,
                content: content.textContent?.substring(0, 5000) || '',
                url: content.url,
              }),
            });
          } catch (err) {
            await logExecutionStep(executionId, `⚠️ Page reading failed: ${err.message}`);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: true, message: err.message }),
            });
          }
          break;
        }

        case 'ask_user_question': {
          // Pause and ask the user — optionally with predefined answer choices
          await logExecutionStep(executionId, `❓ Asking user: "${args.question}"`);
          await updateExecution(executionId, {
            status: 'awaiting_input',
            current_question: args.question,
            current_question_choices: args.choices || null,
            current_question_id: `q_manual_${iterations}`,
            current_action: 'Waiting for your input...',
            conversation_history: history,
            progress_pct: 60,
          });
          return; // Wait for user response
        }

        case 'produce_agent_output': {
          // ─── Plan mode (Phase A0): in planning, the only valid output is the plan. ───
          if (isPlanning) {
            const planContent = (args.content && typeof args.content === 'object') ? args.content : {};
            await logExecutionStep(executionId, `📝 Proposing plan: "${args.title}" (awaiting your approval before execution)`);
            await createApproval({
              executionId, companyId: execution.company_id,
              outputType: 'plan',
              title: args.title || `${execution.agent_label} — Plan`,
              summary: args.summary || planContent.objective || 'Proposed plan',
              content: planContent,
            });
            await updateExecution(executionId, {
              status: 'awaiting_plan_approval',
              current_action: 'Awaiting your approval of the plan',
              output_data: planContent,
              output_summary: args.summary || planContent.objective || '',
              progress_pct: 40,
              conversation_history: history,
            });
            return;
          }

          // ─── Recipe output_type enforcement ───
          // A recipe run declares the deliverable it must ship (e.g. brand_identity →
          // asset_collection). If the agent ignores it and emits a generic output
          // (e.g. dumping the task text into `findings`), bounce it once so we actually
          // get the intended, previewable deliverable instead of a prose echo.
          const _recipeId = execution.output_data && execution.output_data.recipe_id;
          if (_recipeId) {
            const _recipe = getRecipe(execution.agent_type, _recipeId);
            if (_recipe && _recipe.output_type && args.output_type !== _recipe.output_type && schemaRetries < MAX_SCHEMA_RETRIES) {
              schemaRetries++;
              await logExecutionStep(executionId, `⚠️ Expected a "${_recipe.output_type}" deliverable but got "${args.output_type}". Requesting the correct format.`);
              const hint = _recipe.output_type === 'asset_collection'
                ? 'content.assets MUST be a non-empty array of self-contained CODE assets: [{ "kind":"svg", "code":"<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 …\\">…</svg>", "caption":"…" }, …] — real, complete SVG markup (e.g. a color-palette swatch with hex labels, a type-pairing sample, and 2-3 logo marks). Do NOT put the task text into findings, and do NOT describe the assets — actually draw them as SVG.'
                : _recipe.output_type === 'web_artifact'
                  ? 'content.html MUST be a COMPLETE, self-contained HTML document (inline CSS/JS, no external assets).'
                  : `produce the real ${_recipe.output_type} content with this task's actual results (not a restatement of the task).`;
              messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: true, message: `This task must be delivered as output_type "${_recipe.output_type}". Re-call produce_agent_output with output_type "${_recipe.output_type}" and ${hint}` }) });
              break;
            }
          }

          // ─── code_project (Phase C2): assemble a static preview from the workspace ───
          if (args.output_type === 'code_project') {
            const content = (args.content && typeof args.content === 'object') ? args.content : {};
            try {
              const ws = require('./workspaceService');
              const preview = await ws.buildPreview(executionId, execution.company_id);
              content.workspace_id = preview ? undefined : content.workspace_id;
              if (preview) {
                if (preview.html) content.html = preview.html;
                content.entry = preview.entry;
                content.files = preview.files;
              }
            } catch (e) {
              await logExecutionStep(executionId, `⚠️ Could not assemble project preview: ${e.message}`);
            }
            await logExecutionStep(executionId, `🏁 Producing code project: "${args.title}"`);
            await createApproval({
              executionId, companyId: execution.company_id,
              outputType: 'code_project', title: args.title, summary: args.summary, content,
            });
            await updateExecution(executionId, {
              status: 'awaiting_approval', current_action: 'Awaiting your approval',
              output_data: { ...(execution.output_data || {}), files: content.files }, output_summary: args.summary,
              progress_pct: 95, completed_at: new Date().toISOString(),
            });
            return;
          }

          // ─── Visual artifact types (previewable): validate their own shape ───
          const ARTIFACT_TYPES = ['web_artifact', 'asset_collection'];
          if (ARTIFACT_TYPES.includes(args.output_type)) {
            const c = (args.content && typeof args.content === 'object') ? args.content : {};
            // An asset item is valid if it carries renderable code (svg/html) OR a real image (url/dataUri).
            const assetOk = (a) => a && typeof a === 'object' && (
              (typeof a.code === 'string' && a.code.trim().length > 0) ||
              typeof a.url === 'string' || typeof a.dataUri === 'string'
            );
            const ok = args.output_type === 'web_artifact'
              ? (typeof c.html === 'string' && c.html.trim().length > 20)
              : (Array.isArray(c.assets) && c.assets.length > 0 && c.assets.every(assetOk));
            if (!ok && schemaRetries < MAX_SCHEMA_RETRIES) {
              schemaRetries++;
              await logExecutionStep(executionId, `⚠️ ${args.output_type} missing content. Requesting one revision.`);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  error: true,
                  message: args.output_type === 'web_artifact'
                    ? 'Re-call produce_agent_output with content.html containing the COMPLETE self-contained HTML document (inline CSS/JS, no external build).'
                    : 'Re-call produce_agent_output with content.assets as a non-empty array. Each asset MUST be self-contained code { kind: "svg"|"html", code, caption } (preferred — do not generate raster images) OR { url|dataUri, caption } for a real existing asset.',
                }),
              });
              break;
            }

            // ── Precision gate: visual code assets must be well-formed & self-contained ──
            const codeWellFormed = (a) => {
              if (!a || typeof a.code !== 'string' || !a.code.trim()) return true; // non-code assets handled above
              const code = a.code.trim();
              if (/https?:\/\//i.test(code) || /<image\b/i.test(code) || /<link\b/i.test(code) || /<script\b/i.test(code)) return false;
              if (a.kind === 'html') return /<[a-z][\s\S]*>/i.test(code);
              return /<svg[\s>]/i.test(code) && /<\/svg>/i.test(code) && /viewbox\s*=/i.test(code) && /xmlns\s*=/i.test(code);
            };
            if (ok && args.output_type === 'asset_collection' && schemaRetries < MAX_SCHEMA_RETRIES) {
              const assetsArr = Array.isArray(c.assets) ? c.assets : [];
              const bad = assetsArr.filter(a => typeof a?.code === 'string' && a.code.trim() && !codeWellFormed(a));
              if (bad.length > 0) {
                schemaRetries++;
                await logExecutionStep(executionId, `⚠️ ${bad.length} visual asset(s) not well-formed/self-contained. Requesting one fix.`);
                messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: true, message: 'Some visual assets are invalid. Re-call produce_agent_output. Every SVG MUST include xmlns AND an explicit viewBox AND a closing </svg>, with NO external URLs, <image>, <link>, scripts or fonts. Fix coordinates so nothing is clipped or overlapping, center text with text-anchor="middle" and dominant-baseline="central", and keep each mark legible at ~24px and monochrome-safe.' }) });
                break;
              }
            }

            // Pre-review self-critique (Phase B3)
            if (SELF_CRITIQUE_ENABLED && selfCritiques < MAX_SELF_CRITIQUES) {
              const crit = await runSelfCritique(execution, args);
              if (!crit.pass) {
                selfCritiques++;
                await logExecutionStep(executionId, `🔎 Self-review (${crit.score}/100) before showing you: ${crit.deficiencies.join('; ')}. Revising once.`);
                messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: true, message: `Self-review scored ${crit.score}/100 and found issues to fix BEFORE the user sees this. Improve and re-call produce_agent_output: ${crit.deficiencies.join('; ')}` }) });
                break;
              }
            }
            await logExecutionStep(executionId, `🏁 Producing ${args.output_type}: "${args.title}"`);
            await createApproval({
              executionId, companyId: execution.company_id,
              outputType: args.output_type, title: args.title, summary: args.summary, content: args.content,
            });
            await updateExecution(executionId, {
              status: 'awaiting_approval', current_action: 'Awaiting your approval',
              output_data: args.content, output_summary: args.summary,
              progress_pct: 95, completed_at: new Date().toISOString(),
            });
            return;
          }

          // ─── Schema enforcement (Phase 1A) ───
          // Only enforce the agent-wide schema for GENERIC outputs. For recognized
          // deliverable types (lead_list, tech_spec, market_research, asset_collection,
          // recipe outputs, …) the intended shape differs — forcing the agent schema
          // wrongly rejects them and causes revision churn. Quality is instead handled
          // by the recipe prompt + the Phase B3 self-critique gate.
          const requiredKeys = KNOWN_DELIVERABLE_TYPES.has(args.output_type)
            ? []
            : (AGENT_OUTPUT_SCHEMAS[execution.agent_type] || []);
          const outContent = (args.content && typeof args.content === 'object') ? args.content : {};
          const missingKeys = requiredKeys.filter(k => {
            const v = outContent[k];
            if (v === undefined || v === null) return true;
            if (Array.isArray(v) && v.length === 0) return true;
            if (typeof v === 'string' && v.trim() === '') return true;
            return false;
          });

          // (R3) Schema is now NON-BLOCKING — log a soft note but never force a
          // revision round. Extra LLM rounds add churn (and failure surface on a flaky
          // model); quality is governed by the Phase-B3 self-critique gate below.
          if (missingKeys.length > 0) {
            await logExecutionStep(executionId, `ℹ️ Note: generic output is light on ${missingKeys.join(', ')} — accepting and letting self-review handle quality.`);
          }

          // Pre-review self-critique (Phase B3)
          if (SELF_CRITIQUE_ENABLED && selfCritiques < MAX_SELF_CRITIQUES) {
            const crit = await runSelfCritique(execution, args);
            if (!crit.pass) {
              selfCritiques++;
              await logExecutionStep(executionId, `🔎 Self-review (${crit.score}/100) before showing you: ${crit.deficiencies.join('; ')}. Revising once.`);
              messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: true, message: `Self-review scored ${crit.score}/100 and found issues to fix BEFORE the user sees this. Improve and re-call produce_agent_output: ${crit.deficiencies.join('; ')}` }) });
              break;
            }
          }

          // Create an approval record
          await logExecutionStep(executionId, `🏁 Producing final deliverable: "${args.title}"`);
          await createApproval({
            executionId,
            companyId: execution.company_id,
            outputType: args.output_type,
            title: args.title,
            summary: args.summary,
            content: args.content,
          });

          await updateExecution(executionId, {
            status: 'awaiting_approval',
            current_action: 'Awaiting your approval',
            output_data: args.content,
            output_summary: args.summary,
            progress_pct: 95,
            completed_at: new Date().toISOString(),
          });
          return;
        }

        case 'fs_write_file':
        case 'fs_read_file':
        case 'fs_edit_file':
        case 'fs_list_files':
        case 'fs_search':
        case 'run_command': {
          // Claude-Code-style workspace tools (Phase C2) — execute directly against
          // the sandboxed per-run workspace, bypassing the sentinel.
          try {
            const ws = require('./workspaceService');
            const cid = execution.company_id;
            let result;
            switch (toolCall.function.name) {
              case 'fs_write_file':
                await logExecutionStep(executionId, `📝 Writing ${args.path}`);
                result = await ws.writeFile(executionId, cid, args.path, args.content); break;
              case 'fs_read_file':
                result = await ws.readFile(executionId, cid, args.path); break;
              case 'fs_edit_file':
                await logExecutionStep(executionId, `✏️ Editing ${args.path}`);
                result = await ws.editFile(executionId, cid, args.path, args.old_string, args.new_string); break;
              case 'fs_list_files':
                result = await ws.listFiles(executionId, cid); break;
              case 'fs_search':
                result = await ws.searchFiles(executionId, cid, args.query); break;
              case 'run_command':
                await updateExecution(executionId, { current_action: `⚙️ ${args.command}` });
                await logExecutionStep(executionId, `⚙️ Running: ${args.command}`);
                result = await ws.runCommand(executionId, cid, args.command); break;
            }
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result).slice(0, 14000) });
          } catch (err) {
            await logExecutionStep(executionId, `⚠️ Workspace tool failed: ${err.message}`);
            messages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: true, message: err.message }) });
          }
          break;
        }

        default: {
          try {
            await updateExecution(executionId, {
              current_action: `⚙️ Executing tool: ${toolCall.function.name}`,
            });
            await logExecutionStep(executionId, `⚙️ Executing tool: ${toolCall.function.name}`);

            const sentinel = require('../middleware/sentinel');
            const verdict = await sentinel.validate({
              name: toolCall.function.name,
              arguments: args
            }, user);

            if (!verdict.allowed) {
              throw new Error(`Sentinel denied tool execution: ${verdict.reason}`);
            }

            // ─── Approval-first (Phase 3): external-mutating actions are proposed, not executed ───
            const { isActionTool, proposeAction } = require('./actionApprovalService');
            if (isActionTool(toolCall.function.name)) {
              const proposed = await proposeAction({
                companyId: execution.company_id,
                executionId,
                toolName: toolCall.function.name,
                category: verdict.toolDef?.category || null,
                args,
                userId: user?.id || null,
              });
              await logExecutionStep(executionId, `🔐 Action proposed, awaiting your approval: ${proposed.preview}`);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                  status: 'pending_user_approval',
                  action_id: proposed.id,
                  preview: proposed.preview,
                  message: `This action ("${toolCall.function.name}") has been QUEUED for user approval and has NOT been executed yet. Do NOT claim it was completed. Note it as a proposed action and continue with the rest of your work.`,
                }),
              });
              break;
            }

            const execResult = await sentinel.executeApprovedTool({
              name: toolCall.function.name,
              arguments: args
            }, verdict, user);

            if (!execResult.success) {
              throw new Error(execResult.error || 'Execution failed');
            }

            await logExecutionStep(executionId, `✅ Tool execution complete: ${toolCall.function.name}`);

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(execResult.result || execResult),
            });
          } catch (err) {
            await logExecutionStep(executionId, `⚠️ Tool execution failed: ${err.message}`);
            // (R2) Self-heal: if the tool is unavailable (denied / no provider / not
            // implemented / unknown), disable it for the rest of the run so the model
            // can't keep calling it, and tell it to proceed another way.
            const unavailable = /not available|category enabled|No provider|does not implement|Unknown tool|not found in registry/i.test(err.message || '');
            let guidance = err.message;
            if (unavailable) {
              disabledTools.add(toolCall.function.name);
              guidance = `Tool "${toolCall.function.name}" is unavailable for this company and has been disabled. Do NOT call it again. Achieve the goal another way — use web_search_trusted to research, or produce_agent_output with what you have.`;
              await logExecutionStep(executionId, `🚫 Disabled unavailable tool "${toolCall.function.name}" for this run.`);
            }
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: true, message: guidance }),
            });
          }
          break;
        }
      }
    }
  }

  // ─── Max iterations reached — produce fallback output ───
  await logExecutionStep(executionId, `⚠️ Max iterations reached without formal output. Creating fallback output.`);
  await produceFallbackOutput(executionId, execution.agent_type, companyProfile, history);
}

/**
 * Build a company context string from the company profile.
 */
function buildCompanyContext(profile) {
  if (!profile) return 'No company profile available.';
  const parts = [];

  if (profile.name) parts.push(`Company: ${profile.name}`);
  if (profile.industry) parts.push(`Industry: ${profile.industry}`);
  if (profile.description) parts.push(`Description: ${profile.description}`);
  if (profile.website) parts.push(`Website: ${profile.website}`);
  if (profile.onboarding_type) parts.push(`Type: ${profile.onboarding_type === 'new_company' ? 'Startup' : 'Existing Company'}`);
  if (profile.company_stage) parts.push(`Stage: ${profile.company_stage}`);
  if (profile.mission_vision) parts.push(`Mission: ${profile.mission_vision}`);
  if (profile.target_customer) parts.push(`Target Customer: ${profile.target_customer}`);
  if (profile.competitors) parts.push(`Known Competitors: ${profile.competitors}`);
  if (profile.location) parts.push(`Location: ${profile.location}`);
  if (profile.team_size) parts.push(`Team Size: ${profile.team_size}`);
  if (profile.current_tools) parts.push(`Current Tools: ${profile.current_tools}`);
  if (profile.pain_points) parts.push(`Pain Points: ${profile.pain_points}`);
  if (profile.linkedin_url) parts.push(`LinkedIn: ${profile.linkedin_url}`);
  if (profile.x_url) parts.push(`X/Twitter: ${profile.x_url}`);

  return parts.join('\n');
}

/**
 * Build the execution prompt for a specific agent type.
 */
function buildExecutionPrompt(agentType, profile) {
  const prompts = {
    finance: `Perform a comprehensive financial analysis for ${profile.name || 'this company'}.

1. Analyze their revenue model, MRR, and expense structure
2. Research market comparables and financial benchmarks using web_search_trusted
3. Evaluate cash runway, burn rate, and funding needs
4. Provide actionable financial recommendations

When done, use produce_agent_output.`,

    people: `Perform a people/talent analysis for ${profile.name || 'this company'}.

1. Research market salary data and hiring benchmarks using web_search_trusted
2. Analyze team structure, hiring needs, and culture initiatives
3. Provide talent acquisition and retention recommendations

When done, use produce_agent_output.`,

    hr: `Perform an HR and compliance analysis for ${profile.name || 'this company'}.

1. Research labor law and compliance requirements using web_search_trusted
2. Analyze benefits packages and HR policies
3. Provide HR operations and compliance recommendations

When done, use produce_agent_output.`,

    investment: `Perform an investment readiness analysis for ${profile.name || 'this company'}.

1. Research the market size, growth rate, and comparable startups using web_search_trusted
2. Evaluate investment readiness across team, product, traction, and market
3. Find real investors matching their stage and industry
4. Include firm details and contact approach

When done, use produce_agent_output.`,

    crm: `Perform a relationship intelligence analysis for ${profile.name || 'this company'}.

1. Research key contacts and their companies using web_search_trusted
2. Analyze relationship health, deal stages, and interaction history
3. Provide relationship management recommendations

When done, use produce_agent_output.`,

    marketing: `Develop a marketing strategy and content plan for ${profile.name || 'this company'}.

1. Research the market, industry trends, and competitor campaigns using web_search_trusted
2. Create a data-driven marketing strategy with channel recommendations
3. Draft content samples: social posts, email copy, campaign ideas

When done, use produce_agent_output.`,

    sales: `Find leads and build a sales pipeline for ${profile.name || 'this company'}.

1. Search the web for companies matching their ICP using web_search_trusted
2. Research each prospect — company size, funding, needs
3. Organize leads by priority and provide outreach suggestions

When done, use produce_agent_output.`,

    product: `Perform a product analysis for ${profile.name || 'this company'}.

1. Research competitor products and user reviews using web_search_trusted
2. Analyze market trends and feature requirements
3. Provide product strategy and prioritization recommendations

When done, use produce_agent_output.`,

    roadmap: `Develop a strategic roadmap for ${profile.name || 'this company'}.

1. Research market trends and emerging technologies using web_search_trusted
2. Analyze competitive landscape and strategic positioning
3. Create a phased roadmap with milestones and objectives

When done, use produce_agent_output.`,

    meeting: `Prepare for and analyze meetings for ${profile.name || 'this company'}.

1. Research meeting topics and participants using web_search_trusted
2. Extract decisions and action items from past meeting notes
3. Provide meeting preparation and follow-up recommendations

When done, use produce_agent_output.`,

    engineering: `Perform a CTO-level technical review for ${profile.name || 'this company'}.

1. Map the likely technical debt and architecture risks given their stage and stack
2. Research relevant tools, frameworks, and vendors (with rough pricing/effort) using web_search_trusted for any build-vs-buy decisions
3. Assess feature/roadmap feasibility against the team's actual capacity
4. Give opinionated, prioritized technical recommendations a founder can act on this week

When done, use produce_agent_output.`,
  };

  return prompts[agentType] || `Execute your mission for ${profile.name || 'this company'}.`;
}

/**
 * Produce a fallback output when the agent hits max iterations or gets stuck.
 */
async function produceFallbackOutput(executionId, agentType, companyProfile, history) {
  const { data: execution } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', executionId)
    .single();

  if (!execution) return;

  // Synthesize whatever we have into an output
  const msgContent = history.map(h => h.content).join('\n');

  await createApproval({
    executionId,
    companyId: execution.company_id,
    outputType: `${agentType}_results`,
    title: `${execution.agent_label} — Results`,
    summary: `Generated based on available research. ${msgContent.length > 200 ? msgContent.substring(0, 200) + '...' : msgContent}`,
    content: {
      findings: msgContent.substring(0, 10000),
      researchNotes: history,
      generatedAt: new Date().toISOString(),
    },
  });

  await updateExecution(executionId, {
    status: 'awaiting_approval',
    current_action: 'Awaiting your approval',
    output_summary: `Generated based on ${history.length} interactions`,
    progress_pct: 90,
    completed_at: new Date().toISOString(),
  });
}

/**
 * Asynchronously resume an agent execution after rejection/revision feedback is received.
 */
async function resumeAgentWorkAfterRejection(executionId, user) {
  const { data: execution } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', executionId)
    .single();

  if (!execution) throw new Error('Execution not found');

  const { data: companyProfile } = await supabase
    .from('companies')
    .select('*')
    .eq('id', execution.company_id)
    .single();

  if (!companyProfile) throw new Error('Company profile not found');

  const history = execution.conversation_history || [];

  await logExecutionStep(executionId, `Revision feedback received. Resuming background execution.`);

  await updateExecution(executionId, {
    status: 'running',
    current_action: 'Resuming work based on feedback...',
    current_question: null,
    current_question_choices: null,
    current_question_id: null,
    progress_pct: 35,
  });

  // Run in background asynchronously (non-blocking)
  setImmediate(() => {
    executeAgentWork(executionId, companyProfile, user, history).catch(err => {
      console.error(`[AgentOrchestrator] Background revision failed for ${executionId}:`, err.message);
      updateExecution(executionId, {
        status: 'failed',
        error_message: err.message,
        current_action: 'Failed',
      });
    });
  });
}

/**
 * Resume an execution to revise its latest deliverable based on open reviewer
 * comments (Phase A4). Behaviorally identical to the rejection resume — the open
 * comments are read from the DB inside executeAgentWork's context assembly — but
 * named for the comment-driven path.
 */
async function resumeAgentWorkWithComments(executionId, user) {
  return resumeAgentWorkAfterRejection(executionId, user);
}

/**
 * Resume an execution into its work loop in the background (Phase A0). Used after a
 * plan is approved to flip from planning → executing and produce the real deliverable.
 * The caller is responsible for having already set mode/status and seeded any history.
 */
async function resumeAgentExecution(executionId, user) {
  const { data: execution } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', executionId)
    .single();
  if (!execution) throw new Error('Execution not found');

  const { data: companyProfile } = await supabase
    .from('companies')
    .select('*')
    .eq('id', execution.company_id)
    .single();
  if (!companyProfile) throw new Error('Company profile not found');

  const history = execution.conversation_history || [];
  setImmediate(() => {
    executeAgentWork(executionId, companyProfile, user, history).catch(err => {
      console.error(`[AgentOrchestrator] Background execution failed for ${executionId}:`, err.message);
      updateExecution(executionId, { status: 'failed', error_message: err.message, current_action: 'Failed' });
    });
  });
}

// ─── State Management ───

/**
 * Update an execution record in the database.
 */
/**
 * If the user requested a stop, mark the execution stopped and return true so the
 * caller can bail out of its loop. Clears the in-memory flag.
 */
async function haltIfStopped(executionId, history) {
  if (!isStopRequested(executionId)) return false;
  clearStop(executionId);
  try {
    await logExecutionStep(executionId, '🛑 Action stopped by user.');
    // Stopping only aborts the in-flight action — the agent returns to an idle,
    // usable state rather than being stuck in a terminal "stopped" status.
    await updateExecution(executionId, {
      status: 'idle',
      current_action: '',
      progress_pct: 0,
      current_question: null,
      current_question_choices: null,
      current_question_id: null,
      conversation_history: Array.isArray(history) ? history : undefined,
    });
  } catch (e) {
    console.warn('[AgentOrchestrator] haltIfStopped update failed:', e.message);
  }
  return true;
}

async function updateExecution(executionId, updates) {
  updates.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from('agent_executions')
    .update(updates)
    .eq('id', executionId);

  if (error) {
    console.error(`[AgentOrchestrator] Failed to update execution ${executionId}:`, error.message);
  }
}

/**
 * Append a step log to the execution's output_data.logs array.
 */
async function logExecutionStep(executionId, stepText) {
  try {
    const { data: exec } = await supabase
      .from('agent_executions')
      .select('output_data')
      .eq('id', executionId)
      .single();

    if (exec) {
      const outputData = exec.output_data || {};
      const logs = Array.isArray(outputData.logs) ? [...outputData.logs] : [];
      const timestamp = new Date().toLocaleTimeString();
      logs.push(`[${timestamp}] ${stepText}`);
      
      await updateExecution(executionId, {
        output_data: { ...outputData, logs }
      });
    }
  } catch (err) {
    console.error(`[AgentOrchestrator] Failed to log step for ${executionId}:`, err.message);
  }
}

/**
 * Get all active agent executions for a company.
 */
async function getCompanyExecutions(companyId) {
  const { data, error } = await supabase
    .from('agent_executions')
    .select('*, agent_outputs(*)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) throw error;
  return data || [];
}

/**
 * Get a specific agent execution by ID.
 */
async function getExecution(executionId) {
  const { data, error } = await supabase
    .from('agent_executions')
    .select('*, agent_outputs(*)')
    .eq('id', executionId)
    .single();

  if (error) throw error;
  return data;
}

// ─── Map extracted tasks to the agent best suited to execute them ───
const _TASK_AGENT_KEYWORDS = [
  { agent: 'investment', kw: ['investor', 'fundrais', 'pitch deck', 'raise capital', 'venture', 'angel', 'seed round', 'series a', 'cap table', 'valuation'] },
  { agent: 'marketing', kw: ['market', 'campaign', 'content', 'social media', 'brand', 'seo', 'advertis', 'newsletter', 'launch announcement', 'blog', 'landing page'] },
  { agent: 'sales', kw: ['sales', 'lead', 'outreach', 'pipeline', 'prospect', 'deal', 'cold email', 'customer acquisition', 'quota', 'demo call'] },
  { agent: 'engineering', kw: ['code', 'build', 'engineer', 'api', 'frontend', 'backend', 'deploy', 'infrastructure', 'technical', 'bug', 'architecture', 'integration', 'database', 'prototype'] },
  { agent: 'finance', kw: ['budget', 'runway', 'cash', 'accounting', 'pricing', 'financial', 'burn rate', 'forecast', 'expense', 'invoice'] },
  { agent: 'hr', kw: ['hire', 'recruit', 'interview', 'job post', 'onboarding', 'culture', 'employee', 'headcount', 'compliance', 'policy', 'benefits'] },
  { agent: 'product', kw: ['product', 'feature', 'roadmap', 'prd', 'design', 'ux', 'user story', 'sprint', 'mvp', 'backlog'] },
  { agent: 'crm', kw: ['crm', 'relationship', 'follow-up', 'follow up', 'contact', 'client management', 'account management'] },
];
const _DEPT_AGENT = { finance: 'finance', commercial: 'sales', product: 'product', hr: 'hr', operations: 'engineering', general: 'roadmap' };

/**
 * Inspect a meeting/brainstorm's insights and decide which agent should handle each
 * action item. Returns [{ agent_type, agent_label, task }].
 */
function detectAgentTasks(insights) {
  const items = Array.isArray(insights?.action_items) ? insights.action_items : [];
  const out = [];
  for (const a of items) {
    const taskText = typeof a === 'string' ? a : (a.task || '');
    if (!taskText || !taskText.trim()) continue;
    const lower = taskText.toLowerCase();
    let agent = null;
    for (const m of _TASK_AGENT_KEYWORDS) {
      if (m.kw.some(k => lower.includes(k))) { agent = m.agent; break; }
    }
    if (!agent) agent = _DEPT_AGENT[String(a.department || '').toLowerCase()] || 'roadmap';
    if (!AGENT_DEFINITIONS[agent]) agent = 'roadmap';
    out.push({ agent_type: agent, agent_label: AGENT_DEFINITIONS[agent].label, task: taskText });
  }
  return out;
}

module.exports = {
  launchAgent,
  launchAgentWithContext,
  launchRecipe,
  launchStartupAgents,
  AGENT_RECIPES,
  getRecipe,
  respondToAgent,
  getCompanyExecutions,
  getExecution,
  resumeAgentWorkAfterRejection,
  resumeAgentWorkWithComments,
  resumeAgentExecution,
  AGENT_DEFINITIONS,
  executeAgentWork,
  requestStop,
  detectAgentTasks,
};
