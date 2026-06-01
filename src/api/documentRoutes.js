const express = require('express');
const supabase = require('../models/supabaseClient');
const path = require('path');
const fs = require('fs');
const llmService = require('../services/llmService');
const documentGen = require('../services/documentGenerationService');
const docEnhancer = require('../services/documentEnhancementService');
const retrievalService = require('../services/retrievalService');
const { searchWeb, extractSourceContent } = require('../services/webResearchEngine');

const router = express.Router();

/**
 * GET /api/documents
 * List all documents ingested in the Brain
 */
router.get('/', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('brain_documents')
      .select('*')
      .eq('company_id', req.user.company_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Documents] Supabase error:', error.message);
      // Return empty array if table doesn't exist yet
      if (error.message.includes('does not exist') || error.code === '42P01') {
        return res.json({ documents: [] });
      }
      throw error;
    }
    res.json({ documents: data || [] });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/documents/drafts
 * List all pending document drafts
 * NOTE: This MUST come before /:id routes to avoid Express matching "drafts" as an :id
 */
router.get('/drafts', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('document_drafts')
      .select('*')
      .eq('company_id', req.user.company_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Drafts] Supabase error:', error.message);
      if (error.message.includes('does not exist') || error.code === '42P01') {
        return res.json({ drafts: [] });
      }
      throw error;
    }
    res.json({ drafts: data || [] });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/documents/drafts/:id
 * Retrieve a specific draft by ID
 */
router.get('/drafts/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: draft, error } = await supabase
      .from('document_drafts')
      .select('*')
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .single();

    if (error || !draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    res.json({ draft });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/documents/drafts/:id/preview
 * Returns a faithful, format-aware HTML preview of the draft (same styling the
 * export uses): pptx → slide deck, csv/md/docx/pdf/html → styled document. The
 * frontend renders this in a sandboxed iframe so every file type previews in-OS.
 */
router.get('/drafts/:id/preview', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { data: draft, error } = await supabase
      .from('document_drafts')
      .select('id, title, content, format')
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .single();
    if (error || !draft) return res.status(404).json({ error: 'Draft not found' });

    const html = documentGen.buildPreviewHtml(draft.title || 'Document', draft.content || '', draft.format);
    res.json({ html, format: draft.format });
  } catch (err) {
    next(err);
  }
});


/**
 * PUT /api/documents/drafts/:id
 * Direct edit draft title/content/format
 */
router.put('/drafts/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { title, content, format } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (format !== undefined) updates.format = format;
    updates.updated_at = new Date().toISOString();

    const { data: updatedDraft, error } = await supabase
      .from('document_drafts')
      .update(updates)
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .select()
      .single();

    if (error || !updatedDraft) {
      return res.status(404).json({ error: 'Draft not found or update failed' });
    }

    res.json({ success: true, draft: updatedDraft });
  } catch (err) {
    next(err);
  }
});

/**
 * brain_search tool definition — allows the LLM to search the company's knowledge base
 * during draft editing to fulfill user edit requests with real data.
 */
const BRAIN_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'brain_search',
    description: 'Search the company knowledge base (The Brain) for relevant information, documents, meetings, decisions, or any data that could help you fulfill the user edit request.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to find relevant information in the company knowledge base'
        }
      },
      required: ['query']
    }
  }
};

/**
 * Execute a brain_search tool call — searches the company's vector store for relevant context.
 */
async function executeBrainSearch(query, companyId) {
  try {
    const results = await retrievalService.retrieveCompanyContextDetailed(query, companyId);
    if (!results || results.length === 0) {
      return JSON.stringify({ found: false, message: 'No relevant information found in the Brain for your query.' });
    }
    const formatted = results.slice(0, 6).map((r, i) => {
      const title = r.source_title || 'Untitled';
      const dept = r.department ? ` [${r.department}]` : '';
      return `[${i + 1}] Source: ${title}${dept}\n${r.content}`;
    }).join('\n\n---\n\n');
    return JSON.stringify({ found: true, results: formatted, count: results.length });
  } catch (err) {
    console.error('[BrainSearch] Error:', err.message);
    return JSON.stringify({ found: false, message: 'Search failed: ' + err.message });
  }
}

/**
 * web_search_trusted tool definition — allows searching the web for real-world details
 */
const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search_trusted',
    description: 'Search the web for information',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        maxResults: { type: 'number', description: 'Max results (1-10)' },
      },
      required: ['query'],
    },
  },
};

/**
 * web_extract_source_content tool definition — allows extracting readable webpage content
 */
const WEB_EXTRACT_TOOL = {
  type: 'function',
  function: {
    name: 'web_extract_source_content',
    description: 'Extract readable content from a URL',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to extract' },
        maxChars: { type: 'number', description: 'Max characters' },
      },
      required: ['url'],
    },
  },
};


/**
 * POST /api/documents/drafts/:id/comment
 * Add a user comment to a draft (for revision requests).
 * 
 * ENHANCED: Now fetches company context from the Brain and gives the LLM
 * a brain_search tool so it can look up real company data to fulfill edit requests.
 */
router.post('/drafts/:id/comment', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { comment } = req.body;
    if (!comment) return res.status(400).json({ error: 'Comment is required' });

    // 1. Get current draft
    const { data: draft, error: fetchError } = await supabase
      .from('document_drafts')
      .select('*')
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .single();

    if (fetchError || !draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    // 2. Parse comments history
    let commentHistory = [];
    if (draft.user_comments) {
      try {
        commentHistory = JSON.parse(draft.user_comments);
        if (!Array.isArray(commentHistory)) {
          commentHistory = [{ sender: 'user', message: draft.user_comments, timestamp: draft.updated_at || new Date().toISOString() }];
        }
      } catch {
        commentHistory = [{ sender: 'user', message: draft.user_comments, timestamp: draft.updated_at || new Date().toISOString() }];
      }
    }

    // Append new user comment
    commentHistory.push({
      sender: 'user',
      message: comment,
      timestamp: new Date().toISOString()
    });

    // 3. Pre-fetch company context relevant to the edit request
    let companyContextStr = '';
    try {
      const smartContext = await retrievalService.retrieveSmartContext(
        comment,
        commentHistory.map(c => ({ role: c.sender === 'user' ? 'user' : 'assistant', content: c.message })),
        req.user.company_id
      );
      const contextParts = [];

      if (smartContext.chunks && smartContext.chunks.length > 0) {
        const docContext = smartContext.chunks.slice(0, 5).map(c => {
          const title = c.source_title || 'Document';
          return `[${title}]: ${c.content}`;
        }).join('\n\n');
        contextParts.push(`Relevant information from the company knowledge base:\n${docContext}`);
      }

      if (smartContext.openItems && smartContext.openItems.length > 0) {
        contextParts.push(`Open action items:\n${smartContext.openItems.map(i => `  - ${i.task} (${i.assignee || 'Unassigned'})${i.due_date ? ' due: ' + i.due_date : ''}`).join('\n')}`);
      }

      if (smartContext.recentDecisions && smartContext.recentDecisions.length > 0) {
        contextParts.push(`Recent decisions:\n${smartContext.recentDecisions.map(d => `  - ${d.text}${d.made_by ? ' (by ' + d.made_by + ')' : ''}`).join('\n')}`);
      }

      if (smartContext.recentMeetings && smartContext.recentMeetings.length > 0) {
        contextParts.push(`Recent meetings:\n${smartContext.recentMeetings.map(m => `  - ${m.title} (${new Date(m.meeting_date).toLocaleDateString()})`).join('\n')}`);
      }

      if (contextParts.length > 0) {
        companyContextStr = '\n\n--- COMPANY KNOWLEDGE CONTEXT ---\n' + contextParts.join('\n\n') + '\n--- END OF COMPANY CONTEXT ---';
      }
    } catch (ctxErr) {
      console.warn('[DraftComment] Failed to fetch company context:', ctxErr.message);
    }

    // 4. Build messages with context and brain_search tool
    const systemContent = `You are The Brain's document editor — you revise document drafts based on user feedback.

${companyContextStr ? `You have been provided with relevant context from the company's knowledge base. Use this information to accurately fulfill the user's edit request. If the context contains the data the user is asking about, incorporate it directly into the revised document.${companyContextStr}` : 'You can use the brain_search tool to look up information from the company knowledge base if you need more context to fulfill the edit request.'}

In addition to searching the Brain, you have tools to search the web (web_search_trusted) and extract content from websites/links (web_extract_source_content). You MUST use these tools to research real-world info (like finding real investors, competitors, metrics, or market standards) if the user asks you to include external or current information.

CRITICAL INSTRUCTIONS:
1. Take the user's edit request seriously — make real, substantive changes to the document content.
2. If the user asks to add specific data (revenue figures, dates, names, etc.), search the Brain or search the web. DO NOT fabricate data.
3. If the user's feedback is vague (e.g., "improve this section"), use your best judgment to make meaningful improvements.
4. If the Brain or web search has no relevant information, clearly say so in the summary and make the best possible edit with what you have.
5. Keep the format consistent with the original (markdown/text).
6. Return the ENTIRE revised document content — not just the changed sections.

You MUST return your final response as a JSON object with exactly two fields:
{
  "revisedContent": "The complete revised document content here",
  "summaryOfChanges": "- Bullet point summary of what changes you made\n- And why"
}`;

    const userContent = `Current Title: ${draft.title}
Format: ${draft.format}

Current Content:
---
${draft.content}
---

User Feedback / Comment:
${comment}

Please revise the document content and return the JSON response.`;

    // 5. Mini-orchestration loop: allow the LLM to use brain_search and web tools
    const MAX_EDIT_ITERATIONS = 4;
    let messages = [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent }
    ];

    let revisedContent = draft.content;
    let summaryOfChanges = 'Revised document based on comments.';
    let toolsUsed = [];
    let editIteration = 0;
    const availableTools = [BRAIN_SEARCH_TOOL, WEB_SEARCH_TOOL, WEB_EXTRACT_TOOL];

    while (editIteration < MAX_EDIT_ITERATIONS) {
      editIteration++;

      const llmRes = await llmService.callLLMWithTools(messages, availableTools, { temperature: 0.3 });

      // If the LLM wants to run a tool
      if (llmRes.tool_calls && llmRes.tool_calls.length > 0) {
        for (const tc of llmRes.tool_calls) {
          if (tc.function.name === 'brain_search') {
            const args = JSON.parse(tc.function.arguments);
            console.log('[DraftComment] AI searching Brain for:', args.query);
            const searchResult = await executeBrainSearch(args.query, req.user.company_id);
            toolsUsed.push({ name: 'brain_search', query: args.query });

            messages.push({
              role: 'assistant',
              content: null,
              tool_calls: [tc]
            });
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: searchResult
            });
          } else if (tc.function.name === 'web_search_trusted') {
            const args = JSON.parse(tc.function.arguments);
            console.log('[DraftComment] AI searching web for:', args.query);
            let searchResult;
            try {
              const res = await searchWeb(args.query, { maxResults: args.maxResults || 8 });
              searchResult = JSON.stringify(res.results.slice(0, 8));
            } catch (err) {
              searchResult = JSON.stringify({ error: true, message: err.message });
            }
            toolsUsed.push({ name: 'web_search_trusted', query: args.query });
            messages.push({
              role: 'assistant',
              content: null,
              tool_calls: [tc]
            });
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: searchResult
            });
          } else if (tc.function.name === 'web_extract_source_content') {
            const args = JSON.parse(tc.function.arguments);
            console.log('[DraftComment] AI extracting content from URL:', args.url);
            let extractResult;
            try {
              const res = await extractSourceContent(args.url, { maxChars: args.maxChars || 8000 });
              extractResult = JSON.stringify({
                title: res.title,
                content: res.textContent?.substring(0, 5000) || '',
                url: res.url
              });
            } catch (err) {
              extractResult = JSON.stringify({ error: true, message: err.message });
            }
            toolsUsed.push({ name: 'web_extract_source_content', url: args.url });
            messages.push({
              role: 'assistant',
              content: null,
              tool_calls: [tc]
            });
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: extractResult
            });
          }
        }
        continue; // Let the LLM process the search results
      }

      // No tool calls — this is the final response
      let cleaned = (llmRes.content || '').trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```\w*\s*/, '').replace(/\s*```$/, '').trim();
      }

      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (parseErr) {
        console.warn('[DraftComment] JSON parse failed, trying LLM self-healing recovery. Raw snippet:', cleaned.substring(0, 150));
        try {
          const recoveryRes = await llmService.callLLMWithTools([
            {
              role: 'system',
              content: 'You are a JSON formatting assistant. Extract and return a valid JSON object matching the requested schema. Return ONLY the JSON object, with no markdown backticks and no extra text.'
            },
            {
              role: 'user',
              content: `Extract the JSON object with fields "revisedContent" and "summaryOfChanges" from this malformed text:
---
${llmRes.content}
---`
            }
          ], [], { temperature: 0.1 });

          let recoveredText = (recoveryRes.content || '').trim();
          if (recoveredText.startsWith('```json')) {
            recoveredText = recoveredText.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
          } else if (recoveredText.startsWith('```')) {
            recoveredText = recoveredText.replace(/^```\w*\s*/, '').replace(/\s*```$/, '').trim();
          }
          parsed = JSON.parse(recoveredText);
        } catch (recoveryErr) {
          console.error('[DraftComment] LLM JSON recovery failed:', recoveryErr.message);
        }
      }

      if (parsed && parsed.revisedContent) revisedContent = parsed.revisedContent;
      if (parsed && parsed.summaryOfChanges) summaryOfChanges = parsed.summaryOfChanges;

      if (!parsed || !parsed.revisedContent) {
        // Regex fallback
        const contentMatch = llmRes.content.match(/"revisedContent"\s*:\s*"([\s\S]*?)"\s*,\s*"summaryOfChanges"/i)
          || llmRes.content.match(/"revisedContent"\s*:\s*"([\s\S]*?)"\s*}/i);
        const summaryMatch = llmRes.content.match(/"summaryOfChanges"\s*:\s*"([\s\S]*?)"/i);

        if (contentMatch && contentMatch[1]) {
          revisedContent = contentMatch[1]
            .replace(/\\n/g, '\n')
            .replace(/\\"/g, '"')
            .replace(/\\t/g, '\t');
        } else if (!llmRes.content.includes('"revisedContent"')) {
          revisedContent = llmRes.content;
        }

        if (summaryMatch && summaryMatch[1]) {
          summaryOfChanges = summaryMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
        }
      }
      break;
    }

    // Append AI reply to comment history
    commentHistory.push({
      sender: 'ai',
      message: summaryOfChanges,
      timestamp: new Date().toISOString()
    });

    // 6. Update draft in database
    const { data: updatedDraft, error: updateError } = await supabase
      .from('document_drafts')
      .update({
        content: revisedContent,
        summary_of_changes: summaryOfChanges,
        user_comments: JSON.stringify(commentHistory),
        updated_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .select()
      .single();

    if (updateError) throw updateError;
    res.json({ success: true, draft: updatedDraft, toolsUsed });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/documents/drafts/:id/reject
 * Reject a draft
 */
router.post('/drafts/:id/reject', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { error } = await supabase
      .from('document_drafts')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id);

    if (error) throw error;
    res.json({ success: true, message: 'Draft rejected' });
  } catch (err) {
    next(err);
  }
});

/**
 * Helper to generate actual files — now uses DocumentGenerationService
 * for professional PDF, DOCX, PPTX, and CSV output.
 */
async function generateFile(title, content, format, outputPath, options = {}) {
  return documentGen.generateFile(title, content, format, outputPath, options);
}

/**
 * POST /api/documents/drafts/:id/approve
 * Approve a draft, generate file, and ingest into brain
 */
router.post('/drafts/:id/approve', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    // Fetch draft
    const { data: draft, error: fetchError } = await supabase
      .from('document_drafts')
      .select('*')
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .single();

    if (fetchError || !draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    // Generate physical file
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const safeName = draft.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `${safeName}_${Date.now()}.${draft.format}`;
    const filePath = path.join(uploadsDir, fileName);

    await generateFile(draft.title, draft.content, draft.format, filePath);

    // Ingest into brain_documents
    const { data: docData, error: insertError } = await supabase
      .from('brain_documents')
      .insert([{
        company_id: req.user.company_id,
        title: draft.title,
        document_type: draft.format,
        content: draft.content,
        metadata: { source: 'ai_generated', draft_id: draft.id },
        file_path: `/uploads/${fileName}`
      }])
      .select()
      .single();

    if (insertError) {
      console.error('[Documents] Insert error:', insertError.message);
      throw insertError;
    }

    // Fire-and-forget: index into vector store for retrieval
    try {
      const { processDocument } = require('../services/ingestionService');
      processDocument(filePath, `${draft.title}.${draft.format}`, 'text/plain', req.user.company_id, req.user.id, docData.id)
        .catch(err => console.error('Failed to index approved document:', err.message));
    } catch (err) {
      console.warn('[Documents] Ingestion service not available:', err.message);
    }

    // Update draft status
    await supabase
      .from('document_drafts')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', draft.id);

    res.json({ success: true, document: docData, downloadUrl: `/uploads/${fileName}` });
  } catch (err) {
    next(err);
  }
});
/**
 * GET /api/documents/:id
 * Retrieve a specific document by ID
 */
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: doc, error } = await supabase
      .from('brain_documents')
      .select('*')
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .single();

    if (error || !doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json({ document: doc });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/documents/:id
 * Delete a document and ALL associated data from The Brain, including:
 * - brain_documents record (cascades to decisions & action_items via FK)
 * - document chunks (vector embeddings)
 * - proactive suggestions
 * - contacts
 * - proposed automations
 * - physical file on disk
 * NOTE: This comes AFTER /drafts routes so Express doesn't match "drafts" as an :id
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const docId = req.params.id;
    const tenantId = req.user.company_id;

    // 1. Get the document info (for file path) before deleting
    const { data: doc } = await supabase
      .from('brain_documents')
      .select('id, file_path')
      .eq('id', docId)
      .eq('company_id', tenantId)
      .single();

    // 2. Delete document chunks (vector embeddings)
    await supabase
      .from('document_chunks')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('source_id', docId);

    // 3. Delete proactive suggestions linked to this document
    await supabase
      .from('proactive_suggestions')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('source_entity_id', docId);

    // 4. Delete contacts linked to this document
    await supabase
      .from('contacts')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('source_doc_id', docId);

    // 5. Delete proposed automations linked to this document
    await supabase
      .from('proposed_automations')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('source_doc_id', docId);

    // 6. Delete the brain_documents record
    //    (ON DELETE CASCADE handles decisions & action_items automatically)
    const { error } = await supabase
      .from('brain_documents')
      .delete()
      .eq('id', docId)
      .eq('company_id', tenantId);

    if (error) throw error;

    // 7. Delete physical file from disk
    if (doc && doc.file_path) {
      const filePath = path.join(__dirname, '../..', doc.file_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[Documents] Deleted physical file: ${filePath}`);
      }
    }

    res.json({ success: true, message: 'Document and all associated data deleted successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/documents/export
 * Export a document to a specified format with LLM-enhanced content
 */
router.post('/export', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { title, content, format = 'pdf', enhance = true } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const docTitle = title || documentGen.extractTitle(content);

    // Optionally enhance content via LLM. Skip for content that is already a full
    // HTML document (enhancing would mangle the artifact) and fail open on any error.
    let finalContent = content;
    let enhancementMeta = null;
    const isHtmlDoc = /^\s*<(?:!doctype html|html[\s>])/i.test(String(content).trim());
    if (enhance && !isHtmlDoc) {
      try {
        const enhanced = await docEnhancer.enhanceForFormat(docTitle, content, format);
        finalContent = enhanced.content;
        enhancementMeta = enhanced.metadata;
      } catch (e) {
        console.warn('[Export] Enhancement failed, exporting raw content:', e.message);
      }
    }

    // Generate the file
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const safeName = docTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `${req.user.company_id}_${safeName}_export_${Date.now()}.${format}`;
    const filePath = path.join(uploadsDir, fileName);

    await documentGen.generateFile(docTitle, finalContent, format, filePath);

    res.json({
      success: true,
      downloadUrl: `/uploads/${fileName}`,
      format,
      fileName,
      enhanced: !!enhancementMeta,
      metadata: enhancementMeta,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/documents/enhance
 * Enhance document content using LLM (preview before export)
 */
router.post('/enhance', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { title, content, format = 'pdf' } = req.body;
    if (!content) return res.status(400).json({ error: 'Content is required' });

    const docTitle = title || documentGen.extractTitle(content);
    const enhanced = await docEnhancer.enhanceForFormat(docTitle, content, format);

    // Also get a brief
    const brief = await docEnhancer.generateBrief(docTitle, content);

    res.json({
      success: true,
      enhanced,
      brief,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/documents/convert
 * Convert an existing document from one format to another
 */
router.post('/convert', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { documentId, targetFormat = 'pdf', enhance = false } = req.body;
    if (!documentId) return res.status(400).json({ error: 'documentId is required' });

    // Fetch document from DB
    const { data: doc, error } = await supabase
      .from('brain_documents')
      .select('*')
      .eq('id', documentId)
      .eq('company_id', req.user.company_id)
      .single();

    if (error || !doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    let content = doc.content || '';
    let title = doc.title;

    // If there's a physical file path and no content stored, read from file
    if (!content && doc.file_path) {
      const filePath = path.join(__dirname, '../..', doc.file_path);
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, 'utf8');
      }
    }

    if (!content) {
      return res.status(400).json({ error: 'No content available for this document' });
    }

    // Optionally enhance
    if (enhance) {
      const enhanced = await docEnhancer.enhanceForFormat(title, content, targetFormat);
      content = enhanced.content;
    }

    // Generate the file
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const safeName = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `${req.user.company_id}_${safeName}_converted_${Date.now()}.${targetFormat}`;
    const filePath = path.join(uploadsDir, fileName);

    await documentGen.generateFile(title, content, targetFormat, filePath);

    res.json({
      success: true,
      downloadUrl: `/uploads/${fileName}`,
      format: targetFormat,
      fileName,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/documents/drafts/:id/approve
 * Approve a draft, generate premium file, and ingest into brain
 */
router.post('/drafts/:id/enhanced-approve', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { format: targetFormat } = req.body;
    const exportFormat = targetFormat || 'pdf';

    // Fetch draft
    const { data: draft, error: fetchError } = await supabase
      .from('document_drafts')
      .select('*')
      .eq('id', req.params.id)
      .eq('company_id', req.user.company_id)
      .single();

    if (fetchError || !draft) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    // Enhance content for the target format
    const enhanced = await docEnhancer.enhanceForFormat(draft.title, draft.content, exportFormat);

    // Generate physical file
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const safeName = enhanced.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `${safeName}_${Date.now()}.${exportFormat}`;
    const filePath = path.join(uploadsDir, fileName);

    await documentGen.generateFile(enhanced.title, enhanced.content, exportFormat, filePath);

    // Ingest into brain_documents
    const { data: docData, error: insertError } = await supabase
      .from('brain_documents')
      .insert([{
        company_id: req.user.company_id,
        title: enhanced.title,
        document_type: exportFormat,
        content: enhanced.content,
        metadata: {
          source: 'ai_generated',
          draft_id: draft.id,
          enhanced: true,
          quality_score: enhanced.metadata?.qualityScore,
          word_count: enhanced.metadata?.wordCount,
        },
        file_path: `/uploads/${fileName}`
      }])
      .select()
      .single();

    if (insertError) {
      console.error('[Documents] Insert error:', insertError.message);
      throw insertError;
    }

    // Fire-and-forget: index into vector store
    try {
      const { processDocument } = require('../services/ingestionService');
      processDocument(filePath, `${enhanced.title}.${exportFormat}`, 'text/plain', req.user.company_id, req.user.id, docData.id)
        .catch(err => console.error('Failed to index approved document:', err.message));
    } catch (err) {
      console.warn('[Documents] Ingestion service not available:', err.message);
    }

    // Update draft status
    await supabase
      .from('document_drafts')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', draft.id);

    res.json({
      success: true,
      document: docData,
      downloadUrl: `/uploads/${fileName}`,
      format: exportFormat,
      metadata: enhanced.metadata,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = { router, generateFile };
