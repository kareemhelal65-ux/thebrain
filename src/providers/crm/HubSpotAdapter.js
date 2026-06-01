const CRMAdapter = require('./CRMAdapter');
const axios = require('axios');

/**
 * HubSpotAdapter — Concrete CRM implementation using HubSpot API v3.
 * 
 * Uses private app access tokens for authentication.
 * Covers contacts, deals, pipeline management, and activity logging.
 */
const HUBSPOT_BASE = 'https://api.hubapi.com';

class HubSpotAdapter extends CRMAdapter {
  constructor(credentials, config = {}) {
    super('hubspot', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.access_token) {
      throw new Error('HubSpot adapter missing required credential: access_token');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.client = axios.create({
      baseURL: HUBSPOT_BASE,
      headers: {
        'Authorization': `Bearer ${this.credentials.access_token}`,
        'Content-Type': 'application/json'
      }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      await this.client.get('/crm/v3/objects/contacts?limit=1');
      return { healthy: true, message: 'HubSpot API connected.' };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async get_contact({ contact_id, email }) {
    this.ensureInitialized();

    if (email) {
      const res = await this.client.post('/crm/v3/objects/contacts/search', {
        filterGroups: [{
          filters: [{ propertyName: 'email', operator: 'EQ', value: email }]
        }],
        properties: ['firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle']
      });
      const contact = res.data.results[0];
      if (!contact) return { error: 'Contact not found', email };
      return this._mapContact(contact);
    }

    const res = await this.client.get(`/crm/v3/objects/contacts/${contact_id}`, {
      params: { properties: 'firstname,lastname,email,phone,company,jobtitle' }
    });
    return this._mapContact(res.data);
  }

  async create_contact({ first_name, last_name, email, phone, company, title, tags, custom_fields }) {
    this.ensureInitialized();
    const properties = { email };
    if (first_name) properties.firstname = first_name;
    if (last_name) properties.lastname = last_name;
    if (phone) properties.phone = phone;
    if (company) properties.company = company;
    if (title) properties.jobtitle = title;
    if (custom_fields) Object.assign(properties, custom_fields);

    const res = await this.client.post('/crm/v3/objects/contacts', { properties });
    return this._mapContact(res.data);
  }

  async search_contacts({ query, filters, limit = 25 }) {
    this.ensureInitialized();
    const body = {
      query,
      limit,
      properties: ['firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle']
    };

    const res = await this.client.post('/crm/v3/objects/contacts/search', body);
    return {
      contacts: res.data.results.map(c => this._mapContact(c)),
      total: res.data.total
    };
  }

  async update_deal({ deal_id, stage, value, close_date, notes }) {
    this.ensureInitialized();
    const properties = {};
    if (stage) properties.dealstage = stage;
    if (value) properties.amount = value.toString();
    if (close_date) properties.closedate = close_date;
    if (notes) properties.description = notes;

    const res = await this.client.patch(`/crm/v3/objects/deals/${deal_id}`, { properties });
    return this._mapDeal(res.data);
  }

  async list_deals({ stage, owner, min_value, limit = 25 }) {
    this.ensureInitialized();
    const filterGroups = [];
    const filters = [];
    if (stage) filters.push({ propertyName: 'dealstage', operator: 'EQ', value: stage });
    if (owner) filters.push({ propertyName: 'hubspot_owner_id', operator: 'EQ', value: owner });
    if (min_value) filters.push({ propertyName: 'amount', operator: 'GTE', value: min_value.toString() });
    if (filters.length > 0) filterGroups.push({ filters });

    const res = await this.client.post('/crm/v3/objects/deals/search', {
      filterGroups,
      limit,
      properties: ['dealname', 'dealstage', 'amount', 'closedate', 'hubspot_owner_id']
    });
    return {
      deals: res.data.results.map(d => this._mapDeal(d)),
      total: res.data.total
    };
  }

  async log_activity({ contact_id, deal_id, type, subject, body, timestamp }) {
    this.ensureInitialized();
    const typeMap = { call: 'calls', email: 'emails', meeting: 'meetings', note: 'notes' };
    const objectType = typeMap[type] || 'notes';

    const properties = {
      hs_timestamp: timestamp || new Date().toISOString(),
    };

    if (objectType === 'notes') {
      properties.hs_note_body = `${subject}\n\n${body || ''}`;
    } else {
      properties.hs_call_title = subject;
      properties.hs_call_body = body || '';
    }

    const res = await this.client.post(`/crm/v3/objects/${objectType}`, { properties });

    // Associate with contact or deal
    if (contact_id) {
      await this.client.put(
        `/crm/v3/objects/${objectType}/${res.data.id}/associations/contacts/${contact_id}/note_to_contact`
      ).catch(() => {});
    }

    return { id: res.data.id, type, subject, logged: true };
  }

  _mapContact(raw) {
    const p = raw.properties || {};
    return {
      id: raw.id,
      first_name: p.firstname,
      last_name: p.lastname,
      email: p.email,
      phone: p.phone,
      company: p.company,
      title: p.jobtitle,
      created_at: raw.createdAt
    };
  }

  _mapDeal(raw) {
    const p = raw.properties || {};
    return {
      id: raw.id,
      name: p.dealname,
      stage: p.dealstage,
      value: parseFloat(p.amount) || 0,
      close_date: p.closedate,
      owner: p.hubspot_owner_id,
      created_at: raw.createdAt
    };
  }
}

module.exports = HubSpotAdapter;
