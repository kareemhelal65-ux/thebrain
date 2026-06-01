const BaseAdapter = require('../BaseAdapter');

/**
 * LegalAdapter — Abstract interface for Legal/Compliance providers.
 * Implementations: Ironclad, ContractPodAi, or the Brain's internal legal engine.
 */
class LegalAdapter extends BaseAdapter {
  async contract_review() { throw new Error('contract_review not implemented'); }
  async contract_generate() { throw new Error('contract_generate not implemented'); }
  async contract_lifecycle() { throw new Error('contract_lifecycle not implemented'); }
  async compliance_check() { throw new Error('compliance_check not implemented'); }
  async regulatory_monitor() { throw new Error('regulatory_monitor not implemented'); }
  async ip_portfolio() { throw new Error('ip_portfolio not implemented'); }
  async legal_hold() { throw new Error('legal_hold not implemented'); }
  async policy_management() { throw new Error('policy_management not implemented'); }
  async legal_spend_tracking() { throw new Error('legal_spend_tracking not implemented'); }
  async risk_register() { throw new Error('risk_register not implemented'); }
}

module.exports = LegalAdapter;
