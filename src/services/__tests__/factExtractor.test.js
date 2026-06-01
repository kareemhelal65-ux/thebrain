/**
 * Tests for Fact Extractor
 * Covers: extractFactsFallback, extractFactsFromExchange (with fallback)
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

jest.mock('../../models/supabaseClient', () => ({
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    insert: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null })
  }))
}));

const { OpenAI } = require('openai');
const mockCreate = OpenAI().chat.completions.create;

const { extractFactsFromExchange, saveFacts, getKeyFactsForUser, processTurn } = require('../factExtractor');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('extractFactsFromExchange - fallback (when LLM fails)', () => {
  test('extracts name from "I am" pattern', async () => {
    mockCreate.mockRejectedValueOnce(new Error('LLM down'));
    const facts = await extractFactsFromExchange('I am Alice Johnson', 'Nice to meet you');
    expect(facts.length).toBeGreaterThanOrEqual(1);
    expect(facts.some(f => f.fact.includes('Alice Johnson'))).toBe(true);
  });

  test('extracts company from "I work at" pattern', async () => {
    mockCreate.mockRejectedValueOnce(new Error('LLM down'));
    const facts = await extractFactsFromExchange('I work at Acme Corp', 'Great!');
    expect(facts.some(f => f.fact.includes('Acme Corp'))).toBe(true);
  });

  test('extracts preference from "I prefer" pattern', async () => {
    mockCreate.mockRejectedValueOnce(new Error('LLM down'));
    const facts = await extractFactsFromExchange('I prefer markdown responses', 'OK');
    expect(facts.some(f => f.fact.includes('prefers'))).toBe(true);
  });

  test('returns empty array for short messages', async () => {
    const facts = await extractFactsFromExchange('Hi', 'Hello');
    expect(facts).toEqual([]);
  });

  test('extracts deadline from "due" pattern', async () => {
    mockCreate.mockRejectedValueOnce(new Error('LLM down'));
    const facts = await extractFactsFromExchange('The report is due next Friday', 'Noted');
    expect(facts.some(f => f.fact.includes('Deadline'))).toBe(true);
  });
});

describe('extractFactsFromExchange - LLM path', () => {
  test('processes LLM response correctly', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            facts: [
              { fact: 'User prefers markdown tables.', category: 'preference', confidence: 0.85 }
            ]
          })
        }
      }]
    });
    const facts = await extractFactsFromExchange(
      'Make sure to format as markdown with tables',
      'Will do',
      [{ role: 'user', content: 'hi' }]
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].category).toBe('preference');
  });

  test('filters low confidence facts', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            facts: [
              { fact: 'Maybe user likes blue?', category: 'preference', confidence: 0.3 },
              { fact: 'User confirmed their name is Bob.', category: 'personal', confidence: 0.9 }
            ]
          })
        }
      }]
    });
    const facts = await extractFactsFromExchange('My name is Bob', 'Hi Bob');
    expect(facts).toHaveLength(1);
    expect(facts[0].fact).toContain('Bob');
  });

  test('handles empty facts response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({ facts: [] })
        }
      }]
    });
    const facts = await extractFactsFromExchange('How is the weather?', 'Sunny');
    expect(facts).toEqual([]);
  });
});

describe('saveFacts', () => {
  test('returns empty array when no facts provided', async () => {
    const result = await saveFacts([], 'tenant-1', 'user-1', 'session-1', 'msg');
    expect(result).toEqual([]);
  });
});

describe('getKeyFactsForUser', () => {
  test('returns empty array when query fails', async () => {
    const result = await getKeyFactsForUser('tenant-1', 'user-1');
    expect(result).toEqual([]);
  });
});

describe('processTurn', () => {
  test('returns empty array on error', async () => {
    const result = await processTurn({ userMessage: '', tenantId: 't1', userId: 'u1', sessionId: 's1' });
    expect(Array.isArray(result)).toBe(true);
  });
});
