require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  try {
    const { data: { users }, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;
    console.log('AUTH USERS:');
    users.forEach(u => {
      console.log(`ID: ${u.id}, Email: ${u.email}, Metadata:`, JSON.stringify(u.user_metadata), 'AppMetadata:', JSON.stringify(u.app_metadata));
    });
  } catch (err) {
    console.error('Error:', err.message);
  }
}

run();
