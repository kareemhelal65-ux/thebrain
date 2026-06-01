-- --------------------------------------------------------
-- MIGRATION: 007_tool_permissions.sql
-- --------------------------------------------------------
-- Creates the Tool Permission Matrix for RBAC governance.
-- Admins define which users/roles are authorized to use
-- specific tools from the Universal Registry.
-- --------------------------------------------------------

CREATE TABLE public.tool_permissions (
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
CREATE POLICY "Users can view tool permissions" ON public.tool_permissions
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Policy: Only Admins can manage tool permissions
CREATE POLICY "Admins can manage tool permissions" ON public.tool_permissions
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
        AND (auth.jwt() ->> 'role') = 'Admin'
    );
