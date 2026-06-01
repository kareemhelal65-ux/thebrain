const { callLLMWithTools } = require('./llmService');
const { parseLooseJson } = require('../utils/looseJson');
const { resolveToolsForCompany, toFunctionCallingFormat } = require('../providers/registry');
const sentinel = require('../middleware/sentinel');
const { emitNotification } = require('../api/notificationRoutes');
const { processTurn: extractFacts, getKeyFactsForUser } = require('./factExtractor');

/**
 * Orchestrator — The Central Nervous System Loop
 * 
 * Flow:
 * 1. Context Assembly (company config, org memory [multi-strategy], tiered memory [exact + summaries + facts], available tools)
 * 2. Conversation-aware expanded query for retrieval
 * 3. LLM Call (with tool definitions)
 * 4. If tool_call → Sentinel Validate → Adapter Execute → Emit status → Feed result back → Loop
 * 5. If text response → Return to user with source citations
 * 
 * Supports multi-step tool chains with MAX_ITERATIONS safety limit.
 */

const BASE_MAX_ITERATIONS = parseInt(process.env.MAX_TOOL_ITERATIONS) || 8;

// Dynamic iteration limit based on tool activation counts
// Simple tools get fewer loops, complex research chains get more
function computeIterationLimit(toolsActivated, msgLength) {
  let limit = BASE_MAX_ITERATIONS;
  // Research tools need more iterations for multi-step lookups
  if (toolsActivated.has('web_search_trusted') ||
      toolsActivated.has('research_multi_source_synthesis')) {
    limit = Math.max(limit, 12);
  }
  // Complex chains involving multiple tools
  if (toolsActivated.size >= 3) {
    limit = Math.max(limit, 14);
  }
  // Very long user messages likely contain complex requests
  if (msgLength > 500) {
    limit = Math.max(limit, 10);
  }
  return limit;
}

// Detect if the LLM is repeating itself (same tool same args)
function detectRepetition(auditTrail) {
  if (auditTrail.length < 4) return false;
  const last = auditTrail.slice(-2);
  if (last.length < 2) return false;
  return last[0].tool === last[1].tool &&
         JSON.stringify(last[0].parsedArgs) === JSON.stringify(last[1].parsedArgs);
}

