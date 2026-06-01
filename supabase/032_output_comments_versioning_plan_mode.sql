-- ============================================================
-- MIGRATION: 032_output_comments_versioning_plan_mode.sql
-- Phase A foundation:
--   1) agent_output_comments  — threaded + section-level review comments
--   2) agent_outputs.version / .revision_of  — versioned revisions while a
--      comment thread persists across the revision chain
--   3) agent_executions.mode  — plan/execute split (Claude-Code-style):
--      agents first emit an approvable `plan`, then execute on approval.
-- ============================================================

-- ─── 1. Review comments on an agent output ───
-- section_ref: NULL = whole-deliverable / threaded comment.
--              non-null = a section/step/file anchor, e.g. 'channels[2]',
--              a heading slug, a plan step id, or (engineering) a file path.
CREATE TABLE IF NOT EXISTS public.agent_output_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_output_id UUID NOT NULL REFERENCES public.agent_outputs(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    section_ref TEXT,
    status TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'addressed'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_output_comments_output
    ON public.agent_output_comments(agent_output_id, created_at);
CREATE INDEX IF NOT EXISTS idx_output_comments_company
    ON public.agent_output_comments(company_id);

ALTER TABLE public.agent_output_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_isolation_output_comments" ON public.agent_output_comments;
CREATE POLICY "company_isolation_output_comments" ON public.agent_output_comments
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- ─── 2. Versioned revisions of an output ───
-- A revision is a NEW agent_outputs row with version = prev+1 and
-- revision_of = the predecessor's id. The comment thread is resolved by
-- walking the revision chain.
ALTER TABLE public.agent_outputs
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.agent_outputs
    ADD COLUMN IF NOT EXISTS revision_of UUID REFERENCES public.agent_outputs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_outputs_revision_of
    ON public.agent_outputs(revision_of);

-- ─── 3. Plan mode → Execute mode ───
-- mode: 'executing' (default, legacy behavior) | 'planning'.
-- New execution status value 'awaiting_plan_approval' is just a TEXT value;
-- status is free TEXT so no enum change is required.
ALTER TABLE public.agent_executions
    ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'executing';
ALTER TABLE public.agent_executions
    ADD COLUMN IF NOT EXISTS require_plan BOOLEAN NOT NULL DEFAULT false;
