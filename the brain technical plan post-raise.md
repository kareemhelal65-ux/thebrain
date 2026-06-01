# The Brain AIOS — Complete Technical Build Plan
**Version 1.0 | Monk Summer Execution Phase | 2026**

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [The Brain — Core Context Layer](#2-the-brain--core-context-layer)
3. [Semantic Ingestion Pipeline](#3-semantic-ingestion-pipeline)
4. [The Orchestrator](#4-the-orchestrator)
5. [Soft Agents & Universal Adapters](#5-soft-agents--universal-adapters)
6. [OAuth Integration Layer (6 MVP Connectors)](#6-oauth-integration-layer-6-mvp-connectors)
7. [Meeting Memory Engine](#7-meeting-memory-engine)
8. [Agent Builder (No-Code UI)](#8-agent-builder-no-code-ui)
9. [Sentinel Pipeline (Security & Compliance)](#9-sentinel-pipeline-security--compliance)
10. [Multi-Tenant Architecture & RBAC](#10-multi-tenant-architecture--rbac)
11. [Frontend & UI Layer](#11-frontend--ui-layer)
12. [Infrastructure & DevOps](#12-infrastructure--devops)
13. [Database Schema](#13-database-schema)
14. [API Design](#14-api-design)
15. [Phased Build Roadmap](#15-phased-build-roadmap)
16. [Tech Stack Summary](#16-tech-stack-summary)
17. [Team Structure & Hiring Plan](#17-team-structure--hiring-plan)
18. [Budget Allocation Map](#18-budget-allocation-map)

---

## 1. System Architecture Overview

The Brain AIOS is built as a **multi-tenant, event-driven platform** composed of five major subsystems that work together to create a persistent, context-aware AI layer over a company's existing tool stack.

```
┌──────────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                             │
│   Web App (Next.js)  ·  Desktop (Tauri/Electron, future)     │
└────────────────────────────┬─────────────────────────────────┘
                             │ REST + WebSocket
┌────────────────────────────▼─────────────────────────────────┐
│                      API GATEWAY                              │
│   FastAPI  ·  Auth (Clerk/Auth0)  ·  Rate Limiting           │
└──────┬──────────────┬────────────────────┬────────────────────┘
       │              │                    │
┌──────▼──────┐ ┌─────▼──────┐  ┌─────────▼──────────┐
│  THE BRAIN  │ │ORCHESTRATOR│  │  INGESTION WORKERS  │
│(Vector Mem) │ │(LLM Planner│  │ (Celery + Redis)    │
│ Pinecone +  │ │+ Tool Sel.)│  │                     │
│ PostgreSQL  │ └─────┬──────┘  └─────────┬───────────┘
└──────▲──────┘       │                   │
       │         ┌────▼────────┐    ┌─────▼──────────┐
       │         │SOFT AGENTS  │    │ INTEGRATION HUB │
       └─────────│(Execution   │    │ Google · M365   │
                 │ Layer)      │    │ Slack · Zoom    │
                 └─────────────┘    │ Gmail · Outlook │
                                    └────────────────┘
```

### Core Design Principles

**Context-first, not query-first.** Every response the AI gives is grounded in the company's actual data stored in The Brain — not general LLM knowledge.

**Write-safe by default.** No agent ever writes to an external system without staged human approval. All mutations pass through the Sentinel pipeline before execution.

**Tenant isolation is non-negotiable.** Every vector embedding, every document chunk, every agent execution is scoped to a `tenant_id`. No data bleeds between companies.

---

## 2. The Brain — Core Context Layer

The Brain is the single most important component of the entire product. It is what differentiates you from every competitor. It is a **persistent, company-scoped semantic memory store** — not a RAG bolt-on, but the foundation every other subsystem reads from and writes to.

### What It Stores

Every piece of information that enters The Brain is chunked, embedded, and stored with rich metadata:

- Meeting transcripts (decisions, action items, participants, timestamps)
- Documents (Google Docs, Word files, PDFs, CSVs)
- Slack messages and thread summaries
- Email threads (Gmail, Outlook)
- Agent action logs
- User-defined knowledge entries ("Kareem is our investor relations lead")

### Memory Architecture

The Brain uses a **two-layer memory model**:

**Layer 1 — Hot Memory (PostgreSQL + pgvector)**
Fast, structured retrieval for recent context (last 90 days for Kernel, 1 year for Neural+). Stores embeddings alongside full metadata, participant info, and cross-references between documents.

**Layer 2 — Cold Memory (Pinecone)**
Long-term semantic search across all historical data. Every chunk is stored with a namespace tied to `tenant_id` so searches are always scoped. Used for deeper retrieval when hot memory doesn't yield high-confidence results.

### Embedding Strategy

Use **text-embedding-3-large** from OpenAI (or a fine-tuned version later) for all embeddings. Chunk size: 512 tokens with 64-token overlap. Every chunk stores:

```json
{
  "chunk_id": "uuid",
  "tenant_id": "acme_corp",
  "source_type": "meeting | document | slack | email | agent_log",
  "source_id": "original_document_uuid",
  "content": "chunk text",
  "embedding": [0.021, -0.044, ...],
  "metadata": {
    "created_at": "ISO timestamp",
    "participants": ["kareem@acme.com"],
    "tags": ["investor-meeting", "Q3-2026"],
    "rbac_roles": ["admin", "exec"],
    "source_url": "https://docs.google.com/...",
    "meeting_date": "2026-05-10"
  }
}
```

### Memory Query Flow

When a user sends a prompt to The Brain:

1. The prompt is embedded using the same model as the stored chunks.
2. A hybrid search runs: semantic similarity (cosine distance) + BM25 keyword search for precision.
3. Top-k chunks (k=10 default, k=20 for complex queries) are retrieved, filtered by `tenant_id` and the user's RBAC roles.
4. A **reranker** (Cohere Rerank or cross-encoder) rescores the chunks for relevance.
5. The top 5–8 chunks are passed to the Orchestrator as the context window for the LLM.

---

## 3. Semantic Ingestion Pipeline

This pipeline continuously pulls content from connected integrations, processes it, and inserts it into The Brain. It runs asynchronously so users never wait for ingestion.

### Pipeline Architecture

```
Integration Webhook / Polling
         │
         ▼
   Event Queue (Redis)
         │
         ▼
   Celery Workers
   ┌─────────────────────────────────────┐
   │  1. Raw Fetch (download content)    │
   │  2. Clean & Normalize               │
   │  3. PII Scrub (Sentinel)            │
   │  4. Chunk (512 tokens, 64 overlap)  │
   │  5. Embed (text-embedding-3-large)  │
   │  6. Store → pgvector + Pinecone     │
   │  7. Index metadata → PostgreSQL     │
   └─────────────────────────────────────┘
```

### Source-Specific Processing

**Google Meet / Zoom Transcripts**
- Webhook fires when meeting ends.
- Pull transcript via API.
- Run speaker diarization normalization (map speaker IDs to workspace users).
- Extract: decisions made, action items assigned, next steps.
- Store full transcript + structured extraction separately.
- Link meeting to calendar event, participants, and related documents mentioned in the call.

**Google Docs / Microsoft Word**
- Triggered on document change events (Google Drive webhook, Microsoft Graph subscription).
- Full document re-ingested on significant change (delta > 20% content change).
- Preserve heading structure as metadata for better retrieval context.

**Slack**
- Subscribe to Slack Events API for `message.channels`, `message.groups`, `file_shared`.
- Ingest messages with thread context (thread parent + replies as one semantic unit).
- Daily batch job re-processes pinned messages and important threads.
- Channel-level RBAC: only ingest channels the connecting OAuth user has access to.

**Gmail / Outlook**
- Poll every 15 minutes via Gmail watch / Microsoft Graph webhooks.
- Ingest emails with sender, recipient, subject, date, and body as linked context.
- Thread emails together (In-Reply-To headers) as a semantic unit.
- Flag emails with action items or decisions for explicit extraction.

**PDFs / CSVs (Manual Upload)**
- User uploads via the app.
- PDF: extract text via pdfminer, OCR fallback with Tesseract for scanned documents.
- CSV: analyze column structure, ingest as tabular context with schema description.

### Deduplication

Every chunk is hashed (SHA-256 of content + source_id). Before inserting, check hash against existing records. Skip if identical. Update if content has changed.

---

## 4. The Orchestrator

The Orchestrator is the planning brain that sits between the user's prompt and the execution layer. It decides: what does the user want, which tools are needed, in what order, and what requires human approval?

### Orchestrator Flow

```
User Prompt
    │
    ▼
1. Context Retrieval (query The Brain)
    │
    ▼
2. Intent Classification
   - Simple Q&A → direct RAG response
   - Action request → multi-step planning
   - Agent trigger → route to Soft Agent
    │
    ▼
3. Tool Selection (from 200+ API registry)
    │
    ▼
4. Execution Plan Generation
   (DAG of steps with dependencies)
    │
    ▼
5. Sentinel Check (PII scan, write-risk flag)
    │
    ▼
6. Human-in-the-Loop Gate (for write actions)
    │
    ▼
7. Execute → Return result
    │
    ▼
8. Log execution to The Brain (agent_log)
```

### LLM Planner Design

The Orchestrator uses **Claude claude-sonnet-4-20250514** (or GPT-4o, cost-dependent) as its planner. The system prompt includes:

- The company's retrieved context (top-k chunks from The Brain)
- The available tool registry for this tenant's connected integrations
- Execution constraints (read-only vs. write-enabled based on plan tier)
- The user's RBAC role

The planner outputs a structured execution plan:

```json
{
  "intent": "schedule_follow_up_email",
  "steps": [
    {
      "step": 1,
      "tool": "gmail.draft_email",
      "params": {"to": "investor@vc.com", "subject": "Follow-up from May 10 call"},
      "requires_approval": true,
      "risk_level": "write"
    }
  ],
  "requires_human_approval": true,
  "confidence": 0.94
}
```

### Tool Registry

The tool registry is a database of every action the system knows how to perform, indexed by integration:

```
tool_registry table:
- tool_id
- integration_name (e.g., "gmail")
- tool_name (e.g., "draft_email")
- description (natural language, used for LLM selection)
- input_schema (JSON Schema)
- output_schema (JSON Schema)
- risk_level ("read" | "write" | "destructive")
- required_oauth_scopes
```

MVP ships with 6 integrations and approximately 40–60 tools. At launch, 200+ tools across 40 integrations.

---

## 5. Soft Agents & Universal Adapters

Soft Agents are pre-built or user-defined automation workflows that execute multi-step plans using the Orchestrator and Universal Adapters. The word "soft" means they are configurable, inspectable, and reversible — not hard-coded bots.

### Agent Types

**System Agents (pre-built by The Brain team)**
- Meeting Follow-Up Agent: after every meeting, drafts follow-up email, creates tasks from action items, logs decisions to The Brain.
- Onboarding Agent: when a new user joins Slack, creates onboarding checklist, shares relevant documents, schedules welcome meeting.
- Weekly Digest Agent: every Monday, pulls meeting summaries, project updates from docs, Slack activity — generates a CEO briefing.

**Custom Agents (user-built via no-code builder)**
- Users define: trigger (schedule, webhook, event), steps (tools to call in order), output (draft for approval or auto-execute).

### Universal Adapter Pattern

Each integration has a Universal Adapter — a standardized interface that normalizes the third-party API into a consistent internal contract:

```python
class GoogleDriveAdapter(UniversalAdapter):
    integration = "google_drive"
    
    def list_files(self, folder_id=None) -> List[File]: ...
    def read_file(self, file_id: str) -> DocumentContent: ...
    def create_file(self, name: str, content: str) -> File: ...
    def update_file(self, file_id: str, content: str) -> File: ...
    def delete_file(self, file_id: str) -> bool: ...
```

Every adapter implements the same base interface. The Orchestrator never calls third-party APIs directly — it always goes through the adapter layer. This means swapping or adding integrations never touches Orchestrator logic.

### Agent Execution Runtime

Agents run as isolated Celery tasks. Each execution:

1. Gets a unique `execution_id`.
2. Runs in a sandboxed context with only the tools and scopes its creator authorized.
3. Logs every step (tool called, input, output, timestamp) to the `agent_execution_log` table.
4. All write-actions are held in a `pending_writes` queue until the human approves them in the UI.
5. On approval, the write is executed via the adapter. On rejection, it is discarded and logged.

### Rollback Engine

For every write action that executes, the system stores a rollback record:

```json
{
  "write_id": "uuid",
  "tenant_id": "acme_corp",
  "tool_called": "gmail.send_email",
  "action_taken": {"to": "...", "subject": "...", "body": "..."},
  "rollback_action": "gmail.trash_email",
  "rollback_params": {"message_id": "..."},
  "executed_at": "timestamp",
  "rolled_back": false
}
```

Within 30 minutes of any write, users can hit "undo" in the UI and the rollback action fires automatically.

---

## 6. OAuth Integration Layer (6 MVP Connectors)

### OAuth Flow Architecture

All integrations use OAuth 2.0. The Brain never stores raw credentials — only encrypted refresh tokens. The flow:

1. User clicks "Connect Google Workspace" in the app.
2. Redirect to Google OAuth consent screen with required scopes.
3. Google returns auth code → server exchanges for access + refresh tokens.
4. Tokens encrypted with AES-256 and stored in the `oauth_tokens` table, keyed to `tenant_id + integration_name`.
5. All API calls use short-lived access tokens. Refresh tokens auto-rotate on expiry.

### MVP Connectors

**1. Google Workspace (Drive, Docs, Sheets)**
- Scopes: `drive.readonly`, `documents.readonly`, `spreadsheets.readonly`
- Webhooks: Google Drive push notifications for file change events
- Rate limits: 1000 req/100s per user — implement exponential backoff queue

**2. Microsoft 365 (SharePoint, OneDrive, Word)**
- Scopes: `Files.Read.All`, `Sites.Read.All`
- Webhooks: Microsoft Graph change notifications
- Rate limits: 10,000 req/10min — batch requests via Graph $batch endpoint

**3. Gmail**
- Scopes: `gmail.readonly`, `gmail.compose` (write-gated to Neural+ tier)
- Webhooks: Gmail push notifications via Cloud Pub/Sub
- Thread normalization: group by thread_id for coherent context

**4. Microsoft Outlook**
- Scopes: `Mail.Read`, `Mail.Send` (write-gated)
- Microsoft Graph webhooks for inbox events
- Shared with M365 OAuth app registration

**5. Slack**
- Scopes: `channels:history`, `channels:read`, `users:read`, `files:read`
- Events API for real-time message ingestion
- Bot token stored per-workspace, user token for user-level actions

**6. Google Meet / Zoom**
- Google Meet: Transcripts via Google Workspace Admin API (requires Workspace Business+ on user's side, handle gracefully if unavailable)
- Zoom: Webhooks for meeting ended events, recording/transcript download via Zoom API
- Both: normalize transcript format to internal schema (speaker, timestamp, text)

---

## 7. Meeting Memory Engine

This is the primary entry-wedge feature — the one that gets users hooked on The Brain immediately.

### How It Works End-to-End

1. **Pre-meeting:** The Brain checks the calendar (Google Calendar / Outlook Calendar) and pulls context for every participant — past decisions made with them, open action items, related documents.

2. **During meeting:** No real-time processing in MVP. Users connect Zoom/Meet recording after.

3. **Post-meeting (within 5 minutes of meeting end):**
   - Transcript webhook fires.
   - Pipeline runs: fetch → clean → speaker normalization → extraction.
   - LLM extraction pass: identify decisions, action items, open questions, next steps.
   - Store full transcript + structured extraction in The Brain.
   - Auto-generate: meeting summary card in the app, draft follow-up email (held for approval), tasks in connected task manager (if connected).

4. **Retrieval:** Any future prompt that relates to topics, people, or projects from past meetings automatically pulls those meeting chunks as context. "What did we decide about the pricing model?" surfaces the relevant transcript chunk with date, participants, and full context.

### Meeting Entity Extraction Schema

Every meeting produces:

```json
{
  "meeting_id": "uuid",
  "tenant_id": "acme_corp",
  "date": "2026-05-10",
  "participants": ["kareem@acme.com", "investor@vc.com"],
  "duration_minutes": 45,
  "topics": ["pre-seed raise", "product roadmap", "Cairo team"],
  "decisions": [
    "Will send term sheet by May 17",
    "MVP scope locked to 6 integrations"
  ],
  "action_items": [
    {"owner": "kareem@acme.com", "task": "Send updated cap table", "due": "2026-05-14"},
    {"owner": "investor@vc.com", "task": "Intro to Flat6Labs partner", "due": "2026-05-20"}
  ],
  "open_questions": ["What is the data residency requirement for EU customers?"],
  "full_transcript_ref": "transcript_uuid"
}
```

---

## 8. Agent Builder (No-Code UI)

The Agent Builder is the product surface that lets non-technical ops leads deploy custom automations without writing code.

### UI Components

**Trigger Selector**
- Schedule (cron-style but human-readable: "Every Monday at 9am")
- Event-based ("When a meeting ends", "When a Slack message contains [keyword]", "When a document is shared with me")
- Manual ("Run now" button)

**Step Builder (visual flow)**
- Each step is a card.
- User picks: Integration → Action → Configure Parameters.
- Parameters support: static values, dynamic values from The Brain context (`{{meeting.participants}}`), and AI-generated values ("write a summary of {{meeting.transcript}}").
- Steps can be connected sequentially or with conditional branches ("If action item has owner, assign to them in Asana, else draft a Slack message asking who owns it").

**Approval Settings**
- Per-step: "Auto-execute" or "Hold for my approval."
- Default is hold-for-approval on all write actions.
- Users can toggle specific agents to auto-execute after trust is established.

**Test Mode**
- Run agent against the last 3 real events in dry-run mode.
- Shows what would have happened: what emails would have been drafted, what tasks would have been created.
- User reviews and confirms before enabling live execution.

---

## 9. Sentinel Pipeline (Security & Compliance)

Every prompt, every retrieval, every write action passes through Sentinel. This is not an optional module — it runs inline in the critical path.

### Sentinel Components

**PII Scrubber (pre-LLM)**
- Runs before any content is sent to the LLM provider.
- Detects and redacts: email addresses, phone numbers, national IDs, credit card numbers, passport numbers, physical addresses.
- Uses Microsoft Presidio (open-source) as the detection engine.
- Redacted entities are replaced with typed placeholders: `[EMAIL_1]`, `[PHONE_1]`.
- Original ↔ placeholder mapping stored encrypted in memory for duration of the request only.

**Write Risk Classifier**
- Classifies every Orchestrator action as: `read` / `write` / `destructive`.
- Write actions always require human approval on Kernel tier.
- Neural+ users can configure per-tool auto-approval thresholds.
- Destructive actions (delete, bulk-send) always require approval regardless of tier.

**Immutable Audit Log**
- Every action (ingestion event, agent execution, write, approval, rejection) is written to an append-only log table with no UPDATE or DELETE permissions on that table.
- Log entry: `tenant_id`, `user_id`, `action_type`, `input_hash`, `output_hash`, `timestamp`, `ip_address`.
- Cortex tier: logs exportable as signed JSON (HMAC-signed for tamper evidence).

**Data Leakage Guard**
- Every LLM response is scanned before delivery to the user.
- Checks: does the response reference data from another tenant? (detects cross-tenant bleed).
- Checks: does the response contain PII that wasn't in the original user's data?
- Flagged responses are quarantined and never delivered to the user.

---

## 10. Multi-Tenant Architecture & RBAC

### Tenant Isolation Model

The Brain is multi-tenant at the **data layer, not just the application layer.**

- Every database table has a `tenant_id` column.
- PostgreSQL Row-Level Security (RLS) is enabled on all tables: `CREATE POLICY tenant_isolation ON documents USING (tenant_id = current_setting('app.current_tenant'))`.
- Pinecone namespaces are `tenant_{id}` — no cross-namespace queries are ever issued.
- Redis cache keys are always prefixed with `{tenant_id}:`.
- Every API request sets `app.current_tenant` in the PostgreSQL session at the start of the request lifecycle.

### RBAC Model

Three built-in roles per tenant:

**Admin** — full read/write access, can connect integrations, manage agents, view audit logs, manage users.

**Member** — can query The Brain, run agents they created, view shared meeting summaries. Cannot connect integrations or view other users' private documents.

**Viewer** — read-only access to shared context. Cannot run agents or modify anything.

Custom roles (Cortex tier only): admins can define custom roles with specific tool-level permissions ("can run Meeting Follow-Up Agent but cannot access Finance tools").

RBAC is enforced at two levels: API middleware (rejects requests before they reach business logic) and database RLS (defense-in-depth — even if middleware is bypassed, the DB refuses).

---

## 11. Frontend & UI Layer

### Tech Stack

**Framework:** Next.js 14 (App Router) + TypeScript
**Styling:** Tailwind CSS + shadcn/ui
**State Management:** Zustand for client state, React Query (TanStack) for server state
**Real-time:** WebSockets via Socket.IO (streaming LLM responses, live agent execution status)
**Auth:** Clerk (handles OAuth, SSO for Cortex tier, session management)

### Core UI Surfaces

**The Brain Dashboard**
The main interface. Three-panel layout:
- Left: navigation (Meetings, Documents, Agents, Integrations, Settings)
- Center: the AI chat interface — main query surface, streaming responses, inline citations showing which source from The Brain each claim came from
- Right: context panel — shows what The Brain retrieved for the current response (source cards with document name, date, relevant excerpt)

**Meeting Memory View**
Timeline-style list of all ingested meetings. Each meeting opens into: summary card, decisions list, action items with owners, full transcript toggle. Filter by participant, date range, topic.

**Agent Builder**
Visual canvas (described in Section 8). Accessible from "Agents" tab. List of active agents with last-run status, execution history, enable/disable toggle.

**Integration Hub**
OAuth connection cards for each supported integration. Status indicator (connected / needs re-auth / error). Shows last sync time and number of items ingested.

**Approval Queue**
The human-in-the-loop interface. Shows pending write actions from agents: what the agent wants to do, the drafted content (email, task, message), and Approve / Edit / Reject buttons. Approve fires the execution. Edit opens inline editor before approval.

**Knowledge Search**
Direct semantic search across The Brain. Returns source cards with relevance scores. Useful for "what did we say about X" without framing it as an agent task.

### Streaming Response Architecture

LLM responses stream token-by-token to the UI using Server-Sent Events (SSE). As the response streams:
- Citations are injected inline as the relevant chunk is referenced.
- The context panel populates in real-time as sources are retrieved.
- If an agent execution is triggered mid-response, a live execution card appears in the chat.

---

## 12. Infrastructure & DevOps

### Cloud Provider: AWS

Primary region: `eu-west-1` (Ireland) — latency to Cairo acceptable, EU data residency option available for future enterprise customers.

### Services Used

| Service | Purpose |
|---|---|
| ECS Fargate | API server, Celery workers (containerized, auto-scaling) |
| RDS PostgreSQL 16 | Primary database with pgvector extension |
| ElastiCache Redis | Job queue (Celery), caching, session store |
| S3 | Raw document storage (pre-processing), audio/video files |
| CloudFront | CDN for frontend static assets |
| Route 53 | DNS |
| SES | Transactional email (notifications, magic links) |
| CloudWatch | Logs, metrics, alerts |
| Secrets Manager | API keys, OAuth secrets, encryption keys |

### External Services

| Service | Purpose | Monthly Cost (est.) |
|---|---|---|
| Pinecone (Starter → Standard) | Vector database | $0–$70 |
| OpenAI API | Embeddings + GPT-4o / Claude | $300–$800 (usage-based) |
| Clerk | Auth + user management | $0–$25 |
| Resend | Transactional email | $0–$20 |

### Containerization

Every service runs in Docker. Docker Compose for local development. ECS task definitions for production.

```
services:
  api:        FastAPI app
  worker:     Celery worker (ingestion + agent execution)
  beat:       Celery beat (scheduled agent jobs)
  frontend:   Next.js app (or deploy separately to Vercel)
  redis:      ElastiCache in prod, local Redis in dev
  postgres:   RDS in prod, local Postgres in dev
```

### CI/CD

GitHub Actions pipeline:
1. On PR: lint, type check, unit tests, integration tests against test DB
2. On merge to `main`: build Docker images, push to ECR, deploy to staging (ECS blue/green)
3. On manual approval: promote to production

### Environments

- `local`: Docker Compose, seeded test data, mock OAuth
- `staging`: Full AWS stack, real OAuth, separate tenant namespace in Pinecone
- `production`: Full AWS stack, RLS enforced, audit logging active

---

## 13. Database Schema

### Core Tables (PostgreSQL)

```sql
-- Tenants
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  plan TEXT NOT NULL CHECK (plan IN ('kernel', 'neural', 'cortex')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  stripe_customer_id TEXT,
  seat_count INT DEFAULT 1
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  clerk_user_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- OAuth Tokens
CREATE TABLE oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  integration TEXT NOT NULL, -- 'google', 'slack', 'zoom', etc.
  access_token_encrypted BYTEA NOT NULL,
  refresh_token_encrypted BYTEA NOT NULL,
  scopes TEXT[],
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id, integration)
);

-- Source Documents (pre-chunking record)
CREATE TABLE source_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  source_type TEXT NOT NULL, -- 'google_doc', 'slack_message', 'meeting', etc.
  external_id TEXT, -- original ID in the source system
  title TEXT,
  url TEXT,
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  last_modified TIMESTAMPTZ,
  content_hash TEXT,
  metadata JSONB
);

-- Meetings
CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  source_document_id UUID REFERENCES source_documents(id),
  platform TEXT, -- 'zoom', 'google_meet', 'teams'
  date TIMESTAMPTZ,
  duration_minutes INT,
  participants TEXT[],
  summary TEXT,
  decisions JSONB,
  action_items JSONB,
  transcript_ref TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agents
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  created_by UUID REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT, -- 'schedule', 'event', 'manual'
  trigger_config JSONB,
  steps JSONB,
  approval_config JSONB,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent Execution Log
CREATE TABLE agent_execution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  agent_id UUID REFERENCES agents(id),
  triggered_by UUID REFERENCES users(id),
  status TEXT, -- 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled'
  steps_log JSONB,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Pending Write Actions (approval queue)
CREATE TABLE pending_writes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  execution_id UUID REFERENCES agent_execution_log(id),
  tool TEXT,
  params JSONB,
  draft_content JSONB,
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected', 'executed'
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Immutable Audit Log (no RLS updates/deletes allowed)
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID,
  action_type TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  input_hash TEXT,
  output_hash TEXT,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vector store is managed in Pinecone, but document chunks are also indexed:
CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  source_document_id UUID REFERENCES source_documents(id),
  chunk_index INT,
  content TEXT,
  embedding vector(1536), -- pgvector, for hot memory
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops);
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
```

---

## 14. API Design

### Base URL
`https://api.thebrain.ai/v1`

### Authentication
All API requests require a Bearer token in the Authorization header. Tokens issued by Clerk, validated by a FastAPI dependency that sets the current tenant context.

### Core Endpoints

**Brain / Context**
```
POST   /brain/query          — semantic query, returns answer + source citations
POST   /brain/ingest         — manual document upload
GET    /brain/sources        — list all ingested sources
DELETE /brain/sources/{id}   — remove a source document
```

**Meetings**
```
GET    /meetings             — list all meetings (filters: date, participant, topic)
GET    /meetings/{id}        — full meeting detail (summary, action items, transcript)
POST   /meetings/{id}/resync — re-process a meeting transcript
```

**Agents**
```
GET    /agents               — list tenant's agents
POST   /agents               — create new agent
GET    /agents/{id}          — get agent detail
PUT    /agents/{id}          — update agent
DELETE /agents/{id}          — delete agent
POST   /agents/{id}/run      — manually trigger agent
GET    /agents/{id}/executions — execution history
```

**Approval Queue**
```
GET    /approvals            — pending write actions
POST   /approvals/{id}/approve — approve and execute
POST   /approvals/{id}/reject  — reject
PATCH  /approvals/{id}         — edit draft before approving
```

**Integrations**
```
GET    /integrations         — list available integrations + connection status
POST   /integrations/{name}/connect   — initiate OAuth flow
DELETE /integrations/{name}/disconnect — revoke access
GET    /integrations/{name}/status    — sync status, last update, item count
```

**Admin**
```
GET    /admin/users          — list workspace users
POST   /admin/users/invite   — invite new user
PATCH  /admin/users/{id}/role — change role
GET    /admin/audit-log      — immutable audit log (Cortex only)
GET    /admin/usage          — credit usage, storage used, seats
```

### WebSocket Events (real-time)

```
ws://api.thebrain.ai/v1/ws

Events server → client:
  brain.stream.token          — LLM response token (streaming)
  brain.stream.source         — source citation added
  brain.stream.done           — response complete
  agent.execution.step        — agent step completed
  agent.execution.approval    — write action pending approval
  ingestion.complete          — new source ingested
```

---

## 15. Phased Build Roadmap

### Phase 1 — Kernel Core (Q2 2026, ~8 weeks)

**Goal:** Stable internal product used by the 3 founding companies.

**Week 1–2: Foundation**
- Set up monorepo (Turborepo or Nx)
- PostgreSQL + pgvector + Redis + S3 (Docker Compose locally, Terraform for AWS)
- FastAPI skeleton with Clerk auth, tenant middleware, RLS setup
- Next.js app with Clerk integration, basic routing, Tailwind + shadcn

**Week 3–4: The Brain Core**
- Pinecone setup, namespace-per-tenant config
- Ingestion pipeline scaffolding (Celery workers, Redis queue)
- Chunking, embedding, and upsert pipeline
- Basic semantic query endpoint
- Manual document upload (PDF + DOCX)

**Week 5–6: OAuth Connectors (Google + Slack)**
- Google Workspace OAuth (Drive, Docs)
- Gmail OAuth + polling ingestion
- Slack OAuth + Events API ingestion
- Basic sync job scheduler

**Week 7–8: Chat UI + Meeting Memory**
- Chat interface with streaming responses + source citations
- Zoom webhook + transcript ingestion
- Meeting extraction (decisions, action items)
- Meeting Memory view in UI

**Milestone:** 3 internal companies using it daily. Core ingestion stable. Query quality validated.

---

### Phase 2 — Neural Link (Q3 2026, ~8 weeks)

**Goal:** 10 paying beta customers. Add M365 + agentic layer.

**Week 1–2: M365 + Outlook**
- Microsoft Graph OAuth
- OneDrive / SharePoint ingestion
- Outlook email ingestion
- Google Meet transcript support

**Week 3–4: Orchestrator + Tool Registry**
- Tool registry database populated
- LLM planner prompt engineering + structured output
- Execution plan parser
- Universal Adapter base class + first 4 adapters

**Week 5–6: Meeting Follow-Up Agent (MVP Agent)**
- End-to-end: meeting ends → transcript → extract → draft email + tasks
- Approval queue UI
- Rollback engine
- Audit log

**Week 7–8: Billing + GTM**
- Stripe integration (per-seat subscription, Kernel + Neural tiers)
- Onboarding flow (connect first integration → ingest first 10 docs → run first query)
- Beta customer outreach, onboarding support

**Milestone:** 10 paying customers on Neural ($39/seat). MRR > $1,500.

---

### Phase 3 — Orchestration (Q4 2026, ~8 weeks)

**Goal:** 50 paying customers. Full agent builder. Multi-agent workflows.

**Week 1–2: Agent Builder UI**
- Visual step builder
- Trigger configurator (schedule + event)
- Test mode (dry-run)

**Week 3–4: Multi-Agent Coordination**
- Agent chaining (output of one agent as input of next)
- Event-based triggers between agents
- Concurrency controls (prevent race conditions on writes)

**Week 5–6: Document Generation Tools**
- PDF generation from meeting summaries
- PPTX generation from structured data
- Scheduled digest reports

**Week 7–8: Cortex Tier + Enterprise Features**
- SSO (SAML via Clerk)
- Customer-managed encryption keys
- Data residency config
- Dedicated CSM workflow tools

**Milestone:** 50 paying customers, mix of Neural + Cortex. MRR > $15,000.

---

### Phase 4 — Public Launch (Q1–Q2 2027)

- Public API launch (third-party developers build on The Brain)
- Self-healing agents (auto-retry failed steps, fallback tools)
- Cross-company intelligence bridges (The Brain for group companies under one holding)
- Series A fundraising metrics package ready

---

## 16. Tech Stack Summary

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 14, TypeScript, Tailwind, shadcn/ui | SSR for SEO, best DX, strong ecosystem |
| Backend API | FastAPI (Python) | Async-native, type-safe, great for ML-adjacent code |
| Task Queue | Celery + Redis | Robust async job processing, mature ecosystem |
| Primary Database | PostgreSQL 16 + pgvector | Relational + vector in one, RLS for multi-tenancy |
| Long-term Vector Store | Pinecone | Managed, scales to billions of vectors, fast ANN |
| LLM Provider | OpenAI (GPT-4o) + Anthropic Claude | Cost/capability balance; both as fallback |
| Embeddings | OpenAI text-embedding-3-large | Best in class, 3072 dims (use 1536 for cost) |
| PII Detection | Microsoft Presidio | Open-source, production-grade, extensible |
| Auth | Clerk | Handles OAuth, SSO, session management out of box |
| Payments | Stripe | Per-seat billing, usage metering |
| Infrastructure | AWS (ECS, RDS, ElastiCache, S3) | Production-grade, cost-efficient at SMB scale |
| IaC | Terraform | Reproducible environments |
| CI/CD | GitHub Actions | Free for open-source tier, integrates everywhere |
| Monitoring | CloudWatch + Sentry + Posthog | Logs, errors, product analytics |

---

## 17. Team Structure & Hiring Plan

### Monk Summer Team (funded by the $400K raise)

**Hire 1 — Backend / Infrastructure Lead (Senior)**
- Owns: FastAPI API, Celery workers, PostgreSQL schema, Pinecone integration, OAuth layer
- Must know: Python async, PostgreSQL RLS, Redis, Docker, AWS
- Target: Cairo CS graduate, 3–5 years experience
- Monthly cost: ~$5,200

**Hire 2 — AI / ML Engineer**
- Owns: The Brain query pipeline, embedding strategy, LLM orchestration, Sentinel
- Must know: LangChain or LlamaIndex patterns (but you'll write your own), OpenAI / Anthropic APIs, vector search
- Target: Cairo or remote, strong fundamentals in retrieval systems
- Monthly cost: ~$5,000

**Hire 3 — Frontend Engineer**
- Owns: Next.js app, Clerk auth, WebSocket streaming, Agent Builder UI, all product surfaces
- Must know: React/Next.js, TypeScript, Tailwind, real-time UI patterns
- Target: Cairo, strong eye for product quality
- Monthly cost: ~$5,000

**Founder (Kareem)**
- Owns: product decisions, investor relations, beta customer relationships, QA, and the connective tissue between all three engineers
- Monthly cost: $2,000 (salary from raise)

### Post-Series A Additions

- DevOps / SRE: to own Terraform, CI/CD, incident response
- Second backend engineer: to accelerate integration library
- Customer Success: to manage Cortex tier accounts

---

## 18. Budget Allocation Map

**Total raise: $400,000 USD · Post-Money SAFE · $3.5M cap · 11.4% dilution at cap conversion**

| Item | Total (9 months) | Monthly | Notes |
|---|---|---|---|
| Engineering team (3 × 9 months) | $136,800 | ~$15,200 | Backend $5,200 · AI/ML $5,000 · Frontend $5,000 |
| Founder salary | $18,000 | $2,000 | Cairo living stipend for full 9-month build |
| Cloud infrastructure (AWS) | $18,000 | ~$2,000 | ECS, RDS, ElastiCache, S3 — scales with beta users |
| LLM API costs (OpenAI/Anthropic) | $18,000 | ~$2,000 | Spike-proofed: real users can 3–5× burn rate |
| OAuth + Microsoft Graph (dedicated) | $20,000 | one-time | M365/Graph alone justified separate budget line |
| Beta GTM + content (6 months) | $20,000 | ~$3,333 | Outbound tools, content production, beta incentives |
| Product, design, QA + security audit | $18,000 | one-time | 1-month designer + QA + pre-beta security audit |
| Legal, DPAs + unexpected contracts | $15,000 | one-time | Incorporation, IP assignment, enterprise DPAs |
| Contingency buffer (10%) | $40,000 | — | Rehiring reserve, infra spikes, scope creep |
| **Unallocated buffer** | **$96,200** | — | **Buffer + conservative burn extension** |
| **Total raise** | **$400,000** | — | |

### Why $400K, not $300K

The original $300K budget had $167,500 unaccounted for — which looked like slack but wasn't justified. The $400K budget fixes four specific risks:

**1. LLM API cost spikes** — Real users running agents across 200+ tool calls per session can spike LLM costs 3–5× overnight. The $18K allocation (vs $5,200 previously) is spike-proofed against that scenario.

**2. Microsoft Graph integration time** — M365 OAuth has three different auth flows, inconsistent token refresh behaviour, and documentation that is frequently wrong. Dedicating $20K to OAuth/Graph (vs $8K previously) reflects the real engineering cost of this integration.

**3. Engineer rehiring reserve** — At $5,000+/month per engineer, losing one mid-build and needing to recruit a replacement costs 1–2 months of lost productivity plus recruitment time. The $40K contingency plus unallocated buffer covers one full replacement cycle without pausing the build.

**4. Enterprise legal costs** — The moment a Cortex-tier customer (50+ employees) signs up, their legal team will send a Data Processing Agreement. At $15K for legal (vs $4,500), we can handle 3–4 enterprise contracts without going back to investors.

### Burn rate scenarios

| Scenario | Monthly burn | Runway |
|---|---|---|
| Conservative (dev-only, no GTM) | ~$19,200 | ~20 months |
| Base case (full team + GTM) | ~$23,400 | ~17 months |
| Aggressive (LLM spike + GTM) | ~$38,000 | ~10 months |

The base case gives 17 months of runway on $400K — well past the MVP and Series A metrics target, with significant buffer. Engineers paid at $5,000+/month are top-of-Cairo-market, which buys loyalty and retention through the full build.

---

## Appendix: Key Technical Decisions & Rationale

**Why Python for the backend, not Node.js?**
Python dominates the AI/ML library ecosystem. Celery, LangChain, Presidio, pdfminer, and every embedding library you'll need are Python-first. Fighting this with Node.js would create unnecessary friction.

**Why PostgreSQL + pgvector instead of a pure vector DB?**
Operational simplicity. Running two separate database systems (PostgreSQL for relational data, a vector DB for embeddings) doubles operational overhead. pgvector handles the hot memory tier perfectly. Pinecone handles cold/scale. This two-layer approach is optimal for a 7-person team.

**Why not use LangChain?**
LangChain abstracts too much, making debugging opaque and adding dependency weight. For The Brain's Orchestrator, you need precise control over prompts, tool selection logic, and execution flow. Build thin wrappers around the OpenAI/Anthropic SDK directly. Use LlamaIndex only for the ingestion pipeline where its document loaders save significant time.

**Why AWS over GCP?**
GCP has better native integrations with Google Workspace (which is your primary data source), but AWS has more predictable pricing at SMB scale, a larger Cairo-accessible engineer talent pool familiar with it, and superior managed services for PostgreSQL (RDS) and Redis (ElastiCache). The Google Workspace integration is handled via OAuth regardless of cloud provider.

**Why Clerk over Auth0?**
Clerk is purpose-built for modern web apps with better Next.js integration, built-in OAuth connection management, and competitive pricing. Auth0 is powerful but over-engineered for the MVP phase.

---

*This document is intended as the internal engineering blueprint for The Brain AIOS Monk Summer execution phase. All architectural decisions should be revisited at Phase 2 based on observed production behavior.*
