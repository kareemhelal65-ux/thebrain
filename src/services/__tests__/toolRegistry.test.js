/**
 * Tests for ToolRegistry
 *
 * Covers:
 * - Default tool registration
 * - getAvailableTools returns all tools with correct shape
 * - executeTool calls the correct tool with args
 * - executeTool throws on unknown tool
 */

const toolRegistry = require('../toolRegistry');

describe('ToolRegistry', () => {
  describe('getAvailableTools', () => {
    test('returns an array of tools', () => {
      const tools = toolRegistry.getAvailableTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    test('each tool has name, description, and parameters', () => {
      const tools = toolRegistry.getAvailableTools();
      for (const tool of tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('parameters');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(typeof tool.parameters).toBe('object');
      }
    });

    test('includes expected default tools', () => {
      const tools = toolRegistry.getAvailableTools();
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('slack_post_message');
      expect(toolNames).toContain('google_calendar_create');
      expect(toolNames).toContain('google_drive_read');
      expect(toolNames).toContain('web_scrape_and_analyze');
      expect(toolNames).toContain('stripe_get_metrics');
      expect(toolNames).toContain('carta_get_cap_table');
      expect(toolNames).toContain('jira_create_ticket');
      expect(toolNames).toContain('hubspot_create_contact');
      expect(toolNames).toContain('seo_analyze_keywords');
    });
  });

  describe('executeTool', () => {
    test('throws when Slack not connected for slack_post_message', async () => {
      await expect(
        toolRegistry.executeTool('slack_post_message', { channel: '#general', message: 'hi' }, {})
      ).rejects.toThrow('Slack not connected');
    });

    test('executes slack_post_message with credentials', async () => {
      const result = await toolRegistry.executeTool(
        'slack_post_message',
        { channel: '#general', message: 'Hello' },
        { slack: { token: 'xoxb-123' } }
      );
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('messageId');
    });

    test('throws when Google Workspace not connected for google_calendar_create', async () => {
      await expect(
        toolRegistry.executeTool('google_calendar_create', { title: 'Meeting' }, {})
      ).rejects.toThrow('Google Workspace not connected');
    });

    test('executes google_calendar_create with credentials', async () => {
      const result = await toolRegistry.executeTool(
        'google_calendar_create',
        { title: 'Sprint Review', time: '10:00', attendees: [] },
        { 'google workspace': { token: 'ya29.mock' } }
      );
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('eventId');
    });

    test('executes google_drive_read with credentials', async () => {
      const result = await toolRegistry.executeTool(
        'google_drive_read',
        { fileId: 'abc123' },
        { 'google workspace': { token: 'ya29.mock' } }
      );
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('content');
    });

    test('executes web_scrape_and_analyze', async () => {
      const result = await toolRegistry.executeTool(
        'web_scrape_and_analyze',
        { url: 'https://example.com', query: 'pricing' },
        {}
      );
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('analysis');
    });

    test('executes stripe_get_metrics', async () => {
      const result = await toolRegistry.executeTool(
        'stripe_get_metrics',
        { timeframe: 'Q3' },
        {}
      );
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('mrr');
      expect(result).toHaveProperty('burnRate');
      expect(result).toHaveProperty('runway');
    });

    test('executes carta_get_cap_table', async () => {
      const result = await toolRegistry.executeTool('carta_get_cap_table', {}, {});
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('totalShares');
      expect(result).toHaveProperty('employeePool');
    });

    test('executes jira_create_ticket', async () => {
      const result = await toolRegistry.executeTool(
        'jira_create_ticket',
        { title: 'Bug fix', description: 'Fix login', type: 'Bug' },
        {}
      );
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('ticketId');
    });

    test('executes hubspot_create_contact', async () => {
      const result = await toolRegistry.executeTool(
        'hubspot_create_contact',
        { name: 'John Doe', email: 'john@test.com', company: 'Acme' },
        {}
      );
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('contactId');
    });

    test('executes seo_analyze_keywords', async () => {
      const result = await toolRegistry.executeTool(
        'seo_analyze_keywords',
        { domain: 'example.com', targetKeyword: 'AI tools' },
        {}
      );
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('suggestions');
    });

    test('throws on unknown tool', async () => {
      await expect(
        toolRegistry.executeTool('non_existent_tool', {}, {})
      ).rejects.toThrow('Tool non_existent_tool not found');
    });
  });
});
