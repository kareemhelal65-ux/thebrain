-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create Enum for Roles
CREATE TYPE user_role AS ENUM ('Admin', 'Employee');

-- Create Companies Table
CREATE TABLE public.companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Users Table
CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), -- Could reference auth.users if using Supabase Auth
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    role user_role NOT NULL DEFAULT 'Employee',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create Audit Logs Table
CREATE TABLE public.audit_logs (
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
CREATE POLICY "Users can view their own company" ON public.companies
    FOR SELECT USING (
        id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Policies for Users
CREATE POLICY "Users can view users in their company" ON public.users
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Policies for Audit Logs
CREATE POLICY "Users can view audit logs for their company" ON public.audit_logs
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

CREATE POLICY "Users can insert audit logs for their company" ON public.audit_logs
    FOR INSERT WITH CHECK (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Note: If using Service Role key in the Node backend, RLS is automatically bypassed, 
-- and the backend enforces the `company_id` isolation manually via RBAC middleware.
