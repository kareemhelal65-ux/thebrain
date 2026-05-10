const FinanceAdapter = require('./FinanceAdapter');
const axios = require('axios');

/**
 * XeroAdapter — Concrete Finance implementation using Xero Accounting API.
 * Uses OAuth2 bearer tokens with tenant ID header.
 */
const XERO_BASE = 'https://api.xero.com/api.xro/2.0';

class XeroAdapter extends FinanceAdapter {
  constructor(credentials, config = {}) {
    super('xero', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.access_token || !this.credentials.tenant_id) {
      throw new Error('Xero adapter missing required credentials: access_token, tenant_id');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.client = axios.create({
      baseURL: XERO_BASE,
      headers: {
        'Authorization': `Bearer ${this.credentials.access_token}`,
        'Xero-Tenant-Id': this.credentials.tenant_id,
        'Content-Type': 'application/json', 'Accept': 'application/json'
      }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      await this.client.get('/Organisation');
      return { healthy: true, message: 'Xero API connected.' };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async get_payment_status({ payment_id }) {
    this.ensureInitialized();
    const res = await this.client.get(`/Payments/${payment_id}`);
    const p = res.data.Payments[0];
    return {
      payment_id: p.PaymentID, status: p.Status.toLowerCase(),
      amount: p.Amount, currency: p.CurrencyCode,
      created_at: p.Date, reference: p.Reference
    };
  }

  async initiate_payment({ amount, currency = 'USD', recipient, description }) {
    this.ensureInitialized();
    const payment = {
      Invoice: { InvoiceNumber: recipient },
      Account: { Code: this.config.default_account || '090' },
      Amount: amount, Date: new Date().toISOString().split('T')[0],
      Reference: description || 'Payment via AIOS'
    };
    const res = await this.client.put('/Payments', { Payments: [payment] });
    return { success: true, payment_id: res.data.Payments?.[0]?.PaymentID, amount };
  }

  async refund_payment({ payment_id, amount, reason }) {
    this.ensureInitialized();
    // Xero handles refunds via credit notes
    const res = await this.client.post('/CreditNotes', {
      CreditNotes: [{
        Type: 'ACCRECCREDIT',
        Contact: { ContactID: payment_id },
        LineItems: [{ Description: reason || 'Refund', Quantity: 1, UnitAmount: amount }]
      }]
    }).catch(() => ({ data: {} }));
    return { success: true, credit_note_id: res.data.CreditNotes?.[0]?.CreditNoteID, amount };
  }

  async list_transactions({ status, date_from, date_to, limit = 25 }) {
    this.ensureInitialized();
    let url = '/Payments';
    const params = {};
    if (date_from || date_to) {
      const where = [];
      if (date_from) where.push(`Date >= DateTime(${new Date(date_from).getFullYear()},${new Date(date_from).getMonth()+1},${new Date(date_from).getDate()})`);
      params.where = where.join(' AND ');
    }

    const res = await this.client.get(url, { params });
    let payments = (res.data.Payments || []).slice(0, limit).map(p => ({
      id: p.PaymentID, amount: p.Amount, currency: p.CurrencyCode,
      status: p.Status?.toLowerCase(), created_at: p.Date, reference: p.Reference
    }));
    if (status) payments = payments.filter(p => p.status === status);
    return { transactions: payments, total: payments.length };
  }

  async create_invoice({ client_name, client_email, line_items, currency = 'USD', due_date }) {
    this.ensureInitialized();
    const invoice = {
      Type: 'ACCREC',
      Contact: { Name: client_name, EmailAddress: client_email },
      DueDate: due_date || new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
      CurrencyCode: currency,
      LineItems: line_items.map(item => ({
        Description: item.description, Quantity: item.quantity,
        UnitAmount: item.unit_price, AccountCode: '200'
      }))
    };

    const res = await this.client.put('/Invoices', { Invoices: [invoice] });
    const inv = res.data.Invoices?.[0];
    return {
      invoice_id: inv?.InvoiceID, invoice_number: inv?.InvoiceNumber,
      total: inv?.Total, currency, status: inv?.Status?.toLowerCase()
    };
  }

  async get_balance() {
    this.ensureInitialized();
    const res = await this.client.get('/Reports/BalanceSheet');
    const rows = res.data.Reports?.[0]?.Rows || [];
    return {
      report: 'Balance Sheet',
      sections: rows.filter(r => r.RowType === 'Section').map(s => ({
        title: s.Title, rows: (s.Rows || []).slice(0, 5).map(r => ({
          label: r.Cells?.[0]?.Value, amount: r.Cells?.[1]?.Value
        }))
      }))
    };
  }
}

module.exports = XeroAdapter;
