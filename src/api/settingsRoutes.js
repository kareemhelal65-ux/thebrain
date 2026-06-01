const express = require('express');
const supabase = require('../models/supabaseClient');
const { encrypt, decrypt } = require('../security/encryption');
const {
  createClient,
  resolveProviderBaseUrl,
  invalidateChatModel,
  LLM_PROVIDERS,
} = require('../services/llmService');

const router = express.Router();

/**
 * GET /api/settings/llm-config
 * Returns the company's agent chat-model config (never the raw key).
 */
router.get('/llm-config', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { data } = await supabase
      .from('company_llm_config')
      .select('provider, model, base_url, is_active, api_key_encrypted, updated_at')
      .eq('company_id', req.user.company_id)
      .maybeSingle();

    res.json({
      providers: LLM_PROVIDERS,
      config: data ? {
        provider: data.provider,
        model: data.model,
        base_url: data.base_url,
        is_active: data.is_active,
        has_key: !!data.api_key_encrypted,
        updated_at: data.updated_at,
      } : null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/settings/llm-config
 * Save/replace the company's chat-model config. api_key is optional on update
 * (kept if omitted). Set is_active:false to revert agents to Groq.
 */
router.put('/llm-config', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const companyId = req.user.company_id;
    if (!companyId) return res.status(400).json({ error: 'No company associated with this user.' });

    const { provider, model, base_url, api_key, is_active } = req.body || {};
    if (provider && !LLM_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `provider must be one of: ${LLM_PROVIDERS.join(', ')}` });
    }
    if (provider === 'agentrouter' && !((base_url || '').trim())) {
      return res.status(400).json({ error: 'Agent Router requires a base URL.' });
    }

    const row = {
      company_id: companyId,
      provider: provider || null,
      model: model || null,
      base_url: base_url || null,
      is_active: is_active !== false,
      updated_at: new Date().toISOString(),
    };

    if (api_key && api_key.trim()) {
      const enc = encrypt(api_key.trim());
      row.api_key_encrypted = enc.ciphertext;
      row.api_key_iv = enc.iv;
      row.api_key_tag = enc.tag;
    }

    const { error } = await supabase
      .from('company_llm_config')
      .upsert(row, { onConflict: 'company_id' });
    if (error) throw error;

    invalidateChatModel(companyId);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/settings/llm-config/test
 * Verifies the (submitted or stored) config can reach the model with a tiny call.
 */
router.post('/llm-config/test', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const companyId = req.user.company_id;
    let { provider, model, base_url, api_key } = req.body || {};

    // Backfill from stored config for anything not supplied (e.g. masked key).
    if (!api_key || !provider || !model) {
      const { data } = await supabase
        .from('company_llm_config')
        .select('provider, model, base_url, api_key_encrypted, api_key_iv, api_key_tag')
        .eq('company_id', companyId)
        .maybeSingle();
      if (data) {
        provider = provider || data.provider;
        model = model || data.model;
        base_url = base_url || data.base_url;
        if ((!api_key || !api_key.trim()) && data.api_key_encrypted) {
          api_key = decrypt(data.api_key_encrypted, data.api_key_iv, data.api_key_tag);
        }
      }
    }

    if (!provider || !model || !api_key) {
      return res.status(400).json({ ok: false, error: 'Provider, model and API key are required.' });
    }
    const baseURL = resolveProviderBaseUrl(provider, base_url);
    if (!baseURL) return res.status(400).json({ ok: false, error: 'Could not resolve the provider base URL.' });

    const client = createClient(baseURL, api_key.trim());
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
      max_tokens: 5,
      temperature: 0,
    });
    const sample = resp.choices?.[0]?.message?.content?.trim() || '';
    res.json({ ok: true, sample });
  } catch (error) {
    res.json({ ok: false, error: error?.message || 'Connection failed.' });
  }
});

module.exports = router;
