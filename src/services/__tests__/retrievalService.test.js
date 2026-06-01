/**
 * Tests for Retrieval Service
 * Covers: buildExpandedQuery, simpleRerank, extractKeywords
 */

jest.mock('../models/supabaseClient', () => ({
  rpc: jest.fn(),
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

const {
  buildExpandedQuery,
  simpleRerank
} = require('../retrievalService');

describe('buildExpandedQuery', () => {
  test('returns message as-is when no history provided', () => {
    const result = buildExpandedQuery('hello world');
    expect(result).toBe('hello world');
  });

  test('returns message as-is when history is empty', () => {
    const result = buildExpandedQuery('hello world', []);
    expect(result).toBe('hello world');
  });

  test('returns message as-is when self-contained query is long', () => {
    const result = buildExpandedQuery('What is the revenue for Q3 2026?', [{ role: 'user', content: 'hi' }]);
    expect(result).toBe('What is the revenue for Q3 2026?');
  });

  test('expands vague query with last user message', () => {
    const history = [{ role: 'user', content: 'What about pricing?' }];
    const result = buildExpandedQuery('tell me more', history);
    expect(result).toContain('tell me more');
    expect(result).toContain('What about pricing');
  });

  test('combines short self-contained query with history keywords', () => {
    const history = [
      { role: 'assistant', content: 'Here is the report' },
      { role: 'user', content: 'Show me Q3 numbers' }
    ];
    const result = buildExpandedQuery('any updates', history);
    expect(result).toContain('any updates');
  });
});

describe('simpleRerank', () => {
  test('returns empty array for empty input', () => {
    expect(simpleRerank('test', [])).toEqual([]);
    expect(simpleRerank('test', null)).toEqual([]);
  });

  test('sorts documents by keyword overlap', () => {
    const docs = [
      'The quick brown fox',
      'revenue growth Q3 results',
      'marketing campaign launch'
    ];
    const result = simpleRerank('revenue Q3 growth', docs);
    expect(result[0]).toBe('revenue growth Q3 results');
  });

  test('preserves original order when scores are equal', () => {
    const docs = ['apple', 'banana', 'cherry'];
    const result = simpleRerank('xyz', docs);
    expect(result).toEqual(docs);
  });
});
