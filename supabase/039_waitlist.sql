-- Migration: 039_waitlist.sql
-- Create waitlist table for early access signups

CREATE TABLE IF NOT EXISTS public.waitlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT NOT NULL UNIQUE,
    source TEXT DEFAULT 'marketing_site',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row-Level Security
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Allow anonymous inserts so anyone can sign up on the landing page
DROP POLICY IF EXISTS "allow_anon_inserts" ON public.waitlist;
CREATE POLICY "allow_anon_inserts" ON public.waitlist
    FOR INSERT WITH CHECK (true);

-- Allow authenticated Admins to view the waitlist
DROP POLICY IF EXISTS "allow_admin_select" ON public.waitlist;
CREATE POLICY "allow_admin_select" ON public.waitlist
    FOR SELECT USING (
        auth.role() = 'authenticated' AND 
        EXISTS (
            SELECT 1 FROM public.users 
            WHERE id = auth.uid() AND role = 'Admin'
        )
    );
