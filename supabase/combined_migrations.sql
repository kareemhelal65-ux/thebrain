-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create Enum for Roles (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('Admin', 'Employee');
    END IF;
END$$;

-- Create Companies Table
CREATE TABLE IF NOT EXISTS public.companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Users Table
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), -- Could reference auth.users if using Supabase Auth
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'Employee',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Audit Logs Table
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    tool_used TEXT NOT NULL,
    input_data JSONB,
    reasoning_path TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- --------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) SETUP
-- --------------------------------------------------------

-- Enable RLS on all tables
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Note: The following policies assume that your application backend or Supabase Auth 
-- sets a session variable or JWT claim for `app.current_company_id`.
-- For a Node.js backend using the Service Role, RLS is bypassed. 
-- However, if using the Anon Key + custom JWTs, you would use:
-- current_setting('request.jwt.claims')::json->>'company_id'

-- We will create standard policies assuming requests come with an authenticated user context
-- where we can derive their company_id.

-- Policies for Companies
DROP POLICY IF EXISTS "Users can view their own company" ON public.companies;
CREATE POLICY "Users can view their own company" ON public.companies
    FOR SELECT USING (
        id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Policies for Users
DROP POLICY IF EXISTS "Users can view users in their company" ON public.users;
CREATE POLICY "Users can view users in their company" ON public.users
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Policies for Audit Logs
DROP POLICY IF EXISTS "Users can view audit logs for their company" ON public.audit_logs;
CREATE POLICY "Users can view audit logs for their company" ON public.audit_logs
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

DROP POLICY IF EXISTS "Users can insert audit logs for their company" ON public.audit_logs;
CREATE POLICY "Users can insert audit logs for their company" ON public.audit_logs
    FOR INSERT WITH CHECK (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Note: If using Service Role key in the Node backend, RLS is automatically bypassed, 
-- and the backend enforces the `company_id` isolation manually via RBAC middleware.
-- Create Conversation Memory Table
CREATE TABLE IF NOT EXISTS public.conversation_memory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.conversation_memory ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to view their company's memory
DROP POLICY IF EXISTS "Users can view memory for their company" ON public.conversation_memory;
CREATE POLICY "Users can view memory for their company" ON public.conversation_memory
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Policy to allow users to insert memory for their company
DROP POLICY IF EXISTS "Users can insert memory for their company" ON public.conversation_memory;
CREATE POLICY "Users can insert memory for their company" ON public.conversation_memory
    FOR INSERT WITH CHECK (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );
-- ============================================================
-- 003: Nervous System Schema
-- Adds: Manager role, company services, enhanced audit logs,
--       meetings, webhook secrets
-- ============================================================

-- Add Manager role to existing enum
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'Manager' BEFORE 'Employee';

-- ============================================================
-- Company Service Configurations (Universal Provider Registry)
-- Any category, any provider, per-company isolation
-- Credentials are AES-256-GCM encrypted at the application layer
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    category TEXT NOT NULL,              -- 'communications', 'finance', 'commerce', 'crm', 'project-management', 'hr', 'storage'
    provider_name TEXT NOT NULL,         -- 'gmail', 'paymob', 'shopify', 'hubspot', etc.
    credentials_encrypted TEXT NOT NULL, -- AES-256-GCM ciphertext
    credentials_iv TEXT NOT NULL,        -- Initialization vector (hex)
    credentials_tag TEXT NOT NULL,       -- GCM authentication tag (hex)
    is_active BOOLEAN DEFAULT true,
    config JSONB DEFAULT '{}',           -- Non-secret provider config (e.g., API version, region)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, category, provider_name)
);

-- Index for fast lookups by company
CREATE INDEX IF NOT EXISTS idx_company_services_company ON public.company_services(company_id);
CREATE INDEX IF NOT EXISTS idx_company_services_category ON public.company_services(company_id, category);

