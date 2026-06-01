require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_59YTJY50m9LsjhJZ2ZRLIw_4Yehkl8A';

// Create admin and client Supabase instances
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const BACKEND_URL = 'http://localhost:5000';
const TEST_FILE_PATH = '/uploads/marketing_strategy_for_acme_corp_1779381016032.md';
const TEMP_PASSWORD = 'TestPassword123!';

async function runTests() {
  console.log('=== Starting Secure Download Verification ===\n');

  const userEmails = {
    owner: 'kareemhelal65@gmail.com',
    nonOwner: 'kareemhelal63@gmail.com'
  };

  const userIds = {
    owner: 'eabd9695-b45f-466f-b677-7ce3b9b19cbd',
    nonOwner: '13a3bbcb-aa4a-46dd-bedb-73d95cdb2f62'
  };

  // 1. Set temporary passwords to allow sign-in
  console.log('Setting temporary passwords for test users...');
  await adminClient.auth.admin.updateUserById(userIds.owner, { password: TEMP_PASSWORD });
  await adminClient.auth.admin.updateUserById(userIds.nonOwner, { password: TEMP_PASSWORD });

  let ownerToken = '';
  let nonOwnerToken = '';

  try {
    // 2. Sign in as Owner
    console.log(`Signing in as document owner: ${userEmails.owner}...`);
    const { data: ownerData, error: ownerErr } = await userClient.auth.signInWithPassword({
      email: userEmails.owner,
      password: TEMP_PASSWORD
    });
    if (ownerErr) throw new Error(`Owner sign in failed: ${ownerErr.message}`);
    ownerToken = ownerData.session.access_token;
    console.log('Owner signed in successfully.');

    // 3. Sign in as Non-Owner
    console.log(`Signing in as non-owner (different tenant): ${userEmails.nonOwner}...`);
    const { data: nonOwnerData, error: nonOwnerErr } = await userClient.auth.signInWithPassword({
      email: userEmails.nonOwner,
      password: TEMP_PASSWORD
    });
    if (nonOwnerErr) throw new Error(`Non-owner sign in failed: ${nonOwnerErr.message}`);
    nonOwnerToken = nonOwnerData.session.access_token;
    console.log('Non-owner signed in successfully.\n');

    // --- TEST 1: Unauthenticated request ---
    console.log('Running TEST 1: Requesting download without Authorization header...');
    const res1 = await fetch(`${BACKEND_URL}${TEST_FILE_PATH}`);
    console.log(`Status: ${res1.status} ${res1.statusText}`);
    const data1 = await res1.json();
    console.log('Response:', data1);
    if (res1.status !== 401) {
      throw new Error('TEST 1 FAILED: Expected 401 Unauthorized status.');
    }
    console.log('TEST 1 PASSED: Unauthenticated request blocked.\n');

    // --- TEST 2: Request with invalid token ---
    console.log('Running TEST 2: Requesting download with invalid authorization token...');
    const res2 = await fetch(`${BACKEND_URL}${TEST_FILE_PATH}`, {
      headers: { 'Authorization': 'Bearer invalid_token_value_here' }
    });
    console.log(`Status: ${res2.status} ${res2.statusText}`);
    const data2 = await res2.json();
    console.log('Response:', data2);
    if (res2.status !== 401) {
      throw new Error('TEST 2 FAILED: Expected 401 Unauthorized status.');
    }
    console.log('TEST 2 PASSED: Request with invalid token blocked.\n');

    // --- TEST 3: Multi-tenant boundary check (Non-owner request) ---
    console.log('Running TEST 3: Requesting download as non-owner (different company)...');
    const res3 = await fetch(`${BACKEND_URL}${TEST_FILE_PATH}`, {
      headers: { 'Authorization': `Bearer ${nonOwnerToken}` }
    });
    console.log(`Status: ${res3.status} ${res3.statusText}`);
    const data3 = await res3.json();
    console.log('Response:', data3);
    if (res3.status !== 403) {
      throw new Error('TEST 3 FAILED: Expected 403 Forbidden status.');
    }
    console.log('TEST 3 PASSED: Multi-tenant boundary check blocked cross-tenant access.\n');

    // --- TEST 4: Authorized request (Owner request) ---
    console.log('Running TEST 4: Requesting download as document owner...');
    const res4 = await fetch(`${BACKEND_URL}${TEST_FILE_PATH}`, {
      headers: { 'Authorization': `Bearer ${ownerToken}` }
    });
    console.log(`Status: ${res4.status} ${res4.statusText}`);
    if (res4.status !== 200) {
      const errBody = await res4.json().catch(() => ({}));
      console.log('Error Response:', errBody);
      throw new Error(`TEST 4 FAILED: Expected 200 OK. Got ${res4.status}`);
    }
    const textBody = await res4.text();
    console.log(`Downloaded ${textBody.length} bytes.`);
    console.log('Preview of downloaded content:');
    console.log(textBody.substring(0, 200) + '...\n');
    console.log('TEST 4 PASSED: Document owner successfully downloaded the document.\n');

    console.log('=== All security and multi-tenant checks passed successfully! ===');

  } catch (err) {
    console.error('\n❌ Validation Test Failed:', err.message);
  } finally {
    // 4. Clean up: sign out
    console.log('\nCleaning up sessions...');
    await userClient.auth.signOut();
  }
}

runTests();
