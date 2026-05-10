const { callLLMWithTools, getRecentSummaries } = require('./llmService');
const { similaritySearch } = require('./embeddingService');
const { resolveToolsForCompany, toFunctionCallingFormat } = require('../providers/registry');
const sentinel = require('../middleware/sentinel');

/**
 * Orchestrator — The Central Nervous System Loop
 * 
 * Flow:
 * 1. Context Assembly (company config, org memory, conversation buffer, available tools)
 * 2. LLM Call (with tool definitions)
 * 3. If tool_call → Sentinel Validate → Adapter Execute → Feed result back → Loop
 * 4. If text response → Return to user
 * 
 * Supports multi-step tool chains with MAX_ITERATIONS safety limit.
 */

const MAX_ITERATIONS = parseInt(process.env.MAX_TOOL_ITERATIONS) || 5;

const SYSTEM_PROMPT = `You are "The Brain" — an AI Operating System that runs businesses.
You have access to various business tools organized by category. When a user asks you to
perform an action (check orders, send emails, process payments, manage tasks, etc.),
use the appropriate tool. 

Key rules:
1. Always use tools when the user requests a concrete action. Do not make up data.
2. If a tool call fails, explain the error clearly and suggest alternatives.
3. If you lack a required tool, tell the user what service needs to be enabled.
4. Be concise but thorough in your responses.
5. When presenting data from tools, format it clearly and highlight important details.
6. You must detect the language of the user's prompt and ALWAYS reply in their native language. However, all internal JSON tool_call outputs MUST strictly use English keys and parameters.`;

/**
 * Process a user message through the full orchestration loop.
 * 
 * @param {Object} params
 * @param {string} params.message - The user's message
 * @param {string} params.sessionId - Conversation session ID
 * @param {Object} params.user - { id, company_id, role }
 * @param {string} params.agentId - Optional. ID of a specific Soft Agent.
 * @returns {Promise<Object>} { reply, toolsUsed, auditTrail }
 */
async function processMessage({ message, sessionId, user, agentId = null }) {
  const toolsUsed = [];
  const auditTrail = [];

  let softAgent = null;
  let systemPrompt = SYSTEM_PROMPT;
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
  // 1a. Resolve available tools for this company
  const companyTools = await resolveToolsForCompany(user.company_id);
  const { getRelevantTools } = require('./semanticRouter');
  
  // Pass allowedRoutes to strictly limit the sub-agent's capabilities
  const relevantTools = await getRelevantTools(message, companyTools, allowedRoutes);
  const toolDefinitions = toFunctionCallingFormat(relevantTools);

  // 1b. Fetch organizational memory (vector search + cross-encoder rerank)
  let orgMemory = '';
  try {
    const { retrieveCompanyContext } = require('./retrievalService');
    const contexts = await retrieveCompanyContext(message, user.company_id);
    if (contexts.length > 0) {
      orgMemory = `\n<company_context>\n${contexts.join('\n\n')}\n</company_context>\n`;
    }
  } catch (error) {
    console.warn('Org memory retrieval failed:', error.message);
  }

  // 1c. Fetch conversation buffer
  let conversationBuffer = '';
  if (sessionId) {
    conversationBuffer = await getRecentSummaries(user.company_id, sessionId);
  }

  // 1d. Build messages array
  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  // Inject context if available
  if (orgMemory || conversationBuffer) {
    messages.push({
      role: 'system',
      content: `Context for this conversation:${orgMemory}${conversationBuffer}`
    });
  }

  messages.push({ role: 'user', content: message });

  // ─── STEP 2-5: Orchestration Loop ───
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    // Call LLM
    const llmResponse = await callLLMWithTools(messages, toolDefinitions);

    // If no tool calls, we have our final response
    if (!llmResponse.tool_calls || llmResponse.tool_calls.length === 0) {
      return {
        reply: llmResponse.content || 'I processed your request but have no additional response.',
        toolsUsed,
        auditTrail,
        iterations: iteration
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
      const parsedArgs = typeof toolCall.function.arguments === 'string'
        ? JSON.parse(toolCall.function.arguments)
        : toolCall.function.arguments;

      const toolRequest = {
        name: toolCall.function.name,
        arguments: parsedArgs
      };

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

      // ─── ADAPTER EXECUTION ───
      const executionResult = await sentinel.executeApprovedTool(toolRequest, verdict, user);

      if (executionResult.success) {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(executionResult.result)
        });

        toolsUsed.push({
          name: toolRequest.name,
          status: 'success',
          durationMs: executionResult.durationMs
        });
      } else {
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            error: true,
            message: `Tool execution failed: ${executionResult.error}`
          })
        });

        toolsUsed.push({
          name: toolRequest.name,
          status: 'failed',
          error: executionResult.error,
          durationMs: executionResult.durationMs
        });
      }
    }

    // Loop continues — LLM will process tool results and either
    // return a final response or request more tool calls
  }

  // Safety: max iterations reached
  const finalResponse = await callLLMWithTools(messages, []);
  return {
    reply: finalResponse.content || 'I reached the maximum number of tool calls. Here is what I have so far.',
    toolsUsed,
    auditTrail,
    iterations: iteration,
    maxIterationsReached: true
  };
}

module.exports = {
  processMessage
};
