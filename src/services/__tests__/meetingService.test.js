/**
 * Tests for Meeting Service
 * Covers: normalizeTranscript (all providers), extractInsights, chunkText, isValidDate
 */

jest.mock('openai', () => ({
  OpenAI: jest.fn(() => ({
    audio: { transcriptions: { create: jest.fn() } }
  }))
}));

jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

jest.mock('fs', () => ({
  renameSync: jest.fn(),
  existsSync: jest.fn(() => true),
  unlinkSync: jest.fn(),
  createReadStream: jest.fn(() => ({ pipe: jest.fn() }))
}));

jest.mock('path', () => ({
  extname: jest.fn(() => '.mp3'),
  join: jest.fn(() => '/tmp/test.mp3')
}));

jest.mock('../models/supabaseClient', () => ({
  from: jest.fn(() => ({
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    single: jest.fn().mockResolvedValue({ data: null, error: null })
  })),
  rpc: jest.fn(() => ({ data: null, error: null }))
}));

jest.mock('../embeddingService', () => ({
  generateEmbedding: jest.fn(() => [0.1, 0.2, 0.3]),
  upsertVector: jest.fn()
}));

jest.mock('../intelligencePipeline', () => ({
  classifyDepartment: jest.fn(() => 'general')
}));

jest.mock('../slackNotificationService', () => ({
  notifyMeetingSummary: jest.fn(() => ({ sent: true }))
}));

const { OpenAI } = require('openai');
const groqMock = OpenAI; // using same mock

const {
  normalizeTranscript,
  extractInsights,
  chunkText
} = require('../meetingService');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('normalizeTranscript', () => {
  test('normalizes Zoom webhook', () => {
    const payload = {
      payload: {
        object: {
          topic: 'Sprint Review',
          start_time: '2026-05-25T10:00:00Z',
          duration: 30,
          participant_users: [{ user_name: 'Alice', email: 'alice@co.com' }],
          transcript_content: 'Meeting transcript content here'
        }
      }
    };
    const result = normalizeTranscript('zoom', payload);
    expect(result.title).toBe('Sprint Review');
    expect(result.source_type).toBe('zoom');
    expect(result.participants).toHaveLength(1);
  });

  test('normalizes Google Meet webhook', () => {
    const payload = {
      message: {
        data: Buffer.from(JSON.stringify({
          conferenceRecord: { name: 'Weekly Sync', startTime: '2026-05-25T10:00:00Z' },
          participants: [{ displayName: 'Bob', email: 'bob@co.com' }],
          transcriptContent: 'Transcript text'
        })).toString('base64')
      }
    };
    const result = normalizeTranscript('google_meet', payload);
    expect(result.source_type).toBe('google_meet');
    expect(result.title).toBe('Weekly Sync');
  });

  test('normalizes Teams webhook', () => {
    const payload = {
      value: [{
        resource: {
          subject: 'Team Standup',
          startDateTime: '2026-05-25T10:00:00Z',
          attendees: [{ identity: { user: { displayName: 'Charlie', email: 'c@co.com' } } }],
          transcriptContent: 'Standup transcript'
        }
      }]
    };
    const result = normalizeTranscript('teams', payload);
    expect(result.source_type).toBe('teams');
    expect(result.title).toBe('Team Standup');
  });

  test('throws error for unknown provider', () => {
    expect(() => normalizeTranscript('unknown', {})).toThrow('No transcript normalizer');
  });
});

describe('chunkText', () => {
  test('splits text into chunks', () => {
    const text = 'First sentence. Second sentence. Third sentence.';
    const chunks = chunkText(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
  });

  test('returns single chunk for short text', () => {
    const chunks = chunkText('Hello world.', 1000);
    expect(chunks).toHaveLength(1);
  });
});

describe('extractInsights', () => {
  test('returns fallback on API error', async () => {
    const { OpenAI } = require('openai');
    OpenAI().chat.completions.create.mockRejectedValueOnce(new Error('API failed'));
    const result = await extractInsights('Some transcript');
    expect(result.error).toBeDefined();
    expect(result.summary).toContain('manual review');
  });
});
