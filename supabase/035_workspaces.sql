-- ============================================================
-- MIGRATION: 035_workspaces.sql
-- Phase C2: the engineering agent's real coding workspace. A workspace is a
-- per-run project directory on disk; text files are mirrored here for durability
-- (Render disk is ephemeral) and to drive the code_project preview.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.workspaces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    agent_execution_id UUID,
    name TEXT,
    project_type TEXT,          -- 'static' | 'node' | 'vite' | 'next' | …
    dev_command TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.workspace_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    content TEXT,
    is_binary BOOLEAN DEFAULT false,
    storage_key TEXT,           -- Supabase Storage key for binaries (Phase C2 later)
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (workspace_id, path)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_company ON public.workspaces(company_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_execution ON public.workspaces(agent_execution_id);
CREATE INDEX IF NOT EXISTS idx_workspace_files_ws ON public.workspace_files(workspace_id);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_isolation_workspaces" ON public.workspaces;
CREATE POLICY "company_isolation_workspaces" ON public.workspaces
    FOR ALL USING (company_id = (auth.jwt() ->> 'company_id')::uuid);

DROP POLICY IF EXISTS "company_isolation_workspace_files" ON public.workspace_files;
CREATE POLICY "company_isolation_workspace_files" ON public.workspace_files
    FOR ALL USING (
        workspace_id IN (SELECT id FROM public.workspaces WHERE company_id = (auth.jwt() ->> 'company_id')::uuid)
    );
