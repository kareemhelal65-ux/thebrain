require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  try {
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('*');
    if (usersErr) throw usersErr;
    console.log('USERS:', users);

    const { data: companies, error: compsErr } = await supabase
      .from('companies')
      .select('*');
    if (compsErr) throw compsErr;
    console.log('COMPANIES:', companies);

  } catch (err) {
    console.error('Error:', err.message);
  }
}

run();