-- ============================================================
-- Enhanced Audit Logs for Sentinel Security Gatekeeper
-- Adds pre/post execution tracking with linked execution tokens
-- ============================================================
ALTER TABLE public.audit_logs
    ADD COLUMN IF NOT EXISTS sentinel_verdict TEXT,         -- 'APPROVED', 'DENIED'
    ADD COLUMN IF NOT EXISTS execution_phase TEXT,          -- 'PRE', 'POST'
    ADD COLUMN IF NOT EXISTS execution_token UUID,          -- Links pre/post entries
    ADD COLUMN IF NOT EXISTS result_data JSONB,             -- Tool execution result
    ADD COLUMN IF NOT EXISTS execution_duration_ms INTEGER, -- Execution time in ms
    ADD COLUMN IF NOT EXISTS tool_parameters JSONB;         -- Parameters passed to tool

-- Index for linking pre/post audit entries
CREATE INDEX IF NOT EXISTS idx_audit_execution_token ON public.audit_logs(execution_token);

-- ============================================================
-- Meeting Records
-- Stores transcripts and extracted insights from virtual and
-- physical meetings. Insights are indexed into Vector DB.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.meetings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,           -- 'zoom', 'google_meet', 'teams', 'audio_upload'
    title TEXT,
    raw_transcript TEXT,
    insights JSONB,                      -- { decisions: [], action_items: [], deadlines: [] }
    meeting_date TIMESTAMP WITH TIME ZONE,
    duration_minutes INTEGER,
    participants JSONB DEFAULT '[]',     -- [{ name, email, role }]
    vector_indexed BOOLEAN DEFAULT false,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_company ON public.meetings(company_id);
CREATE INDEX IF NOT EXISTS idx_meetings_source ON public.meetings(company_id, source_type);

-- ============================================================
-- Webhook Secrets (per company, per provider)
-- Used by WebhookAuthenticator to verify inbound webhook signatures
-- Secrets are AES-256-GCM encrypted
-- ============================================================
CREATE TABLE IF NOT EXISTS public.webhook_secrets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,              -- 'zoom', 'google_meet', 'teams'
    secret_encrypted TEXT NOT NULL,      -- AES-256-GCM ciphertext
    secret_iv TEXT NOT NULL,             -- Initialization vector (hex)
    secret_tag TEXT NOT NULL,            -- GCM authentication tag (hex)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, provider)
);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE public.company_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_secrets ENABLE ROW LEVEL SECURITY;

-- Company Services: users can only see/modify their own company's services
DROP POLICY IF EXISTS "Users can view their company services" ON public.company_services;
CREATE POLICY "Users can view their company services" ON public.company_services
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

DROP POLICY IF EXISTS "Admins can manage company services" ON public.company_services;
CREATE POLICY "Admins can manage company services" ON public.company_services
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Meetings: users can only see their own company's meetings
DROP POLICY IF EXISTS "Users can view their company meetings" ON public.meetings;
CREATE POLICY "Users can view their company meetings" ON public.meetings
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

DROP POLICY IF EXISTS "Users can insert meetings for their company" ON public.meetings;
CREATE POLICY "Users can insert meetings for their company" ON public.meetings
    FOR INSERT WITH CHECK (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Webhook Secrets: only admins via service role
DROP POLICY IF EXISTS "Service role manages webhook secrets" ON public.webhook_secrets;
CREATE POLICY "Service role manages webhook secrets" ON public.webhook_secrets
    FOR ALL USING (true);
-- --------------------------------------------------------
-- MIGRATION: 004_users_refactor.sql
-- --------------------------------------------------------

-- 1. Safely add 'Manager' to user_role ENUM
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'Manager';

-- 2. Alter the users table (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'system_handle') THEN
        ALTER TABLE public.users ADD COLUMN system_handle TEXT UNIQUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'department') THEN
        ALTER TABLE public.users ADD COLUMN department TEXT;
    END IF;
