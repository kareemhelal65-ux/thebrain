const BaseAdapter = require('../BaseAdapter');

/**
 * StorageAdapter — Standard interface for all file/document storage providers.
 * Concrete implementations (future): GoogleDriveAdapter, DropboxAdapter, OneDriveAdapter
 */
class StorageAdapter extends BaseAdapter {
  constructor(providerName, credentials, config) {
    super(providerName, 'storage', credentials, config);
  }

  async upload_file(params) { throw new Error(`${this.providerName}: upload_file() not implemented.`); }
  async download_file(params) { throw new Error(`${this.providerName}: download_file() not implemented.`); }
  async list_files(params) { throw new Error(`${this.providerName}: list_files() not implemented.`); }
  async search_files(params) { throw new Error(`${this.providerName}: search_files() not implemented.`); }
  async share_file(params) { throw new Error(`${this.providerName}: share_file() not implemented.`); }
}

module.exports = StorageAdapter;
