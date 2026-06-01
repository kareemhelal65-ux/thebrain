const { getToolByName } = require('../providers/registry');
const { getCompanyConfig, resolveAdapter } = require('../models/companyConfig');
const { logSentinelPreExecution, logSentinelPostExecution } = require('../services/auditService');

// Tool Executor for argument validation and health checks
let toolExecutor = null;
try {
  toolExecutor = require('../services/toolExecutor');
} catch {}

/**
 * SENTINEL — The Security Gatekeeper
 * 
 * Mandatory validation layer that intercepts EVERY tool_call from the LLM
 * before execution. This is NOT HTTP middleware — it's a programmatic gatekeeper
 * called by the orchestrator.
 * 
 * Sequential check pipeline:
 * 1.  TOOL EXISTENCE — Is the tool defined in the registry?
 * 1.5 TOOL HEALTH — Are its dependencies healthy?
 * 1.75 ARGUMENT VALIDATION — Are the arguments valid per the schema?
 * 2.  COMPANY ISOLATION — Is this tool's category enabled for this company?
 * 2.5 RBAC PERMISSION CHECK — Does this user's role permit this action?
 * 2.75 DEPARTMENT ISOLATION — Is the user's department allowed?
 * 3.  AUDIT LOGGING — Immutable pre/post execution records
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

  // ─── CHECK 1: Tool Existence (runs first — no point checking health of unknown tools) ───
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

  // ─── CHECK 1.5: Tool Health (after existence confirmed) ───
  if (toolExecutor) {
    const health = await toolExecutor.checkToolHealth(toolCall.name);
    if (!health.healthy) {
      const verdict = {
        allowed: false,
        reason: `Tool health check failed: ${health.reason}`,
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

  // ─── CHECK 1.75: Argument Validation ───
  if (toolExecutor) {
    const validation = toolExecutor.validateArguments(toolCall.name, toolCall.arguments);
    if (!validation.valid) {
      const verdict = {
        allowed: false,
        reason: `Argument validation failed: ${validation.errors.join('; ')}`,
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

  // ─── CHECK 2: Company Isolation ───
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
  const isNativeTool = ['document_create_draft', 'document_edit_draft'].includes(toolCall.name);
  
  if (!isNativeTool && !companyConfig.enabled_categories.includes(toolCategory)) {
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
  if (user.role !== 'Admin' && !isNativeTool) {
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
    
    // NATIVE TOOL EXECUTION
    if (
      toolCall.name === 'document_create_draft' || 
      toolCall.name === 'document_edit_draft' ||
      toolCall.name === 'document_export' ||
      toolCall.name === 'document_enhance'
    ) {
      const supabase = require('../models/supabaseClient');

      if (toolCall.name === 'document_create_draft' || toolCall.name === 'document_edit_draft') {
        const draftData = {
          company_id: user.company_id,
          title: toolCall.arguments.title,
          content: toolCall.arguments.content,
          format: toolCall.arguments.format || 'md',
          summary_of_changes: toolCall.arguments.summary_of_changes,
          status: 'pending',
          // Link to the originating chat session (if provided) so deleting that chat
          // can clean up still-pending drafts it created.
          session_id: toolCall._sessionId || null,
        };
        
        if (toolCall.name === 'document_edit_draft' && toolCall.arguments.original_document_id) {
           draftData.original_document_id = toolCall.arguments.original_document_id;
        }

        const { data, error } = await supabase
          .from('document_drafts')
          .insert([draftData])
          .select()
          .single();
          
        if (error) throw new Error(`Draft creation failed: ${error.message}`);
        
        const durationMs = Date.now() - startTime;
        const result = { success: true, draft_id: data.id, requires_user_approval: true, message: 'Draft created successfully. Waiting for user approval.' };
        
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
      } else if (toolCall.name === 'document_export') {
        let docTitle = toolCall.arguments.title;
        let docContent = toolCall.arguments.content;
        const format = toolCall.arguments.format;
        const enhance = toolCall.arguments.enhance !== false;

        if (toolCall.arguments.document_id) {
          const { data: doc, error: fetchError } = await supabase
            .from('brain_documents')
            .select('*')
            .eq('id', toolCall.arguments.document_id)
            .eq('company_id', user.company_id)
            .single();
          if (fetchError || !doc) {
            throw new Error(`Source document not found: ${fetchError?.message || 'Not found'}`);
          }
          if (!docContent) docContent = doc.content;
          if (!docTitle) docTitle = doc.title;
        }

        if (!docContent) {
          throw new Error('Content is required to export document.');
        }
        if (!docTitle) {
          docTitle = 'Untitled Export';
        }

        // Optionally enhance content via LLM
        if (enhance) {
          const docEnhancer = require('../services/documentEnhancementService');
          const enhanced = await docEnhancer.enhanceForFormat(docTitle, docContent, format);
          docTitle = enhanced.title;
          docContent = enhanced.content;
        }

        // Generate the physical file
        const documentGen = require('../services/documentGenerationService');
        const path = require('path');
        const fs = require('fs');

        const uploadsDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const safeName = docTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const fileName = `${safeName}_export_${Date.now()}.${format}`;
        const filePath = path.join(uploadsDir, fileName);

        await documentGen.generateFile(docTitle, docContent, format, filePath);

        // Store standard document record in brain_documents
        const { data: newDoc, error: insertError } = await supabase
          .from('brain_documents')
          .insert([{
            company_id: user.company_id,
            title: docTitle,
            document_type: format,
            content: docContent,
            metadata: { source: 'ai_export', agent_tool: toolCall.name },
            file_path: `/uploads/${fileName}`
          }])
          .select()
          .single();

        if (insertError) {
          throw new Error(`Failed to save export registry: ${insertError.message}`);
        }

        // Fire-and-forget: index into vector store
        try {
          const { processDocument } = require('../services/ingestionService');
          processDocument(filePath, `${docTitle}.${format}`, 'text/plain', user.company_id, user.id, newDoc.id)
            .catch(err => console.error('Failed to index exported document:', err.message));
        } catch (err) {
          console.warn('[Sentinel] Ingestion service not available for indexing export:', err.message);
        }

        const durationMs = Date.now() - startTime;
        const result = {
          success: true,
          document_id: newDoc.id,
          downloadUrl: `/uploads/${fileName}`,
          filePath: `/uploads/${fileName}`,
          title: docTitle,
          format,
          message: 'Document exported and stored in Brain successfully.'
        };

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
      } else if (toolCall.name === 'document_enhance') {
        const docEnhancer = require('../services/documentEnhancementService');
        const docTitle = toolCall.arguments.title || 'Untitled Document';
        const docContent = toolCall.arguments.content;
        const format = toolCall.arguments.format;

        if (!docContent) {
          throw new Error('Content is required for preview.');
        }

        const enhanced = await docEnhancer.enhanceForFormat(docTitle, docContent, format);
        const brief = await docEnhancer.generateBrief(docTitle, docContent);

        const durationMs = Date.now() - startTime;
        const result = {
          success: true,
          enhanced,
          brief
        };

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
      }
    }

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
