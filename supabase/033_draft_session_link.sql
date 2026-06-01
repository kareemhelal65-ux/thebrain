-- ============================================================
-- MIGRATION: 033_draft_session_link.sql
-- Link document drafts to the chat session that produced them, so deleting a
-- chat can clean up the still-PENDING drafts/actions it spawned (approved drafts
-- already became permanent brain_documents and are intentionally left untouched).
-- ============================================================

ALTER TABLE public.document_drafts
    ADD COLUMN IF NOT EXISTS session_id UUID;

CREATE INDEX IF NOT EXISTS idx_document_drafts_session
    ON public.document_drafts(session_id);
