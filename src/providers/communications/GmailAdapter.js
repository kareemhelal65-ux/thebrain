const CommsAdapter = require('./CommsAdapter');
const { google } = require('googleapis');

/**
 * GmailAdapter — Concrete implementation of the Communications interface.
 * 
 * Uses Google Service Account authentication for zero-friction org-level access.
 * The client's IT admin approves the AIOS once at the Google Workspace level,
 * granting backend access to the entire company domain.
 */
class GmailAdapter extends CommsAdapter {
  constructor(credentials, config = {}) {
    super('gmail', credentials, config);
    this.gmail = null;
    this.auth = null;
    // The user email to impersonate (domain admin sets this)
    this.delegatedUser = config.delegated_user || credentials.delegated_user;
  }

  validateConfig() {
    const required = ['client_email', 'private_key'];
    for (const field of required) {
      if (!this.credentials[field]) {
        throw new Error(`Gmail adapter missing required credential: ${field}`);
      }
    }
    if (!this.delegatedUser) {
      throw new Error('Gmail adapter missing delegated_user in config or credentials.');
    }
    return true;
  }

  async initialize() {
    this.validateConfig();

    // Create JWT auth with domain-wide delegation
    this.auth = new google.auth.JWT({
      email: this.credentials.client_email,
      key: this.credentials.private_key,
      scopes: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events'
      ],
      subject: this.delegatedUser
    });

