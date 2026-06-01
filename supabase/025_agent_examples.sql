-- ============================================================
-- MIGRATION: 025_agent_examples.sql
-- Closed feedback loop (Phase 1C): persist user-approved agent
-- outputs as company-specific few-shot examples, and store a
-- synthesized per-agent style preference on the company record.
-- ============================================================

-- ============================================================
-- Table: agent_examples
-- One row per approved deliverable, used to seed future runs of
-- the same agent type with "match this quality and style" examples.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.agent_examples (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    agent_type TEXT NOT NULL,
    title TEXT NOT NULL,
    content_summary TEXT,
    full_content JSONB DEFAULT '{}',
    output_type TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_examples_company_type
    ON public.agent_examples(company_id, agent_type, created_at DESC);

ALTER TABLE public.agent_examples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view agent examples in their company" ON public.agent_examples;
CREATE POLICY "Users can view agent examples in their company" ON public.agent_examples
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

DROP POLICY IF EXISTS "Users can manage agent examples in their company" ON public.agent_examples;
CREATE POLICY "Users can manage agent examples in their company" ON public.agent_examples
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- ============================================================
-- companies.agent_preferences
-- Synthesized style/tone preferences per agent type, e.g.
-- { "finance": { "tone": "conservative", "prefers_bullet_points": true } }
-- Injected into the system prompt on every subsequent run.
-- ============================================================
ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS agent_preferences JSONB DEFAULT '{}';