const SYSTEM_PROMPT = `You are "The Brain" — an AI Operating System that runs businesses. You have deep knowledge of the company's data from meetings, documents, Slack messages, emails, and connected integrations.

CRITICAL BEHAVIORAL RULES — NEVER VIOLATE THESE:

1. **NEVER expose internal tool calls to the user.** You must NEVER show JSON, tool call syntax, function names, API calls, parameters, or any internal mechanism in your response. The user should only see natural, conversational answers. If you need to use a tool, use it through the function calling mechanism — NEVER write tool calls as text.

2. **Search Brain context FIRST.** Before attempting any external tool call, always review the company context provided to you. Most questions can be answered from what's already in The Brain's memory (meetings, documents, Slack, etc.).

3. **Be transparent about what you find.** If you searched the Brain and connected sources but found NO relevant information, say so clearly: "I couldn't find any information about [topic] in your company's data. You may need to upload the relevant documents or connect the integration."

4. **Never fabricate data.** Do not invent financial figures, dates, names, or any business data. Only report what you actually find in the context or from tool results.

5. **Use tools silently.** When you DO use a tool (via function calling), process the result internally and present only the meaningful output to the user in a clean, formatted way.

6. **Format responses for readability.** Use bullet points, bold text, and clear structure. Present data in tables when appropriate.

7. **Detect and match the user's language.** Reply in the same language the user writes in. All internal tool parameters must use English keys regardless.

8. **If a required integration is not connected,** tell the user: "To access [service], you'll need to connect it in Settings > Integrations."

9. **File & Document Creation.** If the user asks you to create a document, generate a CSV, or write a file, you MUST use the \`document_create_draft\` tool. Never say "I don't have the capability to make files". If the tool is not available in your list, politely explain that your current agent role does not have file creation capabilities enabled.
   - You must differentiate the output format based on the business use case:
     - Use \`pdf\` for finalized, locked, client-ready, or board deliverables.
     - Use \`md\` (markdown) for internal specs, PRDs, readmes, technical playbooks, or wikis.
     - Use \`csv\` for spreadsheet-based exports, contacts/leads lists, raw directories, or structured tables.
     - Use \`docx\` (for Word doc) for formal reports, business memos, proposals, and narrative text.
     - Use \`pptx\` for pitch decks, slides, and presentation decks.
     - Use \`html\` for formatted webpages, newsletters, or email templates.
   - If the appropriate format is not explicitly requested by the user and is not obvious from the context, you MUST first ask the user which format they prefer by calling the \`ask_user_question\` tool with selectable choices: 'PDF', 'Word Document (DOCX)', 'Markdown (MD)', 'CSV Spreadsheet', 'PowerPoint (PPTX)', 'HTML Webpage'. Do not make a blind guess.

10. **High-effort, detailed documents.** When creating or editing documents via \`document_create_draft\` or \`document_edit_draft\`, you MUST ensure they are comprehensive, detailed, highly structured, and rich in depth (typically 500-1000 words). Never generate short summaries, brief bullet points, or placeholders. Include thorough sections, analysis, detailed tables if applicable, and deep context to ensure premium effort and maximum business utility.

11. **Maintain conversation continuity.** Rely on the conversation history for follow-up questions, clarifications, meta-questions, and chat references, rather than solely on the company context. If the user refers to something previously discussed (e.g., "why did you say that?" or "explain what you just said"), search the conversation history first and answer accurately based on what was said, rather than defaulting to saying you couldn't find context.

12. **NEVER promise future autonomous work.** You act within THIS turn only. Do NOT say things like "Once you approve, I'll generate the logos" or "After you approve this brief I'll create the designs" — you will NOT automatically continue after an approval, so such promises strand the user. Produce the actual deliverable NOW, in this response.

13. **Visual assets (logos, icons, graphics, banners, simple mockups).** Do NOT write a "brief" and promise to design later, and do NOT generate raster images. Instead, produce the assets IMMEDIATELY as self-contained code IN YOUR REPLY: provide 2-4 distinct concepts, each inside a fenced \`\`\`svg code block (or \`\`\`html for richer compositions). The app renders these blocks as live previews, so the user sees the actual logos right away. Example:
\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="#6366f1"/><text x="60" y="72" font-size="40" fill="#fff" text-anchor="middle" font-family="sans-serif">B</text></svg>
\`\`\`
Briefly caption each concept. Only create a document draft if the user explicitly wants a written brief.

12. **Multi-step planning.** When asked to perform a complex task (e.g., "draft an email about the Q3 strategy and send it to the team"):
   - Silently plan the steps you need to take
   - Execute each step using the appropriate tool
   - After each tool completes, review the result before proceeding
   - Present the overall result to the user clearly

13. **Source citation.** When providing information retrieved from the company knowledge base, cite the source document title where relevant (e.g., "According to the Q3 Strategy Document..."). This builds trust and helps users verify information.

14. **Proactive suggestions.** After answering a question, if you notice relevant open action items, upcoming deadlines, or related documents the user should know about, mention them briefly. Don't overwhelm — just 1-2 relevant suggestions.

15. **Research-driven answers when relevant.** If the user asks about external information — market trends, competitors, news, pricing, technical specs, or any topic that requires current external data — you MUST proactively use your web research tools (\`web_search_trusted\`, \`web_extract_source_content\`) to gather real data. Do not guess or say "I don't have access." The research tools can search the web, extract content from URLs, and synthesize findings.

16. **Use research tools proactively for external context.** When the user asks questions that benefit from external knowledge (e.g., "What's happening in the AI market?" or "Tell me about company X"), immediately use the web_search_trusted tool. Present real findings with source URLs.

17. **Intelligence gathering.** For deep research tasks (competitor analysis, market research, due diligence), use multiple research tools in sequence: first search to find sources, then extract content from the best sources, then synthesize a report. Cite your sources clearly.`;

/**
 * Strip any accidentally leaked tool-call formatting from LLM responses.
 * Some models (especially Llama) occasionally emit markdown tool blocks.
 */
function sanitizeResponse(text) {
  if (!text) return text;
  // Remove markdown code blocks that look like tool calls
  let cleaned = text.replace(/\*\*Tool Call:.*?\*\*\s*```[\s\S]*?```/gi, '');
  // Remove standalone tool-call JSON blocks
  cleaned = cleaned.replace(/```json\s*\{[\s\S]*?"action"[\s\S]*?\}\s*```/gi, '');
  // Remove "Please wait while I retrieve/fetch/call..." patterns
  cleaned = cleaned.replace(/\*\*Please wait while I (?:retrieve|fetch|call|access).*?\*\*/gi, '');
  // Remove empty lines left behind
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned || 'I\'m looking into that for you. Could you provide more details about what you need?';
}

