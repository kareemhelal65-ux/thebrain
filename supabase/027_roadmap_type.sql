-- Migration: Add roadmap_type to companies table
-- Determines which roadmap template populates the company's roadmap.
-- 'vc' = venture track (Pre-Seed → IPO, the legacy default),
-- 'bootstrapped' = self-funded growth, 'agency' = client services,
-- 'nonprofit' = mission-driven programs/grants/impact.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS roadmap_type TEXT
    CHECK (roadmap_type IN ('vc', 'bootstrapped', 'agency', 'nonprofit'));

-- Existing companies have no explicit type; the roadmap service falls back to
-- 'vc' for NULL so behaviour is unchanged until they re-onboard or pick a type.
