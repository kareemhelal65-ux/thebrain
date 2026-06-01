const supabase = require('./src/models/supabaseClient');
const { executeAgentWork } = require('./src/services/agentOrchestrator');

async function main() {
  const executionId = 'f58f03bb-307d-421a-8724-54026c873e12';
  
  // 1. Fetch current execution
  const { data: exec, error: fetchErr } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('id', executionId)
    .single();

  if (fetchErr || !exec) {
    console.error('Failed to fetch execution:', fetchErr?.message);
    return;
  }

  const cleanHistory = [
    {
      role: 'assistant',
      content: 'What stage of funding are you pursuing?',
      timestamp: '2026-05-28T11:34:36.756Z'
    },
    {
      role: 'user',
      content: 'Pre-seed',
      timestamp: '2026-05-28T11:34:36.756Z'
    },
    {
      role: 'user',
      content: 'i need you to compile me a list of angel investors and VCs that would be willing to invest in my startup',
      timestamp: '2026-05-28T17:09:42.363Z'
    },
    {
      role: 'assistant',
      content: 'Which investor profile should we prioritize for the list of potential backers for The Brain AIOS?',
      timestamp: new Date().toISOString()
    },
    {
      role: 'user',
      content: 'Angel investors and early-stage VCs focused on AI/ML SaaS startups in the MENA region (Middle East & North Africa)',
      timestamp: new Date().toISOString()
    }
  ];

  // Get company profile
  const { data: companyProfile } = await supabase
    .from('companies')
    .select('*')
    .eq('id', exec.company_id)
    .single();

  // Get user
  const { data: userRecord } = await supabase
    .from('users')
    .select('*')
    .eq('id', '90607449-a597-4bc9-a92b-6d8e60c67243')
    .single();

  const user = {
    id: userRecord.id,
    company_id: userRecord.company_id,
    role: userRecord.role || 'Admin',
    department: userRecord.department || 'general'
  };

  console.log('Resetting execution run status to running...');
  await supabase
    .from('agent_executions')
    .update({
      status: 'running',
      current_action: 'Researching MENA VC and angel investor networks...',
      error_message: null,
      conversation_history: cleanHistory,
      progress_pct: 35,
      updated_at: new Date().toISOString()
    })
    .eq('id', executionId);

  console.log('Triggering background execution loop (with search cap & convergence fixes)...');
  executeAgentWork(executionId, companyProfile, user, cleanHistory)
    .then(() => console.log('✅ Background execution complete.'))
    .catch(err => console.error('❌ Background execution failed:', err.message));
}

main();
