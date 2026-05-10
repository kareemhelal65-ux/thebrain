const supabase = require('./supabaseClient');
const { decryptCredentials } = require('../security/encryption');

// Adapter class registry — maps provider names to their adapter classes
// All adapters use lazy-loading to avoid importing unused dependencies
const ADAPTER_MAP = {
  // ─── Communications (4) ───
  gmail:      () => require('../providers/communications/GmailAdapter'),
  outlook:    () => require('../providers/communications/OutlookAdapter'),
  slack:      () => require('../providers/communications/SlackAdapter'),
  twilio:     () => require('../providers/communications/TwilioAdapter'),

  // ─── Finance (4) ───
  paymob:     () => require('../providers/finance/PaymobAdapter'),
  stripe:     () => require('../providers/finance/StripeAdapter'),
  quickbooks: () => require('../providers/finance/QuickBooksAdapter'),
  xero:       () => require('../providers/finance/XeroAdapter'),

  // ─── Commerce (3) ───
  shopify:     () => require('../providers/commerce/ShopifyAdapter'),
  woocommerce: () => require('../providers/commerce/WooCommerceAdapter'),
  magento:     () => require('../providers/commerce/MagentoAdapter'),

  // ─── CRM (3) ───
  hubspot:    () => require('../providers/crm/HubSpotAdapter'),
  salesforce: () => require('../providers/crm/SalesforceAdapter'),
  zoho:       () => require('../providers/crm/ZohoAdapter'),

  // ─── Project Management (4) ───
  jira:   () => require('../providers/project-management/JiraAdapter'),
  asana:  () => require('../providers/project-management/AsanaAdapter'),
  monday: () => require('../providers/project-management/MondayAdapter'),
  notion: () => require('../providers/project-management/NotionAdapter'),

  // ─── HR (3) ───
  bamboohr: () => require('../providers/hr/BambooHRAdapter'),
  gusto:    () => require('../providers/hr/GustoAdapter'),
  workday:  () => require('../providers/hr/WorkdayAdapter'),

  // ─── Storage (3) ───
  google_drive: () => require('../providers/storage/GoogleDriveAdapter'),
  dropbox:      () => require('../providers/storage/DropboxAdapter'),
  onedrive:     () => require('../providers/storage/OneDriveAdapter'),
};

/**
 * Fetch all enabled services for a company from the database.
 * Returns raw rows (credentials still encrypted).
 * @param {string} companyId
 * @returns {Promise<Object[]>}
 */
async function getCompanyServicesRaw(companyId) {
  const { data, error } = await supabase
    .from('company_services')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true);

  if (error) throw new Error(`Failed to fetch company services: ${error.message}`);
  return data || [];
}

/**
 * Get the full config for a company: enabled categories, providers, and decrypted credentials.
 * IMPORTANT: This function decrypts credentials — only call within the Sentinel execution pipeline.
 * 
 * @param {string} companyId
 * @returns {Promise<Object>} { enabled_services: Map<category, { provider, credentials, config }> }
 */
async function getCompanyConfig(companyId) {
  const services = await getCompanyServicesRaw(companyId);

  const enabledServices = {};

  for (const svc of services) {
    const decrypted = decryptCredentials(
      svc.credentials_encrypted,
      svc.credentials_iv,
      svc.credentials_tag
    );

    if (!enabledServices[svc.category]) {
      enabledServices[svc.category] = [];
    }

    enabledServices[svc.category].push({
      provider: svc.provider_name,
      credentials: decrypted,
      config: svc.config || {}
    });
  }

  return {
    company_id: companyId,
    enabled_services: enabledServices,
    enabled_categories: Object.keys(enabledServices)
  };
}

/**
 * Get enabled categories for a company WITHOUT decrypting credentials.
 * Safe to call anywhere — used by the registry for tool resolution.
 * 
 * @param {string} companyId
 * @returns {Promise<string[]>} List of enabled category names
 */
async function getEnabledCategories(companyId) {
  const { data, error } = await supabase
    .from('company_services')
    .select('category')
    .eq('company_id', companyId)
    .eq('is_active', true);

  if (error) throw new Error(`Failed to fetch enabled categories: ${error.message}`);

  const categories = [...new Set((data || []).map(s => s.category))];
  return categories;
}

/**
 * Resolve and instantiate the correct adapter for a given category and provider.
 * @param {string} category - e.g., 'communications'
 * @param {string} providerName - e.g., 'gmail'
 * @param {Object} credentials - Decrypted credentials
 * @param {Object} config - Non-secret config
 * @returns {BaseAdapter} Initialized adapter instance
 */
function resolveAdapter(category, providerName, credentials, config = {}) {
  const loaderFn = ADAPTER_MAP[providerName];
  if (!loaderFn) {
    throw new Error(`No adapter registered for provider: ${providerName} (category: ${category})`);
  }

  const AdapterClass = loaderFn();
  return new AdapterClass(credentials, config);
}

/**
 * Save a company service with encrypted credentials.
 * @param {string} companyId
 * @param {string} category
 * @param {string} providerName
 * @param {Object} credentials - Plaintext credentials (will be encrypted)
 * @param {Object} config - Non-secret config
 */
async function saveCompanyService(companyId, category, providerName, credentials, config = {}) {
  const { encryptCredentials } = require('../security/encryption');
  const encrypted = encryptCredentials(credentials);

  const { data, error } = await supabase
    .from('company_services')
    .upsert([{
      company_id: companyId,
      category,
      provider_name: providerName,
      credentials_encrypted: encrypted.credentials_encrypted,
      credentials_iv: encrypted.credentials_iv,
      credentials_tag: encrypted.credentials_tag,
      config,
      is_active: true
    }], {
      onConflict: 'company_id,category,provider_name'
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save company service: ${error.message}`);
  return data;
}

module.exports = {
  getCompanyConfig,
  getCompanyServicesRaw,
  getEnabledCategories,
  resolveAdapter,
  saveCompanyService
};
