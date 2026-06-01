/**
 * Tests for Semantic Router
 * Covers: extractKeywords, getRelevantTools, matchByKeywords
 * Mocks: @xenova/transformers, errorTracker
 */

const mockCosSim = jest.fn();

jest.mock('@xenova/transformers', () => ({
  pipeline: jest.fn(() => jest.fn((text, opts) => ({
    tolist: () => [[0.1, 0.2, 0.3]]
  }))),
  cos_sim: (...args) => mockCosSim(...args)
}));

jest.mock('../errorTracker', () => ({
  captureException: jest.fn()
}));

const { getRelevantTools, initRouter } = require('../semanticRouter');

const mockTools = [
  { name: 'document_create', category: 'storage' },
  { name: 'slack_post', category: 'communications' },
  { name: 'web_search', category: 'research' },
  { name: 'calendar_create', category: 'project-management' },
  { name: 'send_email', category: 'communications' },
  { name: 'run_payroll', category: 'finance' },
  { name: 'employee_search', category: 'hr' },
  { name: 'order_process', category: 'commerce' },
  { name: 'create_invoice', category: 'finance' },
  { name: 'meeting_find', category: 'project-management' }
];

beforeEach(() => {
  jest.clearAllMocks();
  mockCosSim.mockReset();
});

describe('getRelevantTools', () => {
  test('returns essential fallback when no route matches confidently', async () => {
    mockCosSim.mockReturnValue(0.1); // Very low scores = fallback
    const tools = await getRelevantTools('hello how are you', mockTools);
    const categories = tools.map(t => t.category);
    expect(categories).toContain('storage');
    expect(categories).toContain('communications');
    expect(categories).toContain('research');
  });

  test('returns route-specific tools on high confidence match', async () => {
    // Make DocumentRoute win with high score
    mockCosSim.mockImplementation((a, b) => {
      return 0.85; // Above HIGH_CONFIDENCE_THRESHOLD
    });
    const tools = await getRelevantTools('create a document', mockTools);
    expect(tools.length).toBeGreaterThan(0);
  });

  test('filters tools by allowedRoutes when provided', async () => {
    mockCosSim.mockReturnValue(0.85);
    const tools = await getRelevantTools('search the web', mockTools, ['DocumentRoute']);
    // Only storage and communications categories (from DocumentRoute) should be returned
    const categories = [...new Set(tools.map(t => t.category))];
    categories.forEach(c => {
      expect(['storage', 'communications']).toContain(c);
    });
  });

  test('never returns empty array (always has fallback)', async () => {
    mockCosSim.mockReturnValue(0.01);
    const tools = await getRelevantTools('xyzzz unmatched query', mockTools);
    expect(tools.length).toBeGreaterThan(0);
  });
});

describe('initRouter', () => {
  test('initializes without throwing', async () => {
    mockCosSim.mockReturnValue(0.0);
    await expect(initRouter()).resolves.not.toThrow();
  });
});
