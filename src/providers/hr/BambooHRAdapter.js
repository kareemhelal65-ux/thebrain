const HRAdapter = require('./HRAdapter');
const axios = require('axios');

/**
 * BambooHRAdapter — Concrete HR implementation using BambooHR API.
 * Uses API key authentication with Basic Auth (apikey:x).
 */
class BambooHRAdapter extends HRAdapter {
  constructor(credentials, config = {}) {
    super('bamboohr', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.api_key || !this.credentials.subdomain) {
      throw new Error('BambooHR adapter missing required credentials: api_key, subdomain');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    const auth = Buffer.from(`${this.credentials.api_key}:x`).toString('base64');
    this.client = axios.create({
      baseURL: `https://api.bamboohr.com/api/gateway.php/${this.credentials.subdomain}/v1`,
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      await this.client.get('/employees/directory');
      return { healthy: true, message: 'BambooHR connected.' };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async get_employee({ employee_id, email }) {
    this.ensureInitialized();
    if (email) {
      const dir = await this.client.get('/employees/directory');
      const emp = dir.data.employees?.find(e => e.workEmail === email);
      if (!emp) return { error: 'Employee not found', email };
      return this._mapEmployee(emp);
    }
    const res = await this.client.get(`/employees/${employee_id}`, {
      params: { fields: 'firstName,lastName,workEmail,workPhone,department,jobTitle,status,hireDate' }
    });
    return this._mapEmployee(res.data);
  }

  async list_employees({ department, status = 'active', limit = 50 }) {
    this.ensureInitialized();
    const res = await this.client.get('/employees/directory');
    let employees = (res.data.employees || []).map(e => this._mapEmployee(e));
    if (department) employees = employees.filter(e => e.department === department);
    if (status === 'active') employees = employees.filter(e => e.status !== 'Inactive');
    return { employees: employees.slice(0, limit), total: employees.length };
  }

  async request_leave({ employee_id, leave_type, start_date, end_date, reason }) {
    this.ensureInitialized();
    // BambooHR uses time-off type IDs; map common types
    const typeMap = { annual: 1, sick: 2, personal: 3, unpaid: 4 };
    const typeId = typeMap[leave_type] || 1;

    const res = await this.client.put(`/employees/${employee_id}/time_off/request`, {
      status: 'requested', start: start_date, end: end_date,
      timeOffTypeId: typeId, notes: reason || ''
    });
    return { employee_id, leave_type, start_date, end_date, status: 'requested' };
  }

  async approve_leave({ request_id, decision, comment }) {
    this.ensureInitialized();
    const status = decision === 'approved' ? 'approved' : 'denied';
    await this.client.put(`/time_off/requests/${request_id}/status`, {
      status, note: comment || ''
    });
    return { request_id, decision, processed: true };
  }

  async get_payroll_summary({ employee_id, period }) {
    this.ensureInitialized();
    // BambooHR payroll data is typically in reports
    return {
      note: 'BambooHR payroll data requires custom report configuration.',
      employee_id, period,
      suggestion: 'Use BambooHR Reports API or connect a dedicated payroll adapter (Gusto).'
    };
  }

  _mapEmployee(raw) {
    return {
      id: raw.id, first_name: raw.firstName, last_name: raw.lastName,
      email: raw.workEmail, phone: raw.workPhone,
      department: raw.department, title: raw.jobTitle,
      status: raw.status, hire_date: raw.hireDate
    };
  }
}

module.exports = BambooHRAdapter;
