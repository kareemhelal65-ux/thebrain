# The Brain — Engineering Handoff

_Last updated: 2026-05-30. Covers the work done in this working session plus the project knowledge needed to continue._

---

## 1. What the project is

**The Brain** is an **AI Operating System for startups/businesses** — "ask your company anything; agents build real deliverables and take action for you." Goal: **$10k MRR, zero spend, launch this month**. Subscription/Stripe (Phase 6) is **explicitly deferred** — do not build a paywall yet.

**Stack**
- **Backend:** Node/Express (`server.js` + `src/`), single process, run with plain `node server.js`.
- **DB/auth/vectors:** Supabase (Postgres + pgvector + Auth). SQL migrations in `supabase/NNN_*.sql`, JWT-based RLS (`company_id = (auth.jwt() ->> 'company_id')::uuid`).
- **Frontend:** Next.js (a **modified** build — see `frontend/AGENTS.md`), inline-styled, lives in `frontend/`.
- **LLM:** Groq (OpenAI-compatible SDK) via `src/services/llmService.js`; model fallback chain. Optional per-company premium chat model (see §3, Feature 1).
- **Web research:** Tavily primary (`src/services/webResearchEngine.js`), Playwright fallback.
- **Speech:** Whisper (`whisper-large-v3-turbo`) via Groq for transcription.

**Core backend services**
- `src/services/agentOrchestrator.js` — the agent engine: `AGENT_DEFINITIONS`, `launchAgent` / `launchAgentWithContext` / `launchStartupAgents`, the `executeAgentWork` loop (research → tools → `produce_agent_output` → approval), discovery questions, output schemas.
- `src/services/orchestrator.js` — conversational **Brain/agent chat** (`/api/orchestrator/chat`, `/agent-chat`) → `processMessage`/`_processMessage` (tool-calling loop).
- `src/services/meetingService.js` — transcription, insight extraction, diarization, persistence, auto-trigger Meeting agent.
- `src/services/roadmapService.js` — per-company roadmap generation/evaluation.
- `src/services/approvalService.js` — agent output approval → store to Brain.
- `src/services/intelligencePipeline.js` — `classifyDepartment`, entity extraction.

**Agent types** (`AGENT_DEFINITIONS`): `finance, people, hr, investment, crm, marketing, sales, product, roadmap, meeting, engineering`.

**Department taxonomy** (`action_items.department`): `operations, product, commercial, finance, hr, general`.

---

## 2. ⚠️ Project gotchas (read before editing)

- **No hot reload on the backend.** It runs as plain `node server.js` (no nodemon). **You MUST restart it after any backend change** or "nothing happens." This caused real confusion mid-session.
- **Frontend is a modified Next.js.** Read `frontend/AGENTS.md`; mirror existing patterns; inline styles; **no new UI libraries**. Verify with `npx tsc --noEmit` and in a running app.
- **Do not use the preview/browser MCP tools.** The owner tests in their own browser. (Saved to memory.)
- **`openai/gpt-oss-120b` is a REASONING model.** Under a small `max_tokens` it spends the whole budget on hidden reasoning and returns **empty** content (`finish_reason: length`). This silently broke `classifyDepartment`. For short/strict-JSON calls use a non-reasoning model (`llama-3.3-70b-versatile`). `llmService` already forces a JSON-mode fallback off gpt-oss.
- **The LLM client is OpenAI-compatible** — any provider works by swapping `baseURL` + `apiKey`.
- **`MASTER_ENCRYPTION_KEY` in `.env` is 32 chars (not 64-hex).** `src/security/encryption.js#getMasterKey` was made tolerant (accepts 64-hex, raw-32-byte, or SHA-256-derives any other value). Don't change the key after any API keys are saved or they become undecryptable.
- **Timezone off-by-one:** formatting dates via `toISOString()` shifts a day in UTC+ timezones (this machine). Format in local time (see `normalizeDueDate` in `meetingService.js`).
- **Owner is testing on OpenRouter "owl-alpha"** (a stealth/preview model) — tool-calling/JSON reliability is inconsistent; that drove the robustness work in §3.
- Test account & companies seen: login `kareemhelal3@gmail.com`; companies "Brainstem Labs", "The Brain AIOS", "Vite". Single-member companies currently.

---

## 3. What was accomplished this session

