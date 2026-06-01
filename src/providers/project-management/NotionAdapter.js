const PMAdapter = require('./PMAdapter');
const axios = require('axios');

/**
 * NotionAdapter — Concrete PM implementation using Notion API v2022-06-28.
 * 
 * Maps Notion databases to projects and pages to tasks.
 * Uses integration token authentication.
 */
const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

class NotionAdapter extends PMAdapter {
  constructor(credentials, config = {}) {
    super('notion', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.api_key) {
      throw new Error('Notion adapter missing required credential: api_key');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.client = axios.create({
      baseURL: NOTION_BASE,
      headers: {
        'Authorization': `Bearer ${this.credentials.api_key}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION
      }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      const res = await this.client.get('/users/me');
      return { healthy: true, message: `Notion connected as ${res.data.name}` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async create_task({ title, description, project_id, assignee, priority, due_date, labels }) {
    this.ensureInitialized();
    const properties = {
      'Name': { title: [{ text: { content: title } }] }
    };
    if (due_date) properties['Due Date'] = { date: { start: due_date } };
    if (priority) properties['Priority'] = { select: { name: priority } };
    if (assignee) properties['Assignee'] = { people: [{ object: 'user', id: assignee }] };
    if (labels) properties['Tags'] = { multi_select: labels.map(l => ({ name: l })) };

    const body = { parent: { database_id: project_id }, properties };

    if (description) {
      body.children = [{
        object: 'block', type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: description } }] }
      }];
    }

    const res = await this.client.post('/pages', body);
    return { id: res.data.id, title, url: res.data.url };
  }

  async update_task({ task_id, status, assignee, priority, due_date, comment }) {
    this.ensureInitialized();
    const properties = {};
    if (status) properties['Status'] = { select: { name: status } };
    if (assignee) properties['Assignee'] = { people: [{ object: 'user', id: assignee }] };
    if (priority) properties['Priority'] = { select: { name: priority } };
    if (due_date) properties['Due Date'] = { date: { start: due_date } };

    await this.client.patch(`/pages/${task_id}`, { properties });

    if (comment) {
      await this.client.patch(`/blocks/${task_id}/children`, {
        children: [{
          object: 'block', type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: `💬 ${comment}` } }] }
        }]
      });
    }

    return { id: task_id, updated: true };
  }

  async list_tasks({ project_id, status, assignee, priority, limit = 25 }) {
    this.ensureInitialized();
    const filter = { and: [] };
    if (status) filter.and.push({ property: 'Status', select: { equals: status } });
    if (assignee) filter.and.push({ property: 'Assignee', people: { contains: assignee } });
    if (priority) filter.and.push({ property: 'Priority', select: { equals: priority } });

    const body = { page_size: limit };
    if (filter.and.length > 0) body.filter = filter.and.length === 1 ? filter.and[0] : filter;

    const res = await this.client.post(`/databases/${project_id}/query`, body);

    return {
      tasks: (res.data.results || []).map(page => {
        const p = page.properties;
        return {
          id: page.id,
          title: p.Name?.title?.[0]?.text?.content || 'Untitled',
          status: p.Status?.select?.name,
          assignee: p.Assignee?.people?.[0]?.name,
          priority: p.Priority?.select?.name,
          due_date: p.Due_Date?.date?.start || p['Due Date']?.date?.start,
          url: page.url
        };
      }),
      total: res.data.results?.length || 0
    };
  }

  async get_project({ project_id }) {
    this.ensureInitialized();
    const res = await this.client.get(`/databases/${project_id}`);
    return {
      id: res.data.id,
      name: res.data.title?.[0]?.text?.content || 'Untitled',
      description: res.data.description?.[0]?.text?.content || '',
      url: res.data.url,
      properties: Object.keys(res.data.properties)
    };
  }

  async assign_task({ task_id, assignee }) {
    this.ensureInitialized();
    await this.client.patch(`/pages/${task_id}`, {
      properties: { 'Assignee': { people: [{ object: 'user', id: assignee }] } }
    });
    return { id: task_id, assignee, assigned: true };
  }

  async log_time({ task_id, hours, description }) {
    this.ensureInitialized();
    const text = `⏱ ${hours}h logged${description ? `: ${description}` : ''}`;
    await this.client.patch(`/blocks/${task_id}/children`, {
      children: [{
        object: 'block', type: 'callout',
        callout: { rich_text: [{ type: 'text', text: { content: text } }], icon: { emoji: '⏱' } }
      }]
    });
    return { task_id, hours, logged: true };
  }
}

module.exports = NotionAdapter;
