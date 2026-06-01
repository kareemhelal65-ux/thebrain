# The Brain — Engineering Handoff (Session 2)

_Last updated: 2026-05-31. Covers everything built, fixed, and learned in this working session. Complements the original `HANDOFF.md` (Session 1) — read that first for the foundational stack, services, and gotchas; this file is the delta + new direction._

The full living design doc for all of this is the plan file:
`C:\Users\HP\.claude\plans\c-users-hp-desktop-the-brain-handoff-md-wise-pumpkin.md` (phases A, W, B, C, R, D).

---

## 0. TL;DR — what changed this session

Built (in order): **Phase A** (per-agent deliverables + in-chat preview/approve/comment + plan-mode), **Phase W** (agent workspaces with capability recipes), **Phase B** (self-improvement engine), **Phase C2-core** (engineering coding workspace), **Phase R** (agent reliability hardening), plus a batch of UX/bug fixes. Then re-planned the product direction as **Phase D** (department dashboards + Brain-only chat) — **approved, not yet built**.

**Apply migrations 032–035 in Supabase, then restart `node server.js`** (backend has no hot reload). Migrations 036–038 belong to the not-yet-built Phase D.

---

## 1. Migrations (owner applies manually in Supabase)

| # | File | What | Status |
|---|------|------|--------|
| 032 | `supabase/032_output_comments_versioning_plan_mode.sql` | `agent_output_comments` table; `agent_outputs.version`/`.revision_of`; `agent_executions.mode`(`planning`/`executing`) + `.require_plan` | **apply** |
| 033 | `supabase/033_draft_session_link.sql` | `document_drafts.session_id` (delete-chat cascade) | **apply** |
| 034 | `supabase/034_agent_playbooks.sql` | `agent_playbooks` (self-improvement library; embedding stored as JSONB) | **apply** |
| 035 | `supabase/035_workspaces.sql` | `workspaces` + `workspace_files` (engineering coding workspace) | **apply** |
| 036–038 | _not written yet_ | Phase D: `department_settings`, `marketing_strategy`, `member_evaluations`+`candidates` | future |

`agent_outputs.output_type` is free TEXT, so new output types (`plan`, `code_project`, `code_handoff`, recipe types) need no migration.

---

## 2. What was built — by phase

### Phase A — Per-agent deliverables + generalized preview/approve/comment
- **A0 Plan→Execute mode (all agents).** `launchAgent({…, requirePlan})` (default ON for engineering) sets `agent_executions.mode`. In `planning` mode the loop injects a PLAN-MODE directive, withholds mutating tools, and `produce_agent_output` is forced to `output_type:'plan'` → status `awaiting_plan_approval`. Approving a `plan` (in `approveOutput`, `approvalService.js`) flips mode to `executing` and calls `resumeAgentExecution()` to build the real deliverable. Key fns in `agentOrchestrator.js`: `resumeAgentWorkWithComments`, `resumeAgentExecution`.
- **A1 Deliverable menu.** `AGENT_DELIVERABLES` map + `buildDeliverableMenu(agentType)` injected into each agent's system prompt.
- **A2 Generalized preview (frontend).** `renderOutputContent(type, data, onSectionComment)` + `renderStructured()` in `frontend/src/app/dashboard/chat/page.tsx` replace the raw-JSON fallback. Handles `web_artifact`, `asset_collection`, `code_project`, `plan`, and a recursive structured renderer for everything else.
- **A2.1 Marketing assets as code, not images.** `asset_collection` items support `{ kind:'svg'|'html', code, caption }` (rendered inline / sandboxed iframe). Marketing prompt + the artifact validator + `storeOutputToBrain` updated. **Generating raster images is intentionally avoided** (token cost; code is editable).
- **A3/A4 Comments (threaded + section-level) + revision loop.** `agent_output_comments` table; endpoints in `approvalRoutes.js`: `GET/POST /api/approvals/:id/comments`, `POST /api/approvals/:id/request-revision`. Service fns in `approvalService.js`: `addOutputComment`, `getOutputComments`, `requestRevision`, `getRevisionChainComments`. Revisions create a new versioned `agent_outputs` row (`createApproval` auto-versions same-type outputs) and feed a REVISION DIRECTIVE back into `executeAgentWork`.
- **A5 Brain storage.** `storeOutputToBrain` formats the new types (plan, code_project, code assets, generic recursive).
- **UI:** two-pane chat — conversation left + dedicated `renderDeliverablePanel()` right (preview + threaded/section comments + Approve/Discard/Send-&-revise). The orbit was replaced by a compact agent launcher.