### Onboarding & agent friction (Phase 7)
- **Autonomous discovery auto-seed:** the 10 agents auto-launched after onboarding used to block at "10 Need Input." Added an `autonomous` mode (`launchAgent`/`runAgentLoop`) + `autoAnswerDiscoveryQuestions()` that answers their own discovery questions from the company profile, so they run unattended. Manual single-agent launches keep the interactive wizard.
- **Roadmap type-awareness:** added `roadmap_type` (VC / Bootstrapped / Agency / Non-profit) selector to onboarding; `roadmapService` now has a template registry with 4 full phase/objective sets. Migration **027**.

### Roadmap quality
- **Genuinely tailored tasks:** replaced the fragile "echo the whole 6-phase JSON" approach (which truncated → fell back to the static template) with **per-phase LLM generation** (`generateTailoredPhaseObjectives`) grounded in the company profile + onboarding discovery Q&A + docs. `is_tailored` flag (migration **028**) auto-upgrades existing companies once on next roadmap load.
- **Frozen valuations:** the roadmap re-ran the LLM valuation on every tab switch (non-deterministic → churn). Now valuations are computed **once at generation** and the on-load LLM re-eval was removed.

### Personal interview & user profiles
- New onboarding **"Tell us about you"** step (extracted into a shared `InterviewFields` component). Saves to **`user_profiles`** (migration **029**), synthesizes a profile summary and embeds it into Brain memory (`source_type: 'user_profile'`).
- **Settings → Your Profile** editor (`GET/PUT /api/onboarding/user-profile`) with "Redo interview."

### Multi-user companies & join codes (migration **030**)
- **`companies.join_code`** (unique, generated via `src/utils/joinCode.js`; self-heals on the Team page).
- **Join flow:** third onboarding choice "Joining your team's company" → enter code (`POST /api/onboarding/join`) → personal interview → dashboard (as Employee).
- **Team page** rebuilt: shareable code + real member roster (`GET /api/team`).
- **Role management:** `PUT /api/team/:userId/role` (Admin-only, refuses to demote the last admin); inline role dropdown on the Team page.

### Meetings tab (large area of work)
- **Language-agnostic transcription:** removed the hardcoded `language: 'en'`; Whisper auto-detects. Detected language stored + shown as a badge; duration captured.
- **In-browser recorder** with a mode menu: **In-person** (mic only), **Online meeting** (mic + shared-tab audio via `getDisplayMedia`, mixed with WebAudio), **Brainstorm (private)**.
- **Transcript** now shown in the meeting detail (speaker-segmented if diarization succeeded, else raw).
- **Action items get a department:** extraction prompt assigns one; `registerMeetingEntities` stores it. Fixed **`classifyDepartment`** (it used the reasoning model + tiny `max_tokens` → always returned `general`); now `llama-3.3-70b` + definitional prompt + robust keyword parse. Backfilled existing items.
- **Per-person task assignment:** the team roster is fed into meeting extraction; `assignee` resolves to a real teammate and stores **`action_items.assignee_user_id`** (migration **030**), with a `pickBestMember` fallback so tasks are never ownerless. Surfaced in the **Decision Log → Actions** tab (avatar chips, "Assigned to me" filter). Backfilled.
- **Better due dates:** prompt resolves relative dates ("by Friday", "end of month") to ISO using today's date; `normalizeDueDate` safety-net parser (with the local-time fix).
- **Task consolidation:** extraction now groups granular steps under tightly-scoped **objectives** (with `sub_tasks`); a one-time iterative-clustering re-org cleaned up the existing flat lists (avoided mega-objective and over-fragmentation).
- **Brainstorming (reworked):** record → `POST /api/meetings/transcribe` (compute only, **persists nothing**) → review modal → **Save brainstorm** saves a Meetings session that is **NOT in the Brain** (`vector_indexed=false`, reused as the "in Brain" flag). In the detail view: **"Store in the Brain"** (`/:id/commit-to-brain` → indexes + registers decisions/actions) → AI-**detected agent tasks** (`detectAgentTasks`) → **"Send to agents"** (`/:id/send-to-agents` → `launchAgentWithContext` per relevant agent).
- **AI topic titles** for all meetings/brainstorms (extraction prompt `title` field; `storeMeeting` prefers it). Backfilled old sessions.
- **Delete** brainstorm sessions: `DELETE /api/meetings/:id` (cascades to derived brain doc / chunks / decisions / action_items).
- Backend split: `meetingService` now exposes `transcribeMeeting` (compute) + `storeMeeting` (persist, `indexToBrain` flag) + `commitMeetingToBrain`.

