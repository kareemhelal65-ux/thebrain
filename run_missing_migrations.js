const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = 'postgresql://postgres.cefluyeljkohdcylgsms:E7na%40ELshilla@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function runMissing() {
  const client = new Client({ connectionString });
  try {
    console.log('Connecting to Supabase...');
    await client.connect();

    const missingFiles = [
      '036_department_settings.sql',
      '037_marketing_strategy.sql',
      '038_member_evaluations_candidates.sql',
      '039_waitlist.sql'
    ];

    const dir = path.join(__dirname, 'supabase');
    for (const file of missingFiles) {
      console.log(`Running migration: ${file}...`);
      const sqlPath = path.join(dir, file);
      if (!fs.existsSync(sqlPath)) {
        console.warn(`File ${file} not found!`);
        continue;
      }
      const sql = fs.readFileSync(sqlPath, 'utf8');
      try {
        await client.query(sql);
        console.log(`✅ Successfully executed ${file}`);
      } catch (err) {
        console.error(`❌ Error in ${file}:`, err.message);
      }
    }
  } catch (error) {
    console.error('Connection error:', error.message);
  } finally {
    await client.end();
  }
}

runMissing();
