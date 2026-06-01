const FinanceAdapter = require('./FinanceAdapter');
const axios = require('axios');

/**
 * PaymobAdapter — Concrete implementation of the Finance interface.
 * 
 * Targets Paymob Egypt (accept.paymob.com).
 * Handles the auth token → order registration → payment key flow.
 * When a client needs international routing, spin up a Paymob_Global adapter instead.
 */
const PAYMOB_BASE_URL = 'https://accept.paymob.com/api';

class PaymobAdapter extends FinanceAdapter {
  constructor(credentials, config = {}) {
    super('paymob', credentials, config);
    this.authToken = null;
    this.tokenExpiry = null;
  }

  validateConfig() {
    const required = ['api_key'];
    for (const field of required) {
      if (!this.credentials[field]) {
        throw new Error(`Paymob adapter missing required credential: ${field}`);
      }
    }
    if (!this.credentials.integration_id) {
      console.warn('Paymob adapter: integration_id not set. Payment initiation will fail.');
    }
    return true;
  }

  /**
   * Authenticate with Paymob and get an auth token.
   */
  async authenticate() {
    const response = await axios.post(`${PAYMOB_BASE_URL}/auth/tokens`, {
      api_key: this.credentials.api_key
    });
    this.authToken = response.data.token;
    // Tokens are valid for ~1 hour
    this.tokenExpiry = Date.now() + (55 * 60 * 1000);
    return this.authToken;
  }

  /**
   * Ensure we have a valid auth token.
   */
  async ensureAuth() {
    if (!this.authToken || Date.now() >= this.tokenExpiry) {
      await this.authenticate();
    }
    return this.authToken;
  }

  async initialize() {
    this.validateConfig();
    await this.authenticate();
    this.initialized = true;
  }

  async healthCheck() {
    try {
      await this.ensureAuth();
      return { healthy: true, message: 'Paymob Egypt authenticated successfully.' };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  /**
   * Get payment/transaction status by ID.
   */
  async get_payment_status({ payment_id }) {
    await this.ensureAuth();

    const response = await axios.get(
      `${PAYMOB_BASE_URL}/acceptance/transactions/${payment_id}`,
      { headers: { Authorization: `Bearer ${this.authToken}` } }
    );

    const txn = response.data;
    return {
      payment_id: txn.id.toString(),
      status: txn.success ? 'completed' : (txn.pending ? 'pending' : 'failed'),
      amount: txn.amount_cents / 100,
      currency: txn.currency,
      created_at: txn.created_at,
      source: txn.source_data?.type || 'unknown'
    };
  }

  /**
   * Initiate a payment: register order → generate payment key.
   */
  async initiate_payment({ amount, currency = 'EGP', recipient, description, metadata = {} }) {
    await this.ensureAuth();

    // Step 1: Register an order
    const orderResponse = await axios.post(`${PAYMOB_BASE_URL}/ecommerce/orders`, {
      auth_token: this.authToken,
      delivery_needed: false,
      amount_cents: Math.round(amount * 100),
      currency,
      items: [{
        name: description || 'Payment',
        amount_cents: Math.round(amount * 100),
        quantity: 1
      }],
      merchant_order_id: metadata.order_id || `brain_${Date.now()}`
    });

    const orderId = orderResponse.data.id;

    // Step 2: Generate payment key
    const paymentKeyResponse = await axios.post(`${PAYMOB_BASE_URL}/acceptance/payment_keys`, {
      auth_token: this.authToken,
      amount_cents: Math.round(amount * 100),
      expiration: 3600,
      order_id: orderId,
      currency,
      integration_id: this.credentials.integration_id,
      billing_data: {
        email: recipient || 'N/A',
        first_name: 'N/A', last_name: 'N/A',
        phone_number: 'N/A', street: 'N/A',
        building: 'N/A', floor: 'N/A', apartment: 'N/A',
        city: 'N/A', state: 'N/A', country: 'EG',
        shipping_method: 'N/A', postal_code: 'N/A'
      }
    });

    return {
      success: true,
      order_id: orderId.toString(),
      payment_key: paymentKeyResponse.data.token,
      payment_url: `https://accept.paymob.com/api/acceptance/iframes/${this.credentials.iframe_id || 'default'}?payment_token=${paymentKeyResponse.data.token}`
    };
  }

  /**
   * Refund a payment.
   */
  async refund_payment({ payment_id, amount, reason }) {
    await this.ensureAuth();

    const response = await axios.post(`${PAYMOB_BASE_URL}/acceptance/void_refund/refund`, {
      auth_token: this.authToken,
      transaction_id: payment_id,
      amount_cents: amount ? Math.round(amount * 100) : undefined
    });

    return {
      success: response.data.success || false,
      refund_id: response.data.id?.toString(),
      reason: reason || 'Refund processed via AIOS'
    };
  }

  /**
   * List recent transactions.
   */
  async list_transactions({ status, date_from, date_to, limit = 25 }) {
    await this.ensureAuth();

    let url = `${PAYMOB_BASE_URL}/acceptance/transactions?page_size=${limit}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${this.authToken}` }
    });

    let transactions = (response.data.results || []).map(txn => ({
      id: txn.id.toString(),
      amount: txn.amount_cents / 100,
      currency: txn.currency,
      status: txn.success ? 'completed' : (txn.pending ? 'pending' : 'failed'),
      created_at: txn.created_at,
      source: txn.source_data?.type || 'unknown'
    }));

    if (status) {
      transactions = transactions.filter(t => t.status === status);
    }

    return { transactions, total: transactions.length };
  }

  /**
   * Create invoice — Paymob doesn't have native invoicing, generates a payment link instead.
   */
  async create_invoice({ client_name, client_email, line_items, currency = 'EGP', due_date }) {
    const totalAmount = line_items.reduce((sum, item) => {
      return sum + (item.quantity * item.unit_price);
    }, 0);

    const result = await this.initiate_payment({
      amount: totalAmount,
      currency,
      recipient: client_email,
      description: `Invoice for ${client_name}`,
      metadata: { client_name, due_date }
    });

    return {
      invoice_id: result.order_id,
      payment_url: result.payment_url,
      total: totalAmount,
      currency,
      client: client_name
    };
  }

  /**
   * Get balance — not natively supported by Paymob API, returns placeholder.
   */
  async get_balance({ currency }) {
    return {
      available: 'Contact Paymob dashboard for balance',
      currency: currency || 'EGP',
      note: 'Paymob does not expose balance via API. Use dashboard.paymob.com'
    };
  }
}

module.exports = PaymobAdapter;
