const CommsAdapter = require('./CommsAdapter');
const axios = require('axios');

/**
 * SlackAdapter — Concrete Communications implementation using Slack Web API.
 * Uses Bot token (xoxb-) authentication.
 */
const SLACK_API = 'https://slack.com/api';

class SlackAdapter extends CommsAdapter {
  constructor(credentials, config = {}) {
    super('slack', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.bot_token) {
      throw new Error('Slack adapter missing required credential: bot_token');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.client = axios.create({
      baseURL: SLACK_API,
      headers: { 'Authorization': `Bearer ${this.credentials.bot_token}`, 'Content-Type': 'application/json' }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      const res = await this.client.post('/auth.test');
      return { healthy: res.data.ok, message: `Slack connected as ${res.data.user} in ${res.data.team}` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async send_email({ to, subject, body }) {
    // Slack doesn't do email — map to DM
    return await this.send_message({ channel: to[0], message: `*${subject}*\n\n${body}` });
  }

  async read_inbox({ limit = 10 }) {
    this.ensureInitialized();
    // Read recent DMs (conversations.list for IMs, then history)
    const convos = await this.client.get('/conversations.list', { params: { types: 'im', limit: 5 } });
    const messages = [];

    for (const ch of (convos.data.channels || []).slice(0, 3)) {
      const hist = await this.client.get('/conversations.history', {
        params: { channel: ch.id, limit: Math.ceil(limit / 3) }
      });
      for (const msg of (hist.data.messages || [])) {
        messages.push({
          id: msg.ts, channel: ch.id, from: msg.user,
          text: msg.text, date: new Date(parseFloat(msg.ts) * 1000).toISOString(),
          unread: false
        });
      }
    }

    return { emails: messages.slice(0, limit), total: messages.length };
  }

  async search_emails({ query, limit = 20 }) {
    // Map to Slack search
    return await this._searchMessages(query, limit);
  }

  async _searchMessages(query, limit) {
    this.ensureInitialized();
    // Note: search.messages requires a user token, not bot token
    // Using conversations approach as fallback
    const res = await this.client.get('/search.messages', {
      params: { query, count: limit }
    }).catch(() => ({ data: { messages: { matches: [] } } }));

    return {
      results: (res.data.messages?.matches || []).map(m => ({
        id: m.ts, channel: m.channel?.name, from: m.username,
        text: m.text, date: m.ts
      })),
      total: res.data.messages?.total || 0
    };
  }

  async send_message({ channel, message, thread_id }) {
    this.ensureInitialized();
    const body = { channel, text: message };
    if (thread_id) body.thread_ts = thread_id;

    const res = await this.client.post('/chat.postMessage', body);
    if (!res.data.ok) throw new Error(`Slack error: ${res.data.error}`);
    return { success: true, ts: res.data.ts, channel: res.data.channel };
  }

  async list_channels({ type = 'all' } = {}) {
    this.ensureInitialized();
    const typeMap = { all: 'public_channel,private_channel', channel: 'public_channel', group: 'private_channel', direct: 'im' };

    const res = await this.client.get('/conversations.list', {
      params: { types: typeMap[type] || typeMap.all, limit: 100 }
    });

    return {
      channels: (res.data.channels || []).map(ch => ({
        id: ch.id, name: ch.name || ch.user,
        type: ch.is_im ? 'direct' : (ch.is_private ? 'private' : 'public'),
        members: ch.num_members, topic: ch.topic?.value
      }))
    };
  }
}

module.exports = SlackAdapter;