### Phase W — Agent workspaces + capability recipes
- **`AGENT_RECIPES`** map in `agentOrchestrator.js`: 3–6 clickable "recipes" per agent (e.g. marketing → Market Research, Brand Identity, Logos, 7-Week Strategy, Content Calendar, Landing Page). `getRecipe()`, `GET /api/agents/recipes`.
- **`launchRecipe()`** + `launchAgentWithContext({…, requirePlan, recipe})` seed a scoped run (asks the recipe's `suggestedQuestions` only if company context doesn't already cover them). Runs tagged via `agent_executions.output_data.recipe_id`. Route `POST /api/agents/launch-recipe`.
- **Workspace UI** in chat: top tab strip (Chat | capability tabs | Deliverables), **Plan/Execute toggle**, live status pill + activity log, 2s polling while active. _Note: user said "W wasn't executed well" — Phase D supersedes this in-chat workspace with department pages._

### Phase B — Self-improvement engine
- **B1** `synthesizeAgentPreferences()` now also distills **avoid-rules** from comments + rejections; injected via the LEARNED STYLE PREFERENCES slot.
- **B2** `agent_playbooks` (migration 034). `distillPlaybook()` (on approval, dedup by cosine, bump `win_count`) + `getRelevantPlaybooks()` (top-K by embedding sim) → injects a **PROVEN PLAYS** section into `executeAgentWork`. Cosine done in JS (`cosineSim`), embeddings stored as JSONB — no pgvector RPC.
- **B3** `runSelfCritique()` gate before `createApproval` (both artifact + structured branches): scores the draft 0–100 vs schema/standard; one self-revision if <75. Fail-open; toggle with `AGENT_SELF_CRITIQUE=off`.

### Phase C2-core — Engineering coding workspace (real, sandboxed)
- **`src/services/workspaceService.js`**: per-run project dir under `WORKSPACE_ROOT` (default OS temp, outside app source). Path-confined `fs_read/write/edit/list/search`; `run_command` with an **allowlist + timeout + sanitized env (no .env/secrets leak)**; DB mirror of text files; `buildPreview()` inlines the entry HTML for a static snapshot.
- **`src/tools/engineering.tools.json`** (auto-loaded by the registry) + special-cased tool dispatch in `executeAgentWork`. New `output_type:'code_project'` assembles a preview + file tree. Planning mode withholds `fs_write_file`/`fs_edit_file`/`run_command`.
- **Deferred (task #28):** live dev-server proxy preview, Docker hardening, Supabase Storage tarballs, and **C3 GitHub**. Phase D pivots engineering toward an **external coding-tool handoff** instead (see §4).

### Phase R — Agent reliability hardening (the big stability fix)
Root-caused from the user's thinking logs. Three fixes, all in `llmService.js` + `agentOrchestrator.js`:
1. **Crash-proofed all LLM calls.** `callGroqWithFallback` now returns a **safe empty stub** if a provider returns no `choices`, so `response.choices[0].message.content` can never throw `Cannot read properties of undefined (reading '0')` anywhere. `callLLMWithTools` validates shape + **falls back to Groq `llama-3.3-70b-versatile`** when the company's configured model errors/returns garbage. Streaming chunk access guarded. New `safeJsonParse(text, fallback)` used on agent-path JSON parses.
2. **Tool surface = only what works.** `STUB_CATEGORIES` (`marketing, legal, analytics, research`-stubs) never offered; other category tools offered only if the company has a **connected provider** (`enabled_services`). Native tools (web search/extract, document, produce_output, ask_user, engineering `fs_*`) always on. **Self-heal:** a per-run `disabledTools` set drops any tool that fails as unavailable and filters it from subsequent calls. Tool-name typos auto-correct (`resolveToolName` + Levenshtein); truly-unknown names get a guided error.
3. **Non-blocking schema.** `AGENT_OUTPUT_SCHEMAS` is now log-only (no forced revision round); quality handled by B3. Recipe/deliverable types already bypass it via `KNOWN_DELIVERABLE_TYPES`.

### Other fixes this session
- **Agent tool-calling model:** loop now passes `model:'llama-3.3-70b-versatile'` (the default `gpt-oss-120b` is a reasoning model, unreliable at tool calls). Company's configured model still overrides.
- **LLM concurrency limiter** in `llmService.js` (`LLM_MAX_CONCURRENCY`, default 4) so "Launch All" doesn't trip Groq rate limits.
- **Stop = return to idle** (not stuck "stopped"): `haltIfStopped`, `/runs/:id/stop`, frontend `handleStopAgent`.
- **Delete chat** (sidebar trash): `DELETE /api/brain/chat/sessions/:id` cascades pending drafts (linked via `document_drafts.session_id`, threaded through `orchestrator.js` → `sentinel.js`) but keeps approved Brain docs. Removed the 209-line dead deliverable block.
- **Logo/asset chat fix:** `renderMessageBody()` renders ` ```svg `/` ```html ` fences as live previews; orchestrator + agent-chat prompts forbid "I'll generate after approval" and require inline SVG for visual assets.
- **Discard requires a reason:** the deliverable panel's Discard opens a required reason field → fed to the agent as rejection feedback (and into B1 learning).

---

## 3. Key learnings / gotchas discovered this session

- **Backend has NO hot reload.** Every backend change needs `node server.js` restart. Most "still broken" reports this session were un-restarted servers.
- **`openai/gpt-oss-120b` is a reasoning model** and is unreliable for tool-calling and short JSON — it spends its budget on hidden reasoning and returns empty/no tool call. Use `llama-3.3-70b-versatile` for agent tool work; the per-company custom model overrides.
- **The user's configured agent model (owl-alpha / OpenRouter stealth) is flaky** — it intermittently returns malformed responses with no `choices`. That single failure was crashing whole runs (`Cannot read properties of undefined (reading '0')`). The durable fix is the wrapper safe-stub + Groq fallback (Phase R), not per-call patches.
- **Schema enforcement was fighting the deliverable system** — forcing the agent-wide schema on recipe outputs (e.g. `lead_list`) caused endless "missing required keys" revisions. Schemas must be keyed to output_type, and are now non-blocking.
- **Most catalog tools are stubs.** `marketing/legal/analytics` categories are 100% stub; the rest only work with a connected provider. Offering them just produced "category not enabled / not implemented" denials. Gate by `enabled_services`.
- **Visual assets should be code (SVG/HTML), not generated images** — cheaper, editable, iterable.
- **Two production paths exist and differ:** the **chat orchestrator** (`orchestrator.js`, conversational, makes `document_drafts`, has `delegate_to_agents` Brain-only) vs the **agent execution loop** (`agentOrchestrator.js executeAgentWork`, produces `agent_outputs` with the new preview/approve/comment pipeline). Reliable deliverables come from the execution loop; free chat is unreliable for intent.
- **Adapters that actually exist:** Stripe, Paymob, Shopify (full), plus HR (BambooHR), CRM (HubSpot/Salesforce/Zoho), comms, PM, storage. **No Meta/TikTok/Instagram ad adapters exist** (`analytics`/`marketing` provider dirs are abstract-only).
- **Company context for tailoring** lives in `companies` (`onboarding_type`, `company_stage`, `roadmap_type`, `mission_vision`, `target_customer`, `competitors`, `pain_points`, `current_tools`, industry) + `user_profiles` + the Brain (`document_chunks` with `department` filter via `retrieveSmartContext`).
- **Why external coding tools aren't "zero-spend":** Claude Code / Codex / etc. consume the **user's own** LLM API credits when they run and are mostly **local CLIs/IDEs** with no remote API a hosted server can call — a true integration needs a local bridge holding the user's keys. Hence the handoff-spec approach.

---

## 4. Current direction — Phase D (approved, NOT yet built)

The next build, replacing the in-chat workspace and revising engineering:
- **D0** Simplify chat to **Brain-only** (remove the Phase-W per-agent workspace from `chat/page.tsx`).
- **D1** **Department dashboard pages** (Marketing, Finance, Sales, CRM, Investment, Product/PM, People/HR) — a reusable shell: first-run setup, Brain-context widgets, proactive proposals (`proposed_automations`/`proactive_suggestions`), deliverables (Phase-A approve/comment), and an embedded department-agent chat.
- **D1.5 Dynamic setup** — `DEPARTMENT_BLUEPRINTS` (code) + a `configureDepartment()` resolver (rules + LLM) that tailors each tab to **what the company does** (onboarding profile + connected integrations + Brain), asks **gap-only** first-run questions, and assigns each department a relevance (primary/secondary/dormant). **Team is the one static tab.**
- **D2** **Marketing first (the template):** auto-updating 7-week strategy (clone the `roadmapService` generate→store→re-eval pattern) + Stripe/Paymob/Shopify stats; ad platforms deferred.
- **D3** **HR/People:** company members with AI strength + performance scoring; CV upload → impact/fit/hire verdict + score/10 (reuse `ingestionService.parseFile`).
- **D4** **Engineering → handoff package** (`code_handoff` output: paste-ready build spec for the user's external coding tool) + a future optional local bridge. Keep C2 workspace as a prototype fallback.
- **D5** Company-type tailoring + Brain context across all tabs.
- Build order: **D0 + D1 + D2 (Marketing) first**, then clone to other departments, then HR, then coding handoff. New migrations **036–038**.

---

## 5. Run / verify

- **Backend:** `node server.js` in `C:\Users\HP\Desktop\The Brain` (restart after EVERY backend edit). Startup log should show `[Registry] Loaded N tools across … engineering …`.
- **Frontend:** `npm run dev` in `frontend/`; type-check `npx tsc --noEmit -p tsconfig.json` (kept clean all session).
- **Syntax-check a backend file:** `node -c <file>`.
- **Env knobs added:** `LLM_MAX_CONCURRENCY` (default 4), `AGENT_SELF_CRITIQUE=off` to disable B3, `WORKSPACE_ROOT` / `WORKSPACE_CMD_TIMEOUT_MS` for the coding workspace.
- **Do NOT use the preview/browser MCP tools** — the owner tests in their own browser (saved preference).
- After restart, agent thinking logs should be free of: `Cannot read properties of undefined`, `category not enabled` / `not implemented`, and `missing required keys — Requesting one revision`. A `falling back to Groq` / `safe empty stub` warning is expected only when the configured model misbehaves.

---

## 6. Files most touched this session
- `src/services/agentOrchestrator.js` — deliverables/recipes, plan mode, comments/revision resume, self-critique, workspace tools, tool gating + self-heal, schema non-blocking, tool-name normalization, model fix.
- `src/services/approvalService.js` — comments, versioning, playbook distill/retrieve, avoid-rules, new-type Brain storage.
- `src/services/llmService.js` — safe stub guard, Groq fallback, streaming guard, `safeJsonParse`, concurrency limiter.
- `src/services/workspaceService.js` (new), `src/tools/engineering.tools.json` (new).
- `src/api/approvalRoutes.js`, `src/api/agentRoutes.js`, `src/api/brainRoutes.js`, `src/middleware/sentinel.js`, `src/services/orchestrator.js`.
- `frontend/src/app/dashboard/chat/page.tsx` — preview renderers, comment composers, two-pane + deliverable panel, workspace tabs, message SVG rendering, delete-chat, discard-reason.
- `supabase/032–035_*.sql` (new).
