const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const { processDocument } = require('./src/services/ingestionService');
const { approveAutomation, rejectAutomation } = require('./src/services/proactivityService');
const supabase = require('./src/models/supabaseClient');

async function runTest() {
  console.log('🚀 Starting Proactivity Engine E2E Integration Test...');

  let companyId = null;
  let userId = null;
  const testFileName = 'temp_test_proactivity.txt';
  const testFilePath = path.join(__dirname, testFileName);

  try {
    // 1. Create a mock company and user
    console.log('Inserting temporary test company "PROTEST"...');
    const { data: newComp, error: compErr } = await supabase
      .from('companies')
      .insert([{ name: 'PROTEST' }])
      .select('id')
      .single();

    if (compErr) {
      throw new Error(`Failed to create test company: ${compErr.message}`);
    }
    companyId = newComp.id;

    console.log('Inserting temporary test user "PROTEST_CEO"...');
    const { data: newUser, error: userErr } = await supabase
      .from('users')
      .insert([{
        company_id: companyId,
        role: 'Admin',
        system_handle: 'PROTEST_CEO_01',
        department: 'EXECUTIVE'
      }])
      .select('id')
      .single();

    if (userErr) {
      throw new Error(`Failed to create test user: ${userErr.message}`);
    }
    userId = newUser.id;

    console.log(`Using Test Tenant ID: ${companyId}`);
    console.log(`Using Test User ID: ${userId}`);

    // 2. Create a mock document containing proactivity triggers
    const fileContent = `Strategic Planning Update for ACME Corp.
This document outlines the strategic priorities for the next quarter.

Actions to take immediately:
1. Email Kareem Helal at kareem@acme.com with the Q3 specifications update and ask for feedback.
2. Send an update to Slack #general alerting the team that the new plan has been uploaded.
3. Schedule a calendar sync next Tuesday at 3pm with engineer@acme.com to review the database migrations.
4. Draft a follow-up document called "Q3 Marketing Specifications Plan" containing a draft of our outreach content.
`;

    fs.writeFileSync(testFilePath, fileContent, 'utf8');
    console.log(`Created mock document: ${testFileName}`);

    // 3. Process/Ingest the document
    console.log('Ingesting mock document (should run proactivity scanner asynchronously)...');
    const result = await processDocument(testFilePath, testFileName, 'text/plain', companyId, userId);
    console.log('Ingestion Response:', JSON.stringify(result, null, 2));

    // 4. Wait for proactivity scanner to finish
    console.log('Waiting 5 seconds for proactivity LLM scanner to finish...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 5. Query proposed automations from DB
    console.log('\n--- VERIFICATION 1: Proposed Automations ---');
    const { data: autos, error: autoErr } = await supabase
      .from('proposed_automations')
      .select('*')
      .eq('tenant_id', companyId);

    if (autoErr) {
      throw new Error(`Failed to query proposed automations: ${autoErr.message}`);
    }

    console.log(`Found ${autos.length} proposed automations in database.`);
    autos.forEach((auto, i) => {
      console.log(`\nAutomation #${i + 1}:`);
      console.log(` - ID: ${auto.id}`);
      console.log(` - Type: ${auto.type}`);
      console.log(` - Description: ${auto.description}`);
      console.log(` - Status: ${auto.status}`);
      console.log(` - Payload:`, JSON.stringify(auto.action_payload, null, 2));
    });

    if (autos.length === 0) {
      throw new Error('No proposed automations found in DB! Proactivity scanner failed.');
    }

    // 6. Test Approve Automation (simulate tool run)
    const emailAuto = autos.find(a => a.type === 'email');
    if (emailAuto) {
      console.log(`\n--- VERIFICATION 2: Approving Email Automation (${emailAuto.id}) ---`);
      const userObj = { id: userId, company_id: companyId, role: 'Admin' };
      const approveResult = await approveAutomation(emailAuto.id, userObj);
      console.log('Approval output:', approveResult);

      // Re-fetch to verify status updated to 'approved'
      const { data: approvedAuto } = await supabase
        .from('proposed_automations')
        .select('status')
        .eq('id', emailAuto.id)
        .single();
      console.log(`New automation status: ${approvedAuto.status} (expected: approved)`);
      if (approvedAuto.status !== 'approved') {
        throw new Error(`Status was not updated to approved! Got: ${approvedAuto.status}`);
      }
    } else {
      console.log('\n⚠️ No email automation found in results to test approval.');
    }

    // 7. Test Reject/Dismiss Automation
    const slackAuto = autos.find(a => a.type === 'slack' || a.type === 'calendar' || a.type === 'document');
    if (slackAuto) {
      console.log(`\n--- VERIFICATION 3: Rejecting/Dismissing Automation (${slackAuto.id}) ---`);
      const userObj = { id: userId, company_id: companyId, role: 'Admin' };
      const rejectResult = await rejectAutomation(slackAuto.id, userObj);
      console.log('Rejection output:', rejectResult);

      // Re-fetch to verify status updated to 'rejected'
      const { data: rejectedAuto } = await supabase
        .from('proposed_automations')
        .select('status')
        .eq('id', slackAuto.id)
        .single();
      console.log(`New automation status: ${rejectedAuto.status} (expected: rejected)`);
      if (rejectedAuto.status !== 'rejected') {
        throw new Error(`Status was not updated to rejected! Got: ${rejectedAuto.status}`);
      }
    } else {
      console.log('\n⚠️ No secondary automation found in results to test rejection.');
    }

    console.log('\n🎉 ALL PROACTIVITY TESTS PASSED SUCCESSFULLY!');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
  } finally {
    // 8. Cleanup
    console.log('\n🧹 Cleaning up test database entries...');
    if (companyId) {
      const { error: cleanupErr } = await supabase
        .from('companies')
        .delete()
        .eq('id', companyId);
      if (cleanupErr) {
        console.error('Failed to clean up company:', cleanupErr.message);
      } else {
        console.log('Cleaned up database company and cascaded records successfully.');
      }
    }

    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
      console.log(`Deleted temp test file: ${testFileName}`);
    }
    
    process.exit(0);
  }
}

runTest();
