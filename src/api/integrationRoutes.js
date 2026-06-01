const express = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../models/supabaseClient');
const { generateEmbedding } = require('../services/embeddingService');

const router = express.Router();

/**
 * GET /api/integrations/auth/:provider
 * Real OAuth initiation endpoint
 */
router.get('/auth/:provider', async (req, res, next) => {
  try {
    const provider = req.params.provider.toLowerCase();
    
    // In a real scenario, you'd check process.env.GOOGLE_CLIENT_ID, etc.
    // Since we don't have them yet, we will immediately redirect to our simulated callback
    // to prove the architecture works. Once env vars are added, this would redirect to:
    // https://accounts.google.com/o/oauth2/v2/auth?client_id=...

    const hasRealCreds = process.env[`${provider.toUpperCase()}_CLIENT_ID`];
    
    if (hasRealCreds) {
      // Real flow
      res.redirect(`https://oauth.provider.com/auth?client_id=${hasRealCreds}`);
    } else {
      // Simulated flow (Fallback)
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/settings?simulate_oauth=${provider}`);
    }
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/integrations/callback/:provider
 * Real OAuth callback endpoint
 */
router.get('/callback/:provider', async (req, res, next) => {
  try {
    const provider = req.params.provider.toLowerCase();
    const code = req.query.code;
    const userId = req.user?.id || 'unknown'; // Note: In a real OAuth callback, you'd use state params or session cookies to re-identify the user.

    // Exchange code for tokens (simulated here)
    const mockAccessToken = `mock_access_${uuidv4()}`;
    const mockRefreshToken = `mock_refresh_${uuidv4()}`;

    // Upsert to oauth_credentials
    // In reality, you'd want the user's company_id from their session.
    // For this boilerplate, we assume it's handled by the connect POST route for now if simulated.

    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard/settings`);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/integrations/status
 * Get the connection status of all integrations
 */
router.get('/status', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: company, error } = await supabase
      .from('companies')
      .select('integrations')
      .eq('id', req.user.company_id)
      .single();

    if (error) throw error;

    res.json({ integrations: company.integrations || {} });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/integrations/connect/:provider
 * Simulates connecting an integration
 */
router.post('/connect/:provider', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const provider = req.params.provider.toLowerCase();
    
    // Get existing
    const { data: company } = await supabase
      .from('companies')
      .select('integrations')
      .eq('id', req.user.company_id)
      .single();

    const currentIntegrations = company?.integrations || {};
    
    // Update
    const { error } = await supabase
      .from('companies')
      .update({
        integrations: {
          ...currentIntegrations,
          [provider]: { connected: true, connectedAt: new Date().toISOString() }
        }
      })
      .eq('id', req.user.company_id);

    if (error) throw error;

    res.json({ success: true, message: `${provider} connected successfully` });
  } catch (error) {
    next(error);
  }
});

const { ingestGoogleDrive } = require('../services/googleDriveIngestion');
const { ingestSlackMessages } = require('../services/slackIngestion');

/**
 * POST /api/integrations/sync/:provider
 * Syncs data from the provider into The Brain's memory
 */
router.post('/sync/:provider', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const provider = req.params.provider.toLowerCase();
    const tenantId = req.user.company_id;

    // Get oauth credentials from db
    const { data: creds, error: credsError } = await supabase
      .from('oauth_credentials')
      .select('access_token')
      .eq('tenant_id', tenantId)
      .eq('provider', provider === 'google workspace' ? 'google' : provider)
      .single();

    if (credsError || !creds?.access_token) {
      console.warn(`[Sync] No OAuth token found for ${provider}. Falling back to mock token for demo purposes.`);
    }
    
    // For the zero-spend demo, if no real token exists, we simulate the token. 
    // In production, the API calls in the ingestion services will fail without a real token.
    const token = creds?.access_token || process.env.DEMO_MOCK_TOKEN;

    let result = { channelsProcessed: 0, filesProcessed: 0, totalChunks: 0 };

    if (provider === 'google workspace') {
      result = await ingestGoogleDrive(token, tenantId);
    } else if (provider === 'slack') {
      result = await ingestSlackMessages(token, tenantId);
    } else {
      return res.status(400).json({ error: `Provider ${provider} sync not supported` });
    }

    res.json({ success: true, result, message: `Synced data from ${provider}` });
  } catch (error) {
    next(error);
  }
});

// Helper for demo data
function getMockData(provider) {
  if (provider === 'google workspace') {
    return [
      {
        title: 'Project Alpha Planning',
        content: 'During the planning meeting on Tuesday, we decided that the launch date for Project Alpha will be Q4. The marketing team, led by Sarah, will handle the go-to-market strategy. Budget is capped at $50,000.',
        metadata: { date: '2023-10-01', type: 'google_doc' }
      },
      {
        title: 'Q3 Financial Review',
        content: 'Q3 revenue was up 15% year-over-year. Operating costs decreased by 5% due to cloud infrastructure optimizations. Action Item: John needs to finalize the AWS renewal contract by next Friday.',
        metadata: { date: '2023-09-30', type: 'google_sheet' }
      }
    ];
  }
  
  if (provider === 'slack') {
    return [
      {
        title: '#engineering channel',
        content: '@mike said: "The staging deployment is currently blocked because the Redis cluster ran out of memory. I am scaling it up now." -> Resolved at 4:30 PM.',
        metadata: { date: '2023-10-15', channel: 'engineering' }
      },
      {
        title: '#general channel',
        content: 'Announcement from HR: The new health insurance policy will take effect starting January 1st. Everyone needs to complete the enrollment form in BambooHR by December 15th.',
        metadata: { date: '2023-11-01', channel: 'general' }
      }
    ];
  }

  if (provider === 'discord') {
    return [
      {
        title: 'Community Feedback',
        content: 'User "Gamer123" suggested adding a dark mode to the dashboard. The community team upvoted this heavily. We should prioritize this in the next sprint.',
        metadata: { channel: 'feedback' }
      }
    ];
  }

  return null;
}

module.exports = router;
