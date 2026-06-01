-- --------------------------------------------------------
-- MIGRATION: 009_document_drafts.sql
-- --------------------------------------------------------

-- Create the Document Drafts Table
CREATE TABLE public.document_drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    original_document_id UUID,  -- References brain_documents(id) if editing an existing doc
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'md',
    summary_of_changes TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
    user_comments TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.document_drafts ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view drafts within their own company
CREATE POLICY "Users can view drafts in their company" ON public.document_drafts
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Policy: Users can manage drafts within their own company
CREATE POLICY "Users can manage drafts in their company" ON public.document_drafts
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );
