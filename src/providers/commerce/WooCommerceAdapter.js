const CommerceAdapter = require('./CommerceAdapter');
const axios = require('axios');

/**
 * WooCommerceAdapter — Concrete Commerce implementation using WooCommerce REST API v3.
 * Uses consumer key + consumer secret (Basic Auth).
 */
class WooCommerceAdapter extends CommerceAdapter {
  constructor(credentials, config = {}) {
    super('woocommerce', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.store_url || !this.credentials.consumer_key || !this.credentials.consumer_secret) {
      throw new Error('WooCommerce adapter missing required credentials: store_url, consumer_key, consumer_secret');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    const url = this.credentials.store_url.replace(/\/$/, '');
    this.client = axios.create({
      baseURL: `${url}/wp-json/wc/v3`,
      auth: { username: this.credentials.consumer_key, password: this.credentials.consumer_secret }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      const res = await this.client.get('/system_status');
      return { healthy: true, message: `WooCommerce ${res.data.environment?.version} connected.` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async get_orders({ status = 'any', date_from, date_to, customer_email, limit = 25 }) {
    this.ensureInitialized();
    const params = { per_page: limit, orderby: 'date', order: 'desc' };
    if (status !== 'any') params.status = status;
    if (date_from) params.after = date_from;
    if (date_to) params.before = date_to;
    if (customer_email) params.search = customer_email;

    const res = await this.client.get('/orders', { params });
    return {
      orders: res.data.map(o => ({
        id: o.id, number: `#${o.number}`, email: o.billing?.email,
        created_at: o.date_created, financial_status: o.status,
        total: { amount: o.total, currencyCode: o.currency },
        line_items: o.line_items.map(li => ({ title: li.name, quantity: li.quantity }))
      })),
      total: res.data.length
    };
  }

  async get_product({ product_id }) {
    this.ensureInitialized();
    const res = await this.client.get(`/products/${product_id}`);
    const p = res.data;
    return {
      id: p.id, title: p.name, description: p.short_description,
      status: p.status, vendor: p.attributes?.find(a => a.name === 'vendor')?.options?.[0],
      type: p.type, total_inventory: p.stock_quantity,
      variants: (p.variations || []).map(v => ({ id: v })),
      price: p.price, sku: p.sku,
      categories: p.categories?.map(c => c.name)
    };
  }

  async create_order({ customer_email, line_items, shipping_address, note }) {
    this.ensureInitialized();
    const body = {
      billing: { email: customer_email },
      line_items: line_items.map(item => ({ product_id: parseInt(item.product_id), quantity: item.quantity })),
      customer_note: note || ''
    };
    if (shipping_address) body.shipping = shipping_address;

    const res = await this.client.post('/orders', body);
    return { order_id: res.data.id, number: `#${res.data.number}`, status: res.data.status, total: res.data.total };
  }

  async update_inventory({ product_id, variant_id, quantity, adjustment }) {
    this.ensureInitialized();
    const id = variant_id || product_id;
    const endpoint = variant_id ? `/products/${product_id}/variations/${variant_id}` : `/products/${product_id}`;

    if (adjustment != null) {
      const current = await this.client.get(endpoint);
      quantity = (current.data.stock_quantity || 0) + adjustment;
    }

    const res = await this.client.put(endpoint, { stock_quantity: quantity, manage_stock: true });
    return { success: true, product_id, stock_quantity: res.data.stock_quantity };
  }

  async search_products({ query, category, in_stock_only = false, limit = 20 }) {
    this.ensureInitialized();
    const params = { search: query, per_page: limit };
    if (category) params.category = category;
    if (in_stock_only) params.stock_status = 'instock';

    const res = await this.client.get('/products', { params });
    return {
      products: res.data.map(p => ({
        id: p.id, title: p.name, status: p.status,
        vendor: null, type: p.type, inventory: p.stock_quantity, price: p.price
      })),
      total: res.data.length
    };
  }
}

module.exports = WooCommerceAdapter;