END$$;

-- We initially allow NULL for existing users, but new constraints apply
-- 3. Add Regex Constraint for the system_handle (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_system_handle_format') THEN
        ALTER TABLE public.users
        ADD CONSTRAINT chk_system_handle_format 
        CHECK (
            system_handle IS NULL OR 
            -- Executive Pattern: [COMPANY]_[POSITION] e.g., ACME_CEO
            system_handle ~ '^[A-Z0-9]+_[A-Z0-9]+$' OR
            -- Standard Pattern: [COMPANY]_[DEPARTMENT]_[POSITION]_[NUMBER] e.g., ACME_FINANCE_ANALYST_01
            system_handle ~ '^[A-Z0-9]+_[A-Z0-9]+_[A-Z0-9]+_[0-9]+$'
        );
    END IF;
END$$;

-- 4. Create the Trigger Function
CREATE OR REPLACE FUNCTION public.parse_system_handle()
RETURNS TRIGGER AS $$
DECLARE
    parts TEXT[];
    company_name TEXT;
    parsed_department TEXT;
    parsed_position TEXT;
    derived_role user_role;
    found_company_id UUID;
BEGIN
    IF NEW.system_handle IS NOT NULL THEN
        parts := string_to_array(NEW.system_handle, '_');
        company_name := parts[1];

        -- Lookup Company ID based on prefix
        SELECT id INTO found_company_id FROM public.companies WHERE name ILIKE company_name LIMIT 1;
        
        IF found_company_id IS NULL THEN
            RAISE EXCEPTION 'Company matching handle prefix "%" not found.', company_name;
        END IF;

        NEW.company_id := found_company_id;

        -- Executive format: [COMPANY]_[POSITION]
        IF array_length(parts, 1) = 2 THEN
            parsed_position := parts[2];
            parsed_department := 'EXECUTIVE';
            derived_role := 'Admin';
        
        -- Standard format: [COMPANY]_[DEPARTMENT]_[POSITION]_[NUMBER]
        ELSIF array_length(parts, 1) = 4 THEN
            parsed_department := parts[2];
            parsed_position := parts[3];
            
            IF parsed_position LIKE '%MANAGER%' OR parsed_position LIKE '%LEAD%' OR parsed_position LIKE '%HEAD%' OR parsed_position LIKE '%DIRECTOR%' OR parsed_position LIKE '%VP%' THEN
                derived_role := 'Manager';
            ELSE
                derived_role := 'Employee';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid system_handle structure. Must be 2 or 4 parts.';
        END IF;

        -- Assign the parsed values
        NEW.department := parsed_department;
        NEW.role := derived_role;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Attach Trigger to Users Table
DROP TRIGGER IF EXISTS trigger_parse_system_handle ON public.users;
CREATE TRIGGER trigger_parse_system_handle
BEFORE INSERT OR UPDATE OF system_handle ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.parse_system_handle();
-- --------------------------------------------------------
-- MIGRATION: 005_agents_schema.sql
-- --------------------------------------------------------

-- Create the Agents Table
CREATE TABLE IF NOT EXISTS public.agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL,
    system_prompt_modifier TEXT,
    allowed_routes TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view agents within their own company
DROP POLICY IF EXISTS "Users can view agents in their company" ON public.agents;
CREATE POLICY "Users can view agents in their company" ON public.agents
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Policy: Admins can manage agents within their own company
DROP POLICY IF EXISTS "Admins can manage agents in their company" ON public.agents;
CREATE POLICY "Admins can manage agents in their company" ON public.agents
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
        AND (auth.jwt() ->> 'role') = 'Admin'
    );
-- --------------------------------------------------------
-- MIGRATION: 006_fix_executive_handle.sql
-- --------------------------------------------------------
-- Fixes the executive system_handle format from 2-part
-- (COMPANY_POSITION) to 3-part (COMPANY_POSITION_NUMBER).
-- Standard employee format remains 4-part unchanged.
-- --------------------------------------------------------

