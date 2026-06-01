-- ============================================================
-- MIGRATION: 018_agent_system.sql
-- Adds multi-agent execution, approval workflow, and company
-- research infrastructure for The Brain's Agent OS.
-- ============================================================

-- ============================================================
-- Table: agent_executions
-- Tracks each parallel agent run with its own state, status,
-- conversation history, and output data.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    agent_type TEXT NOT NULL,  -- 'company_researcher', 'competitor_researcher', 'marketing_strategist', 'content_creator', 'lead_finder', 'investor_finder', 'custom'
    agent_label TEXT NOT NULL, -- Human-readable name: "Competitor Research", "Marketing Strategy"
    status TEXT NOT NULL DEFAULT 'running',  -- 'running', 'awaiting_input', 'awaiting_approval', 'completed', 'failed', 'cancelled'
    icon TEXT DEFAULT 'bot',  -- Icon identifier for UI
    color TEXT DEFAULT '#6366f1',  -- Color for status badge
    priority INTEGER DEFAULT 0,  -- Execution priority (higher = more urgent)
    
    -- State
    conversation_history JSONB DEFAULT '[]',  -- Messages exchanged with user for this agent
    current_question TEXT,  -- If awaiting_input, what the agent is asking
    current_question_id TEXT,  -- Unique ID for tracking question responses
    output_data JSONB DEFAULT '{}',  -- Latest structured output from the agent
    output_summary TEXT,  -- Brief summary of what was produced
    
    -- Metadata
    progress_pct INTEGER DEFAULT 0,  -- 0-100 progress indicator
    current_action TEXT,  -- What the agent is doing right now (e.g., "Analyzing competitors...")
    error_message TEXT,
    iterations INTEGER DEFAULT 0,
    
    -- Timing
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_executions_company ON public.agent_executions(company_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_status ON public.agent_executions(company_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_executions_type ON public.agent_executions(company_id, agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_executions_created ON public.agent_executions(company_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.agent_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view agent executions in their company" ON public.agent_executions
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can manage agent executions in their company" ON public.agent_executions
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- ============================================================
-- Table: agent_outputs
-- Deliverables produced by agents, pending user approval before
-- being stored permanently in The Brain's knowledge base.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_outputs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_execution_id UUID NOT NULL REFERENCES public.agent_executions(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    output_type TEXT NOT NULL,  -- 'marketing_strategy', 'lead_list', 'investor_list', 'competitor_analysis', 'company_profile', 'content_draft', 'social_post'
    title TEXT NOT NULL,
    summary TEXT,  -- One-paragraph summary for the approval card
    content JSONB DEFAULT '{}',  -- Full structured content
    status TEXT NOT NULL DEFAULT 'pending_approval',  -- 'pending_approval', 'approved', 'rejected', 'draft'
    feedback TEXT,  -- User's rejection reason or approval note
    approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    
    -- Integration: once approved, can be stored in brain
    stored_in_brain BOOLEAN DEFAULT false,  -- Whether this output was stored in brain_documents
    brain_document_id UUID REFERENCES public.brain_documents(id) ON DELETE SET NULL,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    approved_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_agent_outputs_company ON public.agent_outputs(company_id);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_status ON public.agent_outputs(company_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_execution ON public.agent_outputs(agent_execution_id);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_type ON public.agent_outputs(company_id, output_type);

-- Enable RLS
ALTER TABLE public.agent_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view agent outputs in their company" ON public.agent_outputs
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can manage agent outputs in their company" ON public.agent_outputs
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- ============================================================
-- Table: company_insights
-- Stores researched facts about a company from website scans,
-- social media analysis, and market research.
-- Used to enrich The Brain's knowledge about the company itself.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_insights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    insight_type TEXT NOT NULL,  -- 'website_scan', 'social_media', 'competitor_intel', 'market_position', 'product_analysis', 'team_info'
    source_url TEXT,  -- The URL where this insight was found
    source_label TEXT,  -- Human-readable source name: "Company Website", "LinkedIn Profile"
    
    -- Core data
    summary TEXT NOT NULL,  -- One-line summary of the insight
    details JSONB DEFAULT '{}',  -- Full structured details
    confidence FLOAT DEFAULT 0.8,  -- 0.0 to 1.0
    
    -- Tags for discoverability
    tags TEXT[] DEFAULT '{}',
    
    -- Whether this has been reviewed by the user
    is_reviewed BOOLEAN DEFAULT false,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_company_insights_company ON public.company_insights(company_id);
CREATE INDEX IF NOT EXISTS idx_company_insights_type ON public.company_insights(company_id, insight_type);
CREATE INDEX IF NOT EXISTS idx_company_insights_reviewed ON public.company_insights(company_id, is_reviewed);

-- Enable RLS
ALTER TABLE public.company_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view company insights in their company" ON public.company_insights
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can manage company insights in their company" ON public.company_insights
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );
