const { Client } = require('pg');

const connectionString = 'postgresql://postgres.cefluyeljkohdcylgsms:E7na%40ELshilla@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function addSocialColumns() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected to database. Checking columns...');

    await client.query(`
      ALTER TABLE public.companies
        ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
        ADD COLUMN IF NOT EXISTS x_url TEXT,
        ADD COLUMN IF NOT EXISTS instagram_url TEXT,
        ADD COLUMN IF NOT EXISTS tiktok_url TEXT;
    `);

    console.log('✅ Social profile URL columns added successfully.');
  } catch (error) {
    console.error('❌ Error executing migration:', error.message);
  } finally {
    await client.end();
  }
}

addSocialColumns();
