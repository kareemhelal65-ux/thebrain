-- Add taxonomy columns to document_chunks
ALTER TABLE public.document_chunks ADD COLUMN IF NOT EXISTS semantic_type TEXT;
ALTER TABLE public.document_chunks ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE public.document_chunks ADD COLUMN IF NOT EXISTS sub_type TEXT;

-- Add taxonomy columns to brain_documents
ALTER TABLE public.brain_documents ADD COLUMN IF NOT EXISTS semantic_type TEXT;
ALTER TABLE public.brain_documents ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE public.brain_documents ADD COLUMN IF NOT EXISTS sub_type TEXT;

-- Create decisions table
CREATE TABLE IF NOT EXISTS public.decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    source_doc_id UUID REFERENCES public.brain_documents(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    made_by TEXT,
    date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create action_items table
CREATE TABLE IF NOT EXISTS public.action_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    source_doc_id UUID REFERENCES public.brain_documents(id) ON DELETE CASCADE,
    task TEXT NOT NULL,
    assignee TEXT,
    due_date DATE,
    status TEXT DEFAULT 'open',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS for decisions
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their company decisions" ON public.decisions
    FOR SELECT USING (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can insert decisions for their company" ON public.decisions
    FOR INSERT WITH CHECK (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can update decisions for their company" ON public.decisions
    FOR UPDATE USING (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can delete decisions for their company" ON public.decisions
    FOR DELETE USING (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Enable RLS for action_items
ALTER TABLE public.action_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their company action_items" ON public.action_items
    FOR SELECT USING (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can insert action_items for their company" ON public.action_items
    FOR INSERT WITH CHECK (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can update action_items for their company" ON public.action_items
    FOR UPDATE USING (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can delete action_items for their company" ON public.action_items
    FOR DELETE USING (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Recreate match_documents function with taxonomy filters
DROP FUNCTION IF EXISTS match_documents(vector(384), FLOAT, INT, UUID);
DROP FUNCTION IF EXISTS match_documents(vector, FLOAT, INT, UUID);
DROP FUNCTION IF EXISTS match_documents(vector, FLOAT, INT, UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION match_documents(
    query_embedding vector(384),
    match_threshold FLOAT DEFAULT 0.2,
    match_count INT DEFAULT 8,
    filter_tenant_id UUID DEFAULT NULL,
    filter_semantic_type TEXT DEFAULT NULL,
    filter_department TEXT DEFAULT NULL,
    filter_sub_type TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    source_type TEXT,
    source_id TEXT,
    source_title TEXT,
    semantic_type TEXT,
    department TEXT,
    sub_type TEXT,
    metadata JSONB,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        dc.id,
        dc.content,
        dc.source_type,
        dc.source_id,
        dc.source_title,
        dc.semantic_type,
        dc.department,
        dc.sub_type,
        dc.metadata,
        1 - (dc.embedding <=> query_embedding) AS similarity
    FROM public.document_chunks dc
    WHERE
        (filter_tenant_id IS NULL OR dc.tenant_id = filter_tenant_id)
        AND (filter_semantic_type IS NULL OR dc.semantic_type = filter_semantic_type)
        AND (filter_department IS NULL OR dc.department = filter_department)
        AND (filter_sub_type IS NULL OR dc.sub_type = filter_sub_type)
        AND 1 - (dc.embedding <=> query_embedding) > match_threshold
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
