-- --------------------------------------------------------
-- MIGRATION: 014_contacts.sql
-- Creates contacts table for CRM context layer
-- --------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    contact_type TEXT NOT NULL DEFAULT 'client',  -- client, vendor, partner, investor
    company_name TEXT,
    email TEXT,
    phone TEXT,
    notes TEXT,
    source_doc_id UUID REFERENCES public.brain_documents(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view contacts in their company" ON public.contacts
    FOR SELECT USING (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can manage contacts in their company" ON public.contacts
    FOR ALL USING (
        tenant_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON public.contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contacts_type ON public.contacts(contact_type);
