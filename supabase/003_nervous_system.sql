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
CREATE TABLE public.company_services (
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
CREATE INDEX idx_company_services_company ON public.company_services(company_id);
CREATE INDEX idx_company_services_category ON public.company_services(company_id, category);

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
CREATE INDEX idx_audit_execution_token ON public.audit_logs(execution_token);

-- ============================================================
-- Meeting Records
-- Stores transcripts and extracted insights from virtual and
-- physical meetings. Insights are indexed into Vector DB.
-- ============================================================
CREATE TABLE public.meetings (
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

CREATE INDEX idx_meetings_company ON public.meetings(company_id);
CREATE INDEX idx_meetings_source ON public.meetings(company_id, source_type);

-- ============================================================
-- Webhook Secrets (per company, per provider)
-- Used by WebhookAuthenticator to verify inbound webhook signatures
-- Secrets are AES-256-GCM encrypted
-- ============================================================
CREATE TABLE public.webhook_secrets (
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
CREATE POLICY "Users can view their company services" ON public.company_services
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Admins can manage company services" ON public.company_services
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Meetings: users can only see their own company's meetings
CREATE POLICY "Users can view their company meetings" ON public.meetings
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can insert meetings for their company" ON public.meetings
    FOR INSERT WITH CHECK (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Webhook Secrets: only admins via service role
CREATE POLICY "Service role manages webhook secrets" ON public.webhook_secrets
    FOR ALL USING (true);
