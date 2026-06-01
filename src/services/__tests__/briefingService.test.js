/**
 * Tests for Briefing Service
 */

jest.mock('openai', () => ({
  OpenAI: jest.fn(() => ({
    chat: {
      completions: {
        create: jest.fn()
      }
    }
  }))
}));

jest.mock('../models/supabaseClient', () => ({
  rpc: jest.fn(() => ({ data: null, error: { message: 'no data' } })),
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: [], error: null })
  }))
}));

jest.mock('../embeddingService', () => ({
  generateEmbedding: jest.fn(() => [0.1, 0.2, 0.3])
}));

jest.mock('../slackNotificationService', () => ({
  notifyText: jest.fn(() => ({ sent: true }))
}));

const { OpenAI } = require('openai');
const mockCreate = OpenAI().chat.completions.create;
const { generatePreMeetingBriefing } = require('../briefingService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('generatePreMeetingBriefing', () => {
  test('generates briefing successfully', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '**Briefing**: Review Q3 targets and progress.' } }]
    });
    const result = await generatePreMeetingBriefing(
      'tenant-1',
      'Q3 Review',
      [{ name: 'Alice' }, { name: 'Bob' }]
    );
    expect(result.success).toBe(true);
    expect(result.briefing).toContain('Briefing');
  });

  test('handles LLM error gracefully', async () => {
    mockCreate.mockRejectedValueOnce(new Error('LLM failed'));
    const result = await generatePreMeetingBriefing(
      'tenant-1',
      'Standup',
      [{ name: 'Alice' }]
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
