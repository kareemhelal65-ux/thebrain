-- --------------------------------------------------------
-- MIGRATION: 011_chat_sessions.sql
-- Creates the chat_sessions and chat_history tables
-- Required for persistent chat conversations
-- --------------------------------------------------------

-- Drop existing tables if they were partially created
DROP TABLE IF EXISTS public.chat_history CASCADE;
DROP TABLE IF EXISTS public.chat_sessions CASCADE;

-- Chat Sessions — one per conversation thread
CREATE TABLE public.chat_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    title TEXT NOT NULL DEFAULT 'New Chat',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat History — individual messages within a session
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

-- Indexes for fast lookups
CREATE INDEX idx_chat_sessions_tenant ON public.chat_sessions(tenant_id);
CREATE INDEX idx_chat_sessions_user ON public.chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_updated ON public.chat_sessions(updated_at DESC);
CREATE INDEX idx_chat_history_session ON public.chat_history(session_id);
CREATE INDEX idx_chat_history_created ON public.chat_history(created_at ASC);

-- Enable RLS
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;

-- RLS: Users can only see their own company's sessions
CREATE POLICY "Users can view own company sessions" ON public.chat_sessions
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);

CREATE POLICY "Users can insert own company sessions" ON public.chat_sessions
    FOR INSERT WITH CHECK (tenant_id = (auth.jwt() ->> 'company_id')::uuid);

CREATE POLICY "Users can update own company sessions" ON public.chat_sessions
    FOR UPDATE USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);

-- RLS: Users can only see their own company's chat history
CREATE POLICY "Users can view own company chat history" ON public.chat_history
    FOR SELECT USING (tenant_id = (auth.jwt() ->> 'company_id')::uuid);

CREATE POLICY "Users can insert own company chat history" ON public.chat_history
    FOR INSERT WITH CHECK (tenant_id = (auth.jwt() ->> 'company_id')::uuid);

-- Update trigger to keep updated_at current on sessions
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
