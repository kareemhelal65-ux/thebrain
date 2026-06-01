# The Brain AIOS — Zero-Spend Demo Build Plan

## Overview
This document outlines the ruthless, zero-spend, 8-week technical build plan for "The Brain" AIOS demo. The full enterprise plan is reserved for post-raise. For the demo, we are building exactly **one working loop**: 

`User connects Google → meetings sync → user asks a question → Brain answers with source citation → action items shown → Slack notification sent`

---

## 1. Zero-Spend Stack

### AI Coding Tools (Your Team)
- **Cursor (Free Tier)**: Primary vibe coding environment.
- **Claude.ai (Free Tier)**: Architecture decisions and hard problems.
- **Groq API (Free)**: Llama 3.3 70B as the main LLM (better than GPT-4o-mini and zero cost).
- **GitHub Copilot (Free Tier)**: Inline completions.

### Infrastructure (All Free)
- **Supabase (Free Tier)**: PostgreSQL + pgvector + Auth + Storage + 500MB.
- **Vercel (Free Forever)**: Next.js frontend hosting.
- **Railway ($5 Free Credits/Month)**: FastAPI backend hosting.
- **Upstash Redis (Free 10K requests/day)**: Task queue.
- **GitHub (Free)**: Version control + CI/CD via Actions.

### LLM + Embeddings
- **Groq (Llama 3.3 70B)**: Main LLM, completely free.
- **OpenAI (`text-embedding-3-small`)**: $5 free starter credits for embeddings only (very cheap).
- **HuggingFace Inference API**: Free fallback for embeddings if OpenAI credits run out.

### Integrations (All Free APIs)
- **Google Cloud Console**: Google Meet + Drive + Calendar APIs.
- **Slack API**: Free.
- **OAuth Flows**: Free for all supported integrations.

---

## 2. Ruthless Cuts (What NOT to Build)
The full plan is for post-raise. Cut everything else.

- ❌ **Microsoft 365, Teams, Zoom, Outlook**: Microsoft Graph alone takes 3 weeks.
- ❌ **Celery workers**: Use FastAPI `BackgroundTasks` instead (built-in, free).
- ❌ **Pinecone cold memory**: `pgvector` on Supabase is enough for the demo.
- ❌ **Sentinel pipeline**: One approve button replaces the whole thing.
- ❌ **No-code agent builder**: One hardcoded agent: summarize + extract action items.
- ❌ **AWS ECS + Terraform**: Railway is 3 clicks.
- ❌ **Clerk auth**: Supabase Auth does the same thing for free.

---

## 3. 8-Week Execution Plan (Step-by-Step Guide)

Each week is driven by a single Cursor prompt to maximize velocity.

### Week 1 — Next.js + Supabase + Google Sign-In
**Goal**: Get the frontend live with authentication.
**Cursor Prompt**: 
> "Create a Next.js 14 app with Supabase Auth. Users can sign in with Google OAuth. After login show a dashboard with the user's name and email. Use Tailwind CSS and shadcn/ui. Use environment variables NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
*Deploy to Vercel on Day 1 to have a live URL from the start.*

### Week 2 — FastAPI Backend + Google Meet Transcript Fetch
**Goal**: Stand up the backend and integrate with Google Meet APIs.
**Cursor Prompt**: 
> "Build a FastAPI app deployed on Railway. Add a POST /meetings/sync endpoint that takes a Google OAuth access token, fetches recent Google Meet recordings and transcripts via the Google Meet API and Drive API, and stores them in a Supabase table called meetings with columns: id, tenant_id, title, date, participants (jsonb), transcript (text)."

### Week 3 — Chunk + Embed Transcripts into pgvector (The Brain)
**Goal**: Build the core memory engine. **This is the most important week. This IS The Brain.**
**Cursor Prompt**: 
> "Write a Python function that takes a meeting transcript and tenant_id. Chunk it into 512-token pieces with 64-token overlap using tiktoken. Embed each chunk with OpenAI text-embedding-3-small. Store in a Supabase table called document_chunks with columns: id, tenant_id, content, embedding vector(1536), metadata jsonb."

### Week 4 — Ask The Brain Anything (The Magic Moment)
**Goal**: Complete the core conversational loop.
**Cursor Prompt**: 
> "Build a FastAPI POST /brain/query endpoint. Takes a question and tenant_id. Embeds the question with OpenAI. Queries Supabase pgvector for the 5 most similar chunks filtered by tenant_id using cosine similarity. Builds a context string. Calls Groq API with llama-3.3-70b-versatile with system prompt 'Answer only based on this company context. Always cite which meeting your answer came from.' Stream the response back with source meeting names."
*After this, build the chat UI in Next.js to complete the demo moment.*

### Week 5 — Auto Summaries + Action Items + Slack Notification
**Goal**: Automate post-meeting workflows.
**Cursor Prompt**: 
> "After a transcript is saved, call Groq twice: once to generate a 3-paragraph meeting summary, once to extract action items as JSON array with fields: owner, task, deadline. Save both to the meetings table. POST the summary to a Slack Incoming Webhook URL from environment variable SLACK_WEBHOOK_URL."

### Week 6 — Google Drive + Slack Ingestion
**Goal**: Expand context sources for The Brain.
**Cursor Prompt**: 
> "Add two ingestion functions: 1) Google Drive API — fetch 20 most recent Google Docs, extract text, chunk, embed, store with source_type='google_doc'. 2) Slack Web API — fetch last 7 days of messages from all channels, chunk by channel/day, embed, store with source_type='slack'. Both filtered by tenant_id. Brain query now searches across all three sources."

### Week 7 — Polish + Team Invites + Tenant Isolation
**Goal**: Finalize UI, navigation, and core security filters.
**Cursor Prompt**: 
> "Add sidebar navigation (Brain, Meetings, Documents, Slack, Team, Settings). Home page shows source counts by type and last sync time per integration with a Sync Now button. Add invite form using Supabase Auth inviteUserByEmail(). Verify all queries filter by tenant_id."

### Week 8 — Ship + Record Demo + Pitch
**Goal**: Deploy everything, record the demo, and pitch investors.
- Deploy all components (Next.js to Vercel, FastAPI to Railway).
- Record a 3-minute Loom demo.
**Script**: 
> "I connect Google. The Brain pulls my last 10 meetings. I ask: 'What did we decide about pricing last month?' It answers in 2 seconds and tells me exactly which meeting. I ask: 'What are my open action items?' It lists every task across every meeting. This is what every founder needs and nobody built it yet."
- Send the pitch deck and demo link to Flat6Labs, FasterCapital, Cairo Angels, and Falak AI on the same day.
