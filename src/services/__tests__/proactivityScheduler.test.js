/**
 * Tests for ProactivityScheduler — new document scanning logic
 *
 * Focuses on the scanCompany() function's ability to detect newly
 * uploaded brain_documents and create proactive_suggestions for them.
 *
 * Uses a SINGLE thenable mock builder shared across ALL supabase.from()
 * calls (including those inside emitNewSuggestion). Each `await` on
 * any chain consumes the next value from a pre-queued list.
 *
 * NOTE: emitNewSuggestion is called fire-and-forget (no await), but its
 * internal `await supabase.from('users')...` schedules a microtask that
 * runs BEFORE the for-loop's next `await`. Therefore every test that
 * expects newDocument suggestions to be created must include queue
 * entries for the emitNewSuggestion calls.
 */

// ─── Mock: notification routes ───
jest.mock('../../api/notificationRoutes', () => ({
  emitNotification: jest.fn(),
}));

// ═══════════════════════════════════════════════
// Build a THENABLE mock that uses a SHARED index
// ═══════════════════════════════════════════════

let resolveQueue = [];
let sharedIdx = 0;

/** Reset the shared queue and counter. Call in beforeEach. */
function resetQueue(queue = []) {
  resolveQueue = queue;
  sharedIdx = 0;
}

/**
 * Create a shared thenable mock builder. All chain methods return `this`.
 * When `await` is applied (calls `.then`), it resolves the next item
 * from the shared `resolveQueue`, advancing `sharedIdx`.
 */
const builder = {
  select:    jest.fn().mockReturnThis(),
  insert:    jest.fn().mockReturnThis(),
  eq:        jest.fn().mockReturnThis(),
  not:       jest.fn().mockReturnThis(),
  lt:        jest.fn().mockReturnThis(),
  gte:       jest.fn().mockReturnThis(),
  lte:       jest.fn().mockReturnThis(),
  order:     jest.fn().mockReturnThis(),
  limit:     jest.fn().mockReturnThis(),
  in:        jest.fn().mockReturnThis(),
  single:    jest.fn().mockReturnThis(),
  upsert:    jest.fn().mockReturnThis(),
  onConflict: jest.fn().mockReturnThis(),
  /** Thenable: each await consumes the next queued item. */
  then(resolve) {
    const val = sharedIdx < resolveQueue.length
      ? resolveQueue[sharedIdx++]
      : { data: null, error: null };
    return Promise.resolve(val).then(resolve);
  },
};

const mockFrom = jest.fn(() => builder);
const mockSupabase = { from: mockFrom };

jest.mock('../../models/supabaseClient', () => mockSupabase);

// ─── Module under test ───
const { scanCompany } = require('../proactivityScheduler');
const { emitNotification } = require('../../api/notificationRoutes');

// ─── Helpers ───

function makeDoc(overrides = {}) {
  return {
    id: overrides.id || 'doc-001',
    title: overrides.title || 'Q4 Marketing Strategy',
    document_type: overrides.document_type || 'markdown',
    department: overrides.department || 'marketing',
    semantic_type: overrides.semantic_type || 'strategy',
    sub_type: overrides.sub_type || null,
    created_at: overrides.created_at || new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetQueue();
});

// ─── Tests ───

