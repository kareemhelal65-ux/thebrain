const axios = require('axios');

/**
 * SlackNotificationService — Post meeting summaries and action items to Slack
 * Uses a simple Incoming Webhook URL (zero cost, no OAuth needed)
 */

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

/**
 * Post a meeting summary to Slack
 * @param {Object} meeting - Meeting data with insights
 */
async function notifyMeetingSummary(meeting) {
  if (!SLACK_WEBHOOK_URL) {
    console.warn('[Slack] No SLACK_WEBHOOK_URL configured. Skipping notification.');
    return { sent: false, reason: 'No webhook URL configured' };
  }

  try {
    const insights = meeting.insights || {};
    const actionItems = insights.action_items || [];
    const decisions = insights.decisions || [];

    // Build Slack Block Kit message
    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🧠 Meeting Summary: ${meeting.title || 'Untitled'}`,
          emoji: true,
        }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Date:*\n${new Date(meeting.meeting_date).toLocaleDateString()}` },
          { type: 'mrkdwn', text: `*Source:*\n${meeting.source_type || 'unknown'}` },
        ]
      },
    ];

    // Summary
    if (insights.summary) {
      blocks.push(
        { type: 'divider' },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*📝 Summary*\n${insights.summary}` }
        }
      );
    }

    // Decisions
    if (decisions.length > 0) {
      const decisionText = decisions
        .map((d, i) => `${i + 1}. ${d.decision || d}`)
        .join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*✅ Decisions*\n${decisionText}` }
      });
    }

    // Action items
    if (actionItems.length > 0) {
      const actionText = actionItems
        .map((a, i) => `${i + 1}. *${a.task}* → ${a.assignee || 'Unassigned'}${a.deadline ? ` (due: ${a.deadline})` : ''}`)
        .join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*🎯 Action Items*\n${actionText}` }
      });
    }

    // Footer
    blocks.push({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: '🧠 Sent by _The Brain AIOS_ — your company\'s AI operating system' }
      ]
    });

    await axios.post(SLACK_WEBHOOK_URL, {
      text: `Meeting Summary: ${meeting.title}`, // Fallback text
      blocks
    });

    console.log(`[Slack] Meeting summary posted: ${meeting.title}`);
    return { sent: true };
  } catch (error) {
    console.error('[Slack] Failed to send notification:', error.message);
    return { sent: false, reason: error.message };
  }
}

/**
 * Post a simple text notification to Slack
 */
async function notifyText(text) {
  if (!SLACK_WEBHOOK_URL) return { sent: false, reason: 'No webhook URL' };

  try {
    await axios.post(SLACK_WEBHOOK_URL, { text });
    return { sent: true };
  } catch (error) {
    console.error('[Slack] Notification failed:', error.message);
    return { sent: false, reason: error.message };
  }
}

module.exports = {
  notifyMeetingSummary,
  notifyText,
};
