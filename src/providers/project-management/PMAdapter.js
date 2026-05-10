const BaseAdapter = require('../BaseAdapter');

/**
 * PMAdapter — Standard interface for all project management providers.
 * Concrete implementations (future): JiraAdapter, AsanaAdapter, NotionAdapter
 */
class PMAdapter extends BaseAdapter {
  constructor(providerName, credentials, config) {
    super(providerName, 'project-management', credentials, config);
  }

  async create_task(params) { throw new Error(`${this.providerName}: create_task() not implemented.`); }
  async update_task(params) { throw new Error(`${this.providerName}: update_task() not implemented.`); }
  async list_tasks(params) { throw new Error(`${this.providerName}: list_tasks() not implemented.`); }
  async get_project(params) { throw new Error(`${this.providerName}: get_project() not implemented.`); }
  async assign_task(params) { throw new Error(`${this.providerName}: assign_task() not implemented.`); }
  async log_time(params) { throw new Error(`${this.providerName}: log_time() not implemented.`); }
}

module.exports = PMAdapter;
