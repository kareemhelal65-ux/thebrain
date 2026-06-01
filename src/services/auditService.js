const supabase = require('../models/supabaseClient');
const { v4: uuidv4 } = require('uuid');

/**
 * Logs an AI action to the audit trail
 * @param {Object} logDetails - Details of the action
 * @param {string} logDetails.companyId - The company UUID
 * @param {string} logDetails.userId - The user UUID
 * @param {string} logDetails.toolUsed - The name of the tool used (e.g., 'generate_text')
 * @param {Object} logDetails.inputData - The input provided to the AI
 * @param {string} logDetails.reasoningPath - The LLM's internal reasoning
 * @returns {Promise<Object>} The inserted log
 */
const logAIAction = async ({ companyId, userId, toolUsed, inputData, reasoningPath }) => {
  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .insert([
        {
          company_id: companyId,
          user_id: userId,
          tool_used: toolUsed,
          input_data: inputData,
          reasoning_path: reasoningPath,
        },
      ])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('Failed to log AI action to Audit Trail:', error);
    throw new Error('Audit Logging Failed');
  }
};

/**
 * Log a Sentinel PRE-EXECUTION audit entry.
 * Written BEFORE the tool is executed — creates an immutable record of intent.
 * 
 * @param {Object} details
 * @param {string} details.companyId
 * @param {string} details.userId
 * @param {string} details.toolName - The tool being called
 * @param {Object} details.toolParameters - Parameters passed to the tool
 * @param {string} details.sentinelVerdict - 'APPROVED' or 'DENIED'
 * @param {string} details.verdictReason - Why it was approved/denied
 * @returns {Promise<{ auditId: string, executionToken: string }>}
 */
const logSentinelPreExecution = async ({ companyId, userId, toolName, toolParameters, sentinelVerdict, verdictReason }) => {
  const executionToken = uuidv4();

  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .insert([{
        company_id: companyId,
        user_id: userId,
        tool_used: toolName,
        tool_parameters: toolParameters,
        sentinel_verdict: sentinelVerdict,
        execution_phase: 'PRE',
        execution_token: executionToken,
        reasoning_path: verdictReason,
        input_data: { sentinel_check: true, verdict: sentinelVerdict }
      }])
      .select()
      .single();

    if (error) throw error;

    return {
      auditId: data.id,
      executionToken
    };
  } catch (error) {
    console.error('Failed to log Sentinel pre-execution:', error);
    // Sentinel logging failure should NOT prevent execution — log and continue
    return {
      auditId: null,
      executionToken
    };
  }
};

/**
 * Log a Sentinel POST-EXECUTION audit entry.
 * Written AFTER the tool finishes — records the result and execution time.
 * Linked to the pre-execution entry via executionToken.
 * 
 * @param {Object} details
 * @param {string} details.companyId
 * @param {string} details.userId
 * @param {string} details.toolName
 * @param {string} details.executionToken - Links to the PRE entry
 * @param {Object} details.resultData - The tool execution result
 * @param {number} details.executionDurationMs - How long the tool took
 * @param {boolean} details.success - Whether execution succeeded
 * @param {string} [details.errorMessage] - Error message if failed
 */
const logSentinelPostExecution = async ({
  companyId, userId, toolName, executionToken,
  resultData, executionDurationMs, success, errorMessage
}) => {
  try {
    const { error } = await supabase
      .from('audit_logs')
      .insert([{
        company_id: companyId,
        user_id: userId,
        tool_used: toolName,
        execution_phase: 'POST',
        execution_token: executionToken,
        sentinel_verdict: success ? 'EXECUTED' : 'FAILED',
        result_data: resultData || { error: errorMessage },
        execution_duration_ms: executionDurationMs,
        reasoning_path: success ? 'Execution completed successfully' : `Execution failed: ${errorMessage}`
      }]);

    if (error) {
      console.error('Failed to log Sentinel post-execution:', error);
    }
  } catch (error) {
    console.error('Failed to log Sentinel post-execution:', error);
    // Post-execution logging failure is non-fatal
  }
};

module.exports = {
  logAIAction,
  logSentinelPreExecution,
  logSentinelPostExecution
};
