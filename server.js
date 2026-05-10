require('dotenv').config();
const express = require('express');
const cors = require('cors');
const errorHandler = require('./src/middleware/errorHandler');
const { checkRole, auditLogScopeFilter } = require('./src/middleware/rbacMiddleware');
const { logAIAction } = require('./src/services/auditService');
const supabase = require('./src/models/supabaseClient');
const authMiddleware = require('./src/middleware/authMiddleware');
const { initErrorTracker, getSentryRequestHandler, getSentryErrorHandler } = require('./src/services/errorTracker');
const memoryRoutes = require('./src/api/memoryRoutes');
const meetingRoutes = require('./src/api/meetingRoutes');
const orchestrationRoutes = require('./src/api/orchestrationRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Startup Validation ───
// Validate critical environment variables on boot
if (!process.env.MASTER_ENCRYPTION_KEY) {
  console.warn('[WARN] MASTER_ENCRYPTION_KEY is not set. Credential encryption/decryption will fail.');
  console.warn('[WARN] Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

// ─── Initialize Error Tracker (Sentry) ───
initErrorTracker();

// ─── Middleware ───
app.use(getSentryRequestHandler()); // Sentry request handler must be the first middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(authMiddleware);
// -------------------------------------

// ─── Health Check ───
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'The Brain OS Backend is operational.',
    version: '2.0.0',
    subsystems: {
      nervousSystem: 'active',
      sentinel: 'active',
      registry: 'active',
      meetingEngine: 'active'
    }
  });
});

// ─── Vault Routes ───

// Log an AI Action (Internal use)
app.post('/api/vault/log', async (req, res, next) => {
  try {
    // Only authenticated users can log actions
    if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const { toolUsed, inputData, reasoningPath } = req.body;
    
    const log = await logAIAction({
      companyId: req.user.company_id,
      userId: req.user.id,
      toolUsed,
      inputData,
      reasoningPath
    });

    res.status(201).json({ message: 'Log created', log });
  } catch (error) {
    next(error);
  }
});

// Fetch Audit Logs (RBAC protected)
// 'Admin' sees all company logs, 'Employee' sees only their own
app.get('/api/vault/logs', checkRole(['Admin', 'Manager', 'Employee']), auditLogScopeFilter, async (req, res, next) => {
  try {
    // req.auditScope contains the filters determined by the RBAC middleware
    let query = supabase.from('audit_logs').select('*');
    
    // Apply filters safely
    for (const [key, value] of Object.entries(req.auditScope)) {
        query = query.eq(key, value);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    res.status(200).json({ logs: data });
  } catch (error) {
    next(error);
  }
});

// ─── API Routes ───

// Memory Routes (Ingest and Buffer)
app.use('/api/memory', memoryRoutes);

// Meeting Routes (Webhooks and Upload)
app.use('/api/meetings', meetingRoutes);

// Brain Orchestration Routes (The Nervous System)
app.use('/api/brain', orchestrationRoutes);

// ─── Central Error Handling ───
app.use(getSentryErrorHandler()); // Sentry error handler must be before custom errorHandler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║   The Brain AIOS — Nervous System v2.0   ║`);
  console.log(`║   Server running on port ${PORT}            ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
});
