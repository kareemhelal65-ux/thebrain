-- Migration: Per-user profiles built from the onboarding personal interview.
-- Captures who each user is and how they work so agents and the Brain can
-- personalise their output. Keyed by the auth user id (= public.users.id).

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id     UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  company_id  UUID REFERENCES public.companies(id) ON DELETE CASCADE,

  full_name   TEXT,
  position    TEXT,            -- role/title in the startup (e.g. "Founder & CEO")
  experience  TEXT,            -- seniority / years (e.g. "7-15 years")
  background  TEXT,            -- free-text background / prior experience
  work_style  TEXT,            -- how they operate (e.g. "Big-picture strategist")
  interests   JSONB DEFAULT '[]'::jsonb,  -- areas of interest (array of strings)
  bio         TEXT,            -- anything else they shared
  raw_answers JSONB DEFAULT '{}'::jsonb,  -- full raw interview payload

  profile_summary TEXT,        -- LLM-synthesised one-paragraph profile

  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_company_id ON public.user_profiles(company_id);

-- Multi-tenant isolation (server uses the service-role client, but keep RLS on).
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users access own profile or same-company profiles" ON public.user_profiles;
CREATE POLICY "Users access own profile or same-company profiles"
  ON public.user_profiles
  FOR ALL
  USING (
    user_id = auth.uid()
    OR company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid())
  );

-- Auto-update updated_at on change.
CREATE OR REPLACE FUNCTION public.update_user_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER set_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_profiles_updated_at();
