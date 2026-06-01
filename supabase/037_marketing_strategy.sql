-- ============================================================
-- MIGRATION: 037_marketing_strategy.sql
-- Phase D2: the Marketing tab's auto-updating 7-week strategy. Mirrors the
-- roadmap generate→store→re-eval pattern: generated once, stored, and refreshed
-- on demand ("Refresh") or when new marketing context lands. One row per company.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.marketing_strategy (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    weeks JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ week, focus, objectives[], channels[], experiments[], kpis[] }]
    is_tailored BOOLEAN NOT NULL DEFAULT false,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS idx_marketing_strategy_company ON public.marketing_strategy(company_id);

ALTER TABLE public.marketing_strategy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_isolation_marketing_strategy" ON public.marketing_strategy;
CREATE POLICY "company_isolation_marketing_strategy" ON public.marketing_strategy
    FOR ALL USING (company_id = (auth.jwt() ->> 'company_id')::uuid);
