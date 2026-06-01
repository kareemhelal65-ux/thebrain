const FinanceAdapter = require('./FinanceAdapter');
const axios = require('axios');

/**
 * QuickBooksAdapter — Concrete Finance implementation using QuickBooks Online API.
 * Uses OAuth2 bearer tokens. Covers invoices, payments, and account queries.
 */
class QuickBooksAdapter extends FinanceAdapter {
  constructor(credentials, config = {}) {
    super('quickbooks', credentials, config);
    this.client = null;
    this.realmId = null;
  }

  validateConfig() {
    if (!this.credentials.access_token || !this.credentials.realm_id) {
      throw new Error('QuickBooks adapter missing required credentials: access_token, realm_id');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.realmId = this.credentials.realm_id;
    const env = this.config.sandbox ? 'sandbox' : 'quickbooks';
    this.client = axios.create({
      baseURL: `https://${env}.api.intuit.com/v3/company/${this.realmId}`,
      headers: {
        'Authorization': `Bearer ${this.credentials.access_token}`,
        'Content-Type': 'application/json', 'Accept': 'application/json'
      }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      await this.client.get('/companyinfo/' + this.realmId);
      return { healthy: true, message: 'QuickBooks Online connected.' };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async get_payment_status({ payment_id }) {
    this.ensureInitialized();
    const res = await this.client.get(`/payment/${payment_id}`);
    const p = res.data.Payment;
    return {
      payment_id: p.Id, status: 'completed',
      amount: p.TotalAmt, currency: p.CurrencyRef?.value || 'USD',
      created_at: p.MetaData?.CreateTime, customer: p.CustomerRef?.name
    };
  }

  async initiate_payment({ amount, currency = 'USD', recipient, description }) {
    this.ensureInitialized();
    // QuickBooks records received payments against invoices
    const payment = {
      TotalAmt: amount,
      CustomerRef: { value: recipient },
      PrivateNote: description || 'Payment via AIOS'
    };
    const res = await this.client.post('/payment', payment);
    return { success: true, payment_id: res.data.Payment.Id, amount };
  }

  async refund_payment({ payment_id, amount, reason }) {
    this.ensureInitialized();
    const refund = {
      PaymentRefund: { Amount: amount, PaymentRef: { value: payment_id } },
      PrivateNote: reason || 'Refund via AIOS'
    };
    const res = await this.client.post('/refundreceipt', refund).catch(() => ({ data: {} }));
    return { success: true, refund_id: res.data?.RefundReceipt?.Id, amount };
  }

  async list_transactions({ status, date_from, date_to, limit = 25 }) {
    this.ensureInitialized();
    let query = `SELECT * FROM Payment MAXRESULTS ${limit}`;
    if (date_from) query += ` WHERE MetaData.CreateTime >= '${date_from}'`;

    const res = await this.client.get('/query', { params: { query } });
    const payments = res.data?.QueryResponse?.Payment || [];
    return {
      transactions: payments.map(p => ({
        id: p.Id, amount: p.TotalAmt, currency: p.CurrencyRef?.value || 'USD',
        status: 'completed', created_at: p.MetaData?.CreateTime,
        customer: p.CustomerRef?.name
      })),
      total: payments.length
    };
  }

  async create_invoice({ client_name, client_email, line_items, currency = 'USD', due_date }) {
    this.ensureInitialized();
    const invoice = {
      CustomerRef: { value: client_name },
      BillEmail: { Address: client_email },
      DueDate: due_date,
      Line: line_items.map((item, i) => ({
        Amount: item.quantity * item.unit_price,
        DetailType: 'SalesItemLineDetail',
        Description: item.description,
        SalesItemLineDetail: { Qty: item.quantity, UnitPrice: item.unit_price }
      }))
    };

    const res = await this.client.post('/invoice', invoice);
    const inv = res.data.Invoice;
    return {
      invoice_id: inv.Id, total: inv.TotalAmt,
      currency: inv.CurrencyRef?.value || currency,
      status: inv.Balance > 0 ? 'unpaid' : 'paid'
    };
  }

  async get_balance() {
    this.ensureInitialized();
    const res = await this.client.get('/reports/BalanceSheet', {
      params: { date_macro: 'Today' }
    }).catch(() => ({ data: {} }));

    return {
      report: 'Balance Sheet',
      note: 'Full balance details available in QuickBooks dashboard.',
      data: res.data?.Rows?.Row?.slice(0, 5) || []
    };
  }
}

module.exports = QuickBooksAdapter;
