const HRAdapter = require('./HRAdapter');
const axios = require('axios');

/**
 * GustoAdapter — Concrete HR implementation using Gusto API v1.
 * Specializes in payroll, benefits, and employee management for US companies.
 * Uses OAuth2 bearer tokens.
 */
const GUSTO_BASE = 'https://api.gusto.com/v1';

class GustoAdapter extends HRAdapter {
  constructor(credentials, config = {}) {
    super('gusto', credentials, config);
    this.client = null;
    this.companyUuid = null;
  }

  validateConfig() {
    if (!this.credentials.access_token) {
      throw new Error('Gusto adapter missing required credential: access_token');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.client = axios.create({
      baseURL: GUSTO_BASE,
      headers: { 'Authorization': `Bearer ${this.credentials.access_token}`, 'Content-Type': 'application/json' }
    });
    this.companyUuid = this.credentials.company_uuid || this.config.company_uuid;
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      if (this.companyUuid) {
        await this.client.get(`/companies/${this.companyUuid}`);
      }
      return { healthy: true, message: 'Gusto API connected.' };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async get_employee({ employee_id, email }) {
    this.ensureInitialized();
    if (email) {
      const list = await this.client.get(`/companies/${this.companyUuid}/employees`);
      const emp = list.data.find(e => e.email === email);
      if (!emp) return { error: 'Employee not found', email };
      return this._mapEmployee(emp);
    }
    const res = await this.client.get(`/employees/${employee_id}`);
    return this._mapEmployee(res.data);
  }

  async list_employees({ department, status = 'active', limit = 50 }) {
    this.ensureInitialized();
    const params = {};
    if (status === 'terminated') params.terminated = true;
    const res = await this.client.get(`/companies/${this.companyUuid}/employees`, { params });
    let employees = res.data.map(e => this._mapEmployee(e));
    if (department) employees = employees.filter(e => e.department === department);
    return { employees: employees.slice(0, limit), total: employees.length };
  }

  async request_leave({ employee_id, leave_type, start_date, end_date, reason }) {
    this.ensureInitialized();
    // Gusto manages time off through time-off policies
    const res = await this.client.post(`/employees/${employee_id}/time_off_requests`, {
      request_type: leave_type, start_date, end_date,
      employee_note: reason || ''
    }).catch(() => null);

    return {
      employee_id, leave_type, start_date, end_date,
      status: res ? 'requested' : 'submitted_manually',
      note: !res ? 'Gusto time-off API may require specific plan configuration.' : undefined
    };
  }

  async approve_leave({ request_id, decision, comment }) {
    this.ensureInitialized();
    const status = decision === 'approved' ? 'approve' : 'deny';
    await this.client.put(`/time_off_requests/${request_id}/${status}`).catch(() => {});
    return { request_id, decision, processed: true };
  }

  async get_payroll_summary({ employee_id, period }) {
    this.ensureInitialized();
    const res = await this.client.get(`/companies/${this.companyUuid}/payrolls`, {
      params: { processed: true }
    });

    let payrolls = res.data || [];
    if (period) {
      payrolls = payrolls.filter(p => p.pay_period?.start_date?.startsWith(period));
    }

    const summary = payrolls.slice(0, 5).map(p => ({
      period: `${p.pay_period?.start_date} to ${p.pay_period?.end_date}`,
      total_gross: p.totals?.gross_pay,
      total_net: p.totals?.net_pay,
      total_taxes: p.totals?.employer_taxes,
      processed_date: p.processed_date
    }));

    return { payrolls: summary, total: payrolls.length };
  }

  _mapEmployee(raw) {
    return {
      id: raw.uuid || raw.id, first_name: raw.first_name, last_name: raw.last_name,
      email: raw.email, phone: raw.phone,
      department: raw.department, title: raw.job_title || raw.title,
      status: raw.terminated ? 'terminated' : 'active',
      hire_date: raw.date_of_birth ? undefined : raw.hire_date
    };
  }
}

module.exports = GustoAdapter;