/**
 * Process a user message through the full orchestration loop.
 * 
 * @param {Object} params
 * @param {string} params.message - The user's message
 * @param {string} params.sessionId - Conversation session ID
 * @param {Object} params.user - { id, company_id, role }
 * @param {string} params.agentId - Optional. ID of a specific Soft Agent.
 * @param {string} params.systemPrompt - Optional. Override the default system prompt (used for agent-chat flow).
 * @returns {Promise<Object>} { reply, toolsUsed, auditTrail }
 */
async function logTask(user, sessionId, message, agentId, reply, toolsUsed, latencyMs, orgMemory) {
  try {
    const supabaseClient = require('../models/supabaseClient');
    const crypto = require('crypto');
    
    // Hash context if present
    const contextString = orgMemory || '';
    const contextHash = contextString ? crypto.createHash('md5').update(contextString.substring(0, 5000)).digest('hex') : null;
    
    await supabaseClient.from('task_log').insert([{
      tenant_id: user.company_id,
      user_id: user.id,
      session_id: sessionId || null,
      intent: message.trim().substring(0, 500),
      intent_class: agentId ? 'agent_task' : 'orchestrator_task',
      context_hash: contextHash,
      agent_used: agentId || 'orchestrator',
      result_summary: (typeof reply === 'string' ? reply : (reply?.question || '')).substring(0, 200),
      latency_ms: latencyMs,
      tool_calls_count: toolsUsed?.length || 0,
      sources_count: 0,
      status: 'completed'
    }]);
  } catch (err) {
    if (err?.code !== '42P01') {
      console.warn('[Orchestrator Task Log] Failed to insert task log:', err.message);
    }
  }
}

async function processMessage(params) {
  const startTime = Date.now();
  const result = await _processMessage(params);
  const latencyMs = Date.now() - startTime;
  
  // Log the task asynchronously so we don't block the request
  const { message, sessionId, user, agentId } = params;
  const replyText = result.type === 'question' ? result.question : (result.reply || '');
  
  logTask(user, sessionId, message, agentId, replyText, result.toolsUsed, latencyMs, result.sources ? JSON.stringify(result.sources) : '').catch(err => {
    console.warn('[Orchestrator] Task logging failed:', err.message);
  });
  
  return result;
}