-- 1. Drop the old constraint
ALTER TABLE public.users
DROP CONSTRAINT IF EXISTS chk_system_handle_format;

-- 2. Re-create with corrected patterns
ALTER TABLE public.users
ADD CONSTRAINT chk_system_handle_format
CHECK (
    system_handle IS NULL OR
    -- Executive Pattern: [COMPANY]_[POSITION]_[NUMBER] e.g., ACME_CEO_01
    system_handle ~ '^[A-Z0-9]+_[A-Z0-9]+_[0-9]+$' OR
    -- Standard Pattern: [COMPANY]_[DEPARTMENT]_[POSITION]_[NUMBER] e.g., ACME_FINANCE_ANALYST_01
    system_handle ~ '^[A-Z0-9]+_[A-Z0-9]+_[A-Z0-9]+_[0-9]+$'
);

-- 3. Update the trigger function to handle 3-part executive handles
CREATE OR REPLACE FUNCTION public.parse_system_handle()
RETURNS TRIGGER AS $$
DECLARE
    parts TEXT[];
    company_name TEXT;
    parsed_department TEXT;
    parsed_position TEXT;
    derived_role user_role;
    found_company_id UUID;
BEGIN
    IF NEW.system_handle IS NOT NULL THEN
        parts := string_to_array(NEW.system_handle, '_');
        company_name := parts[1];

        -- Lookup Company ID based on prefix
        SELECT id INTO found_company_id FROM public.companies WHERE name ILIKE company_name LIMIT 1;
        
        IF found_company_id IS NULL THEN
            RAISE EXCEPTION 'Company matching handle prefix "%" not found.', company_name;
        END IF;

        NEW.company_id := found_company_id;

        -- Executive format: [COMPANY]_[POSITION]_[NUMBER] (3 parts)
        IF array_length(parts, 1) = 3 THEN
            parsed_position := parts[2];
            parsed_department := 'EXECUTIVE';
            derived_role := 'Admin';
        
        -- Standard format: [COMPANY]_[DEPARTMENT]_[POSITION]_[NUMBER] (4 parts)
        ELSIF array_length(parts, 1) = 4 THEN
            parsed_department := parts[2];
            parsed_position := parts[3];
            
            IF parsed_position LIKE '%MANAGER%' OR parsed_position LIKE '%LEAD%' OR parsed_position LIKE '%HEAD%' OR parsed_position LIKE '%DIRECTOR%' OR parsed_position LIKE '%VP%' THEN
                derived_role := 'Manager';
            ELSE
                derived_role := 'Employee';
            END IF;
        ELSE
            RAISE EXCEPTION 'Invalid system_handle structure. Must be 3 parts (executive) or 4 parts (standard).';
        END IF;

        -- Assign the parsed values
        NEW.department := parsed_department;
        NEW.role := derived_role;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Re-attach trigger (idempotent)
DROP TRIGGER IF EXISTS trigger_parse_system_handle ON public.users;
CREATE TRIGGER trigger_parse_system_handle
BEFORE INSERT OR UPDATE OF system_handle ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.parse_system_handle();
-- --------------------------------------------------------
-- MIGRATION: 007_tool_permissions.sql
-- --------------------------------------------------------
-- Creates the Tool Permission Matrix for RBAC governance.
-- Admins define which users/roles are authorized to use
-- specific tools from the Universal Registry.
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tool_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,  -- NULL = company-wide default
    role user_role,                                               -- NULL = applies to specific user
    tool_name TEXT NOT NULL,                                      -- e.g., 'process_payment'
    tool_category TEXT NOT NULL,                                  -- e.g., 'finance'
    is_allowed BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, user_id, tool_name)
);

