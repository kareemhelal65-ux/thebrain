-- ============================================================
-- MIGRATION: 020_question_choices.sql
-- Adds answer choices support for interactive agent questions.
-- When agents ask questions, they can now provide predefined
-- answer choices that users can select from (with an "Other"
-- option to type a custom answer).
-- ============================================================

-- Add JSONB column for answer choices (array of strings)
ALTER TABLE public.agent_executions 
ADD COLUMN IF NOT EXISTS current_question_choices JSONB DEFAULT NULL;

-- Update RLS policies (already cover all columns, no changes needed)
