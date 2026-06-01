-- Migration: Create roadmap_plans table for per-company dynamic roadmaps
-- Each company has one roadmap with phases, objectives, and evaluation data

CREATE TABLE IF NOT EXISTS public.roadmap_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  
  -- Full roadmap data stored as JSONB for flexibility
  phases JSONB NOT NULL DEFAULT '[]'::jsonb,
  company_summary TEXT,
  last_evaluated TIMESTAMP WITH TIME ZONE,
  generated_by TEXT DEFAULT 'system',
  
  -- Audit timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Enforce one roadmap per company
  UNIQUE(company_id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_roadmap_plans_company_id ON public.roadmap_plans(company_id);

-- Enable RLS for multi-tenant isolation
ALTER TABLE public.roadmap_plans ENABLE ROW LEVEL SECURITY;

-- Company isolation policy
CREATE POLICY "Users can only access their own company's roadmap"
  ON public.roadmap_plans
  FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Auto-update timestamp trigger
CREATE OR REPLACE FUNCTION public.update_roadmap_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_roadmap_updated_at
  BEFORE UPDATE ON public.roadmap_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_roadmap_updated_at();
