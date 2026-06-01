const { captureException } = require('../services/errorTracker');

const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  // Report to Sentry with request context
  captureException(err, {
    component: 'express',
    extra: {
      method: req.method,
      url: req.originalUrl,
      userId: req.user?.id || 'anonymous',
      companyId: req.user?.company_id || 'unknown'
    }
  });

  res.status(err.statusCode || 500).json({
    message: err.message || 'Internal Server Error',
  });
};

module.exports = errorHandler;
