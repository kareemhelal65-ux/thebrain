const CRMAdapter = require('./CRMAdapter');
const axios = require('axios');

/**
 * SalesforceAdapter — Concrete CRM implementation using Salesforce REST API.
 * 
 * Uses OAuth2 bearer tokens. Supports contacts, opportunities (deals),
 * search via SOQL, and activity logging via Task/Event objects.
 */
class SalesforceAdapter extends CRMAdapter {
  constructor(credentials, config = {}) {
    super('salesforce', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.access_token || !this.credentials.instance_url) {
      throw new Error('Salesforce adapter missing required credentials: access_token, instance_url');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.client = axios.create({
      baseURL: `${this.credentials.instance_url}/services/data/v60.0`,
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
      const res = await this.client.get('/sobjects');
      return { healthy: true, message: `Salesforce connected. ${res.data.sobjects?.length || 0} objects available.` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async get_contact({ contact_id, email }) {
    this.ensureInitialized();
    if (email) {
      const res = await this.client.get('/query', {
        params: { q: `SELECT Id, FirstName, LastName, Email, Phone, Account.Name, Title FROM Contact WHERE Email = '${email}' LIMIT 1` }
      });
      if (!res.data.records.length) return { error: 'Contact not found', email };
      return this._mapContact(res.data.records[0]);
    }
    const res = await this.client.get(`/sobjects/Contact/${contact_id}`);
    return this._mapContact(res.data);
  }

  async create_contact({ first_name, last_name, email, phone, company, title }) {
    this.ensureInitialized();
    const body = { Email: email };
    if (first_name) body.FirstName = first_name;
    if (last_name) body.LastName = last_name;
    if (phone) body.Phone = phone;
    if (title) body.Title = title;

    const res = await this.client.post('/sobjects/Contact', body);
    return { id: res.data.id, success: res.data.success, email };
  }

  async search_contacts({ query, limit = 25 }) {
    this.ensureInitialized();
    const sosl = `FIND {${query}} IN ALL FIELDS RETURNING Contact(Id, FirstName, LastName, Email, Phone, Title LIMIT ${limit})`;
    const res = await this.client.get('/search', { params: { q: sosl } });
    return {
      contacts: (res.data.searchRecords || []).map(c => this._mapContact(c)),
      total: res.data.searchRecords?.length || 0
    };
  }

  async update_deal({ deal_id, stage, value, close_date, notes }) {
    this.ensureInitialized();
    const body = {};
    if (stage) body.StageName = stage;
    if (value) body.Amount = value;
    if (close_date) body.CloseDate = close_date;
    if (notes) body.Description = notes;

    await this.client.patch(`/sobjects/Opportunity/${deal_id}`, body);
    return { id: deal_id, updated: true, ...body };
  }

  async list_deals({ stage, owner, min_value, limit = 25 }) {
    this.ensureInitialized();
    let soql = 'SELECT Id, Name, StageName, Amount, CloseDate, OwnerId FROM Opportunity';
    const conditions = [];
    if (stage) conditions.push(`StageName = '${stage}'`);
    if (owner) conditions.push(`OwnerId = '${owner}'`);
    if (min_value) conditions.push(`Amount >= ${min_value}`);
    if (conditions.length) soql += ` WHERE ${conditions.join(' AND ')}`;
    soql += ` ORDER BY CloseDate DESC LIMIT ${limit}`;

    const res = await this.client.get('/query', { params: { q: soql } });
    return {
      deals: (res.data.records || []).map(d => ({
        id: d.Id, name: d.Name, stage: d.StageName,
        value: d.Amount, close_date: d.CloseDate, owner: d.OwnerId
      })),
      total: res.data.totalSize
    };
  }

  async log_activity({ contact_id, deal_id, type, subject, body, timestamp }) {
    this.ensureInitialized();
    const taskBody = {
      Subject: subject,
      Description: body || '',
      ActivityDate: timestamp ? timestamp.split('T')[0] : new Date().toISOString().split('T')[0],
      Status: 'Completed',
      Type: type === 'call' ? 'Call' : type === 'email' ? 'Email' : 'Other'
    };
    if (contact_id) taskBody.WhoId = contact_id;
    if (deal_id) taskBody.WhatId = deal_id;

    const res = await this.client.post('/sobjects/Task', taskBody);
    return { id: res.data.id, type, subject, logged: true };
  }

  _mapContact(raw) {
    return {
      id: raw.Id, first_name: raw.FirstName, last_name: raw.LastName,
      email: raw.Email, phone: raw.Phone,
      company: raw.Account?.Name || null, title: raw.Title
    };
  }
}

module.exports = SalesforceAdapter;
