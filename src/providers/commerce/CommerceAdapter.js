const BaseAdapter = require('../BaseAdapter');

/**
 * CommerceAdapter — Standard interface for all e-commerce providers.
 * Concrete implementations: ShopifyAdapter, WooCommerceAdapter, MagentoAdapter, etc.
 */
class CommerceAdapter extends BaseAdapter {
  constructor(providerName, credentials, config) {
    super(providerName, 'commerce', credentials, config);
  }

  async get_orders(params) {
    throw new Error(`${this.providerName}: get_orders() not implemented.`);
  }

  async get_product(params) {
    throw new Error(`${this.providerName}: get_product() not implemented.`);
  }

  async create_order(params) {
    throw new Error(`${this.providerName}: create_order() not implemented.`);
  }

  async update_inventory(params) {
    throw new Error(`${this.providerName}: update_inventory() not implemented.`);
  }

  async search_products(params) {
    throw new Error(`${this.providerName}: search_products() not implemented.`);
  }
}

module.exports = CommerceAdapter;
