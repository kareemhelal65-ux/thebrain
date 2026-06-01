-- Add roadmap_phase and roadmap_objective columns to decisions table
ALTER TABLE public.decisions ADD COLUMN IF NOT EXISTS roadmap_phase TEXT;
ALTER TABLE public.decisions ADD COLUMN IF NOT EXISTS roadmap_objective TEXT;
