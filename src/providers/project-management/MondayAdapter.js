const PMAdapter = require('./PMAdapter');
const axios = require('axios');

/**
 * MondayAdapter — Concrete PM implementation using Monday.com GraphQL API.
 * Uses API token authentication.
 */
const MONDAY_API = 'https://api.monday.com/v2';

class MondayAdapter extends PMAdapter {
  constructor(credentials, config = {}) {
    super('monday', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.api_token) {
      throw new Error('Monday adapter missing required credential: api_token');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.client = axios.create({
      baseURL: MONDAY_API,
      headers: { 'Authorization': this.credentials.api_token, 'Content-Type': 'application/json' }
    });
    this.initialized = true;
  }

  async _query(query, variables = {}) {
    const res = await this.client.post('', { query, variables });
    if (res.data.errors) throw new Error(res.data.errors[0].message);
    return res.data.data;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      const data = await this._query('{ me { name email } }');
      return { healthy: true, message: `Monday.com connected as ${data.me.name}` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async create_task({ title, description, project_id, assignee, priority, due_date }) {
    this.ensureInitialized();
    const columnValues = {};
    if (due_date) columnValues.date = { date: due_date.split('T')[0] };
    if (priority) columnValues.status = { label: priority };

    const query = `mutation { create_item(board_id: ${project_id}, item_name: "${title}", column_values: ${JSON.stringify(JSON.stringify(columnValues))}) { id name } }`;
    const data = await this._query(query);

    if (description) {
      await this._query(`mutation { create_update(item_id: ${data.create_item.id}, body: "${description}") { id } }`);
    }

    return { id: data.create_item.id, name: data.create_item.name };
  }

  async update_task({ task_id, status, assignee, priority, due_date, comment }) {
    this.ensureInitialized();
    const columnValues = {};
    if (status) columnValues.status = { label: status };
    if (due_date) columnValues.date = { date: due_date.split('T')[0] };

    if (Object.keys(columnValues).length > 0) {
      // We need the board_id; fetch item first
      const itemData = await this._query(`{ items(ids: [${task_id}]) { board { id } } }`);
      const boardId = itemData.items[0]?.board?.id;
      if (boardId) {
        await this._query(`mutation { change_multiple_column_values(board_id: ${boardId}, item_id: ${task_id}, column_values: ${JSON.stringify(JSON.stringify(columnValues))}) { id } }`);
      }
    }

    if (comment) {
      await this._query(`mutation { create_update(item_id: ${task_id}, body: "${comment}") { id } }`);
    }

    return { id: task_id, updated: true };
  }

  async list_tasks({ project_id, status, limit = 25 }) {
    this.ensureInitialized();
    const query = `{ boards(ids: [${project_id}]) { items_page(limit: ${limit}) { items { id name column_values { id text } } } } }`;
    const data = await this._query(query);
    const items = data.boards[0]?.items_page?.items || [];

    return {
      tasks: items.map(item => {
        const cols = {};
        item.column_values.forEach(cv => { cols[cv.id] = cv.text; });
        return { id: item.id, title: item.name, status: cols.status, due_date: cols.date };
      }),
      total: items.length
    };
  }

  async get_project({ project_id }) {
    this.ensureInitialized();
    const data = await this._query(`{ boards(ids: [${project_id}]) { id name description owner { id name } } }`);
    const board = data.boards[0];
    if (!board) return { error: 'Board not found' };
    return { id: board.id, name: board.name, description: board.description, owner: board.owner?.name };
  }

  async assign_task({ task_id, assignee }) {
    this.ensureInitialized();
    const itemData = await this._query(`{ items(ids: [${task_id}]) { board { id } } }`);
    const boardId = itemData.items[0]?.board?.id;
    if (boardId) {
      const colValues = JSON.stringify({ person: { personsAndTeams: [{ id: parseInt(assignee), kind: 'person' }] } });
      await this._query(`mutation { change_multiple_column_values(board_id: ${boardId}, item_id: ${task_id}, column_values: ${JSON.stringify(colValues)}) { id } }`);
    }
    return { id: task_id, assignee, assigned: true };
  }

  async log_time({ task_id, hours, description }) {
    this.ensureInitialized();
    const body = `⏱ Time logged: ${hours}h${description ? ` — ${description}` : ''}`;
    await this._query(`mutation { create_update(item_id: ${task_id}, body: "${body}") { id } }`);
    return { task_id, hours, logged: true };
  }
}

module.exports = MondayAdapter;
