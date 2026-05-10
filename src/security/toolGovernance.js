const supabase = require('../models/supabaseClient');

/**
 * Tool Governance — RBAC Permission Matrix
 * 
 * Checks if a specific user (or their role) is authorized to execute
 * a specific tool based on the tool_permissions table.
 */

/**
 * Check if a tool is authorized for a user
 * @param {Object} context
 * @param {string} context.companyId
 * @param {string} context.userId
 * @param {string} context.role
 * @param {string} context.toolName
 * @returns {Promise<{ authorized: boolean, reason: string }>}
 */
async function isToolAuthorized({ companyId, userId, role, toolName }) {
  try {
    // 1. Check for specific user permission
    // 2. Check for role-based permission
    // 3. Fallback to company default (user_id IS NULL AND role IS NULL)

    const { data, error } = await supabase
      .from('tool_permissions')
      .select('*')
      .eq('company_id', companyId)
      .eq('tool_name', toolName)
      .or(`user_id.eq.${userId},role.eq.${role},and(user_id.is.null,role.is.null)`)
      .order('user_id', { ascending: false, nullsFirst: false }) // Specific user first
      .order('role', { ascending: false, nullsFirst: false });    // Then role

    if (error) throw error;

    // If no permission record exists, we default to DENIED for security
    if (!data || data.length === 0) {
      return { 
        authorized: false, 
        reason: `No permission record found for tool "${toolName}". Restricted by default.` 
      };
    }

    // The first record in our ordered list is the most specific one
    const permission = data[0];

    return {
      authorized: permission.is_allowed,
      reason: permission.is_allowed 
        ? 'Authorized via tool permission matrix.' 
        : `Access to tool "${toolName}" has been explicitly revoked.`
    };
  } catch (error) {
    console.error('[ToolGovernance] Error checking permissions:', error);
    // In case of error, default to DENIED
    return { authorized: false, reason: 'Error verifying tool permissions. Restricted for safety.' };
  }
}

module.exports = {
  isToolAuthorized
};
