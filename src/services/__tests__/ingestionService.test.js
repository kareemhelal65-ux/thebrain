/**
 * Tests for Ingestion Service
 * Covers: chunkText, isValidDate
 */

jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));
jest.mock('openai', () => ({
  OpenAI: jest.fn(() => ({
    chat: { completions: { create: jest.fn() } }
  }))
}));
jest.mock('../models/supabaseClient', () => ({
  from: jest.fn(() => ({
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    single: jest.fn().mockResolvedValue({ data: null, error: null })
  })),
  rpc: jest.fn(() => ({ data: [], error: null }))
}));
jest.mock('../embeddingService', () => ({
  generateEmbedding: jest.fn(() => [0.1, 0.2, 0.3])
}));
jest.mock('../api/notificationRoutes', () => ({
  emitNotification: jest.fn()
}));
jest.mock('../proactivityService', () => ({
  scanDocumentForAutomations: jest.fn(() => Promise.resolve([]))
}));

const { chunkText, isValidDate } = require('../ingestionService');

describe('chunkText', () => {
  test('splits long text into chunks', () => {
    const text = 'First sentence. Second sentence. Third sentence. Fourth. Fifth.';
    const chunks = chunkText(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
  });

  test('returns single chunk for short text', () => {
    const chunks = chunkText('Short text.', 1000);
    expect(chunks).toHaveLength(1);
  });

  test('preserves sentence boundaries', () => {
    const text = 'Sentence one. Sentence two. Sentence three.';
    const chunks = chunkText(text, 100);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    chunks.forEach(c => expect(c.length).toBeGreaterThan(0));
  });
});

describe('isValidDate', () => {
  test('accepts valid YYYY-MM-DD dates', () => {
    expect(isValidDate('2026-05-25')).toBe(true);
    expect(isValidDate('2024-01-01')).toBe(true);
  });

  test('rejects invalid date formats', () => {
    expect(isValidDate('')).toBe(false);
    expect(isValidDate('05-25-2026')).toBe(false);
    expect(isValidDate('2026/05/25')).toBe(false);
    expect(isValidDate('not-a-date')).toBe(false);
    expect(isValidDate(null)).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
  });
});
