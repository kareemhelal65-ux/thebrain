const BaseAdapter = require('../BaseAdapter');

/**
 * HRAdapter — Standard interface for all HR/people management providers.
 * Concrete implementations (future): BambooHRAdapter, GustoAdapter, WorkdayAdapter
 */
class HRAdapter extends BaseAdapter {
  constructor(providerName, credentials, config) {
    super(providerName, 'hr', credentials, config);
  }

  async get_employee(params) { throw new Error(`${this.providerName}: get_employee() not implemented.`); }
  async list_employees(params) { throw new Error(`${this.providerName}: list_employees() not implemented.`); }
  async request_leave(params) { throw new Error(`${this.providerName}: request_leave() not implemented.`); }
  async approve_leave(params) { throw new Error(`${this.providerName}: approve_leave() not implemented.`); }
  async get_payroll_summary(params) { throw new Error(`${this.providerName}: get_payroll_summary() not implemented.`); }
}

module.exports = HRAdapter;
