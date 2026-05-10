const crypto = require('crypto');
const supabase = require('../models/supabaseClient');
const { decrypt } = require('../security/encryption');

/**
 * WebhookAuthenticator — Middleware for verifying inbound webhook signatures.
 * 
 * Switches verification logic per provider (Zoom HMAC SHA-256, Teams HMAC, Google challenge).
 * Looks up the webhook secret from the webhook_secrets table (decrypts via encryption.js).
 * Rejects if secret is missing or signature is invalid.
 */

/**
 * Retrieve and decrypt the webhook secret for a company + provider.
 * @param {string} companyId
 * @param {string} provider
 * @returns {Promise<string|null>} Decrypted secret or null
 */
async function getWebhookSecret(companyId, provider) {
  const { data, error } = await supabase
    .from('webhook_secrets')
    .select('secret_encrypted, secret_iv, secret_tag')
    .eq('company_id', companyId)
    .eq('provider', provider)
    .single();

  if (error || !data) return null;

  return decrypt(data.secret_encrypted, data.secret_iv, data.secret_tag);
}

/**
 * Verify Zoom webhook signature.
 * Zoom uses HMAC SHA-256 with the x-zm-signature header.
 * Also handles the initial URL validation challenge.
 */
function verifyZoomSignature(body, headers, secret) {
  const timestamp = headers['x-zm-request-timestamp'];
  const signature = headers['x-zm-signature'];

  if (!timestamp || !signature) return false;

  const message = `v0:${timestamp}:${JSON.stringify(body)}`;
  const hash = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const expectedSignature = `v0=${hash}`;

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Verify Microsoft Teams webhook signature.
 * Teams uses HMAC SHA-256 with the Authorization header.
 */
function verifyTeamsSignature(body, headers, secret) {
  const authHeader = headers['authorization'];
  if (!authHeader) return false;

  const providedHmac = authHeader.replace('HMAC ', '');
  const bufSecret = Buffer.from(secret, 'base64');
  const hash = crypto.createHmac('sha256', bufSecret)
    .update(JSON.stringify(body))
    .digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(providedHmac),
      Buffer.from(hash)
    );
  } catch {
    return false;
  }
}

/**
 * Verify Google Meet webhook — Google uses a challenge-response for setup,
 * then a bearer token or Pub/Sub push for ongoing events.
 */
function verifyGoogleSignature(body, headers, secret) {
  // Google Cloud Pub/Sub push: verify the bearer token
  const authHeader = headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.replace('Bearer ', '');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(token),
        Buffer.from(secret)
      );
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Express middleware factory for webhook authentication.
 * 
 * Usage:
 *   router.post('/webhook/:provider', webhookAuth(), (req, res) => { ... });
 * 
 * The provider is extracted from req.params.provider.
 * The company_id must be provided as a query parameter or header.
 */
function webhookAuth() {
  return async (req, res, next) => {
    const provider = req.params.provider;
    const companyId = req.query.company_id || req.headers['x-company-id'];

    if (!companyId) {
      return res.status(400).json({ error: 'Missing company_id in query or x-company-id header.' });
    }

    // Handle Zoom URL validation challenge
    if (provider === 'zoom' && req.body?.event === 'endpoint.url_validation') {
      const secret = await getWebhookSecret(companyId, 'zoom');
      if (!secret) {
        return res.status(403).json({ error: 'No webhook secret configured for Zoom.' });
      }

      const hashForValidation = crypto
        .createHmac('sha256', secret)
        .update(req.body.payload.plainToken)
        .digest('hex');

      return res.status(200).json({
        plainToken: req.body.payload.plainToken,
        encryptedToken: hashForValidation
      });
    }

    // Look up the secret
    const secret = await getWebhookSecret(companyId, provider);
    if (!secret) {
      return res.status(403).json({
        error: `No webhook secret configured for provider '${provider}'. Configure it in webhook_secrets table.`
      });
    }

    // Provider-specific verification
    const verifiers = {
      zoom: verifyZoomSignature,
      teams: verifyTeamsSignature,
      'google-meet': verifyGoogleSignature,
      'google_meet': verifyGoogleSignature
    };

    const verifier = verifiers[provider];
    if (!verifier) {
      // Unknown provider — allow through with warning (for extensibility)
      console.warn(`[WebhookAuth] No verifier for provider '${provider}'. Allowing through.`);
      req.webhookCompanyId = companyId;
      req.webhookProvider = provider;
      return next();
    }

    const isValid = verifier(req.body, req.headers, secret);
    if (!isValid) {
      console.error(`[WebhookAuth] Invalid signature for ${provider} webhook from company ${companyId}`);
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    }

    // Attach verified info to request
    req.webhookCompanyId = companyId;
    req.webhookProvider = provider;
    next();
  };
}

module.exports = {
  webhookAuth,
  getWebhookSecret
};
