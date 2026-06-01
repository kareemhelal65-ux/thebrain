require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  try {
    console.log('Querying database via Supabase SDK...');
    
    console.log('\n--- brain_documents ---');
    const { data: docs, error: docsErr } = await supabase
      .from('brain_documents')
      .select('id, title, document_type, file_path, department, semantic_type, sub_type, created_at')
      .order('created_at', { ascending: false });
      
    if (docsErr) throw docsErr;
    console.log(JSON.stringify(docs, null, 2));

    // Done listing documents
    return;

  } catch (err) {
    console.error('Error querying:', err.message);
  }
}

run();
