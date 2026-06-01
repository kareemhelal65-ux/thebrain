const FinanceAdapter = require('./FinanceAdapter');
const axios = require('axios');

/**
 * StripeAdapter — Concrete Finance implementation using Stripe API.
 * Uses API secret key. Covers payments, refunds, invoices, and balance.
 */
const STRIPE_BASE = 'https://api.stripe.com/v1';

class StripeAdapter extends FinanceAdapter {
  constructor(credentials, config = {}) {
    super('stripe', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.secret_key) {
      throw new Error('Stripe adapter missing required credential: secret_key');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.client = axios.create({
      baseURL: STRIPE_BASE,
      auth: { username: this.credentials.secret_key, password: '' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      await this.client.get('/balance');
      return { healthy: true, message: 'Stripe API connected.' };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async get_payment_status({ payment_id }) {
    this.ensureInitialized();
    const res = await this.client.get(`/payment_intents/${payment_id}`);
    const pi = res.data;
    return {
      payment_id: pi.id, status: pi.status,
      amount: pi.amount / 100, currency: pi.currency.toUpperCase(),
      created_at: new Date(pi.created * 1000).toISOString(),
      source: pi.payment_method_types?.[0] || 'unknown'
    };
  }

  async initiate_payment({ amount, currency = 'USD', recipient, description, metadata = {} }) {
    this.ensureInitialized();
    const params = new URLSearchParams();
    params.append('amount', Math.round(amount * 100));
    params.append('currency', currency.toLowerCase());
    if (description) params.append('description', description);
    if (recipient) params.append('receipt_email', recipient);
    params.append('payment_method_types[]', 'card');
    Object.entries(metadata).forEach(([k, v]) => params.append(`metadata[${k}]`, v));

    const res = await this.client.post('/payment_intents', params);
    return {
      success: true, payment_id: res.data.id,
      client_secret: res.data.client_secret, status: res.data.status
    };
  }

  async refund_payment({ payment_id, amount, reason }) {
    this.ensureInitialized();
    const params = new URLSearchParams();
    params.append('payment_intent', payment_id);
    if (amount) params.append('amount', Math.round(amount * 100));
    if (reason) params.append('reason', reason === 'duplicate' ? 'duplicate' : 'requested_by_customer');

    const res = await this.client.post('/refunds', params);
    return {
      success: true, refund_id: res.data.id,
      amount: res.data.amount / 100, status: res.data.status
    };
  }

  async list_transactions({ status, date_from, date_to, limit = 25 }) {
    this.ensureInitialized();
    const params = { limit };
    if (date_from) params['created[gte]'] = Math.floor(new Date(date_from).getTime() / 1000);
    if (date_to) params['created[lte]'] = Math.floor(new Date(date_to).getTime() / 1000);

    const res = await this.client.get('/payment_intents', { params });
    let transactions = (res.data.data || []).map(pi => ({
      id: pi.id, amount: pi.amount / 100, currency: pi.currency.toUpperCase(),
      status: pi.status, created_at: new Date(pi.created * 1000).toISOString(),
      description: pi.description
    }));
    if (status) transactions = transactions.filter(t => t.status === status);
    return { transactions, total: transactions.length };
  }

  async create_invoice({ client_name, client_email, line_items, currency = 'USD', due_date }) {
    this.ensureInitialized();
    // Find or create customer
    let customerId;
    const existingParams = new URLSearchParams();
    existingParams.append('email', client_email);
    const existing = await this.client.get('/customers', { params: { email: client_email, limit: 1 } });
    if (existing.data.data.length > 0) {
      customerId = existing.data.data[0].id;
    } else {
      const custParams = new URLSearchParams();
      custParams.append('email', client_email);
      custParams.append('name', client_name);
      const newCust = await this.client.post('/customers', custParams);
      customerId = newCust.data.id;
    }

    // Create invoice items
    for (const item of line_items) {
      const itemParams = new URLSearchParams();
      itemParams.append('customer', customerId);
      itemParams.append('amount', Math.round((item.quantity * item.unit_price) * 100));
      itemParams.append('currency', currency.toLowerCase());
      itemParams.append('description', item.description);
      await this.client.post('/invoiceitems', itemParams);
    }

    // Create invoice
    const invParams = new URLSearchParams();
    invParams.append('customer', customerId);
    invParams.append('auto_advance', 'true');
    if (due_date) invParams.append('due_date', Math.floor(new Date(due_date).getTime() / 1000));

    const invoice = await this.client.post('/invoices', invParams);
    return {
      invoice_id: invoice.data.id, status: invoice.data.status,
      total: invoice.data.total / 100, currency: currency.toUpperCase(),
      hosted_url: invoice.data.hosted_invoice_url
    };
  }

  async get_balance() {
    this.ensureInitialized();
    const res = await this.client.get('/balance');
    return {
      available: res.data.available.map(b => ({ amount: b.amount / 100, currency: b.currency.toUpperCase() })),
      pending: res.data.pending.map(b => ({ amount: b.amount / 100, currency: b.currency.toUpperCase() }))
    };
  }
}

module.exports = StripeAdapter;
