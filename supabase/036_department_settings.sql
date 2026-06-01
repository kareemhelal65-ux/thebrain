-- ============================================================
-- MIGRATION: 036_department_settings.sql
-- Phase D1/D1.5: per-company, per-department dashboard configuration.
--
-- `department_settings` stores BOTH the first-run wizard answers AND the resolved
-- dynamic config produced by configureDepartment() (selected widgets, recipes,
-- framing/subtitle, relevance, which questions were asked vs auto-answered). All of
-- that lives in `answers` (JSONB) so no further tables are needed for the resolver.
--
-- We also tag proactive items with a `department` so each department tab can show
-- only its own proposals/suggestions (D1 "Proactive proposals").
-- ============================================================

CREATE TABLE IF NOT EXISTS public.department_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    department TEXT NOT NULL,          -- 'marketing' | 'finance' | 'sales' | 'crm' | 'investment' | 'product' | 'people' | 'engineering'
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { setupAnswers, resolvedConfig: { widgets, recipes, subtitle, relevance, askedQuestions, autoAnswered }, ... }
    setup_complete BOOLEAN NOT NULL DEFAULT false,
    relevance TEXT DEFAULT 'secondary', -- 'primary' | 'secondary' | 'dormant' (Team is always present; never dormant)
    last_configured_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (company_id, department)
);

CREATE INDEX IF NOT EXISTS idx_department_settings_company ON public.department_settings(company_id);

ALTER TABLE public.department_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_isolation_department_settings" ON public.department_settings;
CREATE POLICY "company_isolation_department_settings" ON public.department_settings
    FOR ALL USING (company_id = (auth.jwt() ->> 'company_id')::uuid);

-- ─── Department tagging on proactive items (filter proposals per department tab) ───
ALTER TABLE public.proposed_automations  ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE public.proactive_suggestions ADD COLUMN IF NOT EXISTS department TEXT;

CREATE INDEX IF NOT EXISTS idx_proposed_automations_department  ON public.proposed_automations(department);
CREATE INDEX IF NOT EXISTS idx_proactive_suggestions_department ON public.proactive_suggestions(department);
