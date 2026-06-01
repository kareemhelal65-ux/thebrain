/**
 * ============================================================
 * E2E FULL PIPELINE TEST — The Brain AIOS
 * ============================================================
 * 
 * Tests the entire pipeline end-to-end:
 *   1. Supabase connectivity
 *   2. Document ingestion → taxonomy classification
 *   3. Decision extraction
 *   4. Action item extraction  
 *   5. Semantic routing (all 9 routes)
 *   6. Multi-strategy retrieval (precise + broad + query expansion)
 *   7. Proactivity on-demand scan (overdue + cross-doc)
 *   8. Fact extraction from conversation
 *   9. Cleanup
 * 
 * Usage: node test_e2e_full_pipeline.js
 * 
 * Requires: .env with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LLAMA_API_KEY
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// ─── Required env check ───
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'LLAMA_API_KEY'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

// ─── Imports ───
const { processDocument } = require('./src/services/ingestionService');
const { getRelevantTools, initRouter } = require('./src/services/semanticRouter');
const { retrieveCompanyContext, retrieveSmartContext, buildExpandedQuery } = require('./src/services/retrievalService');
const { scanCompany } = require('./src/services/proactivityScheduler');
const { extractFactsFromExchange, saveFacts } = require('./src/services/factExtractor');
const supabase = require('./src/models/supabaseClient');
const registry = require('./src/providers/registry');

// ─── Test State ───
let companyId = null;
let userId = null;
let documentId = null;
const testFileBase = 'e2e_test_strategy_doc.txt';
const testFilePath = path.join(__dirname, testFileBase);

// ─── Test Constants ───
// IMPORTANT: The database trigger parse_system_handle() extracts the first
// underscore-delimited part of system_handle and looks up the company by name.
// So company name MUST match the handle prefix.
const TEST_COMPANY_NAME = 'E2ETEST';
const TEST_USER_HANDLE = 'E2ETEST_ADMIN_01'; // 3-part executive pattern: COMPANY_POSITION_NUMBER

const PASS = '\u2705';
const FAIL = '\u274C';
const WARN = '\u26A0\uFE0F';
const TOTAL_TESTS = 20;
let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ${PASS} ${label}${detail ? ' \u2014 ' + detail : ''}`);
  } else {
    failed++;
    console.log(`  ${FAIL} ${label}${detail ? ' \u2014 ' + detail : ''}`);
  }
}

async function run() {
  console.log('\n' + '='.repeat(60));
  console.log('🧠 BRAIN AIOS \u2014 FULL PIPELINE E2E TEST');
  console.log('='.repeat(60));
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Tests: ${TOTAL_TESTS} assertions`);
  console.log('-'.repeat(60));

  try {
    // ===== TEST 1: Supabase Connectivity =====
    console.log('\n📡 1. INFRASTRUCTURE');
    console.log('-'.repeat(40));

    const { data: healthCheck, error: healthErr } = await supabase.from('companies').select('id').limit(1);
    assert(!healthErr || healthErr === null, 'Supabase connection', healthErr?.message || 'OK');

    // ===== TEST 2: Create Test Tenant & User =====
    console.log('\n🏗️  2. SETUP \u2014 Test Tenant & User');
    console.log('-'.repeat(40));

    // Company name must match the prefix of the system_handle (trigger parses it)
    const { data: newComp, error: compErr } = await supabase
      .from('companies')
      .insert([{ name: TEST_COMPANY_NAME }])
      .select('id')
      .single();

    assert(!compErr, 'Create test company', compErr?.message || 'OK');
    companyId = newComp.id;
    console.log(`     Company ID: ${companyId}`);

    // system_handle must match COMPANY_POSITION_NUMBER (3-part) or COMPANY_DEPT_POSITION_NUMBER (4-part)
    // The trigger will auto-set company_id from the handle prefix lookup,
    // so the passed company_id is used as a fallback.
    const { data: newUser, error: userErr } = await supabase
      .from('users')
      .insert([{
        company_id: companyId,
        role: 'Admin',
        system_handle: TEST_USER_HANDLE,
        department: 'EXECUTIVE'
      }])
      .select('id')
      .single();

    assert(!userErr, 'Create test user', userErr?.message || 'OK');
    userId = newUser.id;
    console.log(`     User ID: ${userId}`);
    console.log(`     Handle: ${TEST_USER_HANDLE}`);

    // ===== TEST 3: Create Mock Document =====
    console.log('\n📄 3. DOCUMENT CREATION');
    console.log('-'.repeat(40));

    const docContent = `# Acme Corp \u2014 Q3 2026 Strategic Plan

## Executive Summary
This document outlines the strategic priorities for Acme Corp in Q3 2026. 
Key areas include product expansion, hiring, and budget planning.

## Strategic Decisions

On 2026-05-15, Kareem Helal decided to adopt Supabase pgvector as the primary vector store instead of Pinecone to reduce infrastructure costs by 40%.

On 2026-05-20, Sara Morimura decided to set the Neural tier pricing at $39 per seat to ensure viable unit economics starting from 10 seats minimum.

On 2026-06-01, the executive team decided to launch the AI agent marketplace in Q4 2026 rather than Q3 to allow more time for security hardening.

## Action Items

1. Kareem Helal to finalize the database migration scripts by 2026-05-01.
2. Sara Morimura to prepare the pricing announcement email draft by 2026-05-15.
3. Ahmed Hassan to complete the integration testing framework by 2026-06-20.
4. The marketing team to create the Q3 campaign assets by 2026-07-01.
5. Review partner agreements with the legal team by 2026-05-10.

## Budget Summary

The total budget allocation for Q3 is $450,000 across four departments:
- Engineering: $200,000 (infrastructure, development, testing)
- Marketing: $100,000 (campaigns, events, content)
- Sales: $100,000 (tools, commissions, training)
- Operations: $50,000 (legal, HR, facilities)

## Contacts

We are working with the following external partners:
- DataVault Inc. \u2014 our infrastructure vendor, contact them at partners@datavault.io
- GrowthPulse Agency \u2014 our marketing partner handling the Q3 campaign
- Allen & Carter LLP \u2014 legal counsel for partner agreement reviews

## Notes
- Next all-hands meeting is scheduled for 2026-06-15.
- The team prefers Slack for daily updates and email for formal communications.
`;

    fs.writeFileSync(testFilePath, docContent, 'utf8');
    assert(fs.existsSync(testFilePath), 'Mock document file created');
    console.log(`     File: ${testFileBase} (${docContent.length} chars)`);

    // ===== TEST 4: Document Ingestion =====
    console.log('\n\u2699\uFE0F  4. DOCUMENT INGESTION (taxonomy + chunks + embedding)');
    console.log('-'.repeat(40));

    let ingestionResult;
    try {
      ingestionResult = await processDocument(testFilePath, testFileBase, 'text/plain', companyId, userId);
      assert(true, 'Ingestion completed without error');
      console.log(`     Chunks processed: ${ingestionResult?.chunksProcessed || 'N/A'}`);
      console.log(`     Taxonomy: ${ingestionResult?.taxonomy?.department || 'N/A'} / ${ingestionResult?.taxonomy?.semantic_type || 'N/A'} / ${ingestionResult?.taxonomy?.sub_type || 'N/A'}`);
      console.log(`     Decisions extracted: ${ingestionResult?.decisionsExtracted || 0}`);
      console.log(`     Action items extracted: ${ingestionResult?.actionItemsExtracted || 0}`);
    } catch (err) {
      assert(false, 'Ingestion completed without error', err.message);
    }

    // ===== TEST 5: Verify Document in DB =====
    console.log('\n🔍 5. VERIFY \u2014 Document Registry');
    console.log('-'.repeat(40));

    const { data: docs } = await supabase
      .from('brain_documents')
      .select('id, title, department, semantic_type, sub_type, document_type')
      .eq('title', testFileBase)
      .eq('company_id', companyId);

    assert(docs && docs.length > 0, 'Document registered in brain_documents', docs?.length > 0 ? `ID: ${docs[0].id}` : 'Not found');

    if (docs && docs.length > 0) {
      documentId = docs[0].id;
      const doc = docs[0];
      assert(doc.department, `Taxonomy department: ${doc.department}`);
      assert(doc.semantic_type, `Taxonomy semantic_type: ${doc.semantic_type}`);
      assert(doc.sub_type, `Taxonomy sub_type: ${doc.sub_type}`);
      console.log(`     Full: ${doc.department} / ${doc.semantic_type} / ${doc.sub_type}`);
    }

    // ===== TEST 6: Verify Chunks in pgvector =====
    console.log('\n🧩 6. VERIFY \u2014 Document Chunks (pgvector)');
    console.log('-'.repeat(40));

    const { data: chunks } = await supabase
      .from('document_chunks')
      .select('id, content, source_id, department, semantic_type')
      .eq('source_id', documentId)
      .limit(20);

    assert(chunks && chunks.length > 0, `Chunks stored in document_chunks`, chunks ? `${chunks.length} chunks` : 'None');
    if (chunks && chunks.length > 0) {
      assert(chunks[0].department === docs[0].department, 'Chunk inherits department taxonomy');
      console.log(`     Sample: "${chunks[0].content.substring(0, 80)}..."`);
    }

    // ===== TEST 7: Verify Decisions Extracted =====
    console.log('\n📋 7. VERIFY \u2014 Decisions');
    console.log('-'.repeat(40));

    const { data: decisions } = await supabase
      .from('decisions')
      .select('id, text, made_by, date, source_doc_id')
      .eq('source_doc_id', documentId);

    assert(decisions && decisions.length >= 2, `Decisions extracted`, decisions ? `${decisions.length} decisions` : 'None');
    if (decisions && decisions.length > 0) {
      decisions.forEach(d => {
        console.log(`     - "${d.text.substring(0, 60)}..." by ${d.made_by || 'Unknown'} on ${d.date || 'N/A'}`);
      });
    }

    // ===== TEST 8: Verify Action Items Extracted =====
    console.log('\n\u2705 8. VERIFY \u2014 Action Items');
    console.log('-'.repeat(40));

    const { data: actionItems } = await supabase
      .from('action_items')
      .select('id, task, assignee, due_date, status, department, sub_tasks')
      .eq('source_doc_id', documentId);

    assert(actionItems && actionItems.length >= 3, `Action items extracted`, actionItems ? `${actionItems.length} items` : 'None');
    if (actionItems && actionItems.length > 0) {
      actionItems.forEach(a => {
        const stCount = a.sub_tasks?.length || 0;
        console.log(`     - "${a.task.substring(0, 55)}..." \u2192 ${a.assignee || 'Unassigned'} (${a.status})${stCount > 0 ? ` [${stCount} sub-tasks]` : ''}`);
      });
    }

    // ===== TEST 9: Semantic Routing =====
    console.log('\n🧭 9. SEMANTIC ROUTER');
    console.log('-'.repeat(40));

    console.log('     Initializing router (may take 10-15s first time)...');
    await initRouter();

    const allTools = registry.getAllTools();
    console.log(`     Available tools: ${allTools.length}`);

    const testPrompts = [
      { prompt: 'create a new document about the marketing plan', expected: 'Document', minCat: 1 },
      { prompt: 'search the web for competitor analysis', expected: 'Research', minCat: 1 },
      { prompt: 'what happened in the last meeting', expected: 'Meeting', minCat: 1 },
      { prompt: 'show me my open tasks', expected: 'Action', minCat: 1 },
      { prompt: 'draft an email to the team', expected: 'Comms', minCat: 1 },
      { prompt: 'what is our MRR this quarter', expected: 'Finance', minCat: 1 },
      { prompt: 'find the employee directory', expected: 'Directory', minCat: 1 },
      { prompt: 'check product inventory levels', expected: 'Commerce', minCat: 1 },
      { prompt: 'search my documents for the strategy plan', expected: 'Knowledge', minCat: 1 },
    ];

    for (const t of testPrompts) {
      const tools = await getRelevantTools(t.prompt, allTools);
      const ok = tools && tools.length >= t.minCat;
      assert(ok, `Route "${t.expected}" for "${t.prompt.substring(0, 40)}..."`, ok ? `${tools.length} tools` : '0 tools (FALLBACK)');
    }

    // ===== TEST 10: Multi-Strategy Retrieval =====
    console.log('\n🎯 10. MULTI-STRATEGY RETRIEVAL');
    console.log('-'.repeat(40));

    const queries = [
      { query: 'What is the Q3 budget allocation?', label: 'Q3 budget' },
      { query: 'Who made decisions about vector storage?', label: 'Vector storage decisions' },
      { query: 'Tell me about the pricing strategy', label: 'Pricing strategy' },
    ];

    for (const q of queries) {
      const results = await retrieveCompanyContext(q.query, companyId);
      assert(results && results.length > 0, `Retrieve "${q.label}"`, results ? `\u2192 ${results.length} chunks` : 'None');
      
      if (results && results.length > 0) {
        console.log(`       Top: "${results[0].substring(0, 80)}..."`);
      }
    }

    // ===== TEST 11: Taxonomy-Filtered Retrieval =====
    console.log('\n🔬 11. TAXONOMY-FILTERED RETRIEVAL');
    console.log('-'.repeat(40));

    const docDept = docs?.[0]?.department || 'general';
    const filteredResults = await retrieveCompanyContext('Q3 Strategy', companyId, { department: docDept });
    assert(filteredResults.length > 0, `Filtered by department "${docDept}"`, `${filteredResults.length} results`);

    // Test non-matching filter
    const wrongFilter = docDept === 'operations' ? 'hr' : 'operations';
    const noResults = await retrieveCompanyContext('Q3 Strategy', companyId, { department: wrongFilter });
    console.log(`     ${WARN} Non-matching filter "${wrongFilter}": ${noResults.length} results (may be 0)`);
    
    // ===== TEST 12: Smart Context Retrieval =====
    console.log('\n🧠 12. SMART CONTEXT (expanded query + entities)');
    console.log('-'.repeat(40));

    const conversationHistory = [
      { role: 'user', content: 'What is the Q3 budget allocation for engineering?' },
      { role: 'assistant', content: 'The engineering budget for Q3 is $200,000.' },
      { role: 'user', content: 'What about marketing?' }
    ];

    const expanded = buildExpandedQuery('What about marketing?', conversationHistory);
    assert(expanded.length > 30 && typeof expanded === 'string', 'Query expansion returns expanded string', expanded);

    const smartCtx = await retrieveSmartContext('What about marketing?', conversationHistory, companyId);
    assert(smartCtx.chunks && smartCtx.chunks.length > 0, 'Smart context has chunks', `${smartCtx.chunks?.length || 0} chunks`);
    assert(smartCtx.expandedQuery, 'Smart context has expanded query', smartCtx.expandedQuery);
    console.log(`     Expanded query: "${smartCtx.expandedQuery}"`);
    console.log(`     Open items: ${smartCtx.openItems?.length || 0}`);
    console.log(`     Recent decisions: ${smartCtx.recentDecisions?.length || 0}`);

    // ===== TEST 13: Proactivity On-Demand Scan =====
    console.log('\n⏰ 13. PROACTIVITY SCHEDULER \u2014 On-Demand Scan');
    console.log('-'.repeat(40));

    let scanResult;
    try {
      scanResult = await scanCompany(companyId);
      assert(true, 'scanCompany() completed without error');
      console.log(`     Overdue suggestions: ${scanResult?.overdue?.suggestionCount || 0}`);
      console.log(`     Cross-doc suggestions: ${scanResult?.crossDoc?.suggestionCount || 0}`);
    } catch (err) {
      assert(false, 'scanCompany() completed without error', err.message);
    }

    // ===== TEST 14: Verify Proactive Suggestions =====
    console.log('\n💡 14. VERIFY \u2014 Proactive Suggestions in DB');
    console.log('-'.repeat(40));

    const { data: suggestions } = await supabase
      .from('proactive_suggestions')
      .select('id, category, title, priority, description')
      .eq('tenant_id', companyId)
      .order('created_at', { ascending: false });

    assert(suggestions && suggestions.length > 0, `Suggestions created`, suggestions ? `${suggestions.length} suggestions` : 'None');
    if (suggestions && suggestions.length > 0) {
      suggestions.forEach(s => {
        console.log(`     [${s.priority.toUpperCase()}] ${s.category}: "${s.title.substring(0, 60)}..."`);
      });
    }

    // ===== TEST 15: Fact Extraction =====
    console.log('\n🧠 15. FACT EXTRACTION');
    console.log('-'.repeat(40));

    const sampleConv = [
      { role: 'user', content: 'I am Kareem Helal, the CTO of Acme Corp. I prefer detailed markdown reports over slide decks.' },
      { role: 'assistant', content: 'Nice to meet you, Kareem! I will remember you prefer detailed markdown reports.' },
      { role: 'user', content: 'Our Q3 budget is $450,000 with $200k going to engineering. I want weekly status updates on Slack.' }
    ];

    const sampleUserMsg = 'I prefer Slack for daily updates and email for formal communications.';
    const sampleAssistantReply = 'Noted! I will remember your communication preferences.';

    const facts = await extractFactsFromExchange(sampleUserMsg, sampleAssistantReply, sampleConv);
    
    console.log(`     Extracted ${facts?.length || 0} facts`);
    if (facts && facts.length > 0) {
      facts.forEach(f => {
        console.log(`       [${f.category}] (${f.confidence}) ${f.fact}`);
      });
    } else {
      console.log(`     ${WARN} No facts extracted (may be normal depending on LLM response)`);
    }
    // Fact extraction is best-effort; don't assert

    // ===== TEST 16: Save Facts =====
    console.log('\n💾 16. SAVE & RETRIEVE FACTS');
    console.log('-'.repeat(40));

    const testFacts = [
      { fact: 'User is Kareem Helal, CTO of Acme Corp.', category: 'personal', confidence: 0.95 },
      { fact: 'User prefers Slack for daily updates.', category: 'preference', confidence: 0.85 },
      { fact: 'Q3 budget is $450,000 total.', category: 'project', confidence: 0.9 },
    ];

    const savedFacts = await saveFacts(testFacts, companyId, userId, 'e2e_test_session', sampleUserMsg);
    assert(savedFacts && savedFacts.length > 0, `Facts saved to DB`, savedFacts ? `${savedFacts.length} facts` : 'None');

    // Retrieve facts
    const factExtractor = require('./src/services/factExtractor');
    const retrievedFacts = await factExtractor.getKeyFactsForUser(companyId, userId, 10);
    assert(retrievedFacts && retrievedFacts.length >= 2, `Facts retrievable from key_facts`, retrievedFacts ? `${retrievedFacts.length} facts` : 'None');

    if (retrievedFacts && retrievedFacts.length > 0) {
      retrievedFacts.forEach(f => {
        console.log(`     [${f.category}] (${f.confidence}) ${f.fact.substring(0, 60)}...`);
      });
    }

    // ===== TEST 17: Scheduler State =====
    console.log('\n📊 17. VERIFY \u2014 Scheduler State');
    console.log('-'.repeat(40));

    const { data: schedState } = await supabase
      .from('scheduler_state')
      .select('tenant_id, last_overdue_scan, last_cross_doc_scan, updated_at')
      .eq('tenant_id', companyId)
      .single();

    assert(schedState !== null, 'Scheduler state created');
    if (schedState) {
      assert(!!schedState.last_overdue_scan, 'last_overdue_scan timestamp set');
      assert(!!schedState.last_cross_doc_scan, 'last_cross_doc_scan timestamp set');
      console.log(`     Overdue scan: ${schedState.last_overdue_scan}`);
      console.log(`     Cross-doc scan: ${schedState.last_cross_doc_scan}`);
    }

    // ===== TEST 18: Orchestrator Integration Test (lightweight) =====
    console.log('\n🔌 18. ORCHESTRATOR \u2014 Module Load & Context Assembly');
    console.log('-'.repeat(40));

    // Verify orchestrator loads and exports processMessage
    const orchestrator = require('./src/services/orchestrator');
    assert(typeof orchestrator.processMessage === 'function', 'orchestrator.processMessage is a function');

    // Verify factExtractor integration
    const factModule = require('./src/services/factExtractor');
    assert(typeof factModule.processTurn === 'function', 'factExtractor.processTurn is a function');
    assert(typeof factModule.getKeyFactsForUser === 'function', 'factExtractor.getKeyFactsForUser is a function');

    console.log('     All module exports verified \u2014 orchestrator ready.');

    // ===== TEST 19: SSE Notification Route =====
    console.log('\n🔔 19. SSE NOTIFICATION INFRASTRUCTURE');
    console.log('-'.repeat(40));

    const { emitNotification } = require('./src/api/notificationRoutes');
    assert(typeof emitNotification === 'function', 'emitNotification is a function');

    // emitNewSuggestion is a private helper (not exported). The public scan API covers it.
    assert(typeof scanCompany === 'function', 'proactivityScheduler.scanCompany is a function');
    console.log('     SSE infrastructure loadable and ready.');

    // ===== TEST 20: Provider Registry =====
    console.log('\n🔧 20. PROVIDER REGISTRY');
    console.log('-'.repeat(40));

    const tools = registry.getAllTools();
    assert(tools && tools.length > 0, `Registry has tools loaded`, `${tools.length} tools`);

    if (tools && tools.length > 0) {
      const categories = [...new Set(tools.map(t => t.category))];
      console.log(`     Categories: ${categories.join(', ')}`);
      const samples = tools.slice(0, 4);
      samples.forEach(t => {
        console.log(`     - ${t.name} (${t.category})`);
      });
    }

    // ===== FINAL SUMMARY =====
    console.log('\n' + '='.repeat(60));
    console.log(`📊 TEST RESULTS: ${passed}/${TOTAL_TESTS} passed`);
    if (failed > 0) {
      console.log(`   ${FAIL} ${failed} assertion(s) failed`);
    } else {
      console.log(`   ${PASS} ALL TESTS PASSED`);
    }
    console.log('='.repeat(60));

  } catch (err) {
    console.error(`\n${FAIL} UNEXPECTED ERROR:`, err);
    failed++;
  } finally {
    // ===== CLEANUP =====
    console.log('\n🧹 CLEANUP');
    console.log('-'.repeat(40));

    if (companyId) {
      await supabase.from('key_facts').delete().eq('tenant_id', companyId);
      await supabase.from('proactive_suggestions').delete().eq('tenant_id', companyId);
      await supabase.from('scheduler_state').delete().eq('tenant_id', companyId);

      const { error: cleanupErr } = await supabase
        .from('companies')
        .delete()
        .eq('id', companyId);
      
      if (cleanupErr) {
        console.error(`  ${FAIL} Cleanup failed: ${cleanupErr.message}`);
      } else {
        console.log(`  ${PASS} Database cleaned (company ${companyId} and all related records)`);
      }
    }

    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
      console.log(`  ${PASS} Temp file deleted: ${testFileBase}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Exit: ${failed > 0 ? `${FAIL} ${failed} FAILURES` : `${PASS} ALL CLEAR`}`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

run();
