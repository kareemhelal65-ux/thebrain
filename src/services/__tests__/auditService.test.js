/**
 * Tests for AuditService
 *
 * Covers:
 * - logAIAction inserts to supabase and returns data
 * - logAIAction throws on error
 * - logSentinelPreExecution returns auditId and executionToken
 * - logSentinelPreExecution returns fallback on error
 * - logSentinelPostExecution inserts post-execution record
 */

jest.mock('../../models/supabaseClient', () => ({
  from: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  single: jest.fn()
}));

const supabase = require('../../models/supabaseClient');
const { logAIAction, logSentinelPreExecution, logSentinelPostExecution } = require('../auditService');

// uuid pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('AuditService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default successful mock chain
    supabase.single.mockResolvedValue({ data: { id: 'audit-123' }, error: null });
    supabase.insert.mockReturnThis();
    supabase.select.mockReturnThis();
  });

  describe('logAIAction', () => {
    test('inserts and returns the audit log', async () => {
      const result = await logAIAction({
        companyId: 'comp-1',
        userId: 'user-1',
        toolUsed: 'generate_text',
        inputData: { prompt: 'Hello' },
        reasoningPath: 'Analyzed request'
      });

      expect(supabase.from).toHaveBeenCalledWith('audit_logs');
      expect(supabase.insert).toHaveBeenCalledWith([{
        company_id: 'comp-1',
        user_id: 'user-1',
        tool_used: 'generate_text',
        input_data: { prompt: 'Hello' },
        reasoning_path: 'Analyzed request'
      }]);
      expect(result).toEqual({ id: 'audit-123' });
    });

    test('throws on database error', async () => {
      supabase.single.mockResolvedValue({ data: null, error: new Error('DB error') });

      await expect(logAIAction({
        companyId: 'comp-1',
        userId: 'user-1',
        toolUsed: 'test_tool',
        inputData: {},
        reasoningPath: 'test'
      })).rejects.toThrow('Audit Logging Failed');
    });
  });

  describe('logSentinelPreExecution', () => {
    test('returns auditId and executionToken on success', async () => {
      supabase.single.mockResolvedValue({ data: { id: 'audit-456' }, error: null });

      const result = await logSentinelPreExecution({
        companyId: 'comp-1',
        userId: 'user-1',
        toolName: 'send_email',
        toolParameters: { to: 'test@test.com' },
        sentinelVerdict: 'APPROVED',
        verdictReason: 'All checks passed'
      });

      expect(result).toHaveProperty('auditId', 'audit-456');
      expect(result).toHaveProperty('executionToken');
      expect(result.executionToken).toMatch(UUID_REGEX);

      expect(supabase.from).toHaveBeenCalledWith('audit_logs');
      expect(supabase.insert).toHaveBeenCalledWith([{
        company_id: 'comp-1',
        user_id: 'user-1',
        tool_used: 'send_email',
        tool_parameters: { to: 'test@test.com' },
        sentinel_verdict: 'APPROVED',
        execution_phase: 'PRE',
        execution_token: expect.any(String),
        reasoning_path: 'All checks passed',
        input_data: { sentinel_check: true, verdict: 'APPROVED' }
      }]);
    });

    test('returns fallback with null auditId on DB error', async () => {
      supabase.single.mockResolvedValue({ data: null, error: new Error('DB error') });

      const result = await logSentinelPreExecution({
        companyId: 'comp-1',
        userId: 'user-1',
        toolName: 'send_email',
        toolParameters: {},
        sentinelVerdict: 'DENIED',
        verdictReason: 'Not allowed'
      });

      expect(result).toHaveProperty('auditId', null);
      expect(result).toHaveProperty('executionToken');
    });
  });

  describe('logSentinelPostExecution', () => {
    test('inserts post-execution record on success', async () => {
      supabase.insert.mockReturnValue({ insert: jest.fn() });

      await logSentinelPostExecution({
        companyId: 'comp-1',
        userId: 'user-1',
        toolName: 'send_email',
        executionToken: 'tok-123',
        resultData: { sent: true },
        executionDurationMs: 150,
        success: true
      });

      expect(supabase.from).toHaveBeenCalledWith('audit_logs');
      expect(supabase.insert).toHaveBeenCalledWith([{
        company_id: 'comp-1',
        user_id: 'user-1',
        tool_used: 'send_email',
        execution_phase: 'POST',
        execution_token: 'tok-123',
        sentinel_verdict: 'EXECUTED',
        result_data: { sent: true },
        execution_duration_ms: 150,
        reasoning_path: 'Execution completed successfully'
      }]);
    });

    test('inserts post-execution record on failure', async () => {
      await logSentinelPostExecution({
        companyId: 'comp-1',
        userId: 'user-1',
        toolName: 'send_email',
        executionToken: 'tok-456',
        resultData: null,
        executionDurationMs: 200,
        success: false,
        errorMessage: 'Connection timeout'
      });

      expect(supabase.insert).toHaveBeenCalledWith([{
        company_id: 'comp-1',
        user_id: 'user-1',
        tool_used: 'send_email',
        execution_phase: 'POST',
        execution_token: 'tok-456',
        sentinel_verdict: 'FAILED',
        result_data: { error: 'Connection timeout' },
        execution_duration_ms: 200,
        reasoning_path: 'Execution failed: Connection timeout'
      }]);
    });

    test('does not throw on error (non-fatal)', async () => {
      supabase.insert.mockImplementation(() => {
        throw new Error('Insert failed');
      });

      await expect(logSentinelPostExecution({
        companyId: 'comp-1',
        userId: 'user-1',
        toolName: 'test',
        executionToken: 'tok',
        resultData: null,
        executionDurationMs: 0,
        success: true
      })).resolves.not.toThrow();
    });
  });
});
