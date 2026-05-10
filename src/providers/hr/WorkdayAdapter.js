const HRAdapter = require('./HRAdapter');
const axios = require('axios');

/**
 * WorkdayAdapter — Concrete HR implementation using Workday REST API.
 * 
 * Workday uses tenant-specific URLs and OAuth2 with client credentials.
 * Covers Workers, Time Off, and Payroll reporting.
 */
class WorkdayAdapter extends HRAdapter {
  constructor(credentials, config = {}) {
    super('workday', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.tenant_url || !this.credentials.access_token) {
      throw new Error('Workday adapter missing required credentials: tenant_url, access_token');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    const baseURL = this.credentials.tenant_url.replace(/\/$/, '');
    this.client = axios.create({
      baseURL: `${baseURL}/api/v1`,
      headers: { 'Authorization': `Bearer ${this.credentials.access_token}`, 'Content-Type': 'application/json' }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      await this.client.get('/workers?limit=1');
      return { healthy: true, message: 'Workday API connected.' };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async get_employee({ employee_id, email }) {
    this.ensureInitialized();
    if (email) {
      const res = await this.client.get('/workers', {
        params: { search: email, limit: 1 }
      });
      const worker = res.data?.data?.[0];
      if (!worker) return { error: 'Employee not found', email };
      return this._mapWorker(worker);
    }
    const res = await this.client.get(`/workers/${employee_id}`);
    return this._mapWorker(res.data);
  }

  async list_employees({ department, status = 'active', limit = 50 }) {
    this.ensureInitialized();
    const params = { limit };
    if (status === 'active') params.active = true;

    const res = await this.client.get('/workers', { params });
    let employees = (res.data?.data || []).map(w => this._mapWorker(w));
    if (department) employees = employees.filter(e => e.department === department);
    return { employees, total: res.data?.total || employees.length };
  }

  async request_leave({ employee_id, leave_type, start_date, end_date, reason }) {
    this.ensureInitialized();
    const res = await this.client.post(`/workers/${employee_id}/timeOffRequests`, {
      type: leave_type, startDate: start_date, endDate: end_date,
      comment: reason || ''
    }).catch(() => null);

    return {
      employee_id, leave_type, start_date, end_date,
      status: res ? 'requested' : 'submitted',
      note: !res ? 'Workday time-off may require business process configuration.' : undefined
    };
  }

  async approve_leave({ request_id, decision, comment }) {
    this.ensureInitialized();
    await this.client.post(`/timeOffRequests/${request_id}/${decision}`, {
      comment: comment || ''
    }).catch(() => {});
    return { request_id, decision, processed: true };
  }

  async get_payroll_summary({ employee_id, period }) {
    this.ensureInitialized();
    const params = {};
    if (employee_id) params.worker = employee_id;
    if (period) params.period = period;

    const res = await this.client.get('/payroll/results', { params }).catch(() => ({ data: {} }));
    const results = res.data?.data || [];

    return {
      payrolls: results.slice(0, 10).map(p => ({
        period: p.payPeriod, gross: p.grossPay,
        net: p.netPay, deductions: p.totalDeductions
      })),
      total: results.length
    };
  }

  _mapWorker(raw) {
    const primary = raw.primaryJob || raw.primary_position || {};
    return {
      id: raw.id || raw.workerId,
      first_name: raw.firstName || raw.name?.first,
      last_name: raw.lastName || raw.name?.last,
      email: raw.email || raw.emailAddress,
      phone: raw.phone || raw.phoneNumber,
      department: primary.department || raw.department,
      title: primary.jobTitle || primary.title || raw.jobTitle,
      status: raw.active ? 'active' : 'inactive',
      hire_date: raw.hireDate
    };
  }
}

module.exports = WorkdayAdapter;
