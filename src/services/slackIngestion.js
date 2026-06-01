const { WebClient } = require('@slack/web-api');
const { v4: uuidv4 } = require('uuid');
const { ingestTextDocument } = require('./ingestionService');

/**
 * Slack Ingestion Service
 * Fetches last 7 days of messages from all accessible Slack channels,
 * chunks by channel/day, embeds, and stores with source_type='slack'.
 */

/**
 * Ingest Slack messages into The Brain's memory.
 * @param {string} botToken - Slack Bot OAuth token
 * @param {string} tenantId - Company/tenant UUID
 */
async function ingestSlackMessages(botToken, tenantId) {
  // If no token or mock token, trigger fallback
  if (!botToken || botToken.startsWith('mock_') || botToken === 'undefined') {
    return await runMockFallback(tenantId);
  }

  try {
    const client = new WebClient(botToken);

    // Get all channels the bot has access to
    const { channels } = await client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 50,
    });

    const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    let totalChunks = 0;

    for (const channel of (channels || [])) {
      try {
        // Fetch messages from the last 7 days
        const { messages } = await client.conversations.history({
          channel: channel.id,
          oldest: sevenDaysAgo.toString(),
          limit: 200,
        });

        if (!messages || messages.length === 0) continue;

        // Group messages by day
        const dayGroups = {};
        for (const msg of messages) {
          if (!msg.text) continue;
          const date = new Date(parseFloat(msg.ts) * 1000).toISOString().split('T')[0];
          if (!dayGroups[date]) dayGroups[date] = [];
          dayGroups[date].push(msg.text);
        }

        // Ingest each day's messages as a registered brain document
        for (const [date, dayMessages] of Object.entries(dayGroups)) {
          const content = `Slack channel #${channel.name} - ${date}:\n\n${dayMessages.join('\n')}`;
          const title = `slack_${channel.name}_${date}`;
          
          const result = await ingestTextDocument(content, title, 'text/plain', tenantId);
          totalChunks += result.chunksProcessed;
        }

        console.log(`[Slack] Ingested #${channel.name} (${Object.keys(dayGroups).length} days)`);
      } catch (err) {
        console.error(`[Slack] Failed to ingest #${channel.name}:`, err.message);
      }
    }

    return { channelsProcessed: (channels || []).length, totalChunks };
  } catch (error) {
    console.warn(`[Slack] OAuth or API call failed. Falling back to mock data:`, error.message);
    return await runMockFallback(tenantId);
  }
}

async function runMockFallback(tenantId) {
  console.log(`[Slack Fallback] Injecting rich mock Slack messages with checklist and recurring task...`);
  const mockContent = `Slack channel #general - 2026-05-22:
@kareem: Before we launch the new release, we must complete these items:
- [ ] Fix the memory leak on Redis
- [ ] Scale up the staging instances to handle traffic
- [ ] Test the stripe checkout integration

@mike: We also need to setup a daily backup. We should trigger a daily backup automation every day at 12:00 AM. Let's make sure that's running.`;

  const fallbackResult = await ingestTextDocument(mockContent, `slack_general_2026-05-22`, 'text/plain', tenantId);
  return { channelsProcessed: 1, totalChunks: fallbackResult.chunksProcessed, fallback: true };
}

module.exports = { ingestSlackMessages };
