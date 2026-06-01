const BaseAdapter = require('../BaseAdapter');

/**
 * ITOpsAdapter — Abstract interface for IT Operations & Service Management providers.
 * Implementations: ServiceNow, Jira Service Management, or the Brain's internal IT engine.
 */
class ITOpsAdapter extends BaseAdapter {
  async create_incident() { throw new Error('create_incident not implemented'); }
  async manage_service_request() { throw new Error('manage_service_request not implemented'); }
  async asset_inventory() { throw new Error('asset_inventory not implemented'); }
  async access_provisioning() { throw new Error('access_provisioning not implemented'); }
  async system_monitoring() { throw new Error('system_monitoring not implemented'); }
  async change_management() { throw new Error('change_management not implemented'); }
  async security_response() { throw new Error('security_response not implemented'); }
  async it_knowledge_base() { throw new Error('it_knowledge_base not implemented'); }
}

module.exports = ITOpsAdapter;
