const PMAdapter = require('./PMAdapter');
const axios = require('axios');

/**
 * JiraAdapter — Concrete PM implementation using Jira Cloud REST API v3.
 * 
 * Uses API token authentication (email + token).
 * Maps Jira issues to tasks, projects to projects.
 */
class JiraAdapter extends PMAdapter {
  constructor(credentials, config = {}) {
    super('jira', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.domain || !this.credentials.email || !this.credentials.api_token) {
      throw new Error('Jira adapter missing required credentials: domain, email, api_token');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    const auth = Buffer.from(`${this.credentials.email}:${this.credentials.api_token}`).toString('base64');
    this.client = axios.create({
      baseURL: `https://${this.credentials.domain}.atlassian.net/rest/api/3`,
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      const res = await this.client.get('/myself');
      return { healthy: true, message: `Jira connected as ${res.data.displayName}` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async create_task({ title, description, project_id, assignee, priority, due_date, labels }) {
    this.ensureInitialized();
    const fields = {
      project: { key: project_id },
      summary: title,
      issuetype: { name: 'Task' }
    };
    if (description) fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] };
    if (assignee) fields.assignee = { accountId: assignee };
    if (priority) fields.priority = { name: priority.charAt(0).toUpperCase() + priority.slice(1) };
    if (due_date) fields.duedate = due_date.split('T')[0];
    if (labels) fields.labels = labels;

    const res = await this.client.post('/issue', { fields });
    return { id: res.data.id, key: res.data.key, url: res.data.self };
  }

  async update_task({ task_id, status, assignee, priority, due_date, comment }) {
    this.ensureInitialized();
    const fields = {};
    if (assignee) fields.assignee = { accountId: assignee };
    if (priority) fields.priority = { name: priority.charAt(0).toUpperCase() + priority.slice(1) };
    if (due_date) fields.duedate = due_date.split('T')[0];

    if (Object.keys(fields).length > 0) {
      await this.client.put(`/issue/${task_id}`, { fields });
    }

    if (status) {
      const transitions = await this.client.get(`/issue/${task_id}/transitions`);
      const transition = transitions.data.transitions.find(t =>
        t.name.toLowerCase().includes(status.replace('_', ' '))
      );
      if (transition) {
        await this.client.post(`/issue/${task_id}/transitions`, { transition: { id: transition.id } });
      }
    }

    if (comment) {
      await this.client.post(`/issue/${task_id}/comment`, {
        body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }] }
      });
    }

    return { id: task_id, updated: true };
  }

  async list_tasks({ project_id, status, assignee, priority, limit = 25 }) {
    this.ensureInitialized();
    let jql = '';
    const conditions = [];
    if (project_id) conditions.push(`project = "${project_id}"`);
    if (status) conditions.push(`status = "${status}"`);
    if (assignee) conditions.push(`assignee = "${assignee}"`);
    if (priority) conditions.push(`priority = "${priority}"`);
    jql = conditions.join(' AND ') || 'ORDER BY created DESC';

    const res = await this.client.get('/search', {
      params: { jql, maxResults: limit, fields: 'summary,status,assignee,priority,duedate' }
    });

    return {
      tasks: res.data.issues.map(i => ({
        id: i.id, key: i.key, title: i.fields.summary,
        status: i.fields.status?.name, assignee: i.fields.assignee?.displayName,
        priority: i.fields.priority?.name, due_date: i.fields.duedate
      })),
      total: res.data.total
    };
  }

  async get_project({ project_id }) {
    this.ensureInitialized();
    const res = await this.client.get(`/project/${project_id}`);
    return {
      id: res.data.id, key: res.data.key, name: res.data.name,
      lead: res.data.lead?.displayName, url: res.data.self
    };
  }

  async assign_task({ task_id, assignee, notify = true }) {
    this.ensureInitialized();
    await this.client.put(`/issue/${task_id}/assignee`, { accountId: assignee });
    return { id: task_id, assignee, assigned: true };
  }

  async log_time({ task_id, hours, description, date }) {
    this.ensureInitialized();
    const seconds = Math.round(hours * 3600);
    const body = { timeSpentSeconds: seconds };
    if (description) body.comment = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] };
    if (date) body.started = new Date(date).toISOString().replace('Z', '+0000');

    const res = await this.client.post(`/issue/${task_id}/worklog`, body);
    return { id: res.data.id, task_id, hours, logged: true };
  }
}

module.exports = JiraAdapter;
