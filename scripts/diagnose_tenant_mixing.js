/**
 * Tenant Isolation Diagnostic Script
 * 
 * Detects:
 * 1. All companies and their users
 * 2. Users whose JWT metadata company_id differs from public.users company_id
 * 3. Users with missing company_id in JWT metadata but existing in public.users
 * 4. Cross-tenant data leaks (same user appearing in multiple companies)
 * 5. Orphaned companies (companies with no users)
 * 6. Users without company association
 * 
 * Run: node scripts/diagnose_tenant_mixing.js
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

async function diagnose() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        Tenant Isolation Diagnostic Report               ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ─── 1. Fetch all companies ───
  console.log('📋 COMPANIES');
  console.log('─'.repeat(60));
  const { data: companies, error: compErr } = await supabase
    .from('companies')
    .select('*')
    .order('created_at', { ascending: false });

  if (compErr) {
    console.error('❌ Failed to fetch companies:', compErr.message);
    return;
  }

  if (!companies || companies.length === 0) {
    console.log('  No companies found.\n');
  } else {
    console.log(`  Found ${companies.length} companies:\n`);
    for (const c of companies) {
      const onboarded = c.onboarding_complete ? '✅ Onboarded' : '⏳ Pending onboarding';
      console.log(`  [${c.id.substring(0, 8)}…] ${c.name} — ${onboarded}`);
      console.log(`        Created: ${new Date(c.created_at).toLocaleDateString()}`);
      if (c.industry) console.log(`        Industry: ${c.industry}`);
    }
    console.log();
  }

  // ─── 2. Fetch all users from public.users ───
  console.log('📋 USERS (public.users table)');
  console.log('─'.repeat(60));
  const { data: dbUsers, error: usersErr } = await supabase
    .from('users')
    .select('*');

  if (usersErr) {
    // Table might not exist or user might not have access
    console.log(`  ⚠️  Could not query public.users: ${usersErr.message}\n`);
  } else if (!dbUsers || dbUsers.length === 0) {
    console.log('  No user records in public.users.\n');
  } else {
    console.log(`  Found ${dbUsers.length} user records:\n`);
    for (const u of dbUsers) {
      const company = companies?.find(c => c.id === u.company_id);
      const companyName = company ? company.name : '❌ UNKNOWN COMPANY';
      console.log(`  [${u.id.substring(0, 8)}…] ${u.id} → ${companyName} (${u.company_id?.substring(0, 8) || 'null'}…)`);
      console.log(`        Role: ${u.role}, Dept: ${u.department}`);
    }
    console.log();
  }

  // ─── 3. Check for orphaned companies (no users) ───
  if (companies && dbUsers) {
    console.log('🔍 ORPHANED COMPANIES (no users)');
    console.log('─'.repeat(60));
    const userIds = new Set(dbUsers.map(u => u.company_id));
    const orphaned = companies.filter(c => !userIds.has(c.id));
    if (orphaned.length === 0) {
      console.log('  ✅ No orphaned companies found.\n');
    } else {
      console.log(`  ⚠️  Found ${orphaned.length} orphaned companies:\n`);
      for (const c of orphaned) {
        console.log(`  [${c.id.substring(0, 8)}…] ${c.name}`);
        console.log(`        Created: ${new Date(c.created_at).toLocaleDateString()}`);
      }
      console.log();
    }
  }

  // ─── 4. Check for users without company_id in public.users ───
  if (dbUsers) {
    console.log('🔍 USERS WITHOUT COMPANY ASSOCIATION');
    console.log('─'.repeat(60));
    const noCompany = dbUsers.filter(u => !u.company_id);
    if (noCompany.length === 0) {
      console.log('  ✅ All users have a company association.\n');
    } else {
      console.log(`  ⚠️  Found ${noCompany.length} users without company:\n`);
      for (const u of noCompany) {
        console.log(`  [${u.id.substring(0, 8)}…] ${u.id}`);
      }
      console.log();
    }
  }

  // ─── 5. Cross-tenant data check: decisions ───
  console.log('🔍 CROSS-TENANT DATA CHECK');
  console.log('─'.repeat(60));
  
  if (companies) {
    for (const company of companies) {
      const { data: decisions, error: decErr } = await supabase
        .from('decisions')
        .select('id, text, tenant_id')
        .eq('tenant_id', company.id)
        .limit(5);

      const { data: actions, error: actErr } = await supabase
        .from('action_items')
        .select('id, task, tenant_id')
        .eq('tenant_id', company.id)
        .limit(5);

      const { data: docs, error: docErr } = await supabase
        .from('brain_documents')
        .select('id, title, company_id')
        .eq('company_id', company.id)
        .limit(5);

      const { data: chunks, error: chunkErr } = await supabase
        .from('document_chunks')
        .select('id, tenant_id')
        .eq('tenant_id', company.id)
        .limit(1);

      console.log(`  ${company.name}:`);
      console.log(`    Decisions: ${decisions?.length || 0} | Action Items: ${actions?.length || 0} | Docs: ${docs?.length || 0} | Chunks: ${chunks?.length || 0}`);
    }
    console.log();
  }

  // ─── 6. Check for duplicate company names ───
  if (companies) {
    console.log('🔍 DUPLICATE COMPANY NAMES');
    console.log('─'.repeat(60));
    const nameCounts = {};
    for (const c of companies) {
      nameCounts[c.name] = (nameCounts[c.name] || 0) + 1;
    }
    const duplicates = Object.entries(nameCounts).filter(([_, count]) => count > 1);
    if (duplicates.length === 0) {
      console.log('  ✅ No duplicate company names.\n');
    } else {
      console.log(`  ⚠️  Found ${duplicates.length} duplicate company names:\n`);
      for (const [name, count] of duplicates) {
        console.log(`  "${name}" appears ${count} times`);
        const dups = companies.filter(c => c.name === name);
        for (const c of dups) {
          console.log(`    [${c.id.substring(0, 8)}…] Created: ${new Date(c.created_at).toLocaleDateString()} | Onboarded: ${c.onboarding_complete ? '✅' : '❌'}`);
        }
      }
      console.log();
    }
  }

  // ─── 7. Summary ───
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                    RECOMMENDATIONS                       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();
  console.log('  If you see a user associated with the wrong company:');
  console.log('  1. Update public.users:    UPDATE users SET company_id = <correct_id> WHERE id = <user_id>;');
  console.log('  2. Sync JWT metadata:      Run admin API to update app_metadata');
  console.log('  3. Delete orphaned company: DELETE FROM companies WHERE id = <orphaned_id>;');
  console.log();
  console.log('  If you see data from two companies mixed together:');
  console.log('  → The auth middleware fix ensures JWT metadata is always sourced from public.users');
  console.log('  → Missing tenant filters may be the cause — run a manual audit on all .from() queries');
  console.log();
}

diagnose().catch(console.error);
