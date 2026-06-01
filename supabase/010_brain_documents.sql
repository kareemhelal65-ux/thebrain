-- ============================================================
-- 010: Brain Documents (Master Document Registry)
-- Central registry for all documents stored in The Brain.
-- Referenced by document_drafts and the Documents dashboard.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.brain_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    document_type TEXT NOT NULL DEFAULT 'md',  -- md, csv, pdf, docx, pptx, txt, json
    content TEXT,                               -- Raw text content (for vectorization)
    metadata JSONB DEFAULT '{}',               -- { source: 'ai_generated', draft_id: '...' }
    file_path TEXT,                             -- Local/S3 path to generated file
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Fast tenant-scoped lookups
CREATE INDEX IF NOT EXISTS idx_brain_documents_company
    ON public.brain_documents(company_id);

-- RLS
ALTER TABLE public.brain_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view documents in their company" ON public.brain_documents
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can manage documents in their company" ON public.brain_documents
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );
