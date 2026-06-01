const { Client } = require('pg');
const client = new Client('postgresql://postgres.cefluyeljkohdcylgsms:E7na%40ELshilla@aws-1-eu-central-1.pooler.supabase.com:6543/postgres');

async function run() {
  try {
    await client.connect();
    
    // First, verify the column names before dropping/renaming
    const res = await client.query(`
      ALTER TABLE public.agents RENAME COLUMN company_id TO tenant_id;
      ALTER TABLE public.agents RENAME COLUMN agent_name TO name;
      ALTER TABLE public.agents RENAME COLUMN system_prompt_modifier TO system_prompt;
      ALTER TABLE public.agents RENAME COLUMN allowed_routes TO tools;
      ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'Assistant';
    `);
    console.log('Successfully altered agents schema');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

run();
