require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  try {
    const { data: docs, error } = await supabase
      .from('brain_documents')
      .select('id, title, file_path, company_id, document_type');
    if (error) throw error;
    console.log('DOCUMENTS:');
    console.log(JSON.stringify(docs, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

run();
