-- Migration: Tables for D3: HR/People evaluations and candidate tracking.

CREATE TABLE IF NOT EXISTS public.member_evaluations (
  user_id           UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  company_id        UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  ai_strength       TEXT,
  performance_score INTEGER CHECK (performance_score >= 1 AND performance_score <= 10),
  evaluation_notes  TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_member_evaluations_company_id ON public.member_evaluations(company_id);

ALTER TABLE public.member_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access same-company member evaluations" ON public.member_evaluations;
CREATE POLICY "Users access same-company member evaluations"
  ON public.member_evaluations
  FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS public.candidates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  name           TEXT,
  email          TEXT,
  role_applied   TEXT,
  cv_text        TEXT,
  fit_score      INTEGER CHECK (fit_score >= 1 AND fit_score <= 10),
  impact_verdict TEXT,
  skills         JSONB DEFAULT '[]'::jsonb,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidates_company_id ON public.candidates(company_id);

ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access same-company candidates" ON public.candidates;
CREATE POLICY "Users access same-company candidates"
  ON public.candidates
  FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid())
  );

-- Auto-update updated_at for member_evaluations.
CREATE TRIGGER set_member_evaluations_updated_at
  BEFORE UPDATE ON public.member_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_profiles_updated_at();
