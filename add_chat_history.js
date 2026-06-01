const { Client } = require('pg');

const connectionString = 'postgresql://postgres.cefluyeljkohdcylgsms:E7na%40ELshilla@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function createChatHistory() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected. Creating chat_history table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.chat_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES public.companies(id),
        user_id UUID NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        sources JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_chat_history_tenant
        ON public.chat_history (tenant_id, created_at DESC);
      
      CREATE INDEX IF NOT EXISTS idx_chat_history_user
        ON public.chat_history (user_id, created_at DESC);
    `);

    console.log('✅ chat_history table created.');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

createChatHistory();
