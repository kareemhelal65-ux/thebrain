const CRMAdapter = require('./CRMAdapter');
const axios = require('axios');

/**
 * ZohoAdapter — Concrete CRM implementation using Zoho CRM API v6.
 * 
 * Uses OAuth2 access tokens with auto-refresh via refresh_token.
 * Maps Zoho Contacts, Deals, and Notes to the standard CRM interface.
 */
const ZOHO_BASE = 'https://www.zohoapis.com/crm/v6';

class ZohoAdapter extends CRMAdapter {
  constructor(credentials, config = {}) {
    super('zoho', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.access_token) {
      throw new Error('Zoho adapter missing required credential: access_token');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    // If we have a refresh token, try to refresh first
    if (this.credentials.refresh_token && this.credentials.client_id) {
      await this._refreshToken().catch(() => {});
    }
    this.client = axios.create({
      baseURL: ZOHO_BASE,
      headers: {
        'Authorization': `Zoho-oauthtoken ${this.credentials.access_token}`,
        'Content-Type': 'application/json'
      }
    });
    this.initialized = true;
  }

  async _refreshToken() {
    const res = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
      params: {
        refresh_token: this.credentials.refresh_token,
        client_id: this.credentials.client_id,
        client_secret: this.credentials.client_secret,
        grant_type: 'refresh_token'
      }
    });
    this.credentials.access_token = res.data.access_token;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      await this.client.get('/Contacts?per_page=1');
      return { healthy: true, message: 'Zoho CRM connected.' };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async get_contact({ contact_id, email }) {
    this.ensureInitialized();
    if (email) {
      const res = await this.client.get('/Contacts/search', { params: { email } });
      const contact = res.data?.data?.[0];
      if (!contact) return { error: 'Contact not found', email };
      return this._mapContact(contact);
    }
    const res = await this.client.get(`/Contacts/${contact_id}`);
    return this._mapContact(res.data.data[0]);
  }

  async create_contact({ first_name, last_name, email, phone, company, title }) {
    this.ensureInitialized();
    const data = { Email: email };
    if (first_name) data.First_Name = first_name;
    if (last_name) data.Last_Name = last_name;
    if (phone) data.Phone = phone;
    if (company) data.Company = company;
    if (title) data.Title = title;

    const res = await this.client.post('/Contacts', { data: [data] });
    return { id: res.data.data[0].details.id, success: true, email };
  }

  async search_contacts({ query, limit = 25 }) {
    this.ensureInitialized();
    const res = await this.client.get('/Contacts/search', {
      params: { word: query, per_page: limit }
    });
    return {
      contacts: (res.data?.data || []).map(c => this._mapContact(c)),
      total: res.data?.info?.count || 0
    };
  }

  async update_deal({ deal_id, stage, value, close_date, notes }) {
    this.ensureInitialized();
    const data = {};
    if (stage) data.Stage = stage;
    if (value) data.Amount = value;
    if (close_date) data.Closing_Date = close_date;
    if (notes) data.Description = notes;

    await this.client.put(`/Deals/${deal_id}`, { data: [data] });
    return { id: deal_id, updated: true };
  }

  async list_deals({ stage, owner, min_value, limit = 25 }) {
    this.ensureInitialized();
    let url = `/Deals?per_page=${limit}&sort_by=Closing_Date&sort_order=desc`;
    const res = await this.client.get(url);
    let deals = (res.data?.data || []).map(d => ({
      id: d.id, name: d.Deal_Name, stage: d.Stage,
      value: d.Amount, close_date: d.Closing_Date, owner: d.Owner?.name
    }));
    if (stage) deals = deals.filter(d => d.stage === stage);
    if (min_value) deals = deals.filter(d => d.value >= min_value);
    return { deals, total: deals.length };
  }

  async log_activity({ contact_id, deal_id, type, subject, body }) {
    this.ensureInitialized();
    const data = {
      Note_Title: subject,
      Note_Content: body || '',
      se_module: contact_id ? 'Contacts' : 'Deals',
      Parent_Id: contact_id || deal_id
    };

    const res = await this.client.post('/Notes', { data: [data] });
    return { id: res.data?.data?.[0]?.details?.id, type, subject, logged: true };
  }

  _mapContact(raw) {
    return {
      id: raw.id, first_name: raw.First_Name, last_name: raw.Last_Name,
      email: raw.Email, phone: raw.Phone,
      company: raw.Company, title: raw.Title
    };
  }
}

module.exports = ZohoAdapter;