async function _processMessage({ message, sessionId, user, agentId = null, systemPrompt: customSystemPrompt = null }) {
  // Agent chats can emit large deliverables (e.g. a full self-contained HTML report);
  // give them a bigger output budget so the artifact isn't truncated. Brain chat stays lean.
  const replyMaxTokens = agentId ? 8000 : 4000;
  const toolsUsed = [];
  const auditTrail = [];

  let softAgent = null;
  let systemPrompt = customSystemPrompt || SYSTEM_PROMPT;
  let allowedRoutes = null;

  // ─── STEP 0: Soft Agent Interception ───
  if (agentId) {
    try {
      const { getAgentById } = require('../models/agentConfig');
      softAgent = await getAgentById(agentId);
      
      if (softAgent) {
        // Inject personality/tone modifier
        if (softAgent.system_prompt_modifier) {
          systemPrompt += `\n\n[AGENT MODIFIER]: ${softAgent.system_prompt_modifier}`;
        }
        // Restrict allowed routes for the semantic router
        allowedRoutes = softAgent.allowed_routes;
      }
    } catch (error) {
      console.warn(`Soft Agent lookup failed for ID ${agentId}:`, error.message);
    }
  }

  // ─── STEP 1: Context Assembly ───
  const supabaseClient = require('../models/supabaseClient');

  // ─── Closed Feedback Loop (Self-Learning from corrections) ───
  let feedbackInstructions = '';
  try {
    const { data: feedbackData, error: feedbackErr } = await supabaseClient
      .from('feedback_events')
      .select('rating, correction_text, agent_name')
      .eq('tenant_id', user.company_id)
      .eq('rating', 'down')
      .not('correction_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!feedbackErr && feedbackData && feedbackData.length > 0) {
      const correctionsList = feedbackData.map(f => {
        const agentPrefix = f.agent_name ? `[${f.agent_name}] ` : '';
        return `- ${agentPrefix}User correction: "${f.correction_text}"`;
      }).join('\n');

      feedbackInstructions = `\n\n--- CLOSED FEEDBACK LOOP: USER CORRECTIONS & LESSONS LEARNED ---\n` +
        `CRITICAL: The user has previously corrected the system's responses. ` +
        `You MUST strictly adhere to these corrections and avoid repeating these mistakes:\n` +
        `${correctionsList}\n` +
        `-----------------------------------------------------------------------------\n`;
    }
  } catch (err) {
    console.warn('[Orchestrator] Failed to fetch feedback for learning loop:', err.message);
  }

  if (feedbackInstructions) {
    systemPrompt += feedbackInstructions;
  }

  const { getRelevantTools } = require('./semanticRouter');
  const { retrieveSmartContext, retrieveCompanyContextDetailed } = require('./retrievalService');

  // 1a. Fetch conversation history FIRST (needed for expanded query)
  let conversationHistory = [];
  if (sessionId) {
    try {
      const { data: historyData, error: historyErr } = await supabaseClient
        .from('chat_history')
        .select('role, content')
        .eq('session_id', sessionId)
        .eq('tenant_id', user.company_id)
        .order('created_at', { ascending: true })
        .limit(20); // Last 10 exchanges

      if (!historyErr && historyData && historyData.length > 0) {
        conversationHistory = historyData;
      }
    } catch (err) {
      console.warn('[Orchestrator] Failed to fetch chat history:', err.message);
    }
  }

  // 1b. Build conversation-aware expanded query for better retrieval
  const expandedQuery = conversationHistory.length > 2
    ? `${conversationHistory.slice(-2).filter(m => m.role === 'user').map(m => m.content).join(' ')} ${message}`
    : message;

  // 1c. Resolve available tools for this company
  const companyTools = await resolveToolsForCompany(user.company_id);
  
  // Pass allowedRoutes to strictly limit the sub-agent's capabilities
  // Use expanded query for better tool routing
  const relevantTools = await getRelevantTools(expandedQuery, companyTools, allowedRoutes);
  
  // Inject research tools as background capability for ANY query that might need them
  const researchToolNames = ['web_search_trusted', 'web_extract_source_content', 'web_scrape_and_analyze', 'research_multi_source_synthesis'];
  const hasResearchTool = relevantTools.some(t => researchToolNames.includes(t.name));
  if (!hasResearchTool) {
    // Add web_search_trusted as a background tool — it's universally useful
    const webSearchTool = companyTools.find(t => t.name === 'web_search_trusted');
    if (webSearchTool) {
      relevantTools.push(webSearchTool);
    }
  }

  // Always inject document creation/editing tools — these are native capabilities
  // that MUST be available regardless of semantic routing. Without them, Groq will
  // reject any LLM attempt to call document_create_draft with a 400 error.
  const docToolNames = ['document_create_draft', 'document_edit_draft', 'document_export'];
  for (const docToolName of docToolNames) {
    if (!relevantTools.some(t => t.name === docToolName)) {
      const docTool = companyTools.find(t => t.name === docToolName);
      if (docTool) relevantTools.push(docTool);
    }
  }
  
  const toolDefinitions = toFunctionCallingFormat(relevantTools);

  // ─── Inject delegate_to_agents tool for Brain (non-agent) flow ───
  // This tool lets The Brain delegate tasks to specialized agents.
  if (!agentId) {
    toolDefinitions.push({
      type: 'function',
      function: {
        name: 'delegate_to_agents',
        description: 'Delegate tasks to specialized agents in the system. Use this when the user asks you to perform work that would be better handled by a specific agent (e.g., financial analysis → Finance Agent, marketing tasks → Marketing Agent, sales tasks → Sales Agent). You can delegate to multiple agents at once.',
        parameters: {
          type: 'object',
          properties: {
            delegations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  agent_name: {
                    type: 'string',
                    enum: ['Finance Agent', 'People Agent', 'HR Agent', 'Investment Agent', 'CRM Agent', 'Marketing Agent', 'Sales Agent', 'Product Agent', 'Roadmap Agent', 'Meeting Agent'],
                    description: 'The exact name of the agent to delegate to'
                  },
                  task: {
                    type: 'string',
                    description: 'A detailed description of the task the agent should perform'
                  },
                  priority: {
                    type: 'string',
                    enum: ['high', 'medium', 'low'],
                    description: 'Priority of the task'
                  }
                },
                required: ['agent_name', 'task']
              }
            },
            explanation: {
              type: 'string',
              description: 'A brief explanation to the user of why you delegated these tasks and to which agents'
            }
          },
          required: ['delegations', 'explanation']
        }
      }
    });
  }

  // ─── Inject ask_user_question tool ───
  // This tool lets the assistant ask the user questions with predefined choices instead of
  // outputting questions as plain text. Available when the assistant hasn't responded yet.
  const hasAskedQuestion = conversationHistory.some(msg => msg.role === 'assistant');
  if (!hasAskedQuestion) {
    // Add the tool definition
    toolDefinitions.push({
      type: 'function',
      function: {
        name: 'ask_user_question',
        description: 'Ask the user a question when you need clarification or additional information. Use this INSTEAD of writing questions as text. Generate specific, context-relevant answer choices based on what you know about the company and user. The user can pick a choice or type a custom answer.',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The specific question to ask the user' },
            choices: { type: 'array', items: { type: 'string' }, description: 'Predefined answer choices based on company context and the user request. Make these specific to the question — not generic. If you cannot think of good choices, you can omit this field and the user will see a text input instead.' },
          },
          required: ['question'],
        },
      },
    });

    if (agentId) {
      // Inject the instruction directly into the system prompt for soft agents — this is the authoritative
      // directive the LLM follows for every response. Much more effective than putting it
      // in the user message.
      systemPrompt += `

=== CRITICAL: ASK ALIGNMENT QUESTIONS BEFORE EXECUTING A TASK ===
When the user asks you to perform a new task, or asks you to do something:
1. Your VERY FIRST response MUST be to ask the user specific, context-relevant clarifying or alignment questions using the \`ask_user_question\` tool.
2. You MUST NOT execute other tools or complete the task immediately. You must gather the user's input first.
3. You MUST formulate the question and choice options by deeply considering the company's background, past decisions, files, and context from the Brain knowledge base (e.g. <company_context>, <company_state>, or <conversation_memory>) in addition to what the user has asked you to do. Do not ask generic questions; instead, ground the questions and choices in specific products, target customers, values, or metrics found in the Brain context.
4. You MUST provide exactly 3 specific, context-relevant choice options for the user to select from. (The system will automatically add the 4th "Other" option).
5. Once the user has responded to your clarifying question, you HAVE established alignment. You MUST NOT ask another question. Do not ask multiple rounds of questions. Proceed directly to use other tools and complete the task.
6. Look at the conversation history: if you have already called the \`ask_user_question\` tool in a previous turn and the user has responded, DO NOT call \`ask_user_question\` again. Proceed with executing the task immediately.
7. If the user is just continuing a conversation or answering a question you asked, proceed naturally and do not ask new clarifying questions.

=== CRITICAL: ASK_USER_QUESTION TOOL ===
You have access to the \`ask_user_question\` tool. You MUST use this tool ANY time you need to ask the user a question.

NEVER output questions as plain text in your response. Instead, always call \`ask_user_question\` with:
1. \`question\`: Your specific question
2. \`choices\`: 3 specific, context-relevant answer choices based on the Brain's company context and the user's request

The tool will present these choices as clickable buttons. The user can also type a custom answer via an "Other" option.

If you write a question as plain text instead of using the tool, the user will NOT see it as interactive choices, which creates a poor experience.`;
    }
  } else if (agentId) {
    systemPrompt += `

=== CRITICAL: ALIGNMENT HAS BEEN ESTABLISHED ===
You have ALREADY asked a clarifying question in a previous turn and the user has responded. 
You now have sufficient information and alignment to execute the task.
1. You MUST NOT ask any more clarifying questions, either via tools or plain text.
2. You MUST NOT call the \`ask_user_question\` tool (it is not even available).
3. Proceed directly to use other tools and complete the task immediately.`;
  }

  // 1d. Multi-strategy smart context retrieval (vector search + entities + action items)
  let orgMemory = '';
  let entityContext = '';
  let sourceCitations = [];
  try {
    const smartContext = await retrieveSmartContext(message, conversationHistory, user.company_id);
    const { chunks, openItems, recentDecisions, recentMeetings } = smartContext;
    
    // Build org memory from document chunks
    if (chunks && chunks.length > 0) {
      const contexts = [];
      for (const match of chunks) {
        const source = match.source_title ? ` [Source: ${match.source_title}]` : '';
        contexts.push(`${match.content}${source}`);
        if (match.source_id) {
          if (!sourceCitations.some(c => c.id === match.source_id)) {
            sourceCitations.push({
              id: match.source_id,
              title: match.source_title || 'Untitled Document',
              source_type: match.source_type || 'document',
              score: match.similarity
            });
          }
        }
      }
      if (contexts.length > 0) {
        orgMemory = `\n<company_context>\n${contexts.join('\n\n')}\n</company_context>\n`;
      }
    }

    // Build structured entity context (always include, even if empty)
    const entityParts = [];
    if (openItems && openItems.length > 0) {
      entityParts.push(`Open Action Items:\n${openItems.map(i => `  - ${i.task} (${i.assignee || 'Unassigned'})${i.due_date ? ` due: ${i.due_date}` : ''}`).join('\n')}`);
    }
    if (recentDecisions && recentDecisions.length > 0) {
      entityParts.push(`Recent Decisions:\n${recentDecisions.map(d => `  - ${d.text}${d.made_by ? ` (by ${d.made_by})` : ''}`).join('\n')}`);
    }
    if (recentMeetings && recentMeetings.length > 0) {
      entityParts.push(`Recent Meetings:\n${recentMeetings.map(m => `  - ${m.title} (${new Date(m.meeting_date).toLocaleDateString()})`).join('\n')}`);
    }
    if (entityParts.length > 0) {
      entityContext = `\n<company_state>\n${entityParts.join('\n\n')}\n</company_state>\n`;
    }
  } catch (error) {
    console.warn('[Orchestrator] Smart context retrieval failed:', error.message);
    // Fallback: simple single-query retrieval
    try {
      const matches = await retrieveCompanyContextDetailed(message, user.company_id);
      if (matches && matches.length > 0) {
        const contexts = [];
        for (const match of matches) {
          const source = match.source_title ? ` [Source: ${match.source_title}]` : '';
          contexts.push(`${match.content}${source}`);
          if (match.source_id) {
            if (!sourceCitations.some(c => c.id === match.source_id)) {
              sourceCitations.push({
                id: match.source_id,
                title: match.source_title || 'Untitled Document',
                source_type: match.source_type || 'document',
                score: match.similarity
              });
            }
          }
        }
        if (contexts.length > 0) {
          orgMemory = `\n<company_context>\n${contexts.join('\n\n')}\n</company_context>\n`;
        }
      }
    } catch (fallbackErr) {
      console.warn('[Orchestrator] Fallback retrieval also failed:', fallbackErr.message);
    }
  }

  // 1e. Tiered memory: recent messages + compressed summaries + extracted facts
  let tieredMemory = '';
  try {
    const memoryParts = [];
    
    // Tier 1: Compressed summaries from conversation_memory
    const { data: summaries } = await supabaseClient
      .from('conversation_memory')
      .select('summary')
      .eq('session_id', sessionId)
      .eq('company_id', user.company_id)
      .order('created_at', { ascending: false })
      .limit(3);
    
    if (summaries && summaries.length > 0) {
      const summaryText = summaries.map(s => s.summary).reverse().join('\n');
      memoryParts.push(`Previous conversation summary:\n${summaryText}`);
    }

    // Tier 2: Key facts extracted from past conversations (cross-session memory)
    if (sessionId && user.id) {
      try {
        const keyFacts = await getKeyFactsForUser(user.company_id, user.id, 8);
        if (keyFacts && keyFacts.length > 0) {
          const factText = keyFacts
            .map(f => `  - [${f.category}] ${f.fact}`)
            .join('\n');
          memoryParts.push(`Known facts about the user:\n${factText}`);
        }
      } catch (factErr) {
        console.warn('[Orchestrator] Key facts retrieval failed:', factErr.message);
      }
    }
    
    if (memoryParts.length > 0) {
      tieredMemory = `\n<conversation_memory>\n${memoryParts.join('\n\n')}\n</conversation_memory>\n`;
    }
  } catch (err) {
    console.warn('[Orchestrator] Tiered memory retrieval failed:', err.message);
  }

  // 1f. Build messages array
  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  // Inject RAG context if available
  if (orgMemory) {
    messages.push({
      role: 'system',
      content: `Context from company knowledge base:${orgMemory}`
    });
  }

  // Inject structured entity context (action items, decisions, meetings)
  if (entityContext) {
    messages.push({
      role: 'system',
      content: `Company current state:${entityContext}`
    });
  }

  // Inject tiered memory (conversation summaries from past sessions)
  if (tieredMemory) {
    messages.push({
      role: 'system',
      content: `Session memory:${tieredMemory}`
    });
  }

  // Inject conversation history so the LLM can maintain context across turns
  if (conversationHistory.length > 0) {
    for (const msg of conversationHistory) {
      messages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content
      });
    }
  }

  messages.push({ role: 'user', content: message });

  // ─── STEP 2-5: Orchestration Loop ───
  let iteration = 0;
  
  // Track activated tools for dynamic iteration scaling
  const activatedToolNames = new Set();
  let dynamicMaxIterations = computeIterationLimit(activatedToolNames, message.length);

  while (iteration < dynamicMaxIterations) {
    // Recompute limit as tools are activated (research tools need more iterations)
    dynamicMaxIterations = computeIterationLimit(activatedToolNames, message.length);
    iteration++;

    // Smart termination: if the last 2 tool calls are identical, we're in a loop
    if (detectRepetition(auditTrail)) {
      console.log(`[Orchestrator] Detected tool repetition loop at iteration ${iteration}. Breaking.`);
      // Force a final response without tools
      const finalResponse = await callLLMWithTools(messages, [], { companyId: user.company_id, max_tokens: replyMaxTokens });
      return {
        reply: sanitizeResponse(finalResponse.content) || 'I completed my analysis of your request.',
        toolsUsed,
        auditTrail,
        iterations: iteration,
        loopTerminated: true,
        sources: sourceCitations
      };
    }

    // Call LLM
    const llmResponse = await callLLMWithTools(messages, toolDefinitions, { companyId: user.company_id, max_tokens: replyMaxTokens });

    // If no tool calls, we have our final response
    if (!llmResponse.tool_calls || llmResponse.tool_calls.length === 0) {
      const reply = sanitizeResponse(llmResponse.content) || 'I processed your request but have no additional response.';

      // ─── POST-RESPONSE: Extract facts from this exchange (fire-and-forget) ───
      if (sessionId && user) {
        extractFacts({
          userMessage: message,
          assistantReply: reply,
          conversationHistory,
          tenantId: user.company_id,
          userId: user.id,
          sessionId
        }).catch(err => console.warn('[Orchestrator] Fact extraction failed:', err.message));
      }

      return {
        reply,
        toolsUsed,
        auditTrail,
        iterations: iteration,
        sources: sourceCitations
      };
    }

    // Process each tool call
    const assistantMessage = {
      role: 'assistant',
      content: llmResponse.content || null,
      tool_calls: llmResponse.tool_calls
    };
    messages.push(assistantMessage);

    for (const toolCall of llmResponse.tool_calls) {
      // Tolerant parse so a malformed/truncated args blob from any provider
      // doesn't crash the whole chat turn.
      const parsedArgs = parseLooseJson(toolCall.function.arguments) || {};

      const toolRequest = {
        name: toolCall.function.name,
        arguments: parsedArgs
      };

      // ─── INTERCEPT DELEGATE_TO_AGENTS (Brain delegating tasks) ───
      if (toolRequest.name === 'delegate_to_agents') {
        const delegations = parsedArgs.delegations || [];
        const explanation = parsedArgs.explanation || 'Delegating tasks to relevant agents.';
        
        // Track which agents were launched
        const launchedAgents = [];
        const failedAgents = [];
        
        for (const delegation of delegations) {
          try {
            // Map agent name to agent type ID
            const agentTypeMap = {
              'Finance Agent': 'finance',
              'People Agent': 'people',
              'HR Agent': 'hr',
              'Investment Agent': 'investment',
              'CRM Agent': 'crm',
              'Marketing Agent': 'marketing',
              'Sales Agent': 'sales',
              'Product Agent': 'product',
              'Roadmap Agent': 'roadmap',
              'Meeting Agent': 'meeting',
            };
            
            const agentType = agentTypeMap[delegation.agent_name];
            if (!agentType) {
              failedAgents.push(`${delegation.agent_name} (unknown agent)`);
              continue;
            }
            
            // Launch the agent via its execution endpoint
            const { launchAgent } = require('./agentOrchestrator');
            const supabaseClient = require('../models/supabaseClient');
            
            // Get company profile
            const { data: company } = await supabaseClient
              .from('companies')
              .select('*')
              .eq('id', user.company_id)
              .single();
            
            if (company) {
              await launchAgent({
                companyId: company.id,
                agentType,
                companyProfile: company,
                user,
                customTask: delegation.task,
              });
              launchedAgents.push(delegation.agent_name);
            }
          } catch (err) {
            console.warn(`[Orchestrator] Failed to delegate to ${delegation.agent_name}:`, err.message);
            failedAgents.push(delegation.agent_name);
          }
        }
        
        // Build result summary
        let summary = `### 🧠 Brain Delegation\n\n${explanation}\n\n`;
        if (launchedAgents.length > 0) {
          summary += `**Launched:** ${launchedAgents.join(', ')}\n`;
        }
        if (failedAgents.length > 0) {
          summary += `**Failed to launch:** ${failedAgents.join(', ')}\n`;
        }
        
        auditTrail.push({
          tool: 'delegate_to_agents',
          verdict: 'APPROVED',
          reason: `Delegated ${delegations.length} tasks to agents`
        });
        
        // Feed the result back to the LLM
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            success: true,
            summary,
            launchedAgents,
            failedAgents,
          })
        });
        
        toolsUsed.push({
          name: 'delegate_to_agents',
          status: 'success',
          result: { launched: launchedAgents, failed: failedAgents }
        });
        
        continue;
      }

      // ─── INTERCEPT ASK_USER_QUESTION (agent-chat flow) ───
      if (toolRequest.name === 'ask_user_question') {
        // Return the question to the frontend as a structured response
        return {
          type: 'question',
          question: parsedArgs.question,
          choices: parsedArgs.choices || [],
          toolsUsed,
          auditTrail,
          sources: sourceCitations,
        };
      }

      // ─── SENTINEL VALIDATION ───
      const verdict = await sentinel.validate(toolRequest, user);

      auditTrail.push({
        tool: toolRequest.name,
        verdict: verdict.allowed ? 'APPROVED' : 'DENIED',
        reason: verdict.reason,
        executionToken: verdict.executionToken
      });

      if (!verdict.allowed) {
        // Feed denial back to LLM so it can respond appropriately
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: true,
            message: `SENTINEL DENIED: ${verdict.reason}`
          })
        });

        toolsUsed.push({
          name: toolRequest.name,
          status: 'denied',
          reason: verdict.reason
        });

        continue;
      }

      // ─── ADAPTER EXECUTION (with real-time status emission) ───
      // Emit start status
      emitNotification(user.id, {
        type: 'tool_execution',
        tool: toolRequest.name,
        status: 'started',
        timestamp: new Date().toISOString()
      });

      // Tag the tool request with the chat session so draft creation can link back to it.
      if (sessionId) toolRequest._sessionId = sessionId;
      const executionResult = await sentinel.executeApprovedTool(toolRequest, verdict, user);

      // Track activated tools for dynamic iteration scaling
      activatedToolNames.add(toolRequest.name);

      if (executionResult.success) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(executionResult.result)
        });

        toolsUsed.push({
          name: toolRequest.name,
          status: 'success',
          durationMs: executionResult.durationMs,
          result: (toolRequest.name === 'document_create_draft' || toolRequest.name === 'document_edit_draft' || toolRequest.name.startsWith('research_') || toolRequest.name.startsWith('web_')) ? executionResult.result : undefined
        });

        // Emit completion status
        emitNotification(user.id, {
          type: 'tool_execution',
          tool: toolRequest.name,
          status: 'completed',
          durationMs: executionResult.durationMs,
          timestamp: new Date().toISOString()
        });
      } else {
        // Auto-retry: on tool failure, give the LLM a chance to try a different approach
        const retryMessage = executionResult.retryable !== false
          ? `Tool execution failed: ${executionResult.error}. You can try a different approach or a different tool.`
          : `Tool execution failed permanently: ${executionResult.error}. Please inform the user and stop using this tool.`;

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: true,
            message: retryMessage
          })
        });

        toolsUsed.push({
          name: toolRequest.name,
          status: 'failed',
          error: executionResult.error,
          durationMs: executionResult.durationMs
        });

        // Emit failure status
        emitNotification(user.id, {
          type: 'tool_execution',
          tool: toolRequest.name,
          status: 'failed',
          error: executionResult.error,
          timestamp: new Date().toISOString()
        });
      }
    }

    // Loop continues — LLM will process tool results and either
    // return a final response or request more tool calls
  }

  // Safety: max iterations reached
  const finalResponse = await callLLMWithTools(messages, [], { companyId: user.company_id, max_tokens: replyMaxTokens });
  return {
    reply: sanitizeResponse(finalResponse.content) || `I reached the maximum number of tool calls (${dynamicMaxIterations}). Here is what I have so far.`,
    toolsUsed,
    auditTrail,
    iterations: iteration,
    maxIterationsReached: true,
    sources: sourceCitations
  };
}

module.exports = {
  processMessage
};
