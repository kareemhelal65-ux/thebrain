const StorageAdapter = require('./StorageAdapter');
const { google } = require('googleapis');

/**
 * GoogleDriveAdapter — Concrete Storage implementation using Google Drive API v3.
 * Uses Service Account with domain-wide delegation (same pattern as Gmail).
 */
class GoogleDriveAdapter extends StorageAdapter {
  constructor(credentials, config = {}) {
    super('google_drive', credentials, config);
    this.drive = null;
  }

  validateConfig() {
    if (!this.credentials.client_email || !this.credentials.private_key) {
      throw new Error('Google Drive adapter missing required credentials: client_email, private_key');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();
    const delegatedUser = this.config.delegated_user || this.credentials.delegated_user;

    const auth = new google.auth.JWT({
      email: this.credentials.client_email,
      key: this.credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/drive'],
      subject: delegatedUser
    });

    this.drive = google.drive({ version: 'v3', auth });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      const res = await this.drive.about.get({ fields: 'user' });
      return { healthy: true, message: `Google Drive connected as ${res.data.user.emailAddress}` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  async upload_file({ file_name, folder_path, content_type }) {
    this.ensureInitialized();
    const metadata = { name: file_name };
    if (folder_path && folder_path !== '/') {
      // Find or create folder
      const folderId = await this._resolveFolderId(folder_path);
      if (folderId) metadata.parents = [folderId];
    }
    // Note: actual file content would be streamed in a real upload
    const res = await this.drive.files.create({
      requestBody: metadata,
      fields: 'id, name, webViewLink, mimeType'
    });
    return { id: res.data.id, name: res.data.name, url: res.data.webViewLink };
  }

  async download_file({ file_id, file_path }) {
    this.ensureInitialized();
    const id = file_id || await this._findFileByPath(file_path);
    const meta = await this.drive.files.get({ fileId: id, fields: 'name, mimeType, webContentLink' });
    return {
      id, name: meta.data.name, mime_type: meta.data.mimeType,
      download_url: meta.data.webContentLink,
      note: 'Use download_url to fetch the file content.'
    };
  }

  async list_files({ folder_path = '/', limit = 50 }) {
    this.ensureInitialized();
    let q = 'trashed = false';
    if (folder_path !== '/') {
      const folderId = await this._resolveFolderId(folder_path);
      if (folderId) q += ` and '${folderId}' in parents`;
    }

    const res = await this.drive.files.list({
      q, pageSize: limit, fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink)',
      orderBy: 'modifiedTime desc'
    });

    return {
      files: (res.data.files || []).map(f => ({
        id: f.id, name: f.name, type: f.mimeType,
        size: f.size, modified: f.modifiedTime, url: f.webViewLink
      })),
      total: res.data.files?.length || 0
    };
  }

  async search_files({ query, file_type, limit = 20 }) {
    this.ensureInitialized();
    let q = `fullText contains '${query}' and trashed = false`;
    if (file_type) q += ` and mimeType contains '${file_type}'`;

    const res = await this.drive.files.list({
      q, pageSize: limit, fields: 'files(id, name, mimeType, size, modifiedTime, webViewLink)'
    });

    return {
      files: (res.data.files || []).map(f => ({
        id: f.id, name: f.name, type: f.mimeType,
        size: f.size, modified: f.modifiedTime, url: f.webViewLink
      })),
      total: res.data.files?.length || 0
    };
  }

  async share_file({ file_id, share_with, permission = 'view', generate_link = false }) {
    this.ensureInitialized();
    const role = permission === 'edit' ? 'writer' : 'reader';

    if (generate_link) {
      await this.drive.permissions.create({
        fileId: file_id,
        requestBody: { type: 'anyone', role }
      });
      const file = await this.drive.files.get({ fileId: file_id, fields: 'webViewLink' });
      return { shared: true, link: file.data.webViewLink };
    }

    const results = [];
    for (const email of (share_with || [])) {
      await this.drive.permissions.create({
        fileId: file_id,
        requestBody: { type: 'user', role, emailAddress: email },
        sendNotificationEmail: true
      });
      results.push({ email, role });
    }
    return { shared: true, permissions: results };
  }

  async _resolveFolderId(folderPath) {
    const parts = folderPath.split('/').filter(Boolean);
    let parentId = 'root';
    for (const name of parts) {
      const res = await this.drive.files.list({
        q: `name = '${name}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id)'
      });
      if (res.data.files.length === 0) return null;
      parentId = res.data.files[0].id;
    }
    return parentId;
  }

  async _findFileByPath(filePath) {
    const parts = filePath.split('/').filter(Boolean);
    const fileName = parts.pop();
    let parentId = 'root';
    for (const name of parts) {
      const res = await this.drive.files.list({
        q: `name = '${name}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
        fields: 'files(id)'
      });
      if (res.data.files.length === 0) return null;
      parentId = res.data.files[0].id;
    }
    const res = await this.drive.files.list({
      q: `name = '${fileName}' and '${parentId}' in parents`,
      fields: 'files(id)'
    });
    return res.data.files[0]?.id || null;
  }
}

module.exports = GoogleDriveAdapter;
