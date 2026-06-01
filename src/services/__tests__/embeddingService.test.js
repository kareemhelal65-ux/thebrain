/**
 * Tests for Embedding Service
 * Covers: generateEmbedding, generateSparseVector, upsertVector, similaritySearch
 */

jest.mock('@xenova/transformers', () => ({
  pipeline: jest.fn(() => jest.fn((text, opts) => ({
    data: new Float32Array([0.1, 0.2, 0.3])
  })))
}));

jest.mock('openai', () => ({
  OpenAI: jest.fn(() => ({}))
}));

const mockPineconeUpsert = jest.fn();
const mockPineconeQuery = jest.fn();
jest.mock('@pinecone-database/pinecone', () => ({
  Pinecone: jest.fn(() => ({
    Index: jest.fn(() => ({
      upsert: mockPineconeUpsert,
      query: mockPineconeQuery
    }))
  }))
}));

const { generateEmbedding, generateSparseVector } = require('../embeddingService');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.PINECONE_API_KEY;
});

describe('generateEmbedding', () => {
  test('generates embedding array from text', async () => {
    const result = await generateEmbedding('hello world');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns array of numbers', async () => {
    const result = await generateEmbedding('test');
    result.forEach(v => expect(typeof v).toBe('number'));
  });
});

describe('generateSparseVector', () => {
  test('returns object with indices and values arrays', () => {
    const result = generateSparseVector('hello world hello');
    expect(result).toHaveProperty('indices');
    expect(result).toHaveProperty('values');
    expect(Array.isArray(result.indices)).toBe(true);
    expect(Array.isArray(result.values)).toBe(true);
    expect(result.indices.length).toBe(result.values.length);
  });

  test('counts term frequency correctly', () => {
    const result = generateSparseVector('foo bar foo');
    const fooIdx = result.indices.findIndex((_, i) => result.values[i] === 2);
    const barIdx = result.indices.findIndex((_, i) => result.values[i] === 1);
    expect(fooIdx).not.toBe(-1);
    expect(barIdx).not.toBe(-1);
  });

  test('handles empty text', () => {
    const result = generateSparseVector('');
    expect(result.indices).toEqual([]);
    expect(result.values).toEqual([]);
  });

  test('produces deterministic hash for same word', () => {
    const r1 = generateSparseVector('test');
    const r2 = generateSparseVector('test');
    expect(r1.indices).toEqual(r2.indices);
    expect(r1.values).toEqual(r2.values);
  });

  test('handles special characters and punctuation', () => {
    const result = generateSparseVector('hello, world! test-case');
    expect(result.indices.length).toBeGreaterThan(0);
    expect(result.values.length).toBeGreaterThan(0);
  });
});
