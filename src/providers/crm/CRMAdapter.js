const BaseAdapter = require('../BaseAdapter');

/**
 * CRMAdapter — Standard interface for all CRM providers.
 * Concrete implementations (future): HubSpotAdapter, SalesforceAdapter, ZohoAdapter
 */
class CRMAdapter extends BaseAdapter {
  constructor(providerName, credentials, config) {
    super(providerName, 'crm', credentials, config);
  }

  async get_contact(params) { throw new Error(`${this.providerName}: get_contact() not implemented.`); }
  async create_contact(params) { throw new Error(`${this.providerName}: create_contact() not implemented.`); }
  async search_contacts(params) { throw new Error(`${this.providerName}: search_contacts() not implemented.`); }
  async update_deal(params) { throw new Error(`${this.providerName}: update_deal() not implemented.`); }
  async list_deals(params) { throw new Error(`${this.providerName}: list_deals() not implemented.`); }
  async log_activity(params) { throw new Error(`${this.providerName}: log_activity() not implemented.`); }
}

module.exports = CRMAdapter;