### Dedicated agent chat model (Feature 1, migration **031** `company_llm_config`)
- The complaint "agents chat badly" is largely the **model**. Added a per-company premium model used **only** for agent chat / agent work, while the rest of the OS stays on Groq.
- `llmService`: provider presets **OpenAI, Anthropic, OpenRouter, Google Gemini, and "Agent Router"** (custom OpenAI-compatible base URL); `resolveChatModel(companyId)` (cached, key decrypted); `options.companyId` threaded into `callLLMWithTools` / `callLLMWithToolsStreaming` / `callLLMWithMemory`. Routed: the **chat orchestrator** + the **agent execution loop**. Left on Groq: embeddings, classification, onboarding, meeting/roadmap extraction, and the strict-JSON research/discovery calls (provider JSON-mode varies; custom path has no Groq fallback).
- **Settings → Agent Chat Model** card (provider dropdown, model, masked key, Test button) + `src/api/settingsRoutes.js` (`GET/PUT/test`). Encrypted via `src/security/encryption.js`.

### Cross-provider robustness (driven by owl-alpha failures)
- **`src/utils/looseJson.js#parseLooseJson`** repairs truncated/fenced tool-call JSON (fixed the "Unexpected end of JSON input" that made the Investment agent produce nothing). Used in the agent loop and the chat orchestrator.
- **Output headroom:** `max_tokens` 8000 (agent) / 4000 (chat) to prevent truncated outputs.
- **Agent-chat prompt** nudged to act/produce deliverables (and ask ≤1 question) rather than describe.

### Other UX
- **Stop button:** cooperative cancel — `requestStop()` set + `haltIfStopped()` checkpoints in the agent loop; `POST /api/agents/runs/:id/stop`; chat header Stop button + `stopped` status.
- **Multi-select question answers:** both the task-status "Needs Input" card and the inline conversational question now allow checking multiple choices + "Other" + a Submit button.
- **Feature 2 — agent previews + accept/comment:** new `produce_agent_output` types `web_artifact` (live, sandboxed `<iframe srcDoc>` + full-screen modal) and `asset_collection` (image gallery); Engineering/Marketing prompts emit them; `approvalService.storeOutputToBrain` handles them; "Reject" relabeled **"Request changes"**; removed the redundant duplicate row of status dots (light declutter — orbit kept).

---

## 4. Migrations to apply

These were added this session (the owner applies migrations manually in Supabase):
- **027** `company` `roadmap_type`
- **028** `roadmap_plans.is_tailored`
- **029** `user_profiles`
- **030** `companies.join_code` + `action_items.assignee_user_id`
- **031** `company_llm_config`

`agent_outputs.output_type` is free TEXT, so the new artifact types needed no migration.

---

## 5. Known limitations / next up

- **Apply migrations 027–031** (some features are inert until then).
- **Infra (zero-spend plan, not yet done):** move `uploads/` (incl. recordings) to **Supabase Storage** (Render disk is ephemeral — recordings vanish on redeploy), drop Pinecone fallback, add Resend (completion emails), PostHog (analytics), GitHub adapter + `engineering.tools.json`.
- **Stripe / Phase 6:** intentionally skipped.
- **Research synthesis & discovery question-gen stay on Groq** (JSON-mode safety) — not on the custom chat model.
- **Chat tab:** kept the orbit with a light declutter; a deeper visual redesign is still open.
- **Add `"dev": "nodemon server.js"`** so backend edits hot-reload (offered, not done).
- **owl-alpha** tool-calling reliability is inconsistent; a known tool-strong model (OpenAI/Claude via OpenRouter) is a good A/B.
- Brainstorm uses **batch** transcription (record→stop); true live captions deferred.
- Google Calendar push auto-ingest webhook for meetings still deferred.
- New AI titles/departments/assignees apply to **newly processed** items; backfills were run for the existing few.

---

## 6. Verify / run

- **Backend:** `node server.js` in `C:\Users\HP\Desktop\The Brain` (port 5000). Restart after every backend edit. Health: `GET /api/health` returns 401 when up (auth required).
- **Frontend:** `npm run dev` in `frontend/` (port 3000). Type-check: `npx tsc --noEmit -p tsconfig.json`.
- **Syntax-check backend file:** `node -c <file>`.
- One-off maintenance scripts were written as `scratch_*.js`, run, then deleted — keep the repo free of `scratch_*` and Windows reserved-name files (`nul`/`con`/`aux`), which silently break Turbopack CSS compile.
