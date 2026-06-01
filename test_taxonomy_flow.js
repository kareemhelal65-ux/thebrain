const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const { processDocument } = require('./src/services/ingestionService');
const { retrieveCompanyContext } = require('./src/services/retrievalService');
const supabase = require('./src/models/supabaseClient');

async function runTest() {
  console.log('🚀 Starting Taxonomy Ingestion and Retrieval Integration Test...');

  let companyId = null;
  let userId = null;
  const testFileName = 'temp_test_product_roadmap.txt';
  const testFilePath = path.join(__dirname, testFileName);

  try {
    // 1. Create a mock company and user to avoid trigger/constraint validation errors
    console.log('Inserting temporary test company "TESTCOMP"...');
    const { data: newComp, error: compErr } = await supabase
      .from('companies')
      .insert([{ name: 'TESTCOMP' }])
      .select('id')
      .single();

    if (compErr) {
      throw new Error(`Failed to create test company: ${compErr.message}`);
    }
    companyId = newComp.id;

    console.log('Inserting temporary test user "TESTCOMP_CEO_01"...');
    const { data: newUser, error: userErr } = await supabase
      .from('users')
      .insert([{
        company_id: companyId,
        role: 'Admin',
        system_handle: 'TESTCOMP_CEO_01',
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

    // 2. Create a mock document containing decisions and action items
    const fileContent = `Project Aegis - Q3 Specifications & Roadmap
This document outlines the product specifications and strategic roadmap decisions for Project Aegis.

Decisions:
- On 2026-05-18, Kareem decided to drop the Pinecone L3 cache in favor of Supabase pgvector because of low budget and ease of management.
- On 2026-05-19, Morimura decided to set the Neural tier price at $39/seat to ensure viable unit economics.

Action Items:
- Ahmed to create the database schemas for decisions and tasks by 2026-05-22.
- Kareem to build the Node.js ingestion gateway by 2026-05-25.
`;

    fs.writeFileSync(testFilePath, fileContent, 'utf8');
    console.log(`Created mock document: ${testFileName}`);

    // 3. Process/Ingest the document
    console.log('Ingesting mock document...');
    const result = await processDocument(testFilePath, testFileName, 'text/plain', companyId, userId);
    console.log('Ingestion Response:', JSON.stringify(result, null, 2));

    // Retrieve the document registry ID
    const { data: docs, error: docFetchErr } = await supabase
      .from('brain_documents')
      .select('id, department, semantic_type, sub_type')
      .eq('title', testFileName)
      .eq('company_id', companyId)
      .limit(1);

    if (docFetchErr || !docs || docs.length === 0) {
      throw new Error(`Failed to find ingested document: ${docFetchErr?.message}`);
    }

    const documentId = docs[0].id;
    const doc = docs[0];

    console.log('\n--- VERIFICATION 1: Taxonomy Classification ---');
    console.log(`Expected Department: 'product' or similar. Got: '${doc.department}'`);
    console.log(`Expected Semantic Type: 'reference_doc' or similar. Got: '${doc.semantic_type}'`);
    console.log(`Expected Sub-type: 'roadmap' or similar. Got: '${doc.sub_type}'`);

    // 4. Verify extracted decisions in SQL
    console.log('\n--- VERIFICATION 2: Extracted Decisions ---');
    const { data: decs, error: decsErr } = await supabase
      .from('decisions')
      .select(`
        id,
        text,
        made_by,
        date,
        created_at,
        source_doc_id,
        brain_documents(id, title, document_type)
      `)
      .eq('tenant_id', companyId);

    if (decsErr) throw decsErr;
    console.log(`Found ${decs.length} decisions in DB:`);
    decs.forEach(d => {
      console.log(` - Decision: "${d.text}" | Made By: ${d.made_by} | Date: ${d.date} | Source: ${d.brain_documents?.title} (${d.brain_documents?.document_type})`);
      if (!d.brain_documents) {
        throw new Error(`❌ Error: Decision ${d.id} is missing its related brain_documents relation!`);
      }
    });

    if (decs.length === 0) {
      throw new Error('❌ Error: No decisions were extracted from the text!');
    }

    // 5. Verify extracted action items in SQL
    console.log('\n--- VERIFICATION 3: Extracted Action Items ---');
    const { data: actionItems, error: actErr } = await supabase
      .from('action_items')
      .select('*')
      .eq('source_doc_id', documentId);

    if (actErr) throw actErr;
    console.log(`Found ${actionItems.length} action items in DB:`);
    for (const a of actionItems) {
      console.log(` - Task: "${a.task}" | Assignee: ${a.assignee} | Due Date: ${a.due_date} | Status: ${a.status}`);
    }

    if (actionItems.length === 0) {
      throw new Error('❌ Error: No action items were extracted from the text!');
    }

    // 6. Verify taxonomy-filtered retrieval
    console.log('\n--- VERIFICATION 4: Taxonomy-filtered pgvector search ---');
    
    // Search with the matching department filter
    console.log(`Searching for "Project Aegis Q3 Specifications & Roadmap" with department filter: "${doc.department}"...`);
    const matchingContext = await retrieveCompanyContext('Project Aegis Q3 Specifications & Roadmap', companyId, {
      department: doc.department
    });
    console.log(`Results found: ${matchingContext.length}`);
    if (matchingContext.length === 0) {
      throw new Error('❌ Error: Search with matching department returned 0 results!');
    }

    // Search with non-matching department filter
    console.log('Searching for "Project Aegis Q3 Specifications & Roadmap" with non-matching department filter "hr"...');
    const nonMatchingContext = await retrieveCompanyContext('Project Aegis Q3 Specifications & Roadmap', companyId, {
      department: 'hr'
    });
    console.log(`Results found: ${nonMatchingContext.length}`);
    if (nonMatchingContext.length > 0) {
      console.warn('⚠️ Warning: Search with "hr" department filter returned results. Chunks might not be properly separated or threshold is low.');
    } else {
      console.log('✅ Success: Non-matching department filter returned 0 results.');
    }

    console.log('\n🎉 ALL TESTS COMPLETED SUCCESSFULLY!');
  } catch (err) {
    console.error('\n❌ Test execution failed with error:', err);
  } finally {
    // 7. Cleanup test data
    console.log('\n🧹 Cleaning up test database entries...');
    if (companyId) {
      // Deleting companies cascades to users, brain_documents, decisions, action_items, and document_chunks!
      const { error: cleanupErr } = await supabase
        .from('companies')
        .delete()
        .eq('id', companyId);
      
      if (cleanupErr) {
        console.error('❌ Failed to cleanup database:', cleanupErr.message);
      } else {
        console.log('✅ Cleaned up database successfully.');
      }
    }

    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
      console.log(`Removed local temp file: ${testFileName}`);
    }
  }
}

runTest();
