const { Client } = require('pg');
const connectionString = 'postgresql://postgres.cefluyeljkohdcylgsms:E7na%40ELshilla@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

async function run() {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected to database.');
    
    // Check columns of action_items
    const columnsRes = await client.query(`
      SELECT column_name, udt_name, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'action_items';
    `);
    console.log('--- action_items Columns ---');
    console.log(columnsRes.rows);

    // List any check or foreign keys or tables in public schema
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public';
    `);
    console.log('--- Tables in Public Schema ---');
    console.log(tablesRes.rows.map(r => r.table_name));

  } catch (err) {
    console.error('Error querying schema:', err.message);
  } finally {
    await client.end();
  }
}

run();
