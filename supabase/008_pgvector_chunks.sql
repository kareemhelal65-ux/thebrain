-- ============================================================
-- 008: pgvector Document Chunks (Demo — Zero-Spend)
-- Replaces Pinecone as the primary vector store for the demo.
-- Uses Supabase's built-in pgvector extension.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.document_chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    embedding vector(768),  -- nomic-embed-text-v1_5 outputs 768 dims
    source_type TEXT NOT NULL DEFAULT 'document',  -- 'meeting', 'google_doc', 'slack', 'document'
    source_id TEXT,           -- ID of the original source (meeting_id, doc_id, etc.)
    source_title TEXT,        -- Human-readable title for citation
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Cosine similarity index for fast vector search
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
    ON public.document_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- Fast tenant-scoped lookups
CREATE INDEX IF NOT EXISTS idx_document_chunks_tenant
    ON public.document_chunks(tenant_id);

CREATE INDEX IF NOT EXISTS idx_document_chunks_source
    ON public.document_chunks(tenant_id, source_type);

-- RLS
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their company document chunks" ON public.document_chunks
    FOR SELECT USING (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can insert document chunks for their company" ON public.document_chunks
    FOR INSERT WITH CHECK (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- ============================================================
-- Function: match_documents
-- Performs cosine similarity search filtered by tenant_id
-- Called from the Node.js backend via Supabase RPC
-- ============================================================
CREATE OR REPLACE FUNCTION match_documents(
    query_embedding vector(768),
    match_threshold FLOAT DEFAULT 0.5,
    match_count INT DEFAULT 5,
    filter_tenant_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    source_type TEXT,
    source_id TEXT,
    source_title TEXT,
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
        dc.metadata,
        1 - (dc.embedding <=> query_embedding) AS similarity
    FROM public.document_chunks dc
    WHERE
        (filter_tenant_id IS NULL OR dc.tenant_id = filter_tenant_id)
        AND 1 - (dc.embedding <=> query_embedding) > match_threshold
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
