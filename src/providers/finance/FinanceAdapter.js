const BaseAdapter = require('../BaseAdapter');

/**
 * FinanceAdapter — Standard interface for all financial/payment providers.
 * Concrete implementations: PaymobAdapter, StripeAdapter, QuickBooksAdapter, etc.
 */
class FinanceAdapter extends BaseAdapter {
  constructor(providerName, credentials, config) {
    super(providerName, 'finance', credentials, config);
  }

  async get_payment_status(params) {
    throw new Error(`${this.providerName}: get_payment_status() not implemented.`);
  }

  async initiate_payment(params) {
    throw new Error(`${this.providerName}: initiate_payment() not implemented.`);
  }

  async refund_payment(params) {
    throw new Error(`${this.providerName}: refund_payment() not implemented.`);
  }

  async list_transactions(params) {
    throw new Error(`${this.providerName}: list_transactions() not implemented.`);
  }

  async create_invoice(params) {
    throw new Error(`${this.providerName}: create_invoice() not implemented.`);
  }

  async get_balance(params) {
    throw new Error(`${this.providerName}: get_balance() not implemented.`);
  }
}

module.exports = FinanceAdapter;
