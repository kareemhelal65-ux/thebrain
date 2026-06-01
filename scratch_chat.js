require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  try {
    console.log('Querying chat_history table for uploads/marketing...');
    const { data: messages, error } = await supabase
      .from('chat_history')
      .select('*')
      .or('content.ilike.%uploads%,content.ilike.%marketing%')
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    console.log(`Found ${messages.length} messages:`);
    messages.slice(0, 3).forEach((msg, idx) => {
      console.log(`\n[${idx + 1}] Role: ${msg.role} | Created: ${msg.created_at} | Session: ${msg.session_id}`);
      console.log(`Content: ${msg.content.substring(0, 1000)}${msg.content.length > 1000 ? '...' : ''}`);
    });
  } catch (err) {
    console.error('Error:', err.message);
  }
}

run();
