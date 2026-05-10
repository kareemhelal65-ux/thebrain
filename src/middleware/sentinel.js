const { getToolByName } = require('../providers/registry');
const { getCompanyConfig, resolveAdapter } = require('../models/companyConfig');
const { logSentinelPreExecution, logSentinelPostExecution } = require('../services/auditService');

/**
 * SENTINEL — The Security Gatekeeper
 * 
 * Mandatory validation layer that intercepts EVERY tool_call from the LLM
 * before execution. This is NOT HTTP middleware — it's a programmatic gatekeeper
 * called by the orchestrator.
 * 
 * Three-check pipeline:
 * 1. COMPANY ISOLATION — Is this tool's category enabled for this company?
 * 2. RBAC PERMISSION CHECK — Does this user's role permit this action?
 * 3. AUDIT LOGGING — Immutable pre/post execution records
 */

// Role hierarchy: Admin > Manager > Employee
const ROLE_HIERARCHY = {
  'Admin': 3,
  'Manager': 2,
  'Employee': 1
};

/**
 * Check if a user's role meets or exceeds the required role.
 * @param {string} userRole - The user's actual role
 * @param {string} requiredRole - The minimum role required by the tool
 * @returns {boolean}
 */
function hasPermission(userRole, requiredRole) {
  const userLevel = ROLE_HIERARCHY[userRole] || 0;
  const requiredLevel = ROLE_HIERARCHY[requiredRole] || 0;
  return userLevel >= requiredLevel;
}

/**
 * Validate a tool call through the Sentinel pipeline.
 * 
 * @param {Object} toolCall - The tool call from the LLM
 * @param {string} toolCall.name - Tool name (e.g., 'send_email')
 * @param {Object} toolCall.arguments - Tool parameters
 * @param {Object} user - The requesting user
 * @param {string} user.id - User UUID
 * @param {string} user.company_id - Company UUID
 * @param {string} user.role - User role ('Admin', 'Manager', 'Employee')
 * @returns {Promise<SentinelVerdict>}
 */
