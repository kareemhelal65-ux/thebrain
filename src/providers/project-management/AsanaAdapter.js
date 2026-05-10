const PMAdapter = require('./PMAdapter');
const axios = require('axios');

/**
 * AsanaAdapter — Concrete PM implementation using Asana REST API.
 * Uses personal access token or OAuth2 token.
 */
const ASANA_BASE = 'https://app.asana.com/api/1.0';

class AsanaAdapter extends PMAdapter {
  constructor(credentials, config = {}) {
    super('asana', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.access_token) {
      throw new Error('Asana adapter missing required credential: access_token');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.client = axios.create({
      baseURL: ASANA_BASE,
      headers: { 'Authorization': `Bearer ${this.credentials.access_token}`, 'Content-Type': 'application/json' }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      const res = await this.client.get('/users/me');
      return { healthy: true, message: `Asana connected as ${res.data.data.name}` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async create_task({ title, description, project_id, assignee, priority, due_date, labels }) {
    this.ensureInitialized();
    const body = { name: title };
    if (description) body.notes = description;
    if (project_id) body.projects = [project_id];
    if (assignee) body.assignee = assignee;
    if (due_date) body.due_on = due_date.split('T')[0];
    if (labels && labels.length) body.tags = labels;

    const res = await this.client.post('/tasks', { data: body });
    return { id: res.data.data.gid, name: res.data.data.name, url: res.data.data.permalink_url };
  }

  async update_task({ task_id, status, assignee, priority, due_date, comment }) {
    this.ensureInitialized();
    const body = {};
    if (status === 'done') body.completed = true;
    if (status === 'todo' || status === 'in_progress') body.completed = false;
    if (assignee) body.assignee = assignee;
    if (due_date) body.due_on = due_date.split('T')[0];

    await this.client.put(`/tasks/${task_id}`, { data: body });

    if (comment) {
      await this.client.post(`/tasks/${task_id}/stories`, { data: { text: comment } });
    }

    return { id: task_id, updated: true };
  }

  async list_tasks({ project_id, status, assignee, limit = 25 }) {
    this.ensureInitialized();
    let url = '/tasks';
    const params = { limit, opt_fields: 'name,completed,assignee.name,due_on,created_at' };
    if (project_id) params.project = project_id;
    if (assignee) params.assignee = assignee;
    if (status === 'done') params.completed_since = '2000-01-01';

    const res = await this.client.get(url, { params });
    return {
      tasks: (res.data.data || []).map(t => ({
        id: t.gid, title: t.name, status: t.completed ? 'done' : 'in_progress',
        assignee: t.assignee?.name, due_date: t.due_on
      })),
      total: res.data.data?.length || 0
    };
  }

  async get_project({ project_id }) {
    this.ensureInitialized();
    const res = await this.client.get(`/projects/${project_id}`, {
      params: { opt_fields: 'name,notes,owner.name,team.name,created_at,members.name' }
    });
    const p = res.data.data;
    return {
      id: p.gid, name: p.name, description: p.notes,
      owner: p.owner?.name, team: p.team?.name,
      members: (p.members || []).map(m => m.name)
    };
  }

  async assign_task({ task_id, assignee, notify = true }) {
    this.ensureInitialized();
    await this.client.put(`/tasks/${task_id}`, { data: { assignee } });
    return { id: task_id, assignee, assigned: true };
  }

  async log_time({ task_id, hours, description }) {
    this.ensureInitialized();
    // Asana doesn't have native time tracking — log as a comment
    const text = `⏱ Time logged: ${hours}h${description ? ` — ${description}` : ''}`;
    await this.client.post(`/tasks/${task_id}/stories`, { data: { text } });
    return { task_id, hours, logged_as: 'comment', note: 'Asana has no native time tracking' };
  }
}

module.exports = AsanaAdapter;
