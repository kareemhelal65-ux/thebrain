-- =============================================
-- Migration 023: v3 Future-Proof Schema
-- Adds tables required by TheBrain v3 Multi-Agent Technical Plan (MVP scope)
-- Tables: feedback_events, task_log, agent_prompts, agent_registry
-- =============================================

-- 1. feedback_events — User signal collection (§7.3)
-- Stores thumbs-up/down on every Brain response + optional text correction
CREATE TABLE IF NOT EXISTS feedback_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID,
    session_id UUID,
    message_id UUID,              -- links to chat_history.id
    rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
    correction_text TEXT,          -- optional user-provided correction
    task_type TEXT,                -- 'meeting_query', 'document_query', 'agent_task', etc.
    agent_name TEXT,               -- which agent produced the output
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_events_tenant ON feedback_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_feedback_events_rating ON feedback_events(tenant_id, rating);
CREATE INDEX IF NOT EXISTS idx_feedback_events_agent ON feedback_events(tenant_id, agent_name);

-- 2. task_log — Orchestrator dispatch logging (§7.6)
-- Every query/task dispatched through the orchestrator is logged
CREATE TABLE IF NOT EXISTS task_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID,
    session_id UUID,
    intent TEXT,                    -- the user's original question/request
    intent_class TEXT,              -- classified intent: 'meeting_query', 'document_query', 'action_item_query', 'agent_task', 'other'
    context_hash TEXT,              -- hash of the context chunks used for retrieval
    agent_used TEXT,                -- which agent handled the request
    result_summary TEXT,            -- first 200 chars of the response
    latency_ms INTEGER,            -- wall-clock time for the full request
    tool_calls_count INTEGER DEFAULT 0,
    sources_count INTEGER DEFAULT 0,
    quality_score REAL,            -- self-check quality score (Phase 2 will populate)
    status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'failed', 'escalated')),
    error_message TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_log_tenant ON task_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_task_log_created ON task_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_log_agent ON task_log(tenant_id, agent_used);

-- 3. agent_prompts — Versioned prompt storage (§7.6)
-- Seeds Phase 2 prompt evolution. MVP: table exists, populated later.
CREATE TABLE IF NOT EXISTS agent_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,         -- e.g. 'marketing_agent', 'finance_agent'
    version INTEGER NOT NULL DEFAULT 1,
    prompt_text TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    change_rationale TEXT,          -- why this version was created
    quality_score_before REAL,     -- quality score before this change (Phase 2)
    quality_score_after REAL,      -- quality score after this change (Phase 2)
    created_by TEXT DEFAULT 'system',
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(agent_id, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_prompts_active ON agent_prompts(agent_id, is_active);

-- 4. agent_registry — Canonical agent records (§7.6)
-- Definitive list of agents with metadata. MVP: 3 core agents.
CREATE TABLE IF NOT EXISTS agent_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT UNIQUE NOT NULL,  -- e.g. 'orchestrator', 'meeting_agent', 'sentinel'
    name TEXT NOT NULL,
    role TEXT,                      -- domain: 'Planning', 'Operations', 'Governance', etc.
    icon TEXT,
    color TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'beta')),
    capabilities JSONB DEFAULT '[]',
    tools JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed MVP agent records (the 3 MVP agents per §7.1)
INSERT INTO agent_registry (agent_id, name, role, icon, color, status) VALUES
    ('orchestrator', 'Orchestrator', 'Planning & Coordination', '🧠', '#6366f1', 'active'),
    ('meeting_agent', 'Meeting Agent', 'Operations', '📅', '#6366f1', 'active'),
    ('sentinel', 'Sentinel Agent', 'Governance & Safety', '🛡️', '#ef4444', 'active'),
    ('memory_agent', 'Memory Agent', 'Knowledge Curation', '💾', '#8b5cf6', 'active'),
    ('marketing_agent', 'Marketing Agent', 'Brand & Content', '📢', '#ec4899', 'beta'),
    ('finance_agent', 'Finance Agent', 'Numbers & Reporting', '💰', '#10b981', 'beta'),
    ('hr_agent', 'HR Agent', 'People & Hiring', '📋', '#f43f5e', 'beta'),
    ('sales_agent', 'Sales Agent', 'Pipeline & Outreach', '💼', '#06b6d4', 'beta'),
    ('product_agent', 'Product Agent', 'Product Management', '🎯', '#14b8a6', 'beta'),
    ('research_agent', 'Research Agent', 'Information Synthesis', '🔬', '#f59e0b', 'beta')
ON CONFLICT (agent_id) DO NOTHING;

-- Enable RLS on new tables
ALTER TABLE feedback_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_registry ENABLE ROW LEVEL SECURITY;

-- RLS policies (service role bypass for backend)
DROP POLICY IF EXISTS "Service role access feedback_events" ON feedback_events;
CREATE POLICY "Service role access feedback_events" ON feedback_events FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role access task_log" ON task_log;
CREATE POLICY "Service role access task_log" ON task_log FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role access agent_prompts" ON agent_prompts;
CREATE POLICY "Service role access agent_prompts" ON agent_prompts FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role access agent_registry" ON agent_registry;
CREATE POLICY "Service role access agent_registry" ON agent_registry FOR ALL USING (true);
