/**
 * Tests for Ingestion Gateway
 */

jest.mock('openai', () => ({
  OpenAI: jest.fn(() => ({
    chat: { completions: { create: jest.fn() } },
    audio: { translations: { create: jest.fn() } }
  }))
}));

jest.mock('languagedetect', () => {
  return jest.fn(() => ({
    detect: jest.fn(() => [['english', 0.9]])
  }));
});

jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  existsSync: jest.fn(() => true),
  unlinkSync: jest.fn(),
  createReadStream: jest.fn(() => ({ pipe: jest.fn() }))
}));

jest.mock('path', () => ({
  join: jest.fn(() => '/tmp/test')
}));

jest.mock('os', () => ({
  tmpdir: jest.fn(() => '/tmp')
}));

jest.mock('../embeddingService', () => ({
  generateEmbedding: jest.fn(() => [0.1, 0.2, 0.3]),
  generateSparseVector: jest.fn(() => ({ indices: [1, 2], values: [1, 1] })),
  upsertVector: jest.fn()
}));

jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

const { processIncomingData } = require('../ingestionGateway');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('processIncomingData', () => {
  test('rejects missing company_id in metadata', async () => {
    await expect(processIncomingData(
      Buffer.from('test'),
      'text/plain',
      { source_type: 'slack' }
    )).rejects.toThrow('SECURITY VIOLATION');
  });

  test('rejects missing source_type in metadata', async () => {
    await expect(processIncomingData(
      Buffer.from('test'),
      'text/plain',
      { company_id: 'c-1' }
    )).rejects.toThrow('SECURITY VIOLATION');
  });

  test('throws error for unsupported MIME type', async () => {
    await expect(processIncomingData(
      Buffer.from('test'),
      'application/unsupported',
      { company_id: 'c-1', source_type: 'test' }
    )).rejects.toThrow('Unsupported MIME type');
  });

  test('processes plain text when metadata is valid', async () => {
    const result = await processIncomingData(
      Buffer.from('Hello world'),
      'text/plain',
      { company_id: 'c-1', source_type: 'slack' }
    );
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('englishText');
    expect(result.sourceLanguage).toBe('english');
  });
});
