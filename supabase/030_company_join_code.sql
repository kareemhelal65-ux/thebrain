-- Migration: Company join codes + per-person task assignment.
-- join_code lets co-founders/employees join an existing company during onboarding.
-- assignee_user_id lets the AI assign action items to a specific team member.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS join_code TEXT;

-- Unique index (multiple NULLs are allowed). Existing companies are backfilled with
-- guaranteed-unique codes by the app; new companies get one at creation time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_join_code ON public.companies(join_code);

-- Link an action item to the specific user responsible (resolved from the assignee name).
ALTER TABLE public.action_items
  ADD COLUMN IF NOT EXISTS assignee_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_action_items_assignee_user_id ON public.action_items(assignee_user_id);