describe('scanCompany — new document detection', () => {
  const companyId = 'company-1';

  test('creates suggestions for newly uploaded documents when none exist', async () => {
    // Queue layout (11 items):
    //   0. scheduler_state.single() → no prior state
    //   1. brain_documents → 2 new docs
    //   2. proactive_suggestions.limit(1) → existing check doc-1 (none)
    //   3. proactive_suggestions.insert().select() → insert doc-1 suggestion
    //   4. emitNewSuggestion: supabase.from('users') → no users found, SSE skipped
    //   5. proactive_suggestions.limit(1) → existing check doc-2 (none)
    //   6. proactive_suggestions.insert().select() → insert doc-2 suggestion
    //   7. emitNewSuggestion: supabase.from('users') → no users found, SSE skipped
    //   8. action_items → none overdue
    //   9. meetings → none recent
    //  10. scheduler_state upsert
    resetQueue([
      { data: null, error: null },
      { data: [makeDoc({ id: 'doc-1', title: 'Q4 Strategy' }), makeDoc({ id: 'doc-2', title: 'Budget Review' })] },
      { data: null },
      { data: [{ id: 'sug-1', category: 'new_document' }] },
      { data: null },                          // emitNewSuggestion users query (no users)
      { data: null },
      { data: [{ id: 'sug-2', category: 'new_document' }] },
      { data: null },                          // emitNewSuggestion users query (no users)
      { data: [] },
      { data: [] },
      { data: null },
    ]);

    const result = await scanCompany(companyId);

    expect(mockFrom).toHaveBeenCalledWith('scheduler_state');
    expect(mockFrom).toHaveBeenCalledWith('brain_documents');
    expect(mockFrom).toHaveBeenCalledWith('proactive_suggestions');
    expect(result.newDocuments.suggestionCount).toBe(2);
  });

  test('skips documents that already have a suggestion', async () => {
    const recentScan = new Date(Date.now() - 3600_000).toISOString();
    //   0. scheduler_state
    //   1. brain_documents → 2 docs
    //   2. existing check doc-1 → HAS existing suggestion → skip
    //   3. existing check doc-2 → none → proceed
    //   4. insert doc-2 suggestion
    //   5. emitNewSuggestion: users query
    //   6. action_items
    //   7. meetings
    //   8. upsert
    resetQueue([
      { data: { last_overdue_scan: recentScan, last_cross_doc_scan: null } },
      { data: [makeDoc({ id: 'doc-1', title: 'Existing Doc' }), makeDoc({ id: 'doc-2', title: 'New Doc' })] },
      { data: [{ id: 'existing-sug' }] },
      { data: null },
      { data: [{ id: 'sug-2', category: 'new_document' }] },
      { data: null },                          // emitNewSuggestion users query
      { data: [] },
      { data: [] },
      { data: null },
    ]);

    const result = await scanCompany(companyId);

    expect(result.newDocuments.suggestionCount).toBe(1);
  });

  test('returns zero when there are no new documents', async () => {
    // When there are no new docs, emitNewSuggestion is never called,
    // so no extra queue items needed.
    resetQueue([
      { data: null, error: null },
      { data: [] },
      { data: [] },
      { data: [] },
      { data: null },
    ]);

    const result = await scanCompany(companyId);

    expect(result.newDocuments.suggestionCount).toBe(0);
  });

  test('uses last scan time from scheduler_state when available', async () => {
    const recentScan = new Date(Date.now() - 30_000).toISOString();
    resetQueue([
      { data: { last_overdue_scan: recentScan, last_cross_doc_scan: recentScan } },
      { data: [] },
      { data: [] },
      { data: [] },
      { data: null },
    ]);

    await scanCompany(companyId);

    // The gte filter should use the recent scan time.
    // builder.gte was called on the brain_documents query chain.
    const gteCalls = builder.gte.mock.calls;
    const gteCreatedAt = gteCalls.find(([col]) => col === 'created_at');
    expect(gteCreatedAt).toBeDefined();
    expect(gteCreatedAt[1]).toBe(recentScan);
  });

  test('falls back to 7 days when no scheduler state exists', async () => {
    resetQueue([
      { data: null, error: { message: 'not found', code: 'PGRST116' } },
      { data: [] },
      { data: [] },
      { data: [] },
      { data: null },
    ]);

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    await scanCompany(companyId);

    const gteCalls = builder.gte.mock.calls;
    const gteCreatedAt = gteCalls.find(([col]) => col === 'created_at');
    expect(gteCreatedAt).toBeDefined();

    const cutoffMs = new Date(gteCreatedAt[1]).getTime();
    expect(cutoffMs).toBeGreaterThan(sevenDaysAgo - 5_000);
    expect(cutoffMs).toBeLessThanOrEqual(Date.now());
  });

  test('handles query failure in new doc scan gracefully', async () => {
    // The scheduler_state query error is caught by the try-catch.
    // After the catch, the function continues with the other scan sections.
    resetQueue([
      { data: null, error: { message: 'network error' } },
      // After the catch, action_items, meetings, upsert still run
    ]);

    const result = await scanCompany(companyId);

    expect(result.newDocuments.suggestionCount).toBe(0);
    expect(result.overdue).toBeDefined();
    expect(result.crossDoc).toBeDefined();
  });

  test('creates suggestion with correct category and metadata', async () => {
    const doc = makeDoc({
      id: 'doc-001',
      title: 'Q4 Marketing Strategy',
      document_type: 'markdown',
      department: 'marketing',
      semantic_type: 'strategy',
    });

    const insertedSuggestion = {
      id: 'sug-001',
      tenant_id: companyId,
      category: 'new_document',
      title: 'New document: Q4 Marketing Strategy',
      description: 'Document "Q4 Marketing Strategy" (markdown) was uploaded and indexed. Department: marketing. Type: strategy.',
      priority: 'low',
      source_entity_type: 'document',
      source_entity_id: 'doc-001',
      metadata: {
        document_id: 'doc-001',
        document_title: 'Q4 Marketing Strategy',
        document_type: 'markdown',
        department: 'marketing',
        semantic_type: 'strategy',
        sub_type: null,
      },
    };

    // Need a user in the users table so emitNewSuggestion actually calls emitNotification
    resetQueue([
      { data: null, error: null },                                 // 0  scheduler_state
      { data: [doc] },                                              // 1  brain_documents
      { data: null },                                               // 2  existing check (none)
      { data: [insertedSuggestion] },                               // 3  insert suggestion
      { data: [{ id: 'user-1' }] },                                 // 4  emitNewSuggestion: users query → 1 user found!
      { data: [] },                                                  // 5  action_items
      { data: [] },                                                  // 6  meetings
      { data: null },                                                // 7  upsert
    ]);

    const result = await scanCompany(companyId);

    expect(result.newDocuments.suggestionCount).toBe(1);

    // Verify the insert payload
    const insertBuilderCalls = builder.insert.mock.calls;
    // First insert call should be for the new document suggestion
    const insertPayload = insertBuilderCalls[0][0];
    expect(insertPayload[0].category).toBe('new_document');
    expect(insertPayload[0].source_entity_type).toBe('document');
    expect(insertPayload[0].source_entity_id).toBe('doc-001');
    expect(insertPayload[0].title).toContain('Q4 Marketing Strategy');
    expect(insertPayload[0].priority).toBe('low');

    // Verify SSE event was emitted (users query returned user-1)
    expect(emitNotification).toHaveBeenCalledWith('user-1', {
      type: 'new_suggestion',
      suggestion: insertedSuggestion,
    });
  });

  test('uses max of available scan timestamps when only one exists', async () => {
    const overdueScan = new Date(Date.now() - 7200_000).toISOString(); // 2h ago
    resetQueue([
      { data: { last_overdue_scan: overdueScan, last_cross_doc_scan: null } },
      { data: [] },
      { data: [] },
      { data: [] },
      { data: null },
    ]);

    await scanCompany(companyId);

    const gteCalls = builder.gte.mock.calls;
    const gteCreatedAt = gteCalls.find(([col]) => col === 'created_at');
    expect(gteCreatedAt).toBeDefined();

    // cutoff = max(2h ago, 0) = 2h ago
    expect(gteCreatedAt[1]).toBe(overdueScan);
  });
});
