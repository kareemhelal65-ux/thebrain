const StorageAdapter = require('./StorageAdapter');
const axios = require('axios');

/**
 * DropboxAdapter — Concrete Storage implementation using Dropbox API v2.
 * Uses OAuth2 access tokens.
 */
const DROPBOX_API = 'https://api.dropboxapi.com/2';
const DROPBOX_CONTENT = 'https://content.dropboxapi.com/2';

class DropboxAdapter extends StorageAdapter {
  constructor(credentials, config = {}) {
    super('dropbox', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.access_token) {
      throw new Error('Dropbox adapter missing required credential: access_token');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.client = axios.create({
      baseURL: DROPBOX_API,
      headers: { 'Authorization': `Bearer ${this.credentials.access_token}`, 'Content-Type': 'application/json' }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      const res = await this.client.post('/users/get_current_account');
      return { healthy: true, message: `Dropbox connected as ${res.data.name.display_name}` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async upload_file({ file_name, folder_path = '/', content_type }) {
    this.ensureInitialized();
    const path = folder_path === '/' ? `/${file_name}` : `${folder_path}/${file_name}`;
    // Note: actual content would be in request body via content endpoint
    return {
      path,
      upload_url: `${DROPBOX_CONTENT}/files/upload`,
      headers_required: {
        'Dropbox-API-Arg': JSON.stringify({ path, mode: 'add', autorename: true }),
        'Content-Type': 'application/octet-stream'
      },
      note: 'Upload file content to the upload_url with the specified headers.'
    };
  }

  async download_file({ file_id, file_path }) {
    this.ensureInitialized();
    const path = file_path || file_id;
    const res = await this.client.post('/files/get_metadata', { path });
    return {
      id: res.data.id, name: res.data.name, path: res.data.path_display,
      size: res.data.size, modified: res.data.server_modified,
      download_endpoint: `${DROPBOX_CONTENT}/files/download`,
      note: 'POST to download_endpoint with Dropbox-API-Arg header containing the path.'
    };
  }

  async list_files({ folder_path = '', limit = 50 }) {
    this.ensureInitialized();
    const res = await this.client.post('/files/list_folder', {
      path: folder_path || '', limit, include_media_info: false
    });

    return {
      files: (res.data.entries || []).map(f => ({
        id: f.id, name: f.name, type: f['.tag'],
        path: f.path_display, size: f.size,
        modified: f.server_modified
      })),
      total: res.data.entries?.length || 0,
      has_more: res.data.has_more
    };
  }

  async search_files({ query, file_type, limit = 20 }) {
    this.ensureInitialized();
    const body = { query, options: { max_results: limit } };
    if (file_type) body.options.file_extensions = [file_type.replace('.', '')];

    const res = await this.client.post('/files/search_v2', body);

    return {
      files: (res.data.matches || []).map(m => ({
        id: m.metadata?.metadata?.id, name: m.metadata?.metadata?.name,
        path: m.metadata?.metadata?.path_display,
        size: m.metadata?.metadata?.size, modified: m.metadata?.metadata?.server_modified
      })),
      total: res.data.matches?.length || 0
    };
  }

  async share_file({ file_id, share_with, permission = 'view', generate_link = false }) {
    this.ensureInitialized();
    if (generate_link) {
      const res = await this.client.post('/sharing/create_shared_link_with_settings', {
        path: file_id, settings: { requested_visibility: 'public' }
      }).catch(async () => {
        const links = await this.client.post('/sharing/list_shared_links', { path: file_id });
        return { data: links.data.links[0] };
      });
      return { shared: true, link: res.data.url };
    }

    const results = [];
    for (const email of (share_with || [])) {
      await this.client.post('/sharing/add_file_member', {
        file: file_id,
        members: [{ '.tag': 'email', email }],
        access_level: permission === 'edit' ? 'editor' : 'viewer'
      }).catch(() => {});
      results.push({ email, permission });
    }
    return { shared: true, permissions: results };
  }
}

module.exports = DropboxAdapter;
