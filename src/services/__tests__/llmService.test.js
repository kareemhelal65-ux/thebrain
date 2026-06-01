/**
 * Tests for LLM Service
 * Covers: callLLMWithTools, getRecentSummaries
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
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: [], error: null })
  }))
}));

jest.mock('../embeddingService', () => ({
  similaritySearch: jest.fn(() => [])
}));

const { OpenAI } = require('openai');
const mockCreate = OpenAI().chat.completions.create;
const { callLLMWithTools, getRecentSummaries } = require('../llmService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('callLLMWithTools', () => {
  test('returns content and tool_calls from LLM response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: { content: 'Hello!', tool_calls: null },
        finish_reason: 'stop'
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    });
    const result = await callLLMWithTools([{ role: 'user', content: 'hi' }]);
    expect(result.content).toBe('Hello!');
    expect(result.tool_calls).toBeNull();
    expect(result.finish_reason).toBe('stop');
  });

  test('includes tool definitions in request when provided', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: { content: 'OK', tool_calls: null },
        finish_reason: 'stop'
      }],
      usage: {}
    });
    const tools = [{ name: 'test_tool' }];
    await callLLMWithTools([{ role: 'user', content: 'run tool' }], tools);
    const requestBody = mockCreate.mock.calls[0][0];
    expect(requestBody.tools).toEqual(tools);
    expect(requestBody.tool_choice).toBe('auto');
  });

  test('handles function calling arguments as string', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call1',
            type: 'function',
            function: { name: 'search', arguments: '{"q":"test"}' }
          }]
        },
        finish_reason: 'tool_calls'
      }],
      usage: {}
    });
    const result = await callLLMWithTools(
      [{ role: 'user', content: 'search' }],
      [{ name: 'search' }]
    );
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].function.name).toBe('search');
  });

  test('throws error on API failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API error'));
    await expect(callLLMWithTools([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('API error');
  });

  test('respects response_format option', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: { content: '{}', tool_calls: null },
        finish_reason: 'stop'
      }],
      usage: {}
    });
    const rf = { type: 'json_object' };
    await callLLMWithTools([{ role: 'user', content: 'json' }], [], { response_format: rf });
    expect(mockCreate.mock.calls[0][0].response_format).toEqual(rf);
  });
});

describe('getRecentSummaries', () => {
  test('returns empty string when no data', async () => {
    const result = await getRecentSummaries('company-1', 'session-1');
    expect(result).toBe('');
  });
});
