const { Client } = require('pg');

const connectionString = 'postgresql://postgres.cefluyeljkohdcylgsms:E7na%40ELshilla@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function migrateOAuth() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected. Creating oauth_credentials table...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.oauth_credentials (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        provider TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        expires_at TIMESTAMPTZ,
        scopes JSONB,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(tenant_id, provider) -- One active connection per provider per company for now
      );

      CREATE INDEX IF NOT EXISTS idx_oauth_tenant
        ON public.oauth_credentials (tenant_id, provider);
    `);

    console.log('✅ oauth_credentials migration complete.');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

migrateOAuth();
