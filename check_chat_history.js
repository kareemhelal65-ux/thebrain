require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  try {
    console.log('Querying document_drafts table...');
    const { data: drafts, error } = await supabase
      .from('document_drafts')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    console.log(`Found ${drafts.length} drafts:`);
    console.log(JSON.stringify(drafts, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

run();

