const CommsAdapter = require('./CommsAdapter');
const axios = require('axios');

/**
 * TwilioAdapter — Concrete Communications implementation using Twilio API.
 * Handles SMS, WhatsApp, and voice notifications.
 * Uses Account SID + Auth Token.
 */
class TwilioAdapter extends CommsAdapter {
  constructor(credentials, config = {}) {
    super('twilio', credentials, config);
    this.client = null;
    this.baseURL = null;
  }

  validateConfig() {
    if (!this.credentials.account_sid || !this.credentials.auth_token) {
      throw new Error('Twilio adapter missing required credentials: account_sid, auth_token');
    }
    if (!this.credentials.from_number) {
      console.warn('Twilio: from_number not set. Sending messages will fail.');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.baseURL = `https://api.twilio.com/2010-04-01/Accounts/${this.credentials.account_sid}`;
    this.client = axios.create({
      baseURL: this.baseURL,
      auth: { username: this.credentials.account_sid, password: this.credentials.auth_token },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      const res = await this.client.get('.json');
      return { healthy: true, message: `Twilio connected. Status: ${res.data.status}` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async send_email({ to, subject, body }) {
    // Twilio SendGrid integration — or fallback to SMS summary
    return await this.send_message({
      channel: Array.isArray(to) ? to[0] : to,
      message: `${subject}\n\n${body}`
    });
  }

  async read_inbox({ limit = 10 }) {
    this.ensureInitialized();
    const res = await this.client.get('/Messages.json', {
      params: { PageSize: limit, To: this.credentials.from_number }
    });

    return {
      emails: (res.data.messages || []).map(m => ({
        id: m.sid, from: m.from, to: m.to,
        text: m.body, date: m.date_sent,
        status: m.status, direction: m.direction
      })),
      total: res.data.messages?.length || 0
    };
  }

  async search_emails({ query, date_from, date_to, limit = 20 }) {
    this.ensureInitialized();
    const params = { PageSize: limit };
    if (date_from) params.DateSent_After = date_from;
    if (date_to) params.DateSent_Before = date_to;

    const res = await this.client.get('/Messages.json', { params });
    let messages = (res.data.messages || []).map(m => ({
      id: m.sid, from: m.from, text: m.body, date: m.date_sent
    }));
    if (query) messages = messages.filter(m => m.text?.toLowerCase().includes(query.toLowerCase()));
    return { results: messages, total: messages.length };
  }

  async send_message({ channel, message, thread_id }) {
    this.ensureInitialized();
    const params = new URLSearchParams();
    params.append('To', channel);
    params.append('From', this.credentials.from_number);
    params.append('Body', message);

    const res = await this.client.post('/Messages.json', params);
    return { success: true, sid: res.data.sid, status: res.data.status, to: channel };
  }

  async list_channels() {
    this.ensureInitialized();
    // Twilio doesn't have channels — list recent unique conversations
    const res = await this.client.get('/Messages.json', { params: { PageSize: 50 } });
    const uniqueNumbers = [...new Set((res.data.messages || []).map(m => m.from === this.credentials.from_number ? m.to : m.from))];
    return {
      channels: uniqueNumbers.map(num => ({
        id: num, name: num, type: 'sms'
      }))
    };
  }
}

module.exports = TwilioAdapter;
