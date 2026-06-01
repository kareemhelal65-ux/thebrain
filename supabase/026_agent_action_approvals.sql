-- ============================================================
-- MIGRATION: 026_agent_action_approvals.sql
-- Approval-first agent actions (Phase 3). Every external-mutating
-- tool an agent wants to run (send email, post Slack message,
-- create calendar event, etc.) is recorded here as a proposal and
-- only executed after explicit user approval.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_action_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    agent_execution_id UUID REFERENCES public.agent_executions(id) ON DELETE SET NULL,

    tool_name TEXT NOT NULL,
    tool_category TEXT,
    arguments JSONB DEFAULT '{}',
    preview TEXT,                       -- human-readable description of what will happen

    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'
    requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    result JSONB,
    error TEXT,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    executed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_action_approvals_company_status
    ON public.agent_action_approvals(company_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_approvals_execution
    ON public.agent_action_approvals(agent_execution_id);

ALTER TABLE public.agent_action_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view action approvals in their company" ON public.agent_action_approvals;
CREATE POLICY "Users can view action approvals in their company" ON public.agent_action_approvals
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

DROP POLICY IF EXISTS "Users can manage action approvals in their company" ON public.agent_action_approvals;
CREATE POLICY "Users can manage action approvals in their company" ON public.agent_action_approvals
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );
