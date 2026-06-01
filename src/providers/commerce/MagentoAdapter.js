const CommerceAdapter = require('./CommerceAdapter');
const axios = require('axios');

/**
 * MagentoAdapter — Concrete Commerce implementation using Magento 2 REST API.
 * Uses bearer token (integration or admin token) authentication.
 */
class MagentoAdapter extends CommerceAdapter {
  constructor(credentials, config = {}) {
    super('magento', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.store_url || !this.credentials.access_token) {
      throw new Error('Magento adapter missing required credentials: store_url, access_token');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    const url = this.credentials.store_url.replace(/\/$/, '');
    this.client = axios.create({
      baseURL: `${url}/rest/V1`,
      headers: { 'Authorization': `Bearer ${this.credentials.access_token}`, 'Content-Type': 'application/json' }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      await this.client.get('/store/storeViews');
      return { healthy: true, message: 'Magento 2 API connected.' };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async get_orders({ status = 'any', date_from, date_to, customer_email, limit = 25 }) {
    this.ensureInitialized();
    let searchCriteria = `searchCriteria[pageSize]=${limit}&searchCriteria[sortOrders][0][field]=created_at&searchCriteria[sortOrders][0][direction]=DESC`;
    let filterIdx = 0;

    if (status !== 'any') {
      searchCriteria += `&searchCriteria[filter_groups][${filterIdx}][filters][0][field]=status&searchCriteria[filter_groups][${filterIdx}][filters][0][value]=${status}`;
      filterIdx++;
    }
    if (customer_email) {
      searchCriteria += `&searchCriteria[filter_groups][${filterIdx}][filters][0][field]=customer_email&searchCriteria[filter_groups][${filterIdx}][filters][0][value]=${customer_email}`;
      filterIdx++;
    }

    const res = await this.client.get(`/orders?${searchCriteria}`);
    return {
      orders: (res.data.items || []).map(o => ({
        id: o.entity_id, number: `#${o.increment_id}`, email: o.customer_email,
        created_at: o.created_at, financial_status: o.status,
        total: { amount: o.grand_total, currencyCode: o.order_currency_code },
        line_items: (o.items || []).map(i => ({ title: i.name, quantity: i.qty_ordered }))
      })),
      total: res.data.total_count
    };
  }

  async get_product({ product_id }) {
    this.ensureInitialized();
    const res = await this.client.get(`/products/${product_id}`);
    const p = res.data;
    const stockItem = p.extension_attributes?.stock_item;
    return {
      id: p.id, title: p.name, description: p.custom_attributes?.find(a => a.attribute_code === 'short_description')?.value,
      status: p.status === 1 ? 'active' : 'disabled', sku: p.sku,
      type: p.type_id, total_inventory: stockItem?.qty || 0,
      price: p.price, weight: p.weight,
      categories: p.extension_attributes?.category_links?.map(c => c.category_id)
    };
  }

  async create_order({ customer_email, line_items, shipping_address, note }) {
    this.ensureInitialized();
    // Magento order creation is multi-step: create cart → add items → set shipping → place order
    // Simplified: create guest cart approach
    const cartRes = await this.client.post('/guest-carts');
    const cartId = cartRes.data;

    for (const item of line_items) {
      await this.client.post(`/guest-carts/${cartId}/items`, {
        cartItem: { sku: item.product_id, qty: item.quantity, quote_id: cartId }
      });
    }

    return {
      cart_id: cartId, status: 'cart_created',
      items_added: line_items.length,
      note: 'Cart created with items. Shipping and payment methods need to be set to complete the order.'
    };
  }

  async update_inventory({ product_id, variant_id, quantity, adjustment }) {
    this.ensureInitialized();
    const sku = product_id; // Magento uses SKU for stock management
    
    if (adjustment != null) {
      const current = await this.client.get(`/stockItems/${sku}`);
      quantity = (current.data.qty || 0) + adjustment;
    }

    const res = await this.client.put(`/products/${sku}/stockItems/1`, {
      stockItem: { qty: quantity, is_in_stock: quantity > 0 }
    });
    return { success: true, product_id, stock_quantity: quantity };
  }

  async search_products({ query, category, in_stock_only = false, limit = 20 }) {
    this.ensureInitialized();
    let searchCriteria = `searchCriteria[pageSize]=${limit}`;
    searchCriteria += `&searchCriteria[filter_groups][0][filters][0][field]=name&searchCriteria[filter_groups][0][filters][0][value]=%25${query}%25&searchCriteria[filter_groups][0][filters][0][condition_type]=like`;

    const res = await this.client.get(`/products?${searchCriteria}`);
    let products = (res.data.items || []).map(p => ({
      id: p.id, title: p.name, status: p.status === 1 ? 'active' : 'disabled',
      sku: p.sku, type: p.type_id, price: p.price,
      inventory: p.extension_attributes?.stock_item?.qty
    }));

    if (in_stock_only) products = products.filter(p => p.inventory > 0);
    return { products, total: res.data.total_count || products.length };
  }
}

module.exports = MagentoAdapter;
