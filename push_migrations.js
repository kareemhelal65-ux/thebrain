const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = 'postgresql://postgres.cefluyeljkohdcylgsms:E7na%40ELshilla@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function runMigrations() {
  const client = new Client({
    connectionString,
  });

  try {
    console.log('Connecting to Supabase...');
    await client.connect();

    console.log('Reading migration file...');
    const sqlPath = path.join(__dirname, 'supabase', 'combined_migrations.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Executing migrations... (this might take a few seconds)');
    await client.query(sql);

    console.log('✅ Successfully pushed all migrations to Supabase!');
  } catch (error) {
    console.error('❌ Error executing migrations:', error.message);
  } finally {
    await client.end();
  }
}

runMigrations();
