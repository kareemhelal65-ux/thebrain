/**
 * Department Stats Service (Phase D2)
 *
 * Aggregates live stats from connected adapters for `integration:*` widgets on a
 * department dashboard. Mirrors the sentinel adapter pattern (resolveAdapter →
 * initialize → method call) but is entirely fail-soft: every provider call is
 * wrapped so a down/unconfigured integration degrades to a placeholder instead of
 * breaking the overview. Ad platforms (Meta/TikTok/Instagram) have no adapter yet
 * and surface as `{ status: 'connect' }` placeholders (see D-deferred).
 */

const { getCompanyConfig, resolveAdapter } = require('../models/companyConfig');

function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function findProvider(cfg, category, providerName) {
  const list = (cfg.enabled_services && cfg.enabled_services[category]) || [];
  return list.find(p => String(p.provider).toLowerCase() === providerName) || null;
}

async function getAdapter(cfg, category, providerName) {
  const info = findProvider(cfg, category, providerName);
  if (!info) return null;
  const adapter = resolveAdapter(category, info.provider, info.credentials, info.config);
  await adapter.initialize();
  return adapter;
}

async function getShopifyStats(cfg) {
  const adapter = await getAdapter(cfg, 'commerce', 'shopify');
  if (!adapter) return { status: 'not_connected' };
  const { orders = [] } = await adapter.get_orders({ date_from: daysAgoISO(30), limit: 50 });

  let revenue = 0;
  let currency = 'USD';
  const productQty = {};
  for (const o of orders) {
    const amt = parseFloat(o.total?.amount || '0');
    if (!Number.isNaN(amt)) revenue += amt;
    if (o.total?.currencyCode) currency = o.total.currencyCode;
    for (const li of (o.line_items || [])) {
      productQty[li.title] = (productQty[li.title] || 0) + (li.quantity || 0);
    }
  }
  const topProducts = Object.entries(productQty)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([title, qty]) => ({ title, qty }));

  return {
    status: 'ok',
    window: 'last 30 days',
    orders: orders.length,
    revenue: Math.round(revenue * 100) / 100,
    currency,
    aov: orders.length ? Math.round((revenue / orders.length) * 100) / 100 : 0,
    topProducts,
  };
}

async function summarizeTransactions(adapter) {
  const { transactions = [] } = await adapter.list_transactions({ date_from: daysAgoISO(30), limit: 100 });
  const succeeded = transactions.filter(t => t.status === 'succeeded' || t.status === 'paid' || t.status === 'captured');
  let volume = 0;
  let currency = 'USD';
  for (const t of succeeded) {
    const amt = parseFloat(t.amount || 0);
    if (!Number.isNaN(amt)) volume += amt;
    if (t.currency) currency = t.currency;
  }
  return {
    transactions: transactions.length,
    succeeded: succeeded.length,
    volume: Math.round(volume * 100) / 100,
    currency,
  };
}

async function getStripeStats(cfg) {
  const adapter = await getAdapter(cfg, 'finance', 'stripe');
  if (!adapter) return { status: 'not_connected' };
  const tx = await summarizeTransactions(adapter);
  let balance = null;
  try {
    const b = await adapter.get_balance();
    balance = (b.available || []).map(x => `${x.amount} ${x.currency}`).join(', ');
  } catch { /* balance is best-effort */ }
  return { status: 'ok', window: 'last 30 days', ...tx, balance };
}

async function getPaymobStats(cfg) {
  const adapter = await getAdapter(cfg, 'finance', 'paymob');
  if (!adapter) return { status: 'not_connected' };
  const tx = await summarizeTransactions(adapter);
  let balance = null;
  try {
    const b = await adapter.get_balance({});
    balance = (b.available || []).map(x => `${x.amount} ${x.currency}`).join(', ');
  } catch { /* balance is best-effort */ }
  return { status: 'ok', window: 'last 30 days', ...tx, balance };
}

const PROVIDER_RESOLVERS = {
  shopify: getShopifyStats,
  stripe: getStripeStats,
  paymob: getPaymobStats,
};

// Ad platforms whose adapters are deferred (D-deferred) — show a Connect placeholder.
const DEFERRED_PROVIDERS = new Set(['meta', 'tiktok', 'instagram', 'facebook', 'google_ads']);

/**
 * Resolve stats keyed by widget id for every `integration:*` widget.
 * @param {string} companyId
 * @param {Array<{id,dataSource}>} widgets
 * @returns {Promise<Object>} { [widgetId]: stats }
 */
async function getStatsForWidgets(companyId, widgets) {
  const integrationWidgets = (widgets || []).filter(w => w.dataSource && w.dataSource.startsWith('integration:'));
  if (integrationWidgets.length === 0) return {};

  let cfg;
  try {
    cfg = await getCompanyConfig(companyId);
  } catch (err) {
    console.warn('[DepartmentStats] getCompanyConfig failed:', err.message);
    return {};
  }

  // Resolve each distinct provider once, then fan back out to widget ids.
  const providers = [...new Set(integrationWidgets.map(w => w.dataSource.split(':')[1]))];
  const byProvider = {};
  await Promise.all(providers.map(async (provider) => {
    if (DEFERRED_PROVIDERS.has(provider)) {
      byProvider[provider] = { status: 'connect', provider };
      return;
    }
    const resolver = PROVIDER_RESOLVERS[provider];
    if (!resolver) {
      byProvider[provider] = { status: 'not_connected', provider };
      return;
    }
    try {
      byProvider[provider] = await resolver(cfg);
    } catch (err) {
      console.warn(`[DepartmentStats] ${provider} stats failed:`, err.message);
      byProvider[provider] = { status: 'error', provider, error: err.message };
    }
  }));

  const stats = {};
  for (const w of integrationWidgets) {
    const provider = w.dataSource.split(':')[1];
    stats[w.id] = byProvider[provider] || { status: 'not_connected', provider };
  }
  return stats;
}

module.exports = { getStatsForWidgets };
