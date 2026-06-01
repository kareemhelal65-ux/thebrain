const supabase = require('./src/models/supabaseClient');

async function main() {
  // Get failed execution
  const { data: exec, error: err1 } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', 'f58f03bb-307d-421a-8724-54026c873e12')
    .single();

  if (err1) {
    console.error('Error fetching failed execution:', err1.message);
    return;
  }

  console.log('Execution:', exec);

  // Get company
  const { data: company, error: err2 } = await supabase
    .from('companies')
    .select('*')
    .eq('id', exec.company_id)
    .single();

  if (err2) {
    console.error('Error fetching company:', err2.message);
    return;
  }

  console.log('Company:', company);

  // Get users
  const { data: users, error: err3 } = await supabase
    .from('users')
    .select('*')
    .limit(5);

  if (err3) {
    console.error('Error fetching users:', err3.message);
  } else {
    console.log('Users:', users);
  }
}

main();
