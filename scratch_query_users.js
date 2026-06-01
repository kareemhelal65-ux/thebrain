require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  try {
    const { data: users, error } = await supabase
      .from('users')
      .select('*');
    if (error) throw error;
    console.log('USERS:');
    console.log(JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

run();
