const fs = require('fs');
const csv = require('csv-parser');
const mammoth = require('mammoth');
const officeParser = require('officeparser');
const { v4: uuidv4 } = require('uuid');
const { generateEmbedding } = require('./embeddingService');
const supabase = require('../models/supabaseClient');
const { emitNotification } = require('../api/notificationRoutes');
const { scanDocumentForAutomations } = require('./proactivityService');
const { groq } = require('./llmService');

// Basic text chunker
function chunkText(text, maxChars = 1000) {
    const chunks = [];
    let currentChunk = '';
    
    const sentences = text.split(/(?<=[.?!])\s+/);
    
    for (const sentence of sentences) {
        if ((currentChunk.length + sentence.length) > maxChars) {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = sentence + ' ';
        } else {
            currentChunk += sentence + ' ';
        }
    }
    
    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks;
}

async function parseFile(filePath, originalName, mimeType) {
    let text = '';
    
    if (mimeType === 'application/pdf') {
        // Dynamic import for pdf-parse (ESM/CJS compat)
        let pdfParse;
        try {
            const mod = require('pdf-parse');
            pdfParse = typeof mod === 'function' ? mod : mod.default;
        } catch {
            throw new Error('pdf-parse module not available');
        }
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        text = data.text;
    } else if (mimeType === 'text/csv') {
        const results = [];
        text = await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (data) => results.push(JSON.stringify(data)))
                .on('end', () => resolve(results.join('\n')))
                .on('error', reject);
        });
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mimeType === 'application/msword') {
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value;
    } else if (mimeType === 'application/json') {
        const data = fs.readFileSync(filePath, 'utf8');
        text = data;
    } else if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'text/x-markdown') {
        text = fs.readFileSync(filePath, 'utf8');
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
        const path = require('path');
        const ext = path.extname(originalName) || '.pptx';
        const tempFilePath = filePath + ext;
        fs.renameSync(filePath, tempFilePath);
        try {
            text = await officeParser.parseOffice(tempFilePath);
        } finally {
            fs.renameSync(tempFilePath, filePath); // Revert back so cleanup works
        }
    } else {
        throw new Error(`Unsupported file type: ${mimeType}`);
    }
    
    return text;
}