    this.gmail = google.gmail({ version: 'v1', auth: this.auth });
    this.calendar = google.calendar({ version: 'v3', auth: this.auth });
    this.initialized = true;
  }

  async healthCheck() {
    try {
      this.ensureInitialized();
      const profile = await this.gmail.users.getProfile({ userId: 'me' });
      return { healthy: true, message: `Connected as ${profile.data.emailAddress}` };
    } catch (error) {
      return { healthy: false, message: error.message };
    }
  }

  /**
   * Compose and send an email.
   */
  async send_email({ to, subject, body, cc, bcc }) {
    this.ensureInitialized();

    const headers = [
      `To: ${Array.isArray(to) ? to.join(', ') : to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0'
    ];

    if (cc) headers.push(`Cc: ${Array.isArray(cc) ? cc.join(', ') : cc}`);
    if (bcc) headers.push(`Bcc: ${Array.isArray(bcc) ? bcc.join(', ') : bcc}`);

    const raw = Buffer.from(
      headers.join('\r\n') + '\r\n\r\n' + body
    ).toString('base64url');

    const result = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw }
    });

    return {
      success: true,
      message_id: result.data.id,
      thread_id: result.data.threadId
    };
  }

  /**
   * Retrieve recent emails from inbox.
   */
  async read_inbox({ limit = 10, unread_only = false, from_filter }) {
    this.ensureInitialized();

    let q = 'in:inbox';
    if (unread_only) q += ' is:unread';
    if (from_filter) q += ` from:${from_filter}`;

    const list = await this.gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: limit
    });

    if (!list.data.messages || list.data.messages.length === 0) {
      return { emails: [], total: 0 };
    }

    const emails = [];
    for (const msg of list.data.messages) {
      const full = await this.gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date']
      });

      const headers = {};
      for (const h of full.data.payload.headers) {
        headers[h.name.toLowerCase()] = h.value;
      }

      emails.push({
        id: msg.id,
        thread_id: full.data.threadId,
        from: headers.from,
        to: headers.to,
        subject: headers.subject,
        date: headers.date,
        snippet: full.data.snippet,
        unread: full.data.labelIds?.includes('UNREAD') || false
      });
    }

    return { emails, total: list.data.resultSizeEstimate };
  }

  /**
   * Search emails by query.
   */
  async search_emails({ query, date_from, date_to, limit = 20 }) {
    this.ensureInitialized();

    let q = query;
    if (date_from) q += ` after:${date_from}`;
    if (date_to) q += ` before:${date_to}`;

    const list = await this.gmail.users.messages.list({
      userId: 'me',
      q,
      maxResults: limit
    });

    if (!list.data.messages) return { results: [], total: 0 };

    const results = [];
    for (const msg of list.data.messages) {
      const full = await this.gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date']
      });

      const headers = {};
      for (const h of full.data.payload.headers) {
        headers[h.name.toLowerCase()] = h.value;
      }

      results.push({
        id: msg.id,
        from: headers.from,
        subject: headers.subject,
        date: headers.date,
        snippet: full.data.snippet
      });
    }

    return { results, total: list.data.resultSizeEstimate };
  }

  /**
   * Send a message (maps to email for Gmail — future Slack adapter would handle channels).
   */
  async send_message({ channel, message }) {
    // For Gmail, 'channel' is treated as a recipient email
    return await this.send_email({
      to: [channel],
      subject: 'Message from The Brain AIOS',
      body: message
    });
  }

  /**
   * List available labels as "channels" for Gmail.
   */
  async list_channels({ type = 'all' } = {}) {
    this.ensureInitialized();

    const result = await this.gmail.users.labels.list({ userId: 'me' });
    const labels = result.data.labels || [];

    return {
      channels: labels.map(l => ({
        id: l.id,
        name: l.name,
        type: l.type
      }))
    };
  }

  // ─── Google Calendar (this adapter doubles as the Google Workspace adapter) ───

  /**
   * Create a calendar event / meeting invite. Matches the create_calendar_event tool schema.
   */
  async create_calendar_event({ title, start_time, end_time, attendees, location, description, recurrence, video_conference, timezone }) {
    this.ensureInitialized();

    const tz = timezone || 'UTC';
    const event = {
      summary: title,
      description: description || '',
      start: { dateTime: new Date(start_time).toISOString(), timeZone: tz },
      end: { dateTime: new Date(end_time).toISOString(), timeZone: tz },
    };
    if (location) event.location = location;
    if (Array.isArray(attendees) && attendees.length > 0) {
      event.attendees = attendees.map(email => ({ email }));
    }
    if (recurrence && recurrence !== 'none') {
      const freqMap = { daily: 'DAILY', weekly: 'WEEKLY', biweekly: 'WEEKLY', monthly: 'MONTHLY' };
      const freq = freqMap[recurrence] || 'WEEKLY';
      const rule = recurrence === 'biweekly' ? `RRULE:FREQ=${freq};INTERVAL=2` : `RRULE:FREQ=${freq}`;
      event.recurrence = [rule];
    }

    const requestBody = { ...event };
    const params = { calendarId: 'primary', requestBody, sendUpdates: 'all' };

    if (video_conference) {
      requestBody.conferenceData = {
        createRequest: { requestId: `brain-${Date.now()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
      };
      params.conferenceDataVersion = 1;
    }

    const res = await this.calendar.events.insert(params);
    return {
      success: true,
      event_id: res.data.id,
      html_link: res.data.htmlLink,
      hangout_link: res.data.hangoutLink || null,
      status: res.data.status,
    };
  }

  /**
   * Find free slots for attendees within a date range. Matches check_availability tool schema.
   */
  async check_availability({ attendees, date_range_start, date_range_end, duration_minutes = 30, timezone }) {
    this.ensureInitialized();

    const tz = timezone || 'UTC';
    const timeMin = new Date(date_range_start).toISOString();
    const timeMax = new Date(date_range_end).toISOString();
    const items = (Array.isArray(attendees) && attendees.length > 0)
      ? attendees.map(email => ({ id: email }))
      : [{ id: 'primary' }];

    const res = await this.calendar.freebusy.query({
      requestBody: { timeMin, timeMax, timeZone: tz, items },
    });

    const calendars = res.data.calendars || {};
    // Merge all busy intervals
    const busy = [];
    for (const cal of Object.values(calendars)) {
      for (const b of (cal.busy || [])) busy.push({ start: new Date(b.start), end: new Date(b.end) });
    }
    busy.sort((a, b) => a.start - b.start);

    // Walk the range finding gaps >= duration
    const slots = [];
    const durMs = duration_minutes * 60 * 1000;
    let cursor = new Date(timeMin);
    const rangeEnd = new Date(timeMax);
    for (const b of busy) {
      if (b.start - cursor >= durMs) {
        slots.push({ start: cursor.toISOString(), end: new Date(cursor.getTime() + durMs).toISOString() });
      }
      if (b.end > cursor) cursor = b.end;
    }
    if (rangeEnd - cursor >= durMs) {
      slots.push({ start: cursor.toISOString(), end: new Date(cursor.getTime() + durMs).toISOString() });
    }

    return { available_slots: slots.slice(0, 10), busy_intervals: busy.map(b => ({ start: b.start.toISOString(), end: b.end.toISOString() })) };
  }

  /**
   * List upcoming calendar events within the next `days` days.
   */
  async list_calendar_events({ days = 7, max_results = 20 } = {}) {
    this.ensureInitialized();

    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const res = await this.calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: max_results,
    });

    return {
      events: (res.data.items || []).map(e => ({
        id: e.id,
        title: e.summary,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        attendees: (e.attendees || []).map(a => a.email),
        location: e.location || null,
        link: e.htmlLink,
      })),
    };
  }
}

module.exports = GmailAdapter;
