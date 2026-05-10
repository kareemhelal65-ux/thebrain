-- --------------------------------------------------------
-- MIGRATION: 005_agents_schema.sql
-- --------------------------------------------------------

-- Create the Agents Table
CREATE TABLE public.agents (
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
CREATE POLICY "Users can view agents in their company" ON public.agents
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Policy: Admins can manage agents within their own company
CREATE POLICY "Admins can manage agents in their company" ON public.agents
    FOR ALL USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
        AND (auth.jwt() ->> 'role') = 'Admin'
    );