async function validate(toolCall, user) {
  const toolDef = getToolByName(toolCall.name);

  // ─── CHECK 0: Tool Existence ───
  if (!toolDef) {
    const verdict = {
      allowed: false,
      reason: `Unknown tool: ${toolCall.name}. Tool not found in registry.`,
      preAuditId: null,
      executionToken: null
    };

    // Still log the denied attempt
    const auditResult = await logSentinelPreExecution({
      companyId: user.company_id,
      userId: user.id,
      toolName: toolCall.name,
      toolParameters: toolCall.arguments,
      sentinelVerdict: 'DENIED',
      verdictReason: verdict.reason
    });

    verdict.preAuditId = auditResult.auditId;
    verdict.executionToken = auditResult.executionToken;
    return verdict;
  }

  // ─── CHECK 1: Company Isolation ───
  // Verify the tool's category is enabled for this company
  let companyConfig;
  try {
    companyConfig = await getCompanyConfig(user.company_id);
  } catch (error) {
    const verdict = {
      allowed: false,
      reason: `Failed to verify company configuration: ${error.message}`,
      preAuditId: null,
      executionToken: null
    };

    const auditResult = await logSentinelPreExecution({
      companyId: user.company_id,
      userId: user.id,
      toolName: toolCall.name,
      toolParameters: toolCall.arguments,
      sentinelVerdict: 'DENIED',
      verdictReason: verdict.reason
    });

    verdict.preAuditId = auditResult.auditId;
    verdict.executionToken = auditResult.executionToken;
    return verdict;
  }

  const toolCategory = toolDef.category;
  if (!companyConfig.enabled_categories.includes(toolCategory)) {
    const verdict = {
      allowed: false,
      reason: `Company does not have the '${toolCategory}' category enabled. Tool '${toolCall.name}' is not available.`,
      preAuditId: null,
      executionToken: null
    };

    const auditResult = await logSentinelPreExecution({
      companyId: user.company_id,
      userId: user.id,
      toolName: toolCall.name,
      toolParameters: toolCall.arguments,
      sentinelVerdict: 'DENIED',
      verdictReason: verdict.reason
    });

    verdict.preAuditId = auditResult.auditId;
    verdict.executionToken = auditResult.executionToken;
    return verdict;
  }

  // ─── CHECK 2: RBAC Permission ───
  const requiredRole = toolDef.required_role || 'Employee';
  if (!hasPermission(user.role, requiredRole)) {
    const verdict = {
      allowed: false,
      reason: `Insufficient permissions. Tool '${toolCall.name}' requires '${requiredRole}' role, but user has '${user.role}'.`,
      preAuditId: null,
      executionToken: null
    };

    const auditResult = await logSentinelPreExecution({
      companyId: user.company_id,
      userId: user.id,
      toolName: toolCall.name,
      toolParameters: toolCall.arguments,
      sentinelVerdict: 'DENIED',
      verdictReason: verdict.reason
    });

    verdict.preAuditId = auditResult.auditId;
    verdict.executionToken = auditResult.executionToken;
    return verdict;
  }

  // ─── CHECK 2.5: Department Isolation ───
  // Admins bypass all restrictions.
  if (user.role !== 'Admin') {
    const userDept = (user.department || '').toLowerCase();
    const targetDept = toolDef.category.toLowerCase();
    
    if (userDept !== targetDept) {
      let isAllowed = false;
      let denialReason = '';

      // Manager Exception: Can execute cross-department ONLY if it's a 'Read-Only' action
      if (user.role === 'Manager') {
        const toolNameLower = toolCall.name.toLowerCase();
        const readOnlyPrefixes = ['get', 'check', 'fetch', 'list', 'read', 'search', 'find'];
        
        if (readOnlyPrefixes.some(prefix => toolNameLower.startsWith(prefix))) {
          isAllowed = true;
        } else {
          denialReason = `Cross-department security violation. Managers can only execute 'Read-Only' actions in other departments. '${toolCall.name}' is a write/execute action.`;
        }
      } else {
        // Employee: Strict match only
        denialReason = `Cross-department security violation. Employees can only execute tools in their own department ('${userDept}').`;
      }

      if (!isAllowed) {
        const verdict = {
          allowed: false,
          reason: denialReason,
          preAuditId: null,
          executionToken: null
        };

        const auditResult = await logSentinelPreExecution({
          companyId: user.company_id,
          userId: user.id,
          toolName: toolCall.name,
          toolParameters: toolCall.arguments,
          sentinelVerdict: 'DENIED',
          verdictReason: verdict.reason
        });

        verdict.preAuditId = auditResult.auditId;
        verdict.executionToken = auditResult.executionToken;
        return verdict;
      }
    }
  }

  // ─── CHECK 3: Pre-Execution Audit Log (APPROVED) ───
  const auditResult = await logSentinelPreExecution({
    companyId: user.company_id,
    userId: user.id,
    toolName: toolCall.name,
    toolParameters: toolCall.arguments,
    sentinelVerdict: 'APPROVED',
    verdictReason: `All checks passed. Role: ${user.role} >= ${requiredRole}. Category '${toolCategory}' is enabled.`
  });

  return {
    allowed: true,
    reason: 'All Sentinel checks passed.',
    preAuditId: auditResult.auditId,
    executionToken: auditResult.executionToken,
    companyConfig,  // Pass config through so orchestrator can resolve adapter
    toolDef         // Pass tool definition for reference
  };
}

/**
 * Execute a tool call through the appropriate provider adapter.
 * Called ONLY after Sentinel.validate() returns allowed: true.
 * 
 * @param {Object} toolCall - { name, arguments }
 * @param {Object} sentinelVerdict - Result from validate()
 * @param {Object} user - The requesting user
 * @returns {Promise<Object>} Tool execution result
 */
async function executeApprovedTool(toolCall, sentinelVerdict, user) {
  const startTime = Date.now();

  try {
    const { companyConfig, toolDef } = sentinelVerdict;
    const category = toolDef.category;

    // Find the provider for this category
    const providers = companyConfig.enabled_services[category];
    if (!providers || providers.length === 0) {
      throw new Error(`No provider configured for category '${category}'`);
    }

    // Use the first active provider for the category
    const providerInfo = providers[0];
    const adapter = resolveAdapter(category, providerInfo.provider, providerInfo.credentials, providerInfo.config);

    // Initialize and execute
    await adapter.initialize();
    const result = await adapter.execute(toolCall.name, toolCall.arguments);

    const durationMs = Date.now() - startTime;

    // Post-execution audit log
    await logSentinelPostExecution({
      companyId: user.company_id,
      userId: user.id,
      toolName: toolCall.name,
      executionToken: sentinelVerdict.executionToken,
      resultData: result,
      executionDurationMs: durationMs,
      success: true
    });

    return { success: true, result, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    // Post-execution audit log (failure)
    await logSentinelPostExecution({
      companyId: user.company_id,
      userId: user.id,
      toolName: toolCall.name,
      executionToken: sentinelVerdict.executionToken,
      resultData: null,
      executionDurationMs: durationMs,
      success: false,
      errorMessage: error.message
    });

    return { success: false, error: error.message, durationMs };
  }
}

module.exports = {
  validate,
  executeApprovedTool,
  hasPermission,
  ROLE_HIERARCHY
};
