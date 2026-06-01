const { Client } = require('pg');
const connectionString = 'postgresql://postgres.cefluyeljkohdcylgsms:E7na%40ELshilla@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function run() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const res2 = await client.query(`
      SELECT proname, oidvectortypes(proargtypes) as argtypes
      FROM pg_proc
      WHERE proname = 'match_documents';
    `);
    console.log('pg_proc functions:', JSON.stringify(res2.rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

run();
