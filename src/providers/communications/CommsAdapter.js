const BaseAdapter = require('../BaseAdapter');

/**
 * CommsAdapter — Standard interface for all communication providers.
 * Concrete implementations: GmailAdapter, OutlookAdapter, SlackAdapter, etc.
 */
class CommsAdapter extends BaseAdapter {
  constructor(providerName, credentials, config) {
    super(providerName, 'communications', credentials, config);
  }

  async send_email(params) {
    throw new Error(`${this.providerName}: send_email() not implemented.`);
  }

  async read_inbox(params) {
    throw new Error(`${this.providerName}: read_inbox() not implemented.`);
  }

  async search_emails(params) {
    throw new Error(`${this.providerName}: search_emails() not implemented.`);
  }

  async send_message(params) {
    throw new Error(`${this.providerName}: send_message() not implemented.`);
  }

  async list_channels(params) {
    throw new Error(`${this.providerName}: list_channels() not implemented.`);
  }
}

module.exports = CommsAdapter;
