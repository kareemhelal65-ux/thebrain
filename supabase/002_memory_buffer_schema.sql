-- Create Conversation Memory Table
CREATE TABLE public.conversation_memory (
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
CREATE POLICY "Users can view memory for their company" ON public.conversation_memory
    FOR SELECT USING (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );

-- Policy to allow users to insert memory for their company
CREATE POLICY "Users can insert memory for their company" ON public.conversation_memory
    FOR INSERT WITH CHECK (
        company_id = (auth.jwt() ->> 'company_id')::uuid
    );
