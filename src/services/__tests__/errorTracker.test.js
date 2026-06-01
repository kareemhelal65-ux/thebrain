/**
 * Tests for ErrorTracker — Silent Error Monitoring & Alerting
 *
 * Covers:
 * - initErrorTracker with/without SENTRY_DSN
 * - captureException with various contexts
 * - captureMessage with severity levels
 * - trackLatency with thresholds
 * - getSentryErrorHandler and getSentryRequestHandler
 *
 * IMPORTANT: Tests are ordered so that "not initialized" tests run
 * first, before any test calls initErrorTracker(). This avoids the
 * need for jest.resetModules() which creates stale mock references.
 */

jest.mock('@sentry/node', () => {
  const mock = {
    init: jest.fn(),
    withScope: jest.fn(),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    Handlers: {
      errorHandler: jest.fn(() => (err, req, res, next) => next(err)),
      requestHandler: jest.fn(() => (req, res, next) => next())
    }
  };
  // Store reference for scope assertions
  mock.withScope.mockImplementation((cb) => {
    cb({
      setTag: jest.fn(),
      setExtras: jest.fn(),
      setLevel: jest.fn()
    });
  });
  return mock;
});

const Sentry = require('@sentry/node');
const {
  initErrorTracker,
  captureException,
  captureMessage,
  trackLatency,
  getSentryErrorHandler,
  getSentryRequestHandler
} = require('../errorTracker');

const ERR = new Error('test error');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SENTRY_DSN;
});

// ─── Not Initialized Tests ─────────────────────────────────────────
// These MUST run first before any test calls initErrorTracker().
// The module-level `initialized` is `false` at this point.

describe('(not initialized) captureException', () => {
  test('logs error to console without Sentry', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation();
    captureException(ERR, { component: 'Test' });
    expect(spy).toHaveBeenCalledWith(
      '[ErrorTracker] (not initialized) test error',
      { component: 'Test' }
    );
    spy.mockRestore();
  });
});

describe('(not initialized) captureMessage', () => {
  test('logs warning to console without Sentry', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    captureMessage('msg', 'warning', { component: 'X' });
    expect(spy).toHaveBeenCalledWith('[ErrorTracker] (not initialized) [warning] msg');
    spy.mockRestore();
  });
});

describe('(not initialized) getSentryErrorHandler', () => {
  test('returns pass-through middleware that forwards errors', () => {
    const handler = getSentryErrorHandler();
    const next = jest.fn();
    handler(ERR, {}, {}, next);
    expect(next).toHaveBeenCalledWith(ERR);
  });
});

describe('(not initialized) getSentryRequestHandler', () => {
  test('returns pass-through middleware that calls next', () => {
    const handler = getSentryRequestHandler();
    const next = jest.fn();
    handler({}, {}, next);
    expect(next).toHaveBeenCalled();
  });
});

// ─── initErrorTracker ──────────────────────────────────────────────

describe('initErrorTracker', () => {
  test('skips initialization when SENTRY_DSN is not set', () => {
    initErrorTracker();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  test('initializes Sentry when SENTRY_DSN is set', () => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/0';
    initErrorTracker();
    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: expect.any(String),
      environment: 'development',
      tracesSampleRate: 1.0,
      beforeSend: expect.any(Function)
    });
  });

  test('uses production tracesSampleRate when NODE_ENV is production', () => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/0';
    process.env.NODE_ENV = 'production';
    initErrorTracker();
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0.2 })
    );
  });
});

// ─── Initialized Tests ─────────────────────────────────────────────
// These tests set SENTRY_DSN and call initErrorTracker() first.

describe('captureException (initialized)', () => {
  beforeEach(() => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/0';
    initErrorTracker();
  });

  test('captures exception via Sentry.withScope', () => {
    const err = new Error('router-error');
    captureException(err, { component: 'Router', extra: { query: 'x' } });
    expect(Sentry.withScope).toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });

  test('captures exception without context', () => {
    const err = new Error('bare');
    captureException(err);
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
  });
});

describe('captureMessage (initialized)', () => {
  beforeEach(() => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/0';
    initErrorTracker();
  });

  test('captures message via Sentry', () => {
    captureMessage('perf issue', 'warning');
    expect(Sentry.captureMessage).toHaveBeenCalledWith('perf issue', 'warning');
  });
});

describe('trackLatency', () => {
  beforeEach(() => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/0';
    initErrorTracker();
  });

  test('does not capture when under threshold', () => {
    trackLatency('pinecone.query', 100, 2000);
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  test('captures when over default threshold', () => {
    trackLatency('pinecone.query', 3000);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('Latency spike: pinecone.query took 3000ms'),
      'warning'
    );
  });

  test('captures when over custom threshold', () => {
    trackLatency('db.query', 150, 100);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('db.query took 150ms'),
      'warning'
    );
  });
});

describe('getSentryErrorHandler (initialized)', () => {
  beforeEach(() => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/0';
    initErrorTracker();
  });

  test('returns Sentry error handler middleware', () => {
    const handler = getSentryErrorHandler();
    const next = jest.fn();
    handler(ERR, { id: 1 }, { json: jest.fn() }, next);
    expect(next).toHaveBeenCalledWith(ERR);
  });
});

describe('getSentryRequestHandler (initialized)', () => {
  beforeEach(() => {
    process.env.SENTRY_DSN = 'https://key@o0.ingest.sentry.io/0';
    initErrorTracker();
  });

  test('returns Sentry request handler middleware', () => {
    const handler = getSentryRequestHandler();
    const next = jest.fn();
    handler({}, {}, next);
    expect(next).toHaveBeenCalled();
  });
});
