/**
 * Department Dashboard Routes (Phase D1 / D1.5)
 *
 * - GET  /api/departments                     — list departments + relevance (for nav)
 * - GET  /api/departments/:dept/overview       — aggregated dashboard payload
 *        ?reconfigure=true re-runs the resolver on demand
 * - POST /api/departments/:dept/setup          — persist first-run wizard answers
 * - POST /api/departments/:dept/reconfigure     — explicit "Reconfigure" action
 */

const express = require('express');
const router = express.Router();
const {
  DEPARTMENTS,
  isKnownDepartment,
  getDepartmentOverview,
  saveDepartmentSetup,
  saveChatDeliverable,
  configureDepartment,
  getDepartmentRelevance,
} = require('../services/departmentService');

/** GET /api/departments — nav metadata (label + relevance per department). */
router.get('/', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const relevance = await getDepartmentRelevance(req.user.company_id);
    const departments = Object.entries(DEPARTMENTS).map(([key, meta]) => ({
      key,
      label: meta.label,
      relevance: relevance[key] || 'secondary',
      static: key === 'people', // Team is the one static tab
    }));
    res.json({ departments });
  } catch (error) {
    next(error);
  }
});

/** GET /api/departments/:dept/overview */
router.get('/:dept/overview', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { dept } = req.params;
    if (!isKnownDepartment(dept)) return res.status(404).json({ error: `Unknown department: ${dept}` });

    const reconfigure = req.query.reconfigure === 'true';
    const overview = await getDepartmentOverview(req.user.company_id, dept, { reconfigure });
    res.json({ overview });
  } catch (error) {
    next(error);
  }
});

/** POST /api/departments/:dept/setup  { answers: { questionId: value, ... } } */
router.post('/:dept/setup', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { dept } = req.params;
    if (!isKnownDepartment(dept)) return res.status(404).json({ error: `Unknown department: ${dept}` });

    const answers = (req.body && typeof req.body.answers === 'object') ? req.body.answers : {};
    const resolved = await saveDepartmentSetup(req.user.company_id, dept, answers);
    res.json({ resolved });
  } catch (error) {
    next(error);
  }
});

/** GET /api/departments/marketing/strategy — the auto-updating 7-week strategy (D2). */
router.get('/marketing/strategy', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { getOrCreateMarketingStrategy } = require('../services/marketingStrategyService');
    const strategy = await getOrCreateMarketingStrategy(req.user.company_id);
    res.json({ strategy });
  } catch (error) {
    next(error);
  }
});

/** POST /api/departments/marketing/strategy/refresh — regenerate the 7-week strategy. */
router.post('/marketing/strategy/refresh', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { generateMarketingStrategy } = require('../services/marketingStrategyService');
    const strategy = await generateMarketingStrategy(req.user.company_id);
    res.json({ strategy });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/departments/:dept/deliverables
 * Promote chat-produced deliverable(s) into the Workspace as pending agent_outputs.
 * Single:  { title?, content (required), summary?, outputType?, store? }
 * Batch:   { deliverables: [{ title?, content, summary?, outputType? }, ...], store? }
 * If `store` is true, each created output is immediately approved → stored to the Brain
 * (and feeds the self-learning loop).
 */
router.post('/:dept/deliverables', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { dept } = req.params;
    if (!isKnownDepartment(dept)) return res.status(404).json({ error: `Unknown department: ${dept}` });

    const body = req.body || {};
    const items = Array.isArray(body.deliverables) ? body.deliverables : [body];
    const { approveOutput } = require('../services/approvalService');

    const hasContent = (c) => c && (typeof c === 'string' ? c.trim().length > 0 : (typeof c === 'object' && Object.keys(c).length > 0));
    const outputs = [];
    for (const it of items) {
      if (!hasContent(it.content)) continue;
      let output = await saveChatDeliverable(req.user.company_id, dept, {
        title: it.title, content: it.content, summary: it.summary, outputType: it.outputType,
      });
      if (body.store || it.store) {
        try { output = await approveOutput(output.id, req.user, { feedback: 'Accepted from chat' }); }
        catch (e) { console.warn('[Deliverables] store-to-brain failed:', e.message); }
      }
      outputs.push(output);
    }
    if (outputs.length === 0) return res.status(400).json({ error: 'content is required' });
    res.json({ outputs, output: outputs[0] });
  } catch (error) {
    next(error);
  }
});

/** POST /api/departments/:dept/reconfigure */
router.post('/:dept/reconfigure', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { dept } = req.params;
    if (!isKnownDepartment(dept)) return res.status(404).json({ error: `Unknown department: ${dept}` });

    const resolved = await configureDepartment(req.user.company_id, dept, { force: true });
    res.json({ resolved });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