function isValidDate(dateStr) {
    if (!dateStr) return false;
    return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

async function classifyAndExtractTaxonomy(text, title, companyId) {
    try {
        const today = new Date().toISOString().split('T')[0];

        let existingDecisions = [];
        let existingActionItems = [];

        if (companyId) {
            try {
                const { data: decs } = await supabase
                    .from('decisions')
                    .select('id, text, made_by, date')
                    .eq('tenant_id', companyId)
                    .order('created_at', { ascending: false })
                    .limit(40);
                if (decs) existingDecisions = decs;

                const { data: acts } = await supabase
                    .from('action_items')
                    .select('id, task, assignee, due_date, status, sub_tasks')
                    .eq('tenant_id', companyId)
                    .eq('status', 'open')
                    .order('created_at', { ascending: false })
                    .limit(40);
                if (acts) existingActionItems = acts;
            } catch (dbErr) {
                console.warn('[IngestionService] Failed to fetch existing entities for context:', dbErr.message);
            }
        }

        let contextStr = '';
        if (existingDecisions.length > 0) {
            contextStr += '\n\n--- EXISTING RECENT DECISIONS (Use for deduplication check) ---\n';
            existingDecisions.forEach(d => {
                contextStr += `- [ID: ${d.id}] "${d.text}" (made by: ${d.made_by || 'Unknown'} on ${d.date || 'Unknown'})\n`;
            });
        }
        if (existingActionItems.length > 0) {
            contextStr += '\n\n--- EXISTING OPEN ACTION ITEMS (Use for deduplication & sub-task grouping checks) ---\n';
            existingActionItems.forEach(a => {
                const subTasksStr = Array.isArray(a.sub_tasks) && a.sub_tasks.length > 0
                    ? ` (sub-tasks: ${a.sub_tasks.map(st => st.text).join(', ')})`
                    : '';
                contextStr += `- [ID: ${a.id}] "${a.task}" (assignee: ${a.assignee || 'Unassigned'}, due: ${a.due_date || 'None'})${subTasksStr}\n`;
            });
        }

        // 1. Run a single lightweight LLM call on the first 20,000 characters to classify doc-level attributes
        const classificationPreview = text.substring(0, 20000);
        const classificationPrompt = `You are a business intelligence assistant analyzing internal company documents.
Analyze the following document titled "${title}".
Today's date is ${today}.

Classify it hierarchically into a department, a semantic type, and a sub-type.

Return a valid JSON object matching this schema:
{
  "department": "operations" | "product" | "commercial" | "finance" | "hr" | "general", 
  "semantic_type": "decision" | "action_item" | "reference_doc" | "discussion" | "knowledge",
  "sub_type": "string" (short descriptive category, e.g., 'roadmap', 'spec', 'feedback', 'process', 'vendor_deal', 'policy', 'budget', etc. - use 'general' if none match)
}
`;

        let department = 'general';
        let semantic_type = 'knowledge';
        let sub_type = 'general';

        try {
            const classResponse = await groq.chat.completions.create({
                model: 'openai/gpt-oss-120b',
                messages: [
                    { role: 'system', content: classificationPrompt },
                    { role: 'user', content: `Document content:\n${classificationPreview}` }
                ],
                temperature: 0.1,
                response_format: { type: 'json_object' }
            });
            const classResult = JSON.parse(classResponse.choices[0].message.content);
            department = classResult.department || 'general';
            semantic_type = classResult.semantic_type || 'knowledge';
            sub_type = classResult.sub_type || 'general';
        } catch (classErr) {
            console.error('[TaxonomyClassifier] Classification failed, using defaults:', classErr.message);
        }

        // 2. Extract decisions, action items, and contacts using chunked extraction to avoid output limit truncation
        const extractionPrompt = `You are a business intelligence assistant extracting details from internal company documents.
Analyze this excerpt of the document titled "${title}".
Today's date is ${today}.

Extract EVERY decision, action item, and business contact mentioned in this text segment.

Return a valid JSON object matching this schema:
{
  "decisions": [
    {
      "temp_id": "string (temporary ID e.g. decision_temp_1, decision_temp_2 to map relations)",
      "text": "The precise decision description",
      "made_by": "Name of the specific person who made the decision. For meeting transcripts or dialogue, inspect the dialogue specifically to identify the exact speaker (e.g. 'John' or 'Sarah') responsible for the decision. If a document is attributed to someone (e.g. 'Kareem's pitch deck'), use that person's name.",
      "date": "YYYY-MM-DD format of when it was decided or null",
      "roadmap_phase": "Which roadmap phase this decision relates to — one of: 'pre-seed', 'seed', 'series-a', 'series-b', 'series-c', 'ipo', or null if not related to a specific phase",
      "roadmap_objective": "The specific roadmap objective this decision relates to (e.g., 'MVP Development', 'Fundraising', 'Product Launch'). Use a short descriptive phrase. If not related to a specific objective, use null."
    }
  ],
  "action_items": [
    {
      "task": "The specific task to be done",
      "assignee": "Name of the assignee or null",
      "due_date": "YYYY-MM-DD format or null",
      "department": "operations" | "product" | "commercial" | "finance" | "hr" | "general",
      "status": "open",
      "related_decision_temp_id": "string (set to temp_id of decision extracted above if spawned by it, or null)",
      "related_decision_id": "string (set to existing decision database ID if spawned by an existing decision, or null)",
      "parent_action_id": "string (set to existing open action item database ID if this task is a sub-task or checklist item under that existing action item, otherwise null)",
      "sub_tasks": ["Sub-task step 1", "Sub-task step 2"]
    }
  ],
  "contacts": [
    {
      "name": "Full name of the person or company",
      "contact_type": "client" | "vendor" | "partner" | "investor",
      "company_name": "The organization they belong to or null",
      "email": "Their email if mentioned or null",
      "notes": "Brief context about the relationship or null"
    }
  ]
}

IMPORTANT INSTRUCTIONS:
- Decisions: Be aggressive. Extract ALL choices, agreements, commitments, resolutions, approvals, strategy changes, or rules decided upon. Look for both explicit statements and implicit context.
- Action Items: Extract EVERY task, to-do, follow-up, or assignment, whether explicitly labeled or implied. Do not skip any tasks.
- For action_items due_date: Intelligently resolve relative dates (e.g. "by Friday") relative to today (${today}).
- For action_items department: Assign the most relevant department based on task context.
- For action_items sub_tasks: If a task has nested steps or checklists, extract these as an array of strings in sub_tasks.
- For contacts: Extract external relationships only, not internal team members.

IMPORTANT DEDUPLICATION & GROUPING RULES:
1. Deduplicate Decisions: Check the document content against the "EXISTING RECENT DECISIONS" list. If a decision is already in the list, DO NOT output it in the "decisions" array.
2. Deduplicate Action Items: Check the document content against the "EXISTING OPEN ACTION ITEMS" list. If a task is already in that list, DO NOT create a duplicate action item.
3. Group related tasks as Sub-tasks: If a new task is actually a sub-step, detail, or checklist item under an existing open action item (from the "EXISTING OPEN ACTION ITEMS" list), DO NOT create a new action item. Instead, specify its "parent_action_id" pointing to the existing action item's ID, and list the task text as a new subtask item.
4. Link Action Items to Decisions: For any action item (new or existing mapped as subtask), if it is directly spawned by a decision extracted in this segment, set "related_decision_temp_id" to the "temp_id" of that decision. If it is related to an existing decision in the "EXISTING RECENT DECISIONS" list, set "related_decision_id" to the database ID of that decision.
`;

        const chunkSize = 25000;
        const overlap = 2000;
        const chunks = [];

        if (text.length <= chunkSize) {
            chunks.push(text);
        } else {
            let start = 0;
            while (start < text.length) {
                chunks.push(text.substring(start, start + chunkSize));
                start += chunkSize - overlap;
                // Guard against infinite loop
                if (chunkSize <= overlap) break;
            }
        }

        let allDecisions = [];
        let allActionItems = [];
        let allContacts = [];

        console.log(`[TaxonomyClassifier] Extracting details from ${chunks.length} segments of "${title}"...`);
        for (let i = 0; i < chunks.length; i++) {
            try {
                const chunkResponse = await groq.chat.completions.create({
                    model: 'openai/gpt-oss-120b',
                    messages: [
                        { role: 'system', content: extractionPrompt },
                        { role: 'user', content: `Document segment ${i + 1}/${chunks.length}:\n${chunks[i]}` }
                    ],
                    temperature: 0.1,
                    response_format: { type: 'json_object' }
                });

                const result = JSON.parse(chunkResponse.choices[0].message.content);
                if (Array.isArray(result.decisions)) allDecisions.push(...result.decisions);
                if (Array.isArray(result.action_items)) allActionItems.push(...result.action_items);
                if (Array.isArray(result.contacts)) allContacts.push(...result.contacts);
            } catch (chunkErr) {
                console.error(`[TaxonomyClassifier] Segment ${i + 1}/${chunks.length} extraction failed:`, chunkErr.message);
            }

            // Sleep briefly to avoid rate limit spikes on multiple calls
            if (chunks.length > 1 && i < chunks.length - 1) {
                await new Promise(r => setTimeout(r, 200));
            }
        }

        // De-duplicate decisions (by normalized text)
        const uniqueDecisions = [];
        const seenDecisions = new Set();
        for (const dec of allDecisions) {
            if (!dec || !dec.text) continue;
            const norm = dec.text.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
            if (!seenDecisions.has(norm)) {
                seenDecisions.add(norm);
                uniqueDecisions.push(dec);
            }
        }

        // De-duplicate action items (by normalized task)
        const uniqueActionItems = [];
        const seenActionItems = new Set();
        for (const item of allActionItems) {
            if (!item || !item.task) continue;
            const norm = item.task.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
            if (!seenActionItems.has(norm)) {
                seenActionItems.add(norm);
                uniqueActionItems.push(item);
            }
        }

        // De-duplicate contacts (by normalized name)
        const uniqueContacts = [];
        const seenContacts = new Set();
        for (const contact of allContacts) {
            if (!contact || !contact.name) continue;
            const norm = contact.name.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
            if (!seenContacts.has(norm)) {
                seenContacts.add(norm);
                uniqueContacts.push(contact);
            }
        }

        return {
            department,
            semantic_type,
            sub_type,
            decisions: uniqueDecisions,
            action_items: uniqueActionItems,
            contacts: uniqueContacts
        };

    } catch (err) {
        console.error('[TaxonomyClassifier] Error running taxonomy classifier:', err.message);
        return {
            department: 'general',
            semantic_type: 'knowledge',
            sub_type: 'general',
            decisions: [],
            action_items: [],
            contacts: []
        };
    }
}

async function ingestTextDocument(text, title, mimeType, companyId, userId = null, existingDocId = null) {
    // Run Taxonomy & Entity extraction
    console.log(`[Ingestion] Running taxonomy classification & entity extraction for "${title}"...`);
    const taxonomy = await classifyAndExtractTaxonomy(text, title, companyId);
    const { department, semantic_type, sub_type, decisions, action_items, contacts } = taxonomy;
    console.log(`[Ingestion] Classification: Department=${department}, Type=${semantic_type}, Sub-type=${sub_type}`);

    let sourceId = existingDocId;

    // If the document doesn't exist in brain_documents registry yet, register it
    if (!sourceId) {
        sourceId = uuidv4();
        const fileExtension = title.split('.').pop() || 'txt';
        const { error: regError } = await supabase
            .from('brain_documents')
            .insert([{
                id: sourceId,
                company_id: companyId,
                title: title,
                document_type: fileExtension,
                content: text,
                metadata: { source: 'ingested', mime_type: mimeType },
                department,
                semantic_type,
                sub_type
            }]);

        if (regError) {
            console.error(`[Ingestion] Registry insert error:`, regError.message);
        } else {
            console.log(`[Ingestion] Registered "${title}" with ID: ${sourceId}`);
        }
    } else {
        // Update the existing document with taxonomy classifications
        const { error: updateError } = await supabase
            .from('brain_documents')
            .update({ department, semantic_type, sub_type })
            .eq('id', sourceId);

        if (updateError) {
            console.error(`[Ingestion] Registry update error:`, updateError.message);
        }
    }

    // Chunk text
    const chunks = chunkText(text);

    // Embed each chunk and store in Supabase pgvector
    for (const chunk of chunks) {
        const embedding = await generateEmbedding(chunk);
        const chunkId = uuidv4();

        const { error } = await supabase.from('document_chunks').insert([{
            id: chunkId,
            tenant_id: companyId,
            content: chunk,
            embedding: JSON.stringify(embedding),
            source_type: 'document',
            source_id: sourceId,
            source_title: title,
            semantic_type,
            department,
            sub_type,
            metadata: {
                document_name: title,
                mime_type: mimeType,
                text_chunk: chunk,
            }
        }]);

        if (error) {
            console.error(`[Ingestion] Chunk insert error:`, error.message);
        }
    }

    // Insert extracted Decisions (retaining temp_id mapping to link Action Items)
    const insertedDecisions = [];
    if (decisions && decisions.length > 0) {
        for (const d of decisions) {
            const { data: newDec, error: decError } = await supabase
                .from('decisions')
                .insert([{
                    tenant_id: companyId,
                    source_doc_id: sourceId,
                    text: d.text,
                    made_by: d.made_by || null,
                    date: isValidDate(d.date) ? d.date : null,
                    roadmap_phase: d.roadmap_phase || null,
                    roadmap_objective: d.roadmap_objective || null
                }])
                .select()
                .single();
            if (decError) {
                console.error('[Ingestion] Error inserting decision:', decError.message);
            } else if (newDec) {
                insertedDecisions.push({ temp_id: d.temp_id, db_id: newDec.id });
            }
        }
    }

    // Insert or update extracted Action Items
    if (action_items && action_items.length > 0) {
        for (const a of action_items) {
            if (a.parent_action_id) {
                // Append to existing action item's sub_tasks
                const { data: existingItem, error: fetchErr } = await supabase
                    .from('action_items')
                    .select('sub_tasks')
                    .eq('id', a.parent_action_id)
                    .single();
                if (!fetchErr && existingItem) {
                    const currentSubTasks = existingItem.sub_tasks || [];
                    const newSubs = Array.isArray(a.sub_tasks) && a.sub_tasks.length > 0 ? a.sub_tasks : [a.task];
                    newSubs.forEach(text => {
                        if (text && !currentSubTasks.some(st => st.text.toLowerCase().trim() === text.toLowerCase().trim())) {
                            currentSubTasks.push({ id: uuidv4(), text, status: 'open' });
                        }
                    });
                    await supabase
                        .from('action_items')
                        .update({ sub_tasks: currentSubTasks })
                        .eq('id', a.parent_action_id);
                }
            } else {
                // Link to decision
                let decisionId = null;
                if (a.related_decision_id) {
                    decisionId = a.related_decision_id;
                } else if (a.related_decision_temp_id) {
                    const foundDec = insertedDecisions.find(idMap => idMap.temp_id === a.related_decision_temp_id);
                    if (foundDec) decisionId = foundDec.db_id;
                }

                const subTasksMapped = Array.isArray(a.sub_tasks)
                    ? a.sub_tasks.map(st => ({ id: uuidv4(), text: st, status: 'open' }))
                    : [];

                const { error: actError } = await supabase
                    .from('action_items')
                    .insert([{
                        tenant_id: companyId,
                        source_doc_id: sourceId,
                        task: a.task,
                        assignee: a.assignee || null,
                        due_date: isValidDate(a.due_date) ? a.due_date : null,
                        department: a.department || department,
                        status: a.status || 'open',
                        sub_tasks: subTasksMapped,
                        decision_id: decisionId
                    }]);
                if (actError) console.error('[Ingestion] Error inserting action items:', actError.message);
            }
        }
    }

    // Insert extracted Contacts
    if (contacts && contacts.length > 0) {
        const contactsToInsert = contacts.map(c => ({
            tenant_id: companyId,
            name: c.name,
            contact_type: c.contact_type || 'client',
            company_name: c.company_name || null,
            email: c.email || null,
            notes: c.notes || null,
            source_doc_id: sourceId
        }));
        const { error: contactError } = await supabase.from('contacts').insert(contactsToInsert);
        if (contactError) {
            // Table might not exist yet — log but don't fail
            if (!contactError.message.includes('does not exist')) {
                console.error('[Ingestion] Error inserting contacts:', contactError.message);
            }
        } else {
            console.log(`[Ingestion] Inserted ${contactsToInsert.length} contacts`);
        }
    }

    // Run background tasks sequentially with delays to prevent concurrent TPM spikes
    (async () => {
        try {
            await scanDocumentForAutomations(text, sourceId, companyId);
            await new Promise(r => setTimeout(r, 1500));
            await generateActionPlanAndNotify(text, title, userId);
            await new Promise(r => setTimeout(r, 1500));
            await proposeRoadmapAdjustments(text, title, companyId);
        } catch (err) {
            console.error('[Ingestion Background Tasks] Error:', err.message);
        }
    })();

    console.log(`[Ingestion] "${title}" → ${chunks.length} chunks embedded into pgvector`);
    return { 
        message: 'Document ingested successfully', 
        chunksProcessed: chunks.length,
        taxonomy: { department, semantic_type, sub_type },
        decisionsExtracted: decisions.length,
        actionItemsExtracted: action_items.length,
        contactsExtracted: contacts.length
    };
}

async function processDocument(filePath, originalName, mimeType, companyId, userId, existingDocId = null) {
    try {
        // Parse the document
        const text = await parseFile(filePath, originalName, mimeType);
        
        if (!text || text.trim() === '') {
            throw new Error('Extracted text is empty');
        }

        const result = await ingestTextDocument(text, originalName, mimeType, companyId, userId, existingDocId);

        // Clean up the temp file
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        return result;
    } catch (error) {
        console.error('Error processing document:', error);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        throw error;
    }
}

async function generateActionPlanAndNotify(text, docName, userId) {
    if (!userId) return;
    
    try {
        const preview = text.substring(0, 3000);
        const llmResponse = await groq.chat.completions.create({
            model: 'openai/gpt-oss-120b',
            messages: [
                { role: 'system', content: 'You are an AI assistant. Review the provided document excerpt. Return a JSON object with: "summary" (1-2 sentences), and "automations" (array of exactly 2 suggested action titles the user might want an agent to do with this doc, e.g. "Draft an email summary", "Send key points to Slack").' },
                { role: 'user', content: `Document: ${docName}\n\nExcerpt:\n${preview}` }
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' }
        });

        const plan = JSON.parse(llmResponse.choices[0].message.content);
        
        emitNotification(userId, {
            type: 'action_plan',
            document_name: docName,
            summary: plan.summary,
            automations: plan.automations
        });
    } catch (err) {
        console.error('[ActionPlan] Error generating plan:', err.message);
    }
}

async function proposeRoadmapAdjustments(text, title, companyId) {
  try {
    const preview = text.substring(0, 120000);
    const today = new Date().toISOString().split('T')[0];
    
    // Call LLM to see if we should suggest roadmap updates
    const prompt = `You are a strategic business analyst. Review this company document titled "${title}" (uploaded today, ${today}).
Determine if this document contains new strategic priorities, goals, major projects, or client requirements that should be added to the company's roadmap.
If it is a general reference document with no clear new tasks/milestones, return an empty list of objectives.
If there are indeed strategic additions, identify which roadmap phase they belong to ('pre-seed', 'seed', 'series-a', 'series-b', 'series-c', 'ipo') and suggest 1-2 new objectives with nested tasks/sub-tasks.

Return your response as JSON in this format:
{
  "shouldUpdate": boolean,
  "reason": "1-2 sentences explaining why this update is suggested based on the document",
  "objectives": [
    {
      "phase": "pre-seed" | "seed" | "series-a" | "series-b" | "series-c" | "ipo",
      "label": "Objective Name (e.g. 'Build Integration Pipeline')",
      "children": [
        { "label": "Task Name 1" },
        { "label": "Task Name 2" }
      ]
    }
  ]
}
`;

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Document content:\n${preview}` }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);
    if (result.shouldUpdate && Array.isArray(result.objectives) && result.objectives.length > 0) {
      // Find or launch/create a Roadmap agent execution to associate the output with
      let execId;
      const { data: existing } = await supabase
        .from('agent_executions')
        .select('id')
        .eq('company_id', companyId)
        .eq('agent_type', 'roadmap')
        .order('created_at', { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        execId = existing[0].id;
      } else {
        execId = uuidv4();
        const { error: insertErr } = await supabase.from('agent_executions').insert([{
          id: execId,
          company_id: companyId,
          agent_type: 'roadmap',
          agent_label: 'Roadmap Agent',
          status: 'completed',
          icon: 'map',
          color: '#a855f7',
          progress_pct: 100,
          current_action: 'Proposed roadmap update',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }]);
        if (insertErr) {
          console.error('[RoadmapProposer] Failed to insert agent execution:', insertErr.message);
        }
      }

      // Create a pending approval
      const { createApproval } = require('./approvalService');
      await createApproval({
        executionId: execId,
        companyId,
        outputType: 'roadmap_proposal',
        title: `Proposed Roadmap Update: ${title}`,
        summary: result.reason || `Based on document "${title}".`,
        content: {
          objectives: result.objectives
        }
      });
      console.log(`[Ingestion] Created pending roadmap update proposal for company ${companyId}`);
    }
  } catch (err) {
    console.error('[RoadmapProposer] Failed to propose roadmap updates:', err.message);
  }
}

module.exports = {
    processDocument,
    ingestTextDocument,
    parseFile
};
