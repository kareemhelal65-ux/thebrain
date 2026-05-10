const CommerceAdapter = require('./CommerceAdapter');
const axios = require('axios');

/**
 * ShopifyAdapter — Concrete implementation of the Commerce interface.
 * 
 * Uses Shopify GraphQL Admin API version 2026-04 (pinned for B2B stability).
 * In a B2B environment, stability is your primary currency — we do not use 'latest'.
 * Controlled upgrades happen on our schedule, not Shopify's.
 */
const SHOPIFY_API_VERSION = '2026-04';

class ShopifyAdapter extends CommerceAdapter {
  constructor(credentials, config = {}) {
    super('shopify', credentials, config);
    this.storeUrl = null;
    this.client = null;
  }

  validateConfig() {
    const required = ['access_token', 'store_url'];
    for (const field of required) {
      if (!this.credentials[field]) {
        throw new Error(`Shopify adapter missing required credential: ${field}`);
      }
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.storeUrl = this.credentials.store_url.replace(/\/$/, '');

    // Create axios client with Shopify headers
    this.client = axios.create({
      baseURL: `https://${this.storeUrl}/admin/api/${SHOPIFY_API_VERSION}`,
      headers: {
        'X-Shopify-Access-Token': this.credentials.access_token,
        'Content-Type': 'application/json'
      }
    });

    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      const response = await this.graphql('{ shop { name myshopifyDomain } }');
      return { healthy: true, message: `Connected to ${response.shop.name}` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  /**
   * Execute a GraphQL query against the Shopify Admin API.
   */
  async graphql(query, variables = {}) {
    this.ensureInitialized();
    const response = await this.client.post('/graphql.json', { query, variables });

    if (response.data.errors) {
      throw new Error(`Shopify GraphQL Error: ${JSON.stringify(response.data.errors)}`);
    }
    return response.data.data;
  }

  /**
   * Retrieve recent orders.
   */
  async get_orders({ status = 'any', date_from, date_to, customer_email, limit = 25 }) {
    let queryFilter = '';
    if (status !== 'any') queryFilter += `status:${status}`;
    if (customer_email) queryFilter += ` email:${customer_email}`;
    if (date_from) queryFilter += ` created_at:>=${date_from}`;
    if (date_to) queryFilter += ` created_at:<=${date_to}`;

    const query = `
      query GetOrders($first: Int!, $query: String) {
        orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges {
            node {
              id
              name
              email
              createdAt
              displayFinancialStatus
              displayFulfillmentStatus
              totalPriceSet { shopMoney { amount currencyCode } }
              lineItems(first: 10) {
                edges {
                  node { title quantity }
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql(query, { first: limit, query: queryFilter.trim() || null });

    return {
      orders: data.orders.edges.map(({ node }) => ({
        id: node.id,
        name: node.name,
        email: node.email,
        created_at: node.createdAt,
        financial_status: node.displayFinancialStatus,
        fulfillment_status: node.displayFulfillmentStatus,
        total: node.totalPriceSet.shopMoney,
        line_items: node.lineItems.edges.map(({ node: li }) => ({
          title: li.title,
          quantity: li.quantity
        }))
      })),
      total: data.orders.edges.length
    };
  }

  /**
   * Get a specific product by ID.
   */
  async get_product({ product_id }) {
    const query = `
      query GetProduct($id: ID!) {
        product(id: $id) {
          id
          title
          description
          status
          vendor
          productType
          createdAt
          totalInventory
          variants(first: 10) {
            edges {
              node {
                id
                title
                price
                inventoryQuantity
                sku
              }
            }
          }
          metafields(first: 10) {
            edges {
              node { namespace key value type }
            }
          }
        }
      }
    `;

    // Ensure the product_id is a full GID if it isn't already
    const gid = product_id.startsWith('gid://') ? product_id : `gid://shopify/Product/${product_id}`;
    const data = await this.graphql(query, { id: gid });

    if (!data.product) {
      return { error: 'Product not found', product_id };
    }

    return {
      id: data.product.id,
      title: data.product.title,
      description: data.product.description,
      status: data.product.status,
      vendor: data.product.vendor,
      type: data.product.productType,
      total_inventory: data.product.totalInventory,
      variants: data.product.variants.edges.map(({ node }) => ({
        id: node.id,
        title: node.title,
        price: node.price,
        inventory: node.inventoryQuantity,
        sku: node.sku
      })),
      metafields: data.product.metafields.edges.map(({ node }) => ({
        namespace: node.namespace,
        key: node.key,
        value: node.value,
        type: node.type
      }))
    };
  }

  /**
   * Create a draft order.
   */
  async create_order({ customer_email, line_items, shipping_address, note }) {
    const mutation = `
      mutation CreateDraftOrder($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id name invoiceUrl }
          userErrors { field message }
        }
      }
    `;

    const input = {
      email: customer_email,
      note: note || '',
      lineItems: line_items.map(item => ({
        variantId: item.product_id.startsWith('gid://') ? item.product_id : `gid://shopify/ProductVariant/${item.product_id}`,
        quantity: item.quantity
      }))
    };

    if (shipping_address) {
      input.shippingAddress = shipping_address;
    }

    const data = await this.graphql(mutation, { input });
    const result = data.draftOrderCreate;

    if (result.userErrors && result.userErrors.length > 0) {
      throw new Error(`Shopify order creation failed: ${result.userErrors.map(e => e.message).join(', ')}`);
    }

    return {
      order_id: result.draftOrder.id,
      name: result.draftOrder.name,
      invoice_url: result.draftOrder.invoiceUrl
    };
  }

  /**
   * Update inventory for a product variant.
   */
  async update_inventory({ product_id, variant_id, quantity, adjustment }) {
    // For inventory adjustments, we need the inventory item ID
    const variantGid = variant_id
      ? (variant_id.startsWith('gid://') ? variant_id : `gid://shopify/ProductVariant/${variant_id}`)
      : null;

    if (!variantGid) {
      throw new Error('variant_id is required for inventory updates');
    }

    // First, get the inventory item ID and location
    const lookupQuery = `
      query GetInventoryItem($id: ID!) {
        productVariant(id: $id) {
          inventoryItem {
            id
            inventoryLevels(first: 1) {
              edges { node { id location { id } quantities(names: ["available"]) { quantity } } }
            }
          }
        }
      }
    `;

    const lookupData = await this.graphql(lookupQuery, { id: variantGid });
    const inventoryItem = lookupData.productVariant?.inventoryItem;

    if (!inventoryItem) throw new Error('Inventory item not found');

    const level = inventoryItem.inventoryLevels.edges[0]?.node;
    if (!level) throw new Error('No inventory level found');

    const delta = adjustment != null ? adjustment : (quantity - (level.quantities[0]?.quantity || 0));

    const mutation = `
      mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!) {
        inventoryAdjustQuantities(input: $input) {
          userErrors { field message }
          inventoryAdjustmentGroup { reason }
        }
      }
    `;

    const data = await this.graphql(mutation, {
      input: {
        reason: 'correction',
        name: 'available',
        changes: [{
          delta,
          inventoryItemId: inventoryItem.id,
          locationId: level.location.id
        }]
      }
    });

    if (data.inventoryAdjustQuantities.userErrors?.length > 0) {
      throw new Error(data.inventoryAdjustQuantities.userErrors.map(e => e.message).join(', '));
    }

    return { success: true, adjustment: delta, product_id, variant_id };
  }

  /**
   * Search products.
   */
  async search_products({ query, category, in_stock_only = false, limit = 20 }) {
    let searchQuery = query;
    if (category) searchQuery += ` product_type:${category}`;
    if (in_stock_only) searchQuery += ' inventory_total:>0';

    const gqlQuery = `
      query SearchProducts($first: Int!, $query: String) {
        products(first: $first, query: $query) {
          edges {
            node {
              id title status vendor productType totalInventory
              variants(first: 1) {
                edges { node { price } }
              }
            }
          }
        }
      }
    `;

    const data = await this.graphql(gqlQuery, { first: limit, query: searchQuery });

    return {
      products: data.products.edges.map(({ node }) => ({
        id: node.id,
        title: node.title,
        status: node.status,
        vendor: node.vendor,
        type: node.productType,
        inventory: node.totalInventory,
        price: node.variants.edges[0]?.node.price
      })),
      total: data.products.edges.length
    };
  }
}

module.exports = ShopifyAdapter;
