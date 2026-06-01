/**
 * Approval Routes
 * 
 * Endpoints for managing agent output approvals:
 * - GET /api/approvals — List pending approvals
 * - POST /api/approvals/:id/approve — Approve an output → stored to Brain
 * - POST /api/approvals/:id/reject — Reject with feedback
 * - GET /api/approvals/history — View approval history
 * - GET /api/approvals/:id — Get specific output details
 */

const express = require('express');
const router = express.Router();
const supabase = require('../models/supabaseClient');
const { approveOutput, rejectOutput, getPendingApprovals, getOutputHistory, addOutputComment, getOutputComments, requestRevision } = require('../services/approvalService');

/**
 * GET /api/approvals
 * List all pending approvals for the current company.
 */
router.get('/', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const approvals = await getPendingApprovals(req.user.company_id);

    res.json({ approvals });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/approvals/history
 * View approved/rejected outputs history.
 */
router.get('/history', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const history = await getOutputHistory(req.user.company_id);

    res.json({ history });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/approvals/:id
 * Get specific approval details.
 */
router.get('/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: output, error } = await supabase
      .from('agent_outputs')
      .select(`
        *,
        agent_executions:agent_execution_id (
          agent_label,
          agent_type,
          icon,
          color,
          conversation_history,
          output_summary
        )
      `)
      .eq('id', req.params.id)
      .single();

    if (error || !output) {
      return res.status(404).json({ error: 'Output not found' });
    }

    if (output.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({ output });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/approvals/:id/approve
 * Approve an agent output. It will be stored to The Brain's permanent memory.
 */
router.post('/:id/approve', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    // Require admin or manager role for approvals
    if (req.user.role !== 'Admin' && req.user.role !== 'Manager') {
      return res.status(403).json({ error: 'Only Admins and Managers can approve outputs' });
    }

    const { feedback } = req.body;
    const result = await approveOutput(req.params.id, req.user, { feedback });

    res.json({
      success: true,
      message: 'Output approved and stored to The Brain',
      output: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/approvals/:id/reject
 * Reject an agent output with feedback.
 */
router.post('/:id/reject', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role !== 'Admin' && req.user.role !== 'Manager') {
      return res.status(403).json({ error: 'Only Admins and Managers can reject outputs' });
    }

    const { feedback } = req.body;
    if (!feedback || !feedback.trim()) {
      return res.status(400).json({ error: 'Feedback is required when rejecting' });
    }

    const result = await rejectOutput(req.params.id, req.user, feedback.trim());

    res.json({
      success: true,
      message: 'Output rejected',
      output: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/approvals/:id/comments
 * List the review-comment thread for an output.
 */
router.get('/:id/comments', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const comments = await getOutputComments(req.params.id, req.user);
    res.json({ comments });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/approvals/:id/comments
 * Add a review comment. Body: { body, section_ref? }.
 * section_ref null = threaded; non-null = section/step/file-level.
 */
router.post('/:id/comments', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { body, section_ref } = req.body;
    if (!body || !String(body).trim()) {
      return res.status(400).json({ error: 'Comment body is required' });
    }
    const comment = await addOutputComment({
      outputId: req.params.id,
      user: req.user,
      body,
      sectionRef: section_ref || null,
    });
    res.json({ success: true, comment });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/approvals/:id/request-revision
 * Submit the open comments as a revision brief and resume the agent to produce a
 * revised version. Does not hard-reject the deliverable.
 */
router.post('/:id/request-revision', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role !== 'Admin' && req.user.role !== 'Manager') {
      return res.status(403).json({ error: 'Only Admins and Managers can request revisions' });
    }
    const result = await requestRevision(req.params.id, req.user);
    res.json({ success: true, message: 'Revision requested', ...result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