-- Index for fast lookups during Sentinel validation
CREATE INDEX idx_tool_permissions_company ON public.tool_permissions(company_id);
CREATE INDEX idx_tool_permissions_user ON public.tool_permissions(company_id, user_id);
CREATE INDEX idx_tool_permissions_role ON public.tool_permissions(company_id, role);

-- Enable RLS
ALTER TABLE public.tool_permissions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their company's tool permissions
DROP POLICY IF EXISTS "Users can view tool permissions" ON public.tool_permissions;
CREATE POLICY "Users can view tool permissions" ON public.tool_permissions
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Policy: Only Admins can manage tool permissions
DROP POLICY IF EXISTS "Admins can manage tool permissions" ON public.tool_permissions;
CREATE POLICY "Admins can manage tool permissions" ON public.tool_permissions
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
        AND (auth.jwt() ->> 'role') = 'Admin'
    );
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

DROP POLICY IF EXISTS "Users can view their company document chunks" ON public.document_chunks;
CREATE POLICY "Users can view their company document chunks" ON public.document_chunks
    FOR SELECT USING (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

DROP POLICY IF EXISTS "Users can insert document chunks for their company" ON public.document_chunks;
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

-- ============================================================
-- 009: Document Drafts
-- ============================================================

-- Create the Document Drafts Table
CREATE TABLE IF NOT EXISTS public.document_drafts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL,
    original_document_id UUID,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'md',
    summary_of_changes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    user_comments TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.document_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view drafts in their company" ON public.document_drafts
    FOR SELECT USING (company_id = (auth.jwt() ->> 'company_id')::uuid);

CREATE POLICY "Users can manage drafts in their company" ON public.document_drafts
    FOR ALL USING (company_id = (auth.jwt() ->> 'company_id')::uuid);

-- ============================================================
-- 010: Brain Documents
-- ============================================================

CREATE TABLE IF NOT EXISTS public.brain_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    document_type TEXT NOT NULL DEFAULT 'md',
    content TEXT,
    metadata JSONB DEFAULT '{}',
    file_path TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_documents_company
    ON public.brain_documents(company_id);

ALTER TABLE public.brain_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view documents in their company" ON public.brain_documents
    FOR SELECT USING (company_id = (auth.jwt() ->> 'company_id')::uuid);

CREATE POLICY "Users can manage documents in their company" ON public.brain_documents
    FOR ALL USING (company_id = (auth.jwt() ->> 'company_id')::uuid);

-- ============================================================
-- 011: Chat Sessions & Chat History
-- ============================================================

DROP TABLE IF EXISTS public.chat_history CASCADE;
DROP TABLE IF EXISTS public.chat_sessions CASCADE;

CREATE TABLE public.chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    title TEXT NOT NULL DEFAULT 'New Chat',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE public.chat_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    sources JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_tenant ON public.chat_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON public.chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON public.chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_history_session ON public.chat_history(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_created ON public.chat_history(created_at ASC);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company sessions" ON public.chat_sessions
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can insert own company sessions" ON public.chat_sessions
    FOR INSERT WITH CHECK (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can update own company sessions" ON public.chat_sessions
    FOR UPDATE USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can view own company chat history" ON public.chat_history
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can insert own company chat history" ON public.chat_history
    FOR INSERT WITH CHECK (tenant_id = (auth.jwt() ->> 'company_id')::uuid);

CREATE OR REPLACE FUNCTION update_chat_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.chat_sessions SET updated_at = NOW() WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chat_history_update_session
    AFTER INSERT ON public.chat_history
    FOR EACH ROW
    EXECUTE FUNCTION update_chat_session_timestamp();

-- ============================================================
-- 012: Taxonomy Schema
-- ============================================================

ALTER TABLE public.document_chunks ADD COLUMN IF NOT EXISTS semantic_type TEXT;
ALTER TABLE public.document_chunks ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE public.document_chunks ADD COLUMN IF NOT EXISTS sub_type TEXT;

ALTER TABLE public.brain_documents ADD COLUMN IF NOT EXISTS semantic_type TEXT;
ALTER TABLE public.brain_documents ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE public.brain_documents ADD COLUMN IF NOT EXISTS sub_type TEXT;

CREATE TABLE IF NOT EXISTS public.decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    source_doc_id UUID REFERENCES public.brain_documents(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    made_by TEXT,
    date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

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

ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their company decisions" ON public.decisions
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can insert decisions for their company" ON public.decisions
    FOR INSERT WITH CHECK (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can update decisions for their company" ON public.decisions
    FOR UPDATE USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can delete decisions for their company" ON public.decisions
    FOR DELETE USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can view their company action_items" ON public.action_items
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can insert action_items for their company" ON public.action_items
    FOR INSERT WITH CHECK (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can update action_items for their company" ON public.action_items
    FOR UPDATE USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can delete action_items for their company" ON public.action_items
    FOR DELETE USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);

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

-- ============================================================
-- 013: Action Items Department
-- ============================================================

ALTER TABLE public.action_items ADD COLUMN IF NOT EXISTS department TEXT;

CREATE INDEX IF NOT EXISTS idx_action_items_department ON public.action_items(department);

-- ============================================================
-- 014: Contacts
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    contact_type TEXT NOT NULL DEFAULT 'client',
    company_name TEXT,
    email TEXT,
    phone TEXT,
    notes TEXT,
    source_doc_id UUID REFERENCES public.brain_documents(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view contacts in their company" ON public.contacts
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can manage contacts in their company" ON public.contacts
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON public.contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contacts_type ON public.contacts(contact_type);

-- ============================================================
-- 015: Proposed Automations
-- ============================================================

CREATE TABLE IF NOT EXISTS public.proposed_automations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    action_payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    source_doc_id UUID REFERENCES public.brain_documents(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.proposed_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view proposed automations in their company" ON public.proposed_automations
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can manage proposed automations in their company" ON public.proposed_automations
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);

CREATE INDEX IF NOT EXISTS idx_proposed_automations_tenant ON public.proposed_automations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_proposed_automations_status ON public.proposed_automations(status);

-- ============================================================
-- 016: Proactive Scheduler & Facts
-- ============================================================

CREATE TABLE IF NOT EXISTS public.proactive_suggestions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    source_entity_type TEXT,
    source_entity_id TEXT,
    metadata JSONB DEFAULT '{}',
    is_dismissed BOOLEAN DEFAULT false,
    is_viewed BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proactive_suggestions_tenant ON public.proactive_suggestions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_proactive_suggestions_user ON public.proactive_suggestions(user_id);
CREATE INDEX IF NOT EXISTS idx_proactive_suggestions_status ON public.proactive_suggestions(tenant_id, is_dismissed, is_viewed);
CREATE INDEX IF NOT EXISTS idx_proactive_suggestions_priority ON public.proactive_suggestions(tenant_id, priority, created_at DESC);

ALTER TABLE public.proactive_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view proactive suggestions in their company" ON public.proactive_suggestions
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can manage proactive suggestions in their company" ON public.proactive_suggestions
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);

CREATE TABLE IF NOT EXISTS public.scheduler_state (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE UNIQUE,
    last_full_scan TIMESTAMP WITH TIME ZONE,
    last_overdue_scan TIMESTAMP WITH TIME ZONE,
    last_cross_doc_scan TIMESTAMP WITH TIME ZONE,
    last_deadline_scan TIMESTAMP WITH TIME ZONE,
    scan_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.scheduler_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages scheduler state" ON public.scheduler_state
    FOR ALL USING (true);

CREATE TABLE IF NOT EXISTS public.key_facts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    session_id TEXT,
    fact TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    confidence FLOAT DEFAULT 0.8,
    source_message TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_key_facts_tenant_user ON public.key_facts(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_key_facts_active ON public.key_facts(tenant_id, user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_key_facts_category ON public.key_facts(tenant_id, category);

ALTER TABLE public.key_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view key facts in their company" ON public.key_facts
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can manage key facts in their company" ON public.key_facts
    FOR ALL USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);

-- ============================================================
-- 017: Onboarding Type & Company Profile Fields
-- ============================================================

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS onboarding_type TEXT CHECK (onboarding_type IN ('new_company', 'existing_company'));

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS company_stage TEXT,
  ADD COLUMN IF NOT EXISTS mission_vision TEXT,
  ADD COLUMN IF NOT EXISTS target_customer TEXT,
  ADD COLUMN IF NOT EXISTS competitors TEXT;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS current_tools TEXT,
  ADD COLUMN IF NOT EXISTS pain_points TEXT;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS employee_count TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS founded_year INTEGER,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS x_url TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_url TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_companies_onboarding_type ON public.companies(onboarding_type);

-- ============================================================
-- 018: Agent System (Executions, Outputs, Company Insights)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    agent_type TEXT NOT NULL,
    agent_label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    icon TEXT DEFAULT 'bot',
    color TEXT DEFAULT '#6366f1',
    priority INTEGER DEFAULT 0,
    conversation_history JSONB DEFAULT '[]',
    current_question TEXT,
    current_question_id TEXT,
    output_data JSONB DEFAULT '{}',
    output_summary TEXT,
    progress_pct INTEGER DEFAULT 0,
    current_action TEXT,
    error_message TEXT,
    iterations INTEGER DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_executions_company ON public.agent_executions(company_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_status ON public.agent_executions(company_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_executions_type ON public.agent_executions(company_id, agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_executions_created ON public.agent_executions(company_id, created_at DESC);

ALTER TABLE public.agent_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view agent executions in their company" ON public.agent_executions
    FOR SELECT USING (company_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can manage agent executions in their company" ON public.agent_executions
    FOR ALL USING (company_id = (auth.jwt() ->> 'company_id')::uuid);

CREATE TABLE IF NOT EXISTS public.agent_outputs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_execution_id UUID NOT NULL REFERENCES public.agent_executions(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    output_type TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    content JSONB DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending_approval',
    feedback TEXT,
    approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    stored_in_brain BOOLEAN DEFAULT false,
    brain_document_id UUID REFERENCES public.brain_documents(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    approved_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_outputs_company ON public.agent_outputs(company_id);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_status ON public.agent_outputs(company_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_execution ON public.agent_outputs(agent_execution_id);
CREATE INDEX IF NOT EXISTS idx_agent_outputs_type ON public.agent_outputs(company_id, output_type);

ALTER TABLE public.agent_outputs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view agent outputs in their company" ON public.agent_outputs
    FOR SELECT USING (company_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can manage agent outputs in their company" ON public.agent_outputs
    FOR ALL USING (company_id = (auth.jwt() ->> 'company_id')::uuid);

CREATE TABLE IF NOT EXISTS public.company_insights (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    insight_type TEXT NOT NULL,
    source_url TEXT,
    source_label TEXT,
    summary TEXT NOT NULL,
    details JSONB DEFAULT '{}',
    confidence FLOAT DEFAULT 0.8,
    tags TEXT[] DEFAULT '{}',
    is_reviewed BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_insights_company ON public.company_insights(company_id);
CREATE INDEX IF NOT EXISTS idx_company_insights_type ON public.company_insights(company_id, insight_type);
CREATE INDEX IF NOT EXISTS idx_company_insights_reviewed ON public.company_insights(company_id, is_reviewed);

ALTER TABLE public.company_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view company insights in their company" ON public.company_insights
    FOR SELECT USING (company_id = (auth.jwt() ->> 'company_id')::uuid);
CREATE POLICY "Users can manage company insights in their company" ON public.company_insights
    FOR ALL USING (company_id = (auth.jwt() ->> 'company_id')::uuid);
