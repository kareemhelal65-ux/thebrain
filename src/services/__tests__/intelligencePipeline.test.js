/**
 * Tests for Intelligence Pipeline
 * Covers: classifyDepartment, extractEntities
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

const { OpenAI } = require('openai');
const mockCreate = OpenAI().chat.completions.create;
const { classifyDepartment, extractEntities } = require('../intelligencePipeline');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('classifyDepartment', () => {
  test('classifies product-related text as product', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Product' } }]
    });
    const dept = await classifyDepartment('We are building a new feature for our platform');
    expect(dept).toBe('product');
  });

  test('classifies finance text as finance', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Finance' } }]
    });
    const dept = await classifyDepartment('Quarterly revenue report shows 20% growth');
    expect(dept).toBe('finance');
  });

  test('falls back to general on invalid department', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Engineering' } }]
    });
    const dept = await classifyDepartment('Some technical discussion');
    expect(dept).toBe('general');
  });

  test('falls back to general on API error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API down'));
    const dept = await classifyDepartment('Some text');
    expect(dept).toBe('general');
  });
});

describe('extractEntities', () => {
  test('extracts entities from text', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{
        message: {
          content: JSON.stringify({
            people: ['Alice'],
            decisions: [{ decision: 'Go to market', decider: 'Alice', alternatives_rejected: ['Wait'], rationale: 'Timing', outcome: 'Launch Q3' }],
            action_items: [{ task: 'Prepare launch', assignee: 'Bob', deadline: '2026-06-01', priority: 'high', department: 'product' }],
            topics: ['launch'],
            projects: ['Project X']
          })
        }
      }]
    });
    const entities = await extractEntities('Alice decided to go to market. Bob will prepare launch.');
    expect(entities.people).toContain('Alice');
    expect(entities.decisions).toHaveLength(1);
    expect(entities.action_items).toHaveLength(1);
    expect(entities.topics).toContain('launch');
    expect(entities.projects).toContain('Project X');
  });

  test('returns empty arrays on API error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API error'));
    const entities = await extractEntities('Some text');
    expect(entities).toEqual({
      people: [], decisions: [], action_items: [], topics: [], projects: []
    });
  });
});
