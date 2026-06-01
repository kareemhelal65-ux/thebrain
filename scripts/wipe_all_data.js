/**
 * Wipe All Data Script
 *
 * Deletes ALL companies, users, and their associated data from the database.
 * Also deletes auth.users records from Supabase Auth.
 *
 * ⚠️ DESTRUCTIVE — This cannot be undone.
 *
 * Run: node scripts/wipe_all_data.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function wipeAll() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║              WIPE ALL DATA — STARTING                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ─── Step 1: Count what we're about to delete ───
  console.log('📊 Pre-deletion counts:\n');

  const tables = [
    'companies', 'users', 'decisions', 'action_items', 'brain_documents',
    'document_chunks', 'meetings', 'contacts', 'proposed_automations',
    'proactive_suggestions', 'key_facts', 'scheduler_state',
    'agent_executions', 'agent_outputs', 'company_insights',
    'chat_sessions', 'chat_history', 'document_drafts', 'agents',
    'tool_permissions', 'company_services', 'webhook_secrets',
    'conversation_memory', 'audit_logs', 'oauth_credentials'
  ];

  const counts = {};
  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    counts[table] = error ? `❌ ${error.message}` : count;
    console.log(`  ${table.padEnd(25)} ${counts[table]}`);
  }

  // Count auth users
  const { data: authUsers, error: authCountErr } = await supabase.auth.admin.listUsers();
  const authUserCount = authCountErr ? `❌ ${authCountErr.message}` : authUsers.users.length;
  console.log(`  ${'auth.users'.padEnd(25)} ${authUserCount}`);

  console.log('\n');

  // ─── Step 2: Delete auth users first (bypasses FK constraints) ───
  console.log('🗑️  Step 1/3: Deleting auth.users (Supabase Auth)...');
  let deletedAuth = 0;
  let authErrors = 0;
  if (authUsers && authUsers.users) {
    for (const user of authUsers.users) {
      const { error } = await supabase.auth.admin.deleteUser(user.id);
      if (error) {
        console.error(`  ❌ Failed to delete auth user ${user.id.substring(0, 8)}…: ${error.message}`);
        authErrors++;
      } else {
        deletedAuth++;
      }
    }
  }
  console.log(`  ✅ Deleted ${deletedAuth} auth users.${authErrors > 0 ? ` (${authErrors} errors)` : ''}\n`);

  // ─── Step 3: Delete all companies (CASCADE handles everything else) ───
  console.log('🗑️  Step 2/3: Deleting all companies (CASCADE will clean up child tables)...');
  const { data: companies, error: listErr } = await supabase
    .from('companies')
    .select('id');

  if (listErr) {
    console.error(`  ❌ Failed to list companies: ${listErr.message}`);
  } else {
    console.log(`  Found ${companies.length} companies to delete.`);
    for (const company of companies) {
      const { error } = await supabase
        .from('companies')
        .delete()
        .eq('id', company.id);
      if (error) {
        console.error(`  ❌ Failed to delete company ${company.id.substring(0, 8)}…: ${error.message}`);
      }
    }
    console.log(`  ✅ Deleted ${companies.length} companies.\n`);
  }

  // ─── Step 4: Verify everything is clean ───
  console.log('🔍 Step 3/3: Verifying cleanup...\n');
  let allClean = true;
  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`  ⚠️  ${table.padEnd(25)} Could not verify: ${error.message}`);
    } else if (count > 0) {
      console.log(`  ❌ ${table.padEnd(25)} ${count} rows REMAINING`);
      allClean = false;
    } else {
      console.log(`  ✅ ${table.padEnd(25)} 0 rows`);
    }
  }

  // Verify auth users
  const { data: remainingAuth } = await supabase.auth.admin.listUsers();
  const remainingCount = remainingAuth?.users?.length || 0;
  if (remainingCount > 0) {
    console.log(`  ❌ ${'auth.users'.padEnd(25)} ${remainingCount} users REMAINING`);
    allClean = false;
  } else {
    console.log(`  ✅ ${'auth.users'.padEnd(25)} 0 users`);
  }

  console.log('\n' + '═'.repeat(58));
  if (allClean) {
    console.log('  ✅ DATABASE IS FULLY CLEAN — All data wiped successfully.');
  } else {
    console.log('  ⚠️  Some data remains — check errors above.');
  }
  console.log('═'.repeat(58));
}

wipeAll().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
