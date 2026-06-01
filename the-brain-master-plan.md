---
name: the-brain-master-plan
description: "The Brain AIOS build is driven by MASTER_PLAN.md; phased roadmap to $10k MRR, zero spend"
metadata: 
  node_type: memory
  type: project
  originSessionId: 56d15636-f315-4d38-9aac-4d07c49e0f7e
---

The Brain (C:\Users\HP\Desktop\The Brain) is an Express + Supabase + Next.js "AI operating system for startups." Active build is driven by `MASTER_PLAN.md` — a phased roadmap (Phase 1 agents → 2 docs → 3 actions → 4 meetings → 5 frontend → 6 Stripe → 7 onboarding → 8 launch + infra).

**Hard constraint (2026-05-28):** do NOT implement subscription pricing / Stripe paywall (Phase 6) until told otherwise.

Backend agent engine lives in `src/services/agentOrchestrator.js` (AGENT_DEFINITIONS, executeAgentWork loop). LLM via Groq (`src/services/llmService.js`, OpenAI-compatible, model fallback chain). Web research in `src/services/webResearchEngine.js` (Tavily primary). Approval workflow in `src/services/approvalService.js`. SQL migrations in `supabase/NNN_*.sql` using JWT-based RLS: `company_id = (auth.jwt() ->> 'company_id')::uuid`.

**Phases 1 & 2 completed (session 2026-05-28):**
- Phase 1A: expert-voice prompts + enforced output schemas (AGENT_OUTPUT_SCHEMAS, one corrective retry) + Engineering agent.
- Phase 1B: web research query expansion/relevance gating/diminishing-returns (webResearchEngine `expandQuery`/`gateRelevance`).
- Phase 1C: closed feedback loop — `agent_examples` table (migration 025), approved-output few-shot seeding + preference synthesis (`companies.agent_preferences`).
- Phase 2: documentGenerationService now has `inferOutputFormat()`, `jsonToMarkdown()` bridge (fixes the broken JSON→doc pipeline), an MD renderer, and `generateFile` accepts object content. All verified via node scripts.

**Phase 3 done (same session):** Slack/Gmail adapters were already implemented (diagnosis stale). Added Google Calendar to GmailAdapter (`create_calendar_event`, `check_availability`, `list_calendar_events` + calendar scopes; it doubles as the Google Workspace adapter since calendar tools route through the `communications` category). Added **approval-first** action gating: `actionApprovalService.js` (`isActionTool` verb heuristic, `proposeAction`/`approveAction`/`rejectAction`), migration `026_agent_action_approvals.sql`, and orchestrator routes external-mutating tools to a pending proposal instead of executing. API: `GET /api/agents/actions`, `POST /api/agents/actions/:id/approve|reject`. Engineering agent added to chat UI (FALLBACK_AGENTS, prompts, validTypes, backend map).

**Migrations to apply:** 025 (done by user) and **026** (new — agent_action_approvals). Architecture notes: agent tool calls execute via `sentinel.validate` + `sentinel.executeApprovedTool` (resolves adapter by category→provider from `company_services`); tool name must equal adapter method name; tools defined in `src/tools/*.tools.json`, registry in `src/providers/registry.js`.

**Phase 4 done (same session):** LLM speaker diarization (`diarizeTranscript` → `insights.speaker_segments`); auto-trigger Meeting agent after ingestion via new `launchAgentWithContext` (skips discovery, seeds transcript); transcript search (`searchMeetings` + `GET /api/meetings/search`). Structured action items + Google Meet `/sync` already existed. Calendar-push auto-ingest webhook still deferred.

**Live-verify setup (session 2026-05-29):** Backend `node server.js` :5000, frontend `npm run dev` :3000 (Next 16 + React 19 + Tailwind 4 + Turbopack — single dev server per dir). Preview via `.claude/launch.json` (frontend, port 3000, autoPort false). Test login: kareemhelal3@gmail.com / Kareem@2007 (session persists in preview). **CRITICAL FIX:** stray Windows reserved-name files `nul` (root + `frontend/nul`) broke Turbopack CSS compile ("os error 1") — removed via git-bash `rm -- ./nul`. If they reappear, that's the cause. Onboarding wizard already exists & works (5 steps, AI discovery questions, launches 10 startup agents). Engineering verified visible in chat orbit after fixing hardcoded `.slice(0,10)` display caps → `.slice(0,11)` (3 spots in chat/page.tsx); launch-all loops stay at 10 (engineering manual-launch only).

