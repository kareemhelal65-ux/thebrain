const Sentry = require('@sentry/node');

/**
 * Error Tracker — Silent Error Monitoring & Alerting
 * 
 * Integrates Sentry for production error tracking. When critical
 * services fail (webhook errors, Pinecone latency spikes, Semantic
 * Router crashes), the system autonomously fires alerts to the
 * developer Slack/Discord channel.
 * 
 * Sentry alerting rules (configured in the Sentry dashboard):
 * - Slack/Discord webhook on any new error
 * - Performance alert when Pinecone latency > 2000ms
 * - Volume alert on repeated Semantic Router crashes
 */

let initialized = false;

/**
 * Initialize Sentry. Call once at server startup.
 */
function initErrorTracker() {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    console.warn('[ErrorTracker] SENTRY_DSN not set. Error tracking is disabled.');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    beforeSend(event) {
      // Optionally filter or modify events before sending
      return event;
    }
  });

  initialized = true;
  console.log('[ErrorTracker] Sentry initialized successfully.');
}

/**
 * Capture an exception and send it to Sentry.
 * 
 * @param {Error} error - The error to capture
 * @param {Object} [context] - Additional context
 * @param {string} [context.component] - Which component failed (e.g., 'SemanticRouter')
 * @param {string} [context.companyId] - The company context
 * @param {Object} [context.extra] - Any extra data to attach
 */
function captureException(error, context = {}) {
  if (!initialized) {
    console.error(`[ErrorTracker] (not initialized) ${error.message}`, context);
    return;
  }

  Sentry.withScope(scope => {
    if (context.component) {
      scope.setTag('component', context.component);
    }
    if (context.companyId) {
      scope.setTag('company_id', context.companyId);
    }
    if (context.extra) {
      scope.setExtras(context.extra);
    }
    Sentry.captureException(error);
  });
}

/**
 * Capture a warning or informational message.
 * 
 * @param {string} message - The message to capture
 * @param {'warning'|'info'|'error'|'fatal'} level - Severity level
 * @param {Object} [context] - Additional context
 */
function captureMessage(message, level = 'warning', context = {}) {
  if (!initialized) {
    console.warn(`[ErrorTracker] (not initialized) [${level}] ${message}`);
    return;
  }

  Sentry.withScope(scope => {
    if (context.component) {
      scope.setTag('component', context.component);
    }
    if (context.companyId) {
      scope.setTag('company_id', context.companyId);
    }
    if (context.extra) {
      scope.setExtras(context.extra);
    }
    Sentry.captureMessage(message, level);
  });
}

/**
 * Record a performance measurement.
 * Used to track latency spikes (e.g., Pinecone > 2000ms).
 * 
 * @param {string} operation - Name of the operation (e.g., 'pinecone.query')
 * @param {number} durationMs - Duration in milliseconds
 * @param {number} [threshold=2000] - Alert threshold in ms
 */
function trackLatency(operation, durationMs, threshold = 2000) {
  if (durationMs > threshold) {
    captureMessage(
      `Latency spike: ${operation} took ${durationMs}ms (threshold: ${threshold}ms)`,
      'warning',
      {
        component: operation.split('.')[0],
        extra: { operation, durationMs, threshold }
      }
    );
  }
}

/**
 * Get the Sentry error handler middleware for Express.
 * Place BEFORE the custom errorHandler in the middleware chain.
 * @returns {Function} Express error handler middleware
 */
function getSentryErrorHandler() {
  if (!initialized) {
    return (err, req, res, next) => next(err);
  }
  return Sentry.Handlers.errorHandler();
}

/**
 * Get the Sentry request handler middleware for Express.
 * Place as the FIRST middleware in the chain.
 * @returns {Function} Express request handler middleware
 */
function getSentryRequestHandler() {
  if (!initialized) {
    return (req, res, next) => next();
  }
  return Sentry.Handlers.requestHandler();
}

module.exports = {
  initErrorTracker,
  captureException,
  captureMessage,
  trackLatency,
  getSentryErrorHandler,
  getSentryRequestHandler
};
