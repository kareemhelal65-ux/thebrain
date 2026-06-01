const StorageAdapter = require('./StorageAdapter');
const axios = require('axios');

/**
 * OneDriveAdapter — Concrete Storage implementation using Microsoft Graph API.
 * Uses OAuth2 bearer token. Accesses OneDrive for Business via Graph.
 */
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

class OneDriveAdapter extends StorageAdapter {
  constructor(credentials, config = {}) {
    super('onedrive', credentials, config);
    this.client = null;
  }

  validateConfig() {
    if (!this.credentials.access_token) {
      throw new Error('OneDrive adapter missing required credential: access_token');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    this.client = axios.create({
      baseURL: GRAPH_BASE,
      headers: { 'Authorization': `Bearer ${this.credentials.access_token}`, 'Content-Type': 'application/json' }
    });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      const res = await this.client.get('/me');
      return { healthy: true, message: `OneDrive connected as ${res.data.displayName}` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async upload_file({ file_name, folder_path = '/', content_type }) {
    this.ensureInitialized();
    const path = folder_path === '/' ? file_name : `${folder_path}/${file_name}`;
    return {
      upload_url: `${GRAPH_BASE}/me/drive/root:/${path}:/content`,
      method: 'PUT',
      headers_required: { 'Content-Type': content_type || 'application/octet-stream' },
      note: 'PUT file content directly to the upload_url.'
    };
  }

  async download_file({ file_id, file_path }) {
    this.ensureInitialized();
    let meta;
    if (file_id) {
      meta = await this.client.get(`/me/drive/items/${file_id}`);
    } else {
      meta = await this.client.get(`/me/drive/root:/${file_path}`);
    }
    return {
      id: meta.data.id, name: meta.data.name, size: meta.data.size,
      modified: meta.data.lastModifiedDateTime,
      download_url: meta.data['@microsoft.graph.downloadUrl'],
      web_url: meta.data.webUrl
    };
  }

  async list_files({ folder_path = '/', limit = 50 }) {
    this.ensureInitialized();
    let url;
    if (folder_path === '/') {
      url = `/me/drive/root/children?$top=${limit}`;
    } else {
      url = `/me/drive/root:/${folder_path}:/children?$top=${limit}`;
    }

    const res = await this.client.get(url);
    return {
      files: (res.data.value || []).map(f => ({
        id: f.id, name: f.name,
        type: f.folder ? 'folder' : (f.file?.mimeType || 'file'),
        size: f.size, modified: f.lastModifiedDateTime, url: f.webUrl
      })),
      total: res.data.value?.length || 0
    };
  }

  async search_files({ query, file_type, limit = 20 }) {
    this.ensureInitialized();
    const res = await this.client.get(`/me/drive/root/search(q='${query}')?$top=${limit}`);

    let files = (res.data.value || []).map(f => ({
      id: f.id, name: f.name,
      type: f.file?.mimeType || 'folder',
      size: f.size, modified: f.lastModifiedDateTime, url: f.webUrl,
      path: f.parentReference?.path
    }));

    if (file_type) {
      files = files.filter(f => f.name.endsWith(file_type) || f.type.includes(file_type));
    }

    return { files, total: files.length };
  }

  async share_file({ file_id, share_with, permission = 'view', generate_link = false }) {
    this.ensureInitialized();
    if (generate_link) {
      const res = await this.client.post(`/me/drive/items/${file_id}/createLink`, {
        type: permission === 'edit' ? 'edit' : 'view', scope: 'anonymous'
      });
      return { shared: true, link: res.data.link.webUrl };
    }

    const results = [];
    for (const email of (share_with || [])) {
      await this.client.post(`/me/drive/items/${file_id}/invite`, {
        recipients: [{ email }],
        roles: [permission === 'edit' ? 'write' : 'read'],
        requireSignIn: true, sendInvitation: true
      }).catch(() => {});
      results.push({ email, permission });
    }
    return { shared: true, permissions: results };
  }
}

module.exports = OneDriveAdapter;
