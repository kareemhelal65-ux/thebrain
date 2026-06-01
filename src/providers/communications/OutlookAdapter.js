const CommsAdapter = require('./CommsAdapter');
const axios = require('axios');

/**
 * OutlookAdapter — Concrete Communications implementation using Microsoft Graph API.
 * Uses OAuth2 bearer token for Mail API access.
 */
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

class OutlookAdapter extends CommsAdapter {
  constructor(credentials, config = {}) {
    super('outlook', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.access_token) {
      throw new Error('Outlook adapter missing required credential: access_token');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.client = axios.create({
      baseURL: GRAPH_BASE,
      headers: { 'Authorization': `Bearer ${this.credentials.access_token}`, 'Content-Type': 'application/json' }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      const res = await this.client.get('/me');
      return { healthy: true, message: `Outlook connected as ${res.data.displayName}` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async send_email({ to, subject, body, cc, bcc }) {
    this.ensureInitialized();
    const message = {
      subject,
      body: { contentType: 'HTML', content: body },
      toRecipients: (Array.isArray(to) ? to : [to]).map(e => ({ emailAddress: { address: e } }))
    };
    if (cc) message.ccRecipients = (Array.isArray(cc) ? cc : [cc]).map(e => ({ emailAddress: { address: e } }));
    if (bcc) message.bccRecipients = (Array.isArray(bcc) ? bcc : [bcc]).map(e => ({ emailAddress: { address: e } }));

    await this.client.post('/me/sendMail', { message, saveToSentItems: true });
    return { success: true, message: 'Email sent via Outlook.' };
  }

  async read_inbox({ limit = 10, unread_only = false, from_filter }) {
    this.ensureInitialized();
    let filter = '';
    if (unread_only) filter = 'isRead eq false';
    if (from_filter) filter += `${filter ? ' and ' : ''}contains(from/emailAddress/address, '${from_filter}')`;

    const params = { $top: limit, $orderby: 'receivedDateTime desc' };
    if (filter) params.$filter = filter;

    const res = await this.client.get('/me/messages', { params });
    return {
      emails: (res.data.value || []).map(m => ({
        id: m.id, from: m.from?.emailAddress?.address,
        to: m.toRecipients?.map(r => r.emailAddress.address).join(', '),
        subject: m.subject, date: m.receivedDateTime,
        snippet: m.bodyPreview, unread: !m.isRead
      })),
      total: res.data['@odata.count'] || res.data.value?.length || 0
    };
  }

  async search_emails({ query, date_from, date_to, limit = 20 }) {
    this.ensureInitialized();
    let search = `"${query}"`;
    const params = { $top: limit, $search: search };

    const res = await this.client.get('/me/messages', { params });
    let emails = (res.data.value || []).map(m => ({
      id: m.id, from: m.from?.emailAddress?.address,
      subject: m.subject, date: m.receivedDateTime, snippet: m.bodyPreview
    }));

    if (date_from) emails = emails.filter(e => new Date(e.date) >= new Date(date_from));
    if (date_to) emails = emails.filter(e => new Date(e.date) <= new Date(date_to));

    return { results: emails, total: emails.length };
  }

  async send_message({ channel, message }) {
    return await this.send_email({ to: [channel], subject: 'Message from The Brain AIOS', body: message });
  }

  async list_channels() {
    this.ensureInitialized();
    const res = await this.client.get('/me/mailFolders');
    return {
      channels: (res.data.value || []).map(f => ({
        id: f.id, name: f.displayName, type: 'folder',
        unread: f.unreadItemCount, total: f.totalItemCount
      }))
    };
  }
}

module.exports = OutlookAdapter;
