-- --------------------------------------------------------
-- MIGRATION: 013_action_items_department.sql
-- Adds department column to action_items for auto-assignment
-- --------------------------------------------------------

ALTER TABLE public.action_items ADD COLUMN IF NOT EXISTS department TEXT;

-- Index for efficient filtering by department
CREATE INDEX IF NOT EXISTS idx_action_items_department ON public.action_items(department);
