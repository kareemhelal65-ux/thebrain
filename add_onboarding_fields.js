const { Client } = require('pg');

const connectionString = 'postgresql://postgres.cefluyeljkohdcylgsms:E7na%40ELshilla@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function addCompanyFields() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected. Adding company onboarding fields...');

    await client.query(`
      ALTER TABLE public.companies
        ADD COLUMN IF NOT EXISTS industry TEXT,
        ADD COLUMN IF NOT EXISTS location TEXT,
        ADD COLUMN IF NOT EXISTS employee_count TEXT,
        ADD COLUMN IF NOT EXISTS description TEXT,
        ADD COLUMN IF NOT EXISTS website TEXT,
        ADD COLUMN IF NOT EXISTS founded_year INTEGER,
        ADD COLUMN IF NOT EXISTS onboarding_complete BOOLEAN DEFAULT false;
    `);

    console.log('✅ Company onboarding fields added successfully.');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

addCompanyFields();
