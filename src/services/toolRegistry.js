class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this._registerDefaultTools();
  }

  _registerDefaultTools() {
    this.tools.set('slack_post_message', {
      name: 'slack_post_message',
      description: 'Post a message to a Slack channel',
      parameters: {
        channel: 'string',
        message: 'string'
      },
      execute: async (args, credentials) => {
        if (!credentials?.slack) throw new Error('Slack not connected');
        // Simulate posting to Slack
        console.log(`[Tool: slack_post_message] Posted to ${args.channel}: ${args.message}`);
        return { success: true, messageId: 'msg_' + Date.now() };
      }
    });

    this.tools.set('google_calendar_create', {
      name: 'google_calendar_create',
      description: 'Create an event on Google Calendar',
      parameters: {
        title: 'string',
        time: 'string',
        attendees: 'array'
      },
      execute: async (args, credentials) => {
        if (!credentials?.['google workspace']) throw new Error('Google Workspace not connected');
        console.log(`[Tool: google_calendar_create] Event created: ${args.title} at ${args.time}`);
        return { success: true, eventId: 'evt_' + Date.now() };
      }
    });

    this.tools.set('google_drive_read', {
      name: 'google_drive_read',
      description: 'Read a file from Google Drive',
      parameters: {
        fileId: 'string'
      },
      execute: async (args, credentials) => {
        if (!credentials?.['google workspace']) throw new Error('Google Workspace not connected');
        console.log(`[Tool: google_drive_read] Read file: ${args.fileId}`);
        return { success: true, content: 'Simulated file content from Drive.' };
      }
    });
    this.tools.set('web_scrape_and_analyze', {
      name: 'web_scrape_and_analyze',
      description: 'Scrape through the internet and websites for research and analyzing',
      parameters: {
        url: 'string',
        query: 'string'
      },
      execute: async (args, credentials) => {
        console.log(`[Tool: web_scrape_and_analyze] Scraping URL: ${args.url} for ${args.query}`);
        return { success: true, analysis: `Simulated deep analysis of ${args.url} regarding ${args.query}` };
      }
    });

    this.tools.set('stripe_get_metrics', {
      name: 'stripe_get_metrics',
      description: 'Fetch MRR, Burn Rate, and revenue metrics from Stripe',
      parameters: {
        timeframe: 'string'
      },
      execute: async (args, credentials) => {
        console.log(`[Tool: stripe_get_metrics] Fetching financial metrics for ${args.timeframe}`);
        return { success: true, mrr: '$45,000', burnRate: '$12,000', runway: '18 months' };
      }
    });

    this.tools.set('carta_get_cap_table', {
      name: 'carta_get_cap_table',
      description: 'Retrieve equity dilution and cap table metrics from Carta',
      parameters: {},
      execute: async (args, credentials) => {
        console.log(`[Tool: carta_get_cap_table] Fetching Cap Table`);
        return { success: true, totalShares: '10,000,000', employeePool: '15%' };
      }
    });

    this.tools.set('jira_create_ticket', {
      name: 'jira_create_ticket',
      description: 'Create a new issue/ticket in Jira for engineering roadmap',
      parameters: {
        title: 'string',
        description: 'string',
        type: 'string'
      },
      execute: async (args, credentials) => {
        console.log(`[Tool: jira_create_ticket] Created ${args.type}: ${args.title}`);
        return { success: true, ticketId: 'PROJ-' + Math.floor(Math.random() * 1000) };
      }
    });

    this.tools.set('hubspot_create_contact', {
      name: 'hubspot_create_contact',
      description: 'Add a new lead or investor contact into HubSpot CRM',
      parameters: {
        name: 'string',
        email: 'string',
        company: 'string'
      },
      execute: async (args, credentials) => {
        console.log(`[Tool: hubspot_create_contact] Added contact: ${args.name} (${args.email})`);
        return { success: true, contactId: 'hs_' + Date.now() };
      }
    });

    this.tools.set('seo_analyze_keywords', {
      name: 'seo_analyze_keywords',
      description: 'Perform an SEO audit and keyword analysis',
      parameters: {
        domain: 'string',
        targetKeyword: 'string'
      },
      execute: async (args, credentials) => {
        console.log(`[Tool: seo_analyze_keywords] Analyzing ${args.domain} for ${args.targetKeyword}`);
        return { success: true, score: 78, suggestions: ['Add meta descriptions', 'Improve H1 density'] };
      }
    });
  }

  getAvailableTools() {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters
    }));
  }

  async executeTool(toolName, args, credentials) {
    const tool = this.tools.get(toolName);
    if (!tool) throw new Error(`Tool ${toolName} not found`);
    return await tool.execute(args, credentials);
  }
}

module.exports = new ToolRegistry();
