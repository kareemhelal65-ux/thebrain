require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  try {
    const { data, error } = await supabase
      .from('action_items')
      .select(`
        id,
        task,
        assignee,
        due_date,
        status,
        department,
        created_at,
        source_doc_id,
        sub_tasks,
        brain_documents(id, title, document_type)
      `)
      .limit(5);
    if (error) throw error;
    console.log('Action items with docs:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

run();
