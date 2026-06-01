# The Brain — Master Build Plan
### Goal: $10k MRR | Zero Spend | Launch This Month

---

## Table of Contents

1. [Honest Diagnosis](#honest-diagnosis)
2. [Strategy](#strategy)
3. [Phase 1 — Fix & Rebuild Agents](#phase-1--fix--rebuild-agents)
4. [Phase 2 — Document Output Quality](#phase-2--document-output-quality)
5. [Phase 3 — Agent Actions](#phase-3--agent-actions)
6. [Phase 4 — Meeting Ingestion](#phase-4--meeting-ingestion)
7. [Phase 5 — Wire Frontend](#phase-5--wire-frontend)
8. [Phase 6 — Stripe Paywall](#phase-6--stripe-paywall)
9. [Phase 7 — Onboarding](#phase-7--onboarding)
10. [Phase 8 — Launch](#phase-8--launch)
11. [Zero-Spend Infrastructure](#zero-spend-infrastructure)
12. [Social Media & GitHub Integrations](#social-media--github-integrations)
13. [Additional Risks & Proposals](#additional-risks--proposals)
14. [What to Remove](#what-to-remove)
15. [Verification Checklist](#verification-checklist)

---

## Honest Diagnosis

### What works end-to-end
- Brain chat (RAG query → LLM → response with source citations)
- Document ingestion (PDF/DOCX/CSV)
- Agent discovery questions (LLM generates contextual Q&A)
- Web research via Tavily API
- Agent structured output + approval workflow
- Dashboard metrics
- Auth + multi-tenancy

### What's broken / blocking value

| # | Problem | Impact |
|---|---------|--------|
| 1 | **Agents produce generic outputs** — system prompts are weak, no output schemas enforced, feel like ChatGPT with a label | No one pays for this |
| 2 | **Frontend ↔ backend agent flow is unwired** — buttons exist but status, progress, question flow, and output display not connected | Product is unusable |
| 3 | **Provider adapters are stubs** — 80+ tools defined but adapters do nothing; agents can't take real actions | Core differentiator missing |
| 4 | **No paywall** — no Stripe, no way to collect revenue | Can't make money |
| 5 | **Onboarding is incomplete** — users land post-signup without guidance | Drop-off at minute 1 |
| 6 | **Document generation is disconnected** — agents produce JSON but the pipeline to DOCX/PDF/PPTX/CSV/MD is broken | Deliverables don't exist |
| 7 | **Uploads stored on disk** — Render/Railway filesystem is ephemeral; files vanish on restart | Data loss in production |
| 8 | **No email notifications** — agents finish in background and users never know | Zero re-engagement |
| 9 | **No usage analytics** — flying blind post-launch | Can't prioritize |

### What to Remove Before Launch

- **Electron `app/` directory** — dead code, confuses deployments, delete it
- **All `scratch_*.js` files** in root — debugging artifacts
- **Stray root files** — `nul`, `pdf`, `test_no_ext` etc.
- **Integration Settings UI** — replace "broken" integrations with "Coming Soon" roadmap; only show Google Drive + Slack as live
- **Roadmap "Launch Related Agents" button** — broken, hide until Phase 5 is done
- **Microsoft 365 mentions in UI** — not built, don't promise it
- **Pinecone fallback** in embedding service — costs money, Supabase pgvector is free and sufficient

---

## Strategy

**Target price:** $299/month (34 customers = $10k) or $499/month (21 customers = $10.5k MRR)

**Target buyer:** Early-stage founders who need strategic intelligence without hiring analysts

**Core value prop:** *"Ask your company anything. Agents build you real deliverables and take action for you."*

**The key insight:** Agents don't need full CRM/ERP integration to be worth $300–500/month. Research + analysis + structured documents + three lightweight actions (Slack message, email, calendar event) is a compelling enough v1. Ship that. Everything else comes after the first $10k MRR.

**Pricing tiers:**
- **Starter — $299/mo**: 3 agents, 50 Brain queries/month, basic document export
- **Growth — $499/mo**: All 11 agents, unlimited queries, all formats, priority support

---

## Phase 1 — Fix & Rebuild Agents

> **Priority: Highest. Nothing else matters if agents don't deliver value.**

### 1A — System Prompts & Output Schemas

Every agent needs two things: (1) a rewritten system prompt that sounds like a world-class expert, not a generic assistant, and (2) a strictly enforced output schema that the `produce_agent_output` handler validates before storing. If the schema is invalid, retry the LLM call with the schema injected into the prompt.

#### Agent Rebuild Table

| Agent | Core Deliverable | Enforced Output Schema Keys |
|-------|-----------------|----------------------------|
| **Finance** | Burn/runway analysis, MRR breakdown, expense map, cash flow forecast | `summary`, `burn_rate`, `runway_months`, `key_metrics[]`, `recommendations[]`, `risks[]` |
| **Investment** | Investor target list, funding readiness score, pitch gap analysis | `readiness_score`, `investor_targets[]`, `pitch_gaps[]`, `next_actions[]` |
| **Sales** | ICP definition, pipeline health score, outreach sequences | `icp_definition`, `pipeline_health`, `outreach_sequences[]`, `blockers[]` |
| **Marketing** | GTM strategy, channel stack, 30-day content calendar | `gtm_strategy`, `channels[]`, `content_calendar[]`, `quick_wins[]` |
| **CRM** | Relationship health map, deal risks, follow-up action plan | `top_relationships[]`, `deal_risks[]`, `follow_up_actions[]`, `insights[]` |
| **People** | Hiring plan, culture gap analysis, org structure recommendations | `hiring_priorities[]`, `culture_gaps[]`, `org_recommendations[]`, `engagement_actions[]` |
| **HR** | Compliance checklist, policy gap audit, benefits benchmarking | `compliance_status`, `policy_gaps[]`, `recommendations[]`, `priority_actions[]` |
| **Product** | Feature prioritization matrix, sprint plan, PRD skeleton | `sprint_plan`, `prioritized_features[]`, `prd_outline`, `blockers[]` |
| **Roadmap** | Milestone status review, next 90-day plan, risk/opportunity map | `current_phase`, `milestones_status[]`, `next_90_days[]`, `risks[]`, `opportunities[]` |
| **Meeting** | Structured action items, decision log, follow-up email drafts | `decisions[]`, `action_items[]`, `follow_up_emails[]`, `open_questions[]` |
| **Engineering** *(new)* | Tech debt map, architecture recommendations, build vs buy analysis, sprint feasibility review | `tech_debt[]`, `architecture_recommendations[]`, `build_vs_buy[]`, `feasibility_assessment`, `blockers[]` |

#### Engineering Agent — Why Add It

No competitor offers CTO-level AI input. Founders constantly ask: "Is this architecture right?", "What should we build next?", "Review this PRD for technical feasibility." The Engineering agent ingests PRDs, GitHub issues, sprint history, and code-related documents to give opinionated technical recommendations. It's a 2-hour build that's a genuine differentiator.

**Default tool categories:** `project-management`, `research`, `engineering` (GitHub tools)

#### Implementation

**File:** `src/services/agentOrchestrator.js`
- Rewrite all `AGENT_CONFIGS` system prompts (expert voice, opinionated, specific, with output format instructions)
- Add `engineering` entry to `AGENT_DEFINITIONS` and `DEFAULT_AGENT_CATEGORIES`
- Add schema validation in the `produce_agent_output` case: validate required keys exist, if not → inject schema into a retry message and loop once more before accepting
- Add JSON parse retry: if LLM returns malformed JSON in `content`, attempt `JSON.parse` with auto-fix before failing

**File:** `src/services/llmService.js`
- Verify model fallback chain works end-to-end: `llama-3.3-70b-versatile` → `llama3-70b-8192` → `mixtral-8x7b-32768`
- Add retry on JSON parse failure (up to 2 retries with schema reminder injected)

---

### 1B — Web Research Flow Improvement

**Current problems:**
- Agents burn all 8 search slots on one broad query
- No relevance filtering — bad results go straight into context
- No diminishing returns detection — agents keep searching even when they have enough
- No source diversity — may hit same domain repeatedly

**Fixes:**

1. **Query expansion** — before the first search, call the LLM to decompose the user's intent into 3–5 targeted sub-queries. Example: "Find investors for an AI startup" → ["seed stage AI investors US", "Andreessen Horowitz portfolio AI tools", "YC-backed AI SaaS investors 2024", "investors who led AI B2B seed rounds"]

2. **Relevance gating** — after each search result set, score each result's relevance (0–1) using a quick LLM call or keyword overlap before injecting into context. Discard anything below 0.5.

3. **Diminishing returns detection** — track a "new facts discovered" counter per iteration. If 2 consecutive searches yield 0 new unique facts (measured by entity/URL deduplication), inject the convergence directive immediately rather than waiting for the search cap.

4. **Source diversity** — maintain a `searchedDomains` Set alongside `searchedQueries`. If a proposed query would likely hit a domain already searched, bias the query away from it.

**Files:** `src/services/webResearchEngine.js`, `src/services/agentOrchestrator.js`

---

### 1C — Closed Feedback Loop (Improved)

**Current loop:** Rejection feedback → injected into next revision. That's the entire loop.

**Improved loop:**

1. **Rejection** → feedback injected into revision (keep, this works)

2. **Approval** → store the approved output content as a company-specific few-shot example in a new `agent_examples` table with fields: `company_id`, `agent_type`, `title`, `content_summary`, `output_schema_snapshot`, `created_at`

3. **Cross-run seeding** — when launching an agent, query `agent_examples` for matching `agent_type` + `company_id`. Inject the top-2 approved examples into the system prompt as: *"Here are two examples of outputs this company has previously approved — match this quality and style."*

4. **Preference synthesis** — after 3+ approved runs of the same agent type for a company, run a background LLM call to synthesize a `agent_preferences` JSONB entry (e.g., `{ "tone": "conservative", "prefers_bullet_points": true, "depth": "detailed" }`) and store it in the `companies` table. Inject this on every subsequent run.

**New migration:** `supabase/025_agent_examples.sql`

```sql
CREATE TABLE agent_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content_summary TEXT,
  full_content JSONB,
  output_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON agent_examples (company_id, agent_type);
ALTER TABLE agent_examples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "company_isolation" ON agent_examples
  USING (company_id = (SELECT company_id FROM users WHERE id = auth.uid()));
```

**Files to modify:** `src/services/agentOrchestrator.js` (inject examples on launch, save on approval), `src/api/agentRoutes.js` (approval endpoint triggers example save)

---

## Phase 2 — Document Output Quality

> **Agents produce JSON. Users need documents. This phase bridges that gap.**

### 2A — Format Selection Logic

Every agent output call includes a `format` field. The system infers the format if not specified, using the logic below. This lives in `documentGenerationService.js` as `inferOutputFormat(agentType, userIntent, outputContent)`.

| Format | When to produce it | Primary triggers |
|--------|-------------------|-----------------|
| **DOCX** | Formal reports, memos, proposals, policies — anything going to a human reader | Finance report, Investment memo, HR policy, Sales proposal, any "write me a doc/report/memo" |
| **PDF** | Final locked deliverables for external sharing | Triggered by "send to investors", "share with board", "client-ready", "final" keywords |
| **CSV** | Raw data tables — lists, comparisons, databases | Investor list, lead list, contact export, content calendar, metric comparison |
| **PPTX** | Presentations — pitch decks, board updates, strategy reviews | Triggered by "deck", "slides", "presentation", "board update" keywords |
| **MD** | Internal wikis, technical specs, PRDs, playbooks | Engineering/Product agents; triggered by "spec", "PRD", "playbook", "internal doc" |

**Implementation:** `inferOutputFormat()` uses keyword matching on the agent's task description and output content. Falls back to LLM classification for ambiguous cases. Default is DOCX.

The `produce_agent_output` tool schema gets a new optional `format` field: `'docx' | 'pdf' | 'csv' | 'pptx' | 'md'`. Agent system prompts instruct: *"When calling produce_agent_output, include the format field based on what type of deliverable this is."*

### 2B — Document Quality Standards per Format

**DOCX** (via `docx` library)
- H1 title, H2 sections, H3 subsections — proper heading hierarchy
- Tables for all metric data (not prose)
- Bullet lists for recommendations/risks
- Header/footer with company name + date
- Page breaks between major sections
- No wall-of-text paragraphs

**PDF** (via `pdfkit`)
- Branded layout: company color accent, logo in header if available
- Page numbers in footer
- Table of contents for reports > 3 pages
- Generated from structured content, not from DOCX conversion (avoid LibreOffice dependency)

**CSV**
- First row: clean column headers (no spaces, PascalCase or snake_case)
- One entity per row — no nested data, no merged cells
- Finance data: pivot-ready rows (Date, Metric, Value, Category)
- Lists: Name, URL, Contact, Stage, Notes columns

**PPTX** (via `pptxgenjs`)
- Slide 1: Title + company name
- Slide 2: Agenda / Executive Summary
- One idea per content slide (not walls of text)
- Data slides: charts generated from metric data
- Final slide: Next Steps / CTA
- Clean template: dark title bar, light content area, consistent fonts

**MD**
- Frontmatter: `title`, `agent`, `date`, `status`
- Proper heading hierarchy (# ## ### ####)
- Tables for comparisons
- Code blocks for technical content
- Links to sources where available

**File:** `src/services/documentGenerationService.js` — rewrite each format renderer to use these standards

---

## Phase 3 — Agent Actions

> **The three actions that are close to working and deliver massive perceived value.**

### Design Rule: Approval-First, Always

Every action that posts, sends, or writes to an external system **must go through the approval workflow**. The agent proposes the action → user sees a preview → user approves or edits → then and only then does the adapter execute. No exceptions. This is a trust feature, not just a safety feature.

### 3A — Slack Messages (Highest Priority)

**What's there:** `@slack/web-api` installed, `company_services` table has credential storage

**What's missing:** `SlackAdapter.js` `sendMessage()` implementation + tool schema

**Build:**
- `src/providers/communications/SlackAdapter.js` → implement `sendMessage(channel, text, blocks)` and `listChannels()`
- Add `slack_send_message` and `slack_list_channels` to `src/tools/communications.tools.json`
- Wire in `src/services/toolExecutor.js`

**Agent use cases:**
- Meeting agent: sends meeting summary to `#general` after approval
- Sales agent: queues prospect outreach message for approval then sends
- Marketing agent: posts content announcement to team channel

### 3B — Email via Gmail

**What's there:** `googleapis` installed, Google OAuth flows through `integrationRoutes.js`

**What's missing:** `GmailAdapter.js` `sendEmail()` + `listThreads()` + tool schema

**Build:**
- `src/providers/communications/GmailAdapter.js` → implement `sendEmail(to, subject, body, cc?)` and `listThreads(query, maxResults)`
- Add `gmail_send_email`, `gmail_list_threads` to `src/tools/communications.tools.json`
- Wire in `src/services/toolExecutor.js`

**Agent use cases:**
- Investment agent: drafts VC outreach email → approval → sends
- Meeting agent: sends follow-up summary email to all attendees
- Marketing agent: sends campaign brief to team

### 3C — Google Calendar Events

**What's there:** `googleapis` with Calendar scope already in Google OAuth

**What's missing:** `GoogleCalendarAdapter.js` `createEvent()` + tool schema

**Build:**
- `src/providers/calendar/GoogleCalendarAdapter.js` → implement `createEvent(title, start, end, attendees, description)` and `listUpcoming(days)`
- Add `calendar_create_event`, `calendar_list_events` to new `src/tools/calendar.tools.json`
- Wire in `src/services/toolExecutor.js`

**Agent use cases:**
- Meeting agent: schedules follow-up meeting after action item extraction
- People agent: creates interview time slots
- Roadmap agent: creates milestone review meetings

---

## Phase 4 — Meeting Ingestion Improvements

**Current state:** File upload → Whisper transcription → summary → basic action item extraction. Functional but shallow.

### Fixes

**1. LLM-based speaker diarization**
After Whisper transcription, run a second LLM pass to infer speaker turns from context clues (names mentioned, pronoun shifts, topic changes). Output format: `[{ speaker: "Alice", text: "..." }, ...]`. Not perfect but dramatically better than one wall of text. True diarization via `pyannote` is a Phase 2+ upgrade.

**2. Auto-ingestion from Google Meet** *(high impact)*
Add a Google Calendar push notification webhook (`POST /api/webhooks/google-calendar`). When a calendar event with a Google Meet link ends, automatically pull the recording from Google Drive and ingest it. Users never have to manually upload — meetings just appear in The Brain. This is the single biggest UX upgrade in the product.

**3. Structured action items**
Meeting agent must produce action items with proper schema, not free text bullets:
```json
{
  "owner": "Kareem",
  "task": "Send the investor deck to Sarah by Friday",
  "deadline": "2026-05-31",
  "priority": "high",
  "linked_decision": "Decided to pursue Series A this quarter"
}
```
These auto-populate the `action_items` table with proper fields.

**4. Auto-trigger Meeting agent** *(high impact)*
After any meeting is ingested and transcribed, automatically launch the Meeting agent in background mode — no discovery questions, the transcript is the full context. The agent produces a structured output (action items, decisions, follow-up emails). User returns to the Dashboard and finds it ready. This is what makes the product feel like a real AI assistant, not a tool.

**5. Meeting transcript search**
Add a search bar to the Meetings tab (`frontend/src/app/dashboard/meetings/page.tsx`). The Brain chat can answer questions about meetings via RAG, but users should also be able to search transcripts directly by keyword, date, or participant.

**Files:** `src/services/meetingService.js`, `src/api/meetingRoutes.js`, `src/services/agentOrchestrator.js` (auto-trigger), `frontend/src/app/dashboard/meetings/page.tsx`

---

## Phase 5 — Wire Frontend

> **The agent flow must work without bugs, end-to-end.**

### Full Agent Execution Flow

```
User clicks agent button
  → POST /api/agents/launch
  → Execution record created (status: awaiting_input)
  
Discovery questions render as chat bubbles from agent
  → User types/selects answers inline
  → POST /api/agents/runs/:id/respond
  → Agent resumes (status: running)

Progress bar polls GET /api/agents/runs/:id every 3 seconds
  → Shows current_action text: "Searching for investors...", "Analyzing your burn rate..."
  → Progress bar fills from 10% to 90%

status === 'awaiting_approval'
  → Output card renders with:
     - Formatted preview of the deliverable
     - Format selector (DOCX / PDF / CSV / PPTX / MD)
     - Approve button → triggers document generation → appears in Documents tab
     - Reject button + feedback field → agent revises
     - Download button on approved output

If action proposed (Slack / email / calendar):
  → Separate action approval card:
     "Send this message to #general on Slack?"
     [Edit] [Approve] [Cancel]
  → On approve: adapter executes, confirmation shown
```

### Files

- `frontend/src/app/dashboard/chat/page.tsx` — full agent launch → question → progress → output/action approval flow
- `frontend/src/app/dashboard/agents/page.tsx` — wire to real `/api/agents/runs` endpoint for listing active executions
- `frontend/src/app/dashboard/documents/page.tsx` — show approved agent outputs with download buttons
- `frontend/src/app/dashboard/meetings/page.tsx` — add transcript search bar

---

## Phase 6 — Stripe Paywall

> **No revenue without a payment flow. Build this before launch.**

### Backend

- `POST /api/billing/create-checkout` → Stripe Checkout session (hosted page, no custom UI needed)
- `POST /api/webhooks/stripe` → handle `checkout.session.completed` (activate), `customer.subscription.deleted` (deactivate), `invoice.payment_failed` (warning)
- Subscription gating middleware: check `subscription_status` on every non-auth API route. If trial expired and no active subscription → 402 response with `{ upgrade_url: '/upgrade' }`

### Database Migration (`supabase/026_billing_schema.sql`)

```sql
ALTER TABLE companies ADD COLUMN subscription_status TEXT DEFAULT 'trial';
ALTER TABLE companies ADD COLUMN trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days');
ALTER TABLE companies ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE companies ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE companies ADD COLUMN plan_tier TEXT DEFAULT 'starter';
ALTER TABLE companies ADD COLUMN agent_run_count INTEGER DEFAULT 0;
```

### Frontend

- `frontend/src/app/upgrade/page.tsx` — plan comparison cards (Starter $299 / Growth $499) + Stripe Checkout redirect
- Trial banner component — shows "X days left in trial" on Dashboard, disappears after upgrade
- Upgrade prompt on agent launch if trial exhausted

### Trial Rules
- **7 days** free trial from signup
- **10 agent runs** cap during trial (generous enough to show value)
- After either limit: all agent routes → 402 → `/upgrade`
- Brain chat remains available during trial (drives engagement, shows value)

**New files:** `src/api/billingRoutes.js`, `src/services/billingService.js`, `frontend/src/app/upgrade/page.tsx`, `supabase/026_billing_schema.sql`

---

## Phase 7 — Onboarding

> **First 5 minutes determine if users ever come back.**

### Wizard Flow (5 steps, ~3 minutes)

1. **Company basics** — name, industry, stage (Pre-seed / Seed / Series A / Bootstrapped / Agency / Non-profit), headcount, website
2. **Funding status** — current MRR, cash runway, target raise amount (all optional — "Not sure" is always valid)
3. **Top 3 challenges** — multiple choice: Cash flow, Hiring, Sales pipeline, Product direction, Marketing/GTM, Fundraising, Operations, Legal/Compliance
4. **Roadmap type** — VC Track, Bootstrapped Growth, Agency/Services, Non-profit (this determines which roadmap template populates)
5. **First document upload** — "Upload your pitch deck, financials, or cap table to give your agents context" (skip option available)

### Post-Onboarding Automation
- Roadmap pre-populated based on roadmap type + stage selection
- Finance agent auto-launched in background (if document uploaded, it has context; if not, it asks one question)
- Dashboard shows "Your Finance agent is analyzing your data..." spinner
- First agent output ready within 60–90 seconds → user sees immediate value

**Files:** `frontend/src/app/onboarding/page.tsx` (complete wizard UI), `src/api/onboardingRoutes.js` (verify all steps handled), `src/services/intelligencePipeline.js` (trigger initial briefing)

---

## Phase 8 — Launch

> **Zero-spend channels only. Execution matters more than channel selection.**

| Channel | Action | Expected |
|---------|--------|----------|
| **ProductHunt** | Schedule launch day. Tagline: *"The AI OS that knows your company and takes action for you."* Get 5+ hunters to support. | 300–800 upvotes if executed well |
| **X / Twitter** | Founder story thread + screen recording of agent producing a real deliverable. Pin it. | 500–5k impressions |
| **Hacker News** | Show HN: "I built an AI operating system for startups — show me what's wrong with it" | 50–200 points if honest and technical |
| **Indie Hackers** | Show IH post with honest build story, MRR goal, and what you've learned | 100–500 views, high-intent traffic |
| **Cold DMs** | 50 early-stage founders/day on X and LinkedIn. Lead with value: "I see you're building X — we just shipped something that might help with Y" | 5–15% reply rate |
| **Reddit** | r/startups, r/entrepreneur, r/SaaS — post genuinely helpful content, mention The Brain in comments where relevant | Varies |
| **Demo mode** | Pre-loaded "Acme Corp" sandbox that any visitor can explore without signing up. Finance agent has already run. | 2–3x better conversion |

---

## Zero-Spend Infrastructure

> **Total monthly cost at launch: $0**

### Hosting & Compute

| Layer | Service | Free Tier | Action Required |
|-------|---------|-----------|----------------|
| Frontend | **Vercel** | Unlimited hobby deploys, custom domain | Already configured. Done. |
| Backend (Express) | **Render** | 1 free web service (sleeps after 15min idle) | Deploy `server.js`. Acceptable pre-launch. Upgrade to $7/mo at first revenue. |
| Database | **Supabase** | 500MB DB, 2GB bandwidth | Already in use. Covers hundreds of companies at this scale. |
| File Storage | **Supabase Storage** | 1GB free | **Action needed:** Move `uploads/` directory here immediately. Render's disk is ephemeral — files vanish on restart. |
| Vector Search | **Supabase pgvector** | Included in free DB tier | Already using. Remove Pinecone fallback — it costs money. |

### AI & ML

| Service | Free Tier | Notes |
|---------|-----------|-------|
| **Groq** | ~14,400 req/day (Llama 3.3 70B) | Primary LLM. Already integrated. |
| **Embeddings** | HuggingFace `all-MiniLM-L6-v2` (free, no API key for small volumes) | OpenAI `text-embedding-3-small` costs ~$0.02/1M tokens — nearly free but not zero. Switch to HuggingFace to hit true $0. Note: dimension changes 1536→384, requires one-time re-embedding. |
| **Tavily** | 1,000 searches/month | Web research. Sufficient pre-launch. |
| **Playwright** | Self-hosted (already in codebase) | Fallback scraper when Tavily quota is hit. Zero cost. |

### Communications

| Service | Free Tier | Use For |
|---------|-----------|---------|
| **Resend** | 3,000 emails/month | Agent completion notifications, weekly Brain digest, onboarding drip. Sign up at resend.com — 5-min integration. |
| **Sentry** | 5,000 errors/month | Already integrated. |

### Analytics — Add Before Launch

| Service | Free Tier | Track |
|---------|-----------|-------|
| **PostHog** | 1M events/month | Which agents users launch most, where they drop off, query volume, feature adoption. Install PostHog JS in Next.js + Node SDK in Express. Non-negotiable — without this, post-launch prioritization is guesswork. |

### Payments

| Service | Cost | Notes |
|---------|------|-------|
| **Stripe** | 2.9% + 30¢/transaction (zero upfront) | At $299/mo, Stripe takes ~$9. Worth it. |

### When to Upgrade (not before)
- First paying customer → upgrade Render to $7/mo (no more sleep spin-down)
- DB hits 450MB → upgrade Supabase to Pro ($25/mo)
- Everything else stays free well into $50k MRR

---

## Social Media & GitHub Integrations

> **All free. Register all five developer apps today — reviews run in parallel with your build.**

### Rollout Order

| # | Integration | Difficulty | Approval Time | Value |
|---|------------|------------|---------------|-------|
| 1 | **GitHub** | Easy | Instant | Engineering agent fully unlocked |
| 2 | **X / Twitter** | Easy | 1–2 days | Marketing/Sales agents can post |
| 3 | **LinkedIn** | Medium | 1–7 days | Professional content publishing |
| 4 | **Instagram** | Medium | 1–5 days | Marketing visual content |
| 5 | **TikTok** | Medium | 3–7 days | Short-form video workflow |

### Design Rule: All Social Actions Go Through Approval

Agent proposes → user sees exact preview of what will be posted → user approves or edits → adapter fires. No exceptions. This is a trust feature.

---

### GitHub — Highest Priority

**What's possible:** Read repos, issues, PRs, commits, branches, file contents. Create issues, comment on PRs, create branches, trigger Actions workflows, manage Projects.

**How to integrate (free, instant):**
- Register GitHub OAuth App at `github.com/settings/developers`
- Scopes: `repo`, `read:org`, `workflow`
- Package: `@octokit/rest`
- Store token in `company_services` (encryption already built)

**Agent use cases:**
- Engineering agent reads open issues → prioritizes → creates sprint plan
- Engineering agent reviews PR diff → leaves structured review comments
- Product agent creates GitHub issues from a PRD
- Meeting agent creates issues from extracted action items
- Engineering agent reads repo structure → gives architecture recommendations

**Files to build:**
- `src/providers/engineering/GitHubAdapter.js`
- `src/tools/engineering.tools.json` — tools: `github_list_repos`, `github_get_issues`, `github_create_issue`, `github_review_pr`, `github_get_file`, `github_list_prs`, `github_create_branch`

---

### X / Twitter

**What's free:** 1,500 tweets/month, 50 DMs/month, read own timeline/mentions

**What requires paid ($100/mo):** Broad search, competitor monitoring — skip for now

**How to integrate:**
- Register at `developer.twitter.com` (1–2 day approval)
- OAuth 2.0 PKCE
- Package: `twitter-api-v2`

**Agent use cases:** Marketing drafts threads → approval → posts. Sales drafts prospect DMs → approval → sends (50/month). Investment drafts investor update → approval → posts.

**Files:** `src/providers/social/TwitterAdapter.js` · Tools: `twitter_post_tweet`, `twitter_post_thread`, `twitter_get_mentions`, `twitter_send_dm`

---

### LinkedIn

**What's free:** Post to own feed (UGC Posts API), read own profile/posts, OAuth sign-in

**What's locked:** InMail API, full connection graph, job posting API (requires partnership)

**How to integrate:**
- Register at `developer.linkedin.com` → request `w_member_social` scope
- Manual review (1–7 days) — describe the use case honestly
- Standard OAuth + REST calls via `axios`

**Agent use cases:** Marketing/Investment agents draft posts → approval → publish. HR drafts job copy (user posts manually). Sales drafts connection messages (user sends manually).

**Files:** `src/providers/social/LinkedInAdapter.js` · Tools: `linkedin_post_update`, `linkedin_get_profile`, `linkedin_get_own_posts`

---

### Instagram

**What's free:** Posting photos/videos/Reels, reading insights, managing comments — but only for **Business/Creator accounts** linked to a Facebook Page

**Personal accounts:** Read-only Basic Display API (being deprecated) — not worth building

**How to integrate:**
- Register at `developers.facebook.com` → Meta app → Instagram Graph API
- App review required for `instagram_content_publish` (1–5 days, need a demo video)
- REST calls to `graph.facebook.com/v18.0/`
- Long-lived user tokens (60-day expiry, auto-refresh)

**Note:** Instagram requires a media file for every post. The agent prepares caption/hashtags/schedule; user provides the image or video in the approval UI.

**Files:** `src/providers/social/InstagramAdapter.js` · Tools: `instagram_publish_post`, `instagram_get_insights`, `instagram_schedule_post`, `instagram_get_media`

---

### TikTok

**What's free:** Content Posting API (after review), Login Kit, basic analytics

**How to integrate:**
- Register at `developers.tiktok.com` → Content Posting API scope
- App review (3–7 days) — need privacy policy URL and app demo
- REST calls to `open.tiktokapis.com`
- Videos: multipart upload to TikTok servers first, then publish call

**Note:** TikTok can't generate video. Agent writes script/caption/hashtags/schedule; user creates the video.

**Files:** `src/providers/social/TikTokAdapter.js` · Tools: `tiktok_upload_video`, `tiktok_publish_post`, `tiktok_get_analytics`

---

### Shared Social Architecture

```
src/providers/
  social/
    TwitterAdapter.js
    LinkedInAdapter.js
    InstagramAdapter.js
    TikTokAdapter.js
  engineering/
    GitHubAdapter.js
  calendar/
    GoogleCalendarAdapter.js   (Phase 3)

src/tools/
  social.tools.json            (all social tools)
  engineering.tools.json       (GitHub + code tools)
  calendar.tools.json          (calendar tools)
```

All adapters extend `BaseAdapter`. OAuth credential flow, token encryption, and `company_services` storage is already built — each new adapter just implements the standard interface.

---

## Additional Risks & Proposals

### Decisions Tab — Underutilized Killer Feature
Currently shows a passive log of extracted decisions. The real opportunity: **auto-link decisions to outcomes**. "You decided to target SMBs in February. Your MRR grew 40% in Q1. Correlation?" Longitudinal decision intelligence doesn't exist in any other tool. Design the data model now even if the UI comes later. Each decision should have `linked_outcome`, `linked_metric`, `outcome_date` fields ready.

### Semantic Router Latency Risk
`semanticRouter.js` classifies intent before every Brain query. If this adds >200ms, users will feel it. Audit the latency. If slow: make it async (fire classification, don't wait for it), or cache common intent patterns by query embedding similarity.

### Memory Health — Make It Actionable
The Memory page shows a gauge. Users don't know what to do with it. Add specific recommendations: "3 documents haven't been embedded — re-process them", "Your Finance knowledge is thin — upload your latest P&L", "No meetings ingested this month". Turn it into a checklist.

### Roadmap Is Hardcoded for VC Track
Pre-seed → Seed → Series A → Series B assumes every user is raising venture. A bootstrapped founder's roadmap is completely different. Add a **Roadmap Type** selector in onboarding (VC Track / Bootstrapped / Agency / Non-profit) and dynamically generate phases based on selection. This is ~2 hours of work and massively increases relevance for non-VC users.

### No Usage Analytics
Add PostHog (free tier) before launch. You need to know which agents users launch most, where they drop off, what they never touch. Without this, post-launch prioritization is guesswork.

### Mobile Responsiveness
Founders check things on their phones. Audit the Tailwind layout before launch — at minimum Dashboard and Chat pages must work at 375px.

### Uploads Are a Critical Risk
`uploads/` is served from disk. Render's filesystem is ephemeral — all uploaded documents will vanish on every restart/redeploy. Move to **Supabase Storage** before launch. This is a data loss bug, not a feature gap.

### Email Notifications — Highest ROI Quick Win
Add Resend (3,000 emails/month free). One email: "Your Finance agent just finished — here's what it found." This single notification drives more re-engagement than any other feature and takes 2 hours to build.

### Demo Mode — Non-Negotiable for Conversion
Pre-loaded "Acme Corp" sandbox with realistic data (pitch deck, 3 months financials, 5 meetings) that any visitor can explore without signing up. Finance agent has already run and produced a report. Let people feel the product before they commit to a trial. PLG tools without demo experiences convert at 2–3x lower rates.

---

## Verification Checklist

Run these end-to-end after implementation:

- [ ] Sign up → onboarding wizard (5 steps) → roadmap auto-populated with correct type → Finance agent auto-launches in background
- [ ] Finance agent completes → email notification sent to user → output appears in Dashboard
- [ ] Upload PDF → appears in Memory → Brain chat answers question about it with source citation
- [ ] Launch Marketing agent → answer discovery questions → agent does 3–5 web searches → produces DOCX report → approve → appears in Documents with download
- [ ] Reject agent output with feedback → agent revises addressing the feedback → re-approval
- [ ] Meeting agent: upload audio → transcription → structured action items extracted → auto-trigger produces follow-up email draft → approve → Gmail sends it
- [ ] Meeting agent: Slack summary proposed → approval → message appears in Slack channel
- [ ] GitHub: Engineering agent reads repo issues → creates sprint plan → user creates GitHub issues from it with one click
- [ ] Trial expires → all agent routes return 402 → frontend redirects to `/upgrade`
- [ ] Stripe checkout → payment → subscription activates → full access restored
- [ ] Dashboard and Chat pages render correctly on mobile (375px width)
- [ ] Upload a file, redeploy backend, verify file still exists (Supabase Storage test)
- [ ] PostHog events firing for: agent launch, agent completion, document approved, chat query
