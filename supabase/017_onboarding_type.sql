-- Migration: Add onboarding_type to companies table
-- Tracks whether the company was onboarded as a new startup or existing business

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS onboarding_type TEXT CHECK (onboarding_type IN ('new_company', 'existing_company'));

-- Also add columns for startup-specific data captured during onboarding
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS company_stage TEXT,
  ADD COLUMN IF NOT EXISTS mission_vision TEXT,
  ADD COLUMN IF NOT EXISTS target_customer TEXT,
  ADD COLUMN IF NOT EXISTS competitors TEXT;

-- Columns for existing company onboarding
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS current_tools TEXT,
  ADD COLUMN IF NOT EXISTS pain_points TEXT;

-- Index for filtering by type
CREATE INDEX IF NOT EXISTS idx_companies_onboarding_type ON public.companies(onboarding_type);
