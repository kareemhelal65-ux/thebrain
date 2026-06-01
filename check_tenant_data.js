require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const t1 = 'dfb6e485-f543-47f8-8452-f05547ad57cd'; // kareemhelal65
  const t2 = '1a113a28-7dcc-4c52-8d23-ff0b7d807602'; // kareemhelal63

  console.log('--- DOCUMENTS FOR BOTH TENANTS ---');
  const { data: d1 } = await supabase.from('brain_documents').select('id, title, company_id').eq('company_id', t1);
  const { data: d2 } = await supabase.from('brain_documents').select('id, title, company_id').eq('company_id', t2);
  console.log(`Tenant 1 (${t1}):`, d1);
  console.log(`Tenant 2 (${t2}):`, d2);

  console.log('\n--- DECISIONS FOR BOTH TENANTS ---');
  const { data: dec1 } = await supabase.from('decisions').select('id, text, tenant_id').eq('tenant_id', t1);
  const { data: dec2 } = await supabase.from('decisions').select('id, text, tenant_id').eq('tenant_id', t2);
  console.log(`Tenant 1 (${t1}):`, dec1);
  console.log(`Tenant 2 (${t2}):`, dec2);

  console.log('\n--- ACTION ITEMS FOR BOTH TENANTS ---');
  const { data: a1 } = await supabase.from('action_items').select('id, task, tenant_id').eq('tenant_id', t1);
  const { data: a2 } = await supabase.from('action_items').select('id, task, tenant_id').eq('tenant_id', t2);
  console.log(`Tenant 1 (${t1}):`, a1);
  console.log(`Tenant 2 (${t2}):`, a2);

  console.log('\n--- PROPOSED AUTOMATIONS FOR BOTH TENANTS ---');
  const { data: auto1 } = await supabase.from('proposed_automations').select('id, type, description, tenant_id').eq('tenant_id', t1);
  const { data: auto2 } = await supabase.from('proposed_automations').select('id, type, description, tenant_id').eq('tenant_id', t2);
  console.log(`Tenant 1 (${t1}):`, auto1);
  console.log(`Tenant 2 (${t2}):`, auto2);
}

run();
