-- Migration: 024_action_items_decision_id.sql
-- Adds decision_id column to link action items directly to decisions

ALTER TABLE public.action_items 
ADD COLUMN IF NOT EXISTS decision_id UUID REFERENCES public.decisions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_action_items_decision_id ON public.action_items(decision_id);
