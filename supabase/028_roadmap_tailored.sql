-- Migration: Mark whether a roadmap's tasks were AI-tailored to the company.
-- Roadmaps generated before per-phase tailoring (or by the old whole-roadmap
-- echo pass) have is_tailored = FALSE, which the service uses to auto-upgrade
-- existing companies to a genuinely tailored roadmap on next load.

ALTER TABLE public.roadmap_plans
  ADD COLUMN IF NOT EXISTS is_tailored BOOLEAN DEFAULT FALSE;
