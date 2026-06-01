const { Client } = require('pg');

const connectionString = 'postgresql://postgres.cefluyeljkohdcylgsms:E7na%40ELshilla@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function migrateChatSessions() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected. Creating chat_sessions table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.chat_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_chat_sessions_user
        ON public.chat_sessions (user_id, created_at DESC);

      -- Add session_id to chat_history
      ALTER TABLE public.chat_history 
      ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.chat_sessions(id) ON DELETE CASCADE;

      -- Optional: Create a default session for existing orphans
      -- We'll just leave existing orphans with null session_id or they can be ignored by the UI.
    `);

    console.log('✅ chat_sessions migration complete.');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

migrateChatSessions();
