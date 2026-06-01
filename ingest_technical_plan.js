require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { processDocument } = require('./src/services/ingestionService');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const TENANTS = [
  {
    companyId: 'dfb6e485-f543-47f8-8452-f05547ad57cd', // kareemhelal65
    userId: 'eabd9695-b45f-466f-b677-7ce3b9b19cbd',
    name: 'kareemhelal65@gmail.com'
  },
  {
    companyId: '1a113a28-7dcc-4c52-8d23-ff0b7d807602', // kareemhelal63
    userId: '13a3bbcb-aa4a-46dd-bedb-73d95cdb2f62',
    name: 'kareemhelal63@gmail.com'
  }
];

async function run() {
  const sourceFile = path.join(__dirname, 'TheBrain_TechnicalPlan_v3.docx');
  const docTitle = 'TheBrain_TechnicalPlan_v3.docx';
  const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  if (!fs.existsSync(sourceFile)) {
    console.error(`Source file not found at: ${sourceFile}`);
    process.exit(1);
  }

  try {
    // 1. Database Cleanup for the target document
    console.log('Cleaning up existing database records for document:', docTitle);
    
    for (const tenant of TENANTS) {
      console.log(`Cleaning tenant ${tenant.name} (${tenant.companyId})...`);
      
      // Delete existing proposed automations linked to the document
      const { data: oldDocs } = await supabase
        .from('brain_documents')
        .select('id')
        .eq('company_id', tenant.companyId)
        .eq('title', docTitle);
      
      if (oldDocs && oldDocs.length > 0) {
        const oldDocIds = oldDocs.map(d => d.id);
        const { error: autoDeleteErr } = await supabase
          .from('proposed_automations')
          .delete()
          .in('source_doc_id', oldDocIds);
        if (autoDeleteErr) console.warn('Warning deleting proposed automations:', autoDeleteErr.message);
      }

      // Delete the document itself (cascades to decisions, action_items, document_chunks, contacts)
      const { error: docDeleteErr } = await supabase
        .from('brain_documents')
        .delete()
        .eq('company_id', tenant.companyId)
        .eq('title', docTitle);

      if (docDeleteErr) {
        console.error('Error deleting old documents:', docDeleteErr.message);
      } else {
        console.log('Old document entries successfully cleared.');
      }
    }

    // 2. Ingest document for each tenant
    for (const tenant of TENANTS) {
      console.log(`\n========================================`);
      console.log(`Ingesting for: ${tenant.name}`);
      console.log(`Company ID: ${tenant.companyId}`);
      console.log(`User ID: ${tenant.userId}`);
      console.log(`========================================`);

      const tempFile = path.join(__dirname, `temp_technical_plan_${tenant.companyId}.docx`);
      fs.copyFileSync(sourceFile, tempFile);

      try {
        const result = await processDocument(
          tempFile,
          docTitle,
          mimeType,
          tenant.companyId,
          tenant.userId
        );
        console.log(`Ingestion completed for ${tenant.name}!`);
        console.log(JSON.stringify(result, null, 2));

        console.log('Waiting 15 seconds for background proactivity scanning to finish...');
        await new Promise(resolve => setTimeout(resolve, 15000));
      } catch (err) {
        console.error(`Ingestion failed for ${tenant.name}:`, err);
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
    }

    console.log('\nAll ingests completed successfully!');

  } catch (err) {
    console.error('Migration execution failed:', err);
  }
}

run();
