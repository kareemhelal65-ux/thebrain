const { Client } = require('pg');
const connectionString = 'postgresql://postgres.cefluyeljkohdcylgsms:E7na%40ELshilla@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function run() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const res = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'chat_history';
    `);
    console.log('chat_history columns:', JSON.stringify(res.rows, null, 2));

    const res2 = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'chat_sessions';
    `);
    console.log('chat_sessions columns:', JSON.stringify(res2.rows, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await client.end();
  }
}

run();
