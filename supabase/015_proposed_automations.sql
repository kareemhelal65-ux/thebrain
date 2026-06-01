-- --------------------------------------------------------
-- MIGRATION: 015_proposed_automations.sql
-- Creates proposed_automations table for Proactivity Engine
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.proposed_automations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    type TEXT NOT NULL,  -- email, slack, calendar, document
    description TEXT NOT NULL,
    action_payload JSONB NOT NULL, -- structured data to execute the action (e.g. email details, slack message details)
    status TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, rejected
    source_doc_id UUID REFERENCES public.brain_documents(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.proposed_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view proposed automations in their company" ON public.proposed_automations
    FOR SELECT USING (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can manage proposed automations in their company" ON public.proposed_automations
    FOR ALL USING (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_proposed_automations_tenant ON public.proposed_automations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_proposed_automations_status ON public.proposed_automations(status);
CREATE INDEX IF NOT EXISTS idx_proposed_automations_source ON public.proposed_automations(source_doc_id);
