-- ============================================================
-- MIGRATION: 034_agent_playbooks.sql
-- Phase B (self-improvement): a growing, per-company "playbook" library.
-- After an output is approved, the system distills ONE reusable "play" (a trigger
-- + the distilled winning approach) and stores it. On future runs the agent
-- retrieves the most relevant plays and reuses them, so quality compounds.
-- Embeddings are stored as JSONB (cosine similarity computed in JS — volume per
-- company+agent is small, so no pgvector RPC is needed).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_playbooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    agent_type TEXT NOT NULL,
    trigger TEXT NOT NULL,           -- when this play applies
    play TEXT NOT NULL,              -- the distilled, reusable approach/template
    embedding JSONB,                 -- embedding of (trigger + play) for retrieval
    source_output_id UUID,           -- the approved output it was distilled from
    win_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_playbooks_company_type
    ON public.agent_playbooks(company_id, agent_type, win_count DESC);

ALTER TABLE public.agent_playbooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_isolation_agent_playbooks" ON public.agent_playbooks;
CREATE POLICY "company_isolation_agent_playbooks" ON public.agent_playbooks
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );
