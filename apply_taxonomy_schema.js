const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = 'postgresql://postgres.cefluyeljkohdcylgsms:E7na%40ELshilla@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function run() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected to Supabase. Reading migration SQL...');

    const sqlPath = path.join(__dirname, 'supabase', '012_taxonomy_schema.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Applying 012_taxonomy_schema.sql...');
    await client.query(sql);

    console.log('✅ Successfully applied taxonomy database migrations!');
  } catch (err) {
    console.error('❌ Error applying migrations:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
