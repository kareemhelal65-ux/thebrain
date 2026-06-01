/**
 * Action Approval Service (Phase 3 — Approval-First Agent Actions)
 *
 * Design rule: every action that posts, sends, or writes to an external system
 * must go through the approval workflow. The agent PROPOSES an action; the user
 * sees a preview and approves/rejects; only on approval does the adapter execute.
 *
 * The orchestrator routes external-mutating tool calls here via proposeAction()
 * instead of executing them inline. Approval triggers executeApprovedAction(),
 * which re-validates through the Sentinel pipeline before the adapter runs.
 */

const supabase = require('../models/supabaseClient');

/**
 * Tool names that are read-only / safe and should NEVER require approval.
 * Used together with the verb heuristic below.
 */
const READONLY_PREFIXES = ['get', 'list', 'read', 'search', 'find', 'fetch', 'check', 'analyze', 'summarize', 'translate', 'view', 'lookup'];

/**
 * Verbs that indicate an external mutation (send/post/write) and therefore
 * require user approval before execution.
 */
const MUTATION_PREFIXES = ['send', 'post', 'publish', 'create', 'schedule', 'update', 'delete', 'add', 'remove', 'invite', 'assign', 'move', 'archive', 'set_', 'dispatch', 'draft_', 'broadcast', 'internal_announcement'];

/**
 * Decide whether a given tool call must be routed through approval.
 * @param {string} toolName
 * @returns {boolean}
 */
function isActionTool(toolName) {
  if (!toolName) return false;
  const n = toolName.toLowerCase();
  if (READONLY_PREFIXES.some(p => n.startsWith(p))) return false;
  return MUTATION_PREFIXES.some(p => n.startsWith(p));
}

/**
 * Build a concise, human-readable preview of what an action will do.
 */
function buildActionPreview(toolName, args = {}) {
  switch (toolName) {
    case 'send_email':
      return `Send email to ${[].concat(args.to || []).join(', ')} — subject: "${args.subject || ''}"`;
    case 'send_message':
      return `Post message to ${args.channel || 'a channel'}: "${String(args.message || '').slice(0, 140)}"`;
    case 'create_calendar_event':
      return `Create calendar event "${args.title || ''}" from ${args.start_time || '?'} to ${args.end_time || '?'}` +
        (args.attendees && args.attendees.length ? ` with ${args.attendees.join(', ')}` : '');
    case 'send_notification':
      return `Send ${args.channel || ''} notification "${args.title || ''}" to ${[].concat(args.recipients || []).join(', ')}`;
    case 'internal_announcement':
      return `Broadcast announcement "${args.title || ''}" to ${args.audience || ''} via ${[].concat(args.channels || []).join(', ')}`;
    case 'send_bulk_email':
      return `Send bulk email (template ${args.template_id || ''}) to ${(args.recipients || []).length} recipients`;
    case 'schedule_email':
      return `Schedule email to ${[].concat(args.to || []).join(', ')} for ${args.send_at || ''}`;
    default: {
      const keys = Object.keys(args || {}).slice(0, 4);
      const summary = keys.map(k => `${k}: ${typeof args[k] === 'object' ? JSON.stringify(args[k]).slice(0, 60) : String(args[k]).slice(0, 60)}`).join('; ');
      return `Run ${toolName}${summary ? ` — ${summary}` : ''}`;
    }
  }
}

/**
 * Record a proposed action awaiting user approval.
 * @returns {Promise<Object>} The created approval row
 */
async function proposeAction({ companyId, executionId = null, toolName, category = null, args = {}, userId = null }) {
  const record = {
    company_id: companyId,
    agent_execution_id: executionId,
    tool_name: toolName,
    tool_category: category,
    arguments: args,
    preview: buildActionPreview(toolName, args),
    status: 'pending',
    requested_by: userId,
  };

  const { data, error } = await supabase
    .from('agent_action_approvals')
    .insert([record])
    .select()
    .single();

  if (error) throw new Error(`Failed to record proposed action: ${error.message}`);
  console.log(`[ActionApproval] Proposed action "${toolName}" for company ${companyId} (id ${data.id})`);
  return data;
}

/**
 * List pending proposed actions for a company.
 */
async function listPendingActions(companyId) {
  const { data, error } = await supabase
    .from('agent_action_approvals')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Approve and execute a proposed action. Re-validates through Sentinel,
 * then runs the adapter. Updates the row with the result.
 * @param {string} actionId
 * @param {Object} user - approving user ({ id, company_id, role, department })
 * @param {Object} [overrides] - optional edited arguments to use instead
 */
async function approveAction(actionId, user, overrides = null) {
  const { data: action, error } = await supabase
    .from('agent_action_approvals')
    .select('*')
    .eq('id', actionId)
    .single();

  if (error || !action) throw new Error('Action not found');
  if (action.company_id !== user.company_id) throw new Error('Unauthorized');
  if (action.status !== 'pending') throw new Error(`Action is already ${action.status}`);

  const args = overrides && typeof overrides === 'object' ? { ...action.arguments, ...overrides } : action.arguments;

  const sentinel = require('../middleware/sentinel');
  const verdict = await sentinel.validate({ name: action.tool_name, arguments: args }, user);
  if (!verdict.allowed) {
    await supabase.from('agent_action_approvals').update({
      status: 'failed', error: `Sentinel denied: ${verdict.reason}`, updated_at: new Date().toISOString(),
    }).eq('id', actionId);
    throw new Error(`Sentinel denied execution: ${verdict.reason}`);
  }

  const execResult = await sentinel.executeApprovedTool({ name: action.tool_name, arguments: args }, verdict, user);

  const success = !!execResult.success;
  const { data: updated } = await supabase
    .from('agent_action_approvals')
    .update({
      status: success ? 'executed' : 'failed',
      approved_by: user.id,
      arguments: args,
      result: success ? (execResult.result || execResult) : null,
      error: success ? null : (execResult.error || 'Execution failed'),
      executed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', actionId)
    .select()
    .single();

  if (!success) throw new Error(execResult.error || 'Action execution failed');
  console.log(`[ActionApproval] Executed action "${action.tool_name}" (id ${actionId})`);
  return updated;
}

/**
 * Reject a proposed action.
 */
async function rejectAction(actionId, user, reason = null) {
  const { data: action } = await supabase
    .from('agent_action_approvals')
    .select('company_id, status')
    .eq('id', actionId)
    .single();

  if (!action) throw new Error('Action not found');
  if (action.company_id !== user.company_id) throw new Error('Unauthorized');

  const { data: updated, error } = await supabase
    .from('agent_action_approvals')
    .update({
      status: 'rejected',
      approved_by: user.id,
      error: reason || 'Rejected by user',
      updated_at: new Date().toISOString(),
    })
    .eq('id', actionId)
    .select()
    .single();

  if (error) throw error;
  return updated;
}

module.exports = {
  isActionTool,
  buildActionPreview,
  proposeAction,
  listPendingActions,
  approveAction,
  rejectAction,
  READONLY_PREFIXES,
  MUTATION_PREFIXES,
};
