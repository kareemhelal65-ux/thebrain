/**
 * BaseAdapter — Abstract base class for all provider adapters.
 * 
 * Every provider (Shopify, Paymob, Gmail, HubSpot, etc.) extends this class
 * and implements the standard interface methods for its category.
 * 
 * The adapter pattern ensures the AIOS never calls a provider directly —
 * it calls the standard interface, and the correct adapter handles it.
 */
class BaseAdapter {
  /**
   * @param {string} providerName - e.g., 'shopify', 'paymob', 'gmail'
   * @param {string} category - e.g., 'commerce', 'finance', 'communications'
   * @param {Object} credentials - Decrypted provider credentials
   * @param {Object} config - Non-secret provider configuration
   */
  constructor(providerName, category, credentials = {}, config = {}) {
    if (new.target === BaseAdapter) {
      throw new Error('BaseAdapter is abstract and cannot be instantiated directly.');
    }
    this.providerName = providerName;
    this.category = category;
    this.credentials = credentials;
    this.config = config;
    this.initialized = false;
  }

  /**
   * Validate that all required credentials and config are present.
   * Must be overridden by concrete adapters.
   * @returns {boolean}
   * @throws {Error} If required configuration is missing
   */
  validateConfig() {
    throw new Error(`${this.providerName}: validateConfig() must be implemented.`);
  }

  /**
   * Test connectivity to the provider API.
   * @returns {Promise<{ healthy: boolean, message: string }>}
   */
  async healthCheck() {
    throw new Error(`${this.providerName}: healthCheck() must be implemented.`);
  }

  /**
   * Generic method dispatcher. Routes tool_name to the correct method.
   * @param {string} methodName - The tool/method name to execute
   * @param {Object} params - Parameters for the method
   * @returns {Promise<Object>} Result of the execution
   */
  async execute(methodName, params) {
    if (typeof this[methodName] !== 'function') {
      throw new Error(
        `${this.providerName} adapter does not implement method: ${methodName}`
      );
    }
    return await this[methodName](params);
  }

  /**
   * Initialize the adapter (auth tokens, sessions, etc.).
   * Override in adapters that need async initialization.
   */
  async initialize() {
    this.validateConfig();
    this.initialized = true;
  }

  /**
   * Helper: Ensure the adapter is initialized before executing.
   */
  ensureInitialized() {
    if (!this.initialized) {
      throw new Error(`${this.providerName} adapter is not initialized. Call initialize() first.`);
    }
  }

  /**
   * Get adapter metadata for logging/debugging.
   */
  getInfo() {
    return {
      provider: this.providerName,
      category: this.category,
      initialized: this.initialized
    };
  }
}

module.exports = BaseAdapter;
