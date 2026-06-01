const express = require('express');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../models/supabaseClient');
const { generateEmbedding } = require('../services/embeddingService');

const router = express.Router();

// Middleware to verify webhook signatures (simplified for demo)
const verifySignature = (req, res, next) => {
  // In a real implementation, you would verify req.headers['x-slack-signature']
  // or Google's equivalent using the stored CLIENT_SECRET or signing secret.
  next();
};

/**
 * POST /api/webhooks/slack
 * Receives events from Slack (e.g. message.channels)
 */
router.post('/slack', verifySignature, async (req, res, next) => {
  try {
    const { type, event, team_id } = req.body;

    // Slack URL Verification Challenge
    if (type === 'url_verification') {
      return res.status(200).send(req.body.challenge);
    }

    // Process new messages
    if (event && event.type === 'message' && !event.bot_id) {
      // 1. Look up which company this Slack team_id belongs to in oauth_credentials
      const { data: creds } = await supabase
        .from('oauth_credentials')
        .select('tenant_id')
        .eq('provider', 'slack')
        // .eq('metadata->>team_id', team_id) // In reality, we'd match the team ID
        .limit(1)
        .single();

      if (creds) {
        const tenantId = creds.tenant_id;
        const content = event.text;
        const embedding = await generateEmbedding(content);

        // 2. Insert into document_chunks
        await supabase.from('document_chunks').insert([{
          id: uuidv4(),
          tenant_id: tenantId,
          content: content,
          embedding: JSON.stringify(embedding),
          source_type: 'slack',
          source_id: event.client_msg_id || uuidv4(),
          source_title: `Slack Message in ${event.channel}`,
          metadata: { timestamp: event.ts, user: event.user }
        }]);

        console.log(`[Webhook] Ingested Slack message for tenant ${tenantId}`);
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhook Slack] Error:', error);
    res.status(500).send('Error');
  }
});

/**
 * POST /api/webhooks/google
 * Receives push notifications from Google Drive/Calendar
 */
router.post('/google', verifySignature, async (req, res, next) => {
  try {
    const channelId = req.headers['x-goog-channel-id'];
    const resourceState = req.headers['x-goog-resource-state']; // 'sync', 'add', 'update', 'trash'

    if (resourceState === 'sync') {
      return res.status(200).send('OK');
    }

    // Process file changes
    if (resourceState === 'add' || resourceState === 'update') {
      console.log(`[Webhook] Google Workspace file changed. Fetching new content...`);
      // In reality: 
      // 1. Look up tenant from channelId mapping
      // 2. Use stored access_token to fetch file content via Google Drive API
      // 3. Extract text
      // 4. Generate embedding and upsert to document_chunks
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('[Webhook Google] Error:', error);
    res.status(500).send('Error');
  }
});

/**
 * POST /api/webhooks/calendar-reminder
 * 
 * Simulated cron-driven endpoint that fires 15 minutes before calendar events.
 * Triggers the Pre-Meeting Briefing Engine.
 */
router.post('/calendar-reminder', async (req, res, next) => {
  try {
    // In production, this would be a secure endpoint called by a cron job (e.g. AWS EventBridge or node-cron)
    // that polls the Google Calendar API for events starting in exactly 15 minutes.
    // For this demo MVP, we accept a direct payload describing the upcoming event.
    
    const { tenant_id, eventTitle, participants } = req.body;

    if (!tenant_id || !eventTitle || !participants) {
      return res.status(400).json({ error: 'Missing required fields for calendar reminder.' });
    }

    console.log(`[Calendar Reminder] Triggering pre-meeting briefing for: ${eventTitle}`);
    
    const { generatePreMeetingBriefing } = require('../services/briefingService');
    const result = await generatePreMeetingBriefing(tenant_id, eventTitle, participants);

    if (result.success) {
      return res.status(200).json({ message: 'Pre-meeting briefing generated and sent.', briefing: result.briefing });
    } else {
      return res.status(500).json({ error: 'Failed to generate briefing.', details: result.error });
    }
  } catch (error) {
    console.error('[Webhook Calendar] Error:', error);
    res.status(500).send('Error');
  }
});

module.exports = router;
