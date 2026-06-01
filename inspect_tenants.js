require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  try {
    console.log('--- USERS ---');
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('*');
    if (usersErr) throw usersErr;
    console.log(JSON.stringify(users, null, 2));

    console.log('\n--- COMPANIES ---');
    const { data: companies, error: compsErr } = await supabase
      .from('companies')
      .select('*');
    if (compsErr) throw compsErr;
    console.log(JSON.stringify(companies, null, 2));

    console.log('\n--- BRAIN DOCUMENTS ---');
    const { data: docs, error: docsErr } = await supabase
      .from('brain_documents')
      .select('*');
    if (docsErr) throw docsErr;
    console.log(JSON.stringify(docs, null, 2));

    console.log('\n--- DECISIONS ---');
    const { data: decs, error: decsErr } = await supabase
      .from('decisions')
      .select('*');
    if (decsErr) throw decsErr;
    console.log(JSON.stringify(decs, null, 2));

    console.log('\n--- ACTION ITEMS ---');
    const { data: actions, error: actionsErr } = await supabase
      .from('action_items')
      .select('*');
    if (actionsErr) throw actionsErr;
    console.log(JSON.stringify(actions, null, 2));

  } catch (err) {
    console.error('Error querying:', err.message);
  }
}

run();
