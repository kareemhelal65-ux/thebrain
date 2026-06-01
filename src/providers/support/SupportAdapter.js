const BaseAdapter = require('../BaseAdapter');

/**
 * SupportAdapter — Abstract interface for Customer Support providers.
 * Implementations: Zendesk, Freshdesk, Intercom, or the Brain's internal support engine.
 */
class SupportAdapter extends BaseAdapter {
  async create_ticket() { throw new Error('create_ticket not implemented'); }
  async update_ticket() { throw new Error('update_ticket not implemented'); }
  async list_tickets() { throw new Error('list_tickets not implemented'); }
  async escalate_ticket() { throw new Error('escalate_ticket not implemented'); }
  async sla_tracking() { throw new Error('sla_tracking not implemented'); }
  async knowledge_base() { throw new Error('knowledge_base not implemented'); }
  async canned_responses() { throw new Error('canned_responses not implemented'); }
  async satisfaction_survey() { throw new Error('satisfaction_survey not implemented'); }
  async support_analytics() { throw new Error('support_analytics not implemented'); }
  async auto_categorize() { throw new Error('auto_categorize not implemented'); }
  async customer_history() { throw new Error('customer_history not implemented'); }
  async queue_management() { throw new Error('queue_management not implemented'); }
}

module.exports = SupportAdapter;