## App Walkthrough Observations (2026-05-29, test account, company "Brainstem Labs")

All dashboard pages render without crashes (after the `nul` fix). Sidebar nav is JS-driven (router.push), NOT `<a>` anchors — there are zero anchor tags; `/dashboard/brain` is a 404 (the "Brain" nav item points at `/dashboard` home). Pages observed:
- **Dashboard home** (`/dashboard`): Welcome, Quick Stats (Meetings/Documents/Sent Messages/Web Queries — all 0 for new acct), Quick Actions (Ask The Brain / Sync Meetings / Upload Document), Recent Action Items, Proposed Automations, Recent Meetings, Ask-The-Brain box. "Connect your integrations" banner.
- **Chat** (`/dashboard/chat`): agent orbit (now 11 incl Engineering), delegate "Ask The Brain anything" view + agent mini-chips. After onboarding, 10 startup agents show "10 Need Input" (awaiting discovery answers).
- **Roadmap**: HARDCODED VC track Pre-Seed→IPO (6 phases / 48 objectives / 48 tasks / 0–84 months) regardless of company type — confirms plan's flagged issue.
- **Meetings**: Sync + Upload + a search bar already present (backend `/api/meetings/search` can power it). Clean empty state.
- **Documents**: drag-drop upload (PDF/DOCX/PPTX/CSV/TXT/MD/JSON ≤10MB) + "Pending Drafts for Review" section.
- **Decision Log**: ledger w/ Decisions/Actions/Plans/Approvals counts (all 0).
- **Memory Health**: shows score "10" labeled "CRITICAL" yet text "Index integrity is fully validated" (CONTRADICTORY); "System sync is degraded — check provider API keys"; Memory Density 2. Not actionable.
- **Settings**: Integrations — Google Workspace / Slack / Discord = "Connect"; Groq LLM + Supabase = "Connected". Environment: Supabase pgvector (Free) · Groq Llama 3.3 70B · Embeddings **all-MiniLM-L6-v2 (Local)** · Hosting "Vercel + Railway".

### Punch list — improvements to add (from walkthrough)
1. **Roadmap type-awareness** — generate roadmap by onboarding type (VC / Bootstrapped / Agency / Non-profit); today it's always VC Pre-Seed→IPO. Add a Roadmap Type selector to onboarding.
2. **Memory Health** — fix contradictory "CRITICAL" vs "fully validated" copy; make recommendations actionable (which docs to re-embed, what to upload).
3. **"10 Need Input" friction** — auto-launched startup agents immediately block on discovery questions, conflicting with the plan's "Finance ready in 60–90s." Auto-seed discovery answers from the onboarding profile so agents run unattended.
4. **Action-approval cards UI** (Phase 5) — surface `/api/agents/actions` propose→approve→execute loop.
5. **Documents tab** — wire approved agent outputs → downloadable files via `inferOutputFormat`.
6. **Settings hosting label** says "Vercel + Railway" (plan assumed Render) — confirm actual backend host.

### Technical learnings
- Stray Windows reserved-name files (`nul`) silently break Turbopack CSS compile — keep repo clean; if build dies with "os error 1 / Incorrect function", look for `nul`/`con`/`aux` files.
- Embeddings are ALREADY local `all-MiniLM-L6-v2` (the plan's OpenAI→HuggingFace switch is effectively done; 384-dim).
- Onboarding wizard already exists end-to-end (5 steps + LLM discovery questions + launches 10 agents) — Phase 7 is mostly built; remaining gap is roadmap-type pre-population.
- Meetings search bar and MD-in-upload already present in UI.

**Still TODO:** 5 (frontend wiring — chat launch→question→progress→output/action-approval cards, documents tab, meetings search bar; approve→auto-generate-file using `inferOutputFormat`), 7 (onboarding wizard + auto-launch finance), infra (Supabase Storage for uploads, drop Pinecone fallback, Resend notifications, PostHog, GitHub adapter + engineering.tools.json). Skip Phase 6 (Stripe). NOTE: frontend is a modified Next.js (see frontend/AGENTS.md) — read node_modules/next/dist/docs before writing new frontend patterns; verify in running app.
