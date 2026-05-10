const express = require('express');
const { processMessage } = require('../services/orchestrator');

const router = express.Router();

/**
 * POST /api/brain/chat
 * 
 * The main orchestration endpoint. Accepts a user message, runs it through
 * the full Nervous System pipeline:
 * 
 * Context Assembly → LLM (with tools) → Sentinel → Adapter → Result → LLM → Response
 * 
 * Body: { message: string, sessionId?: string }
 * Returns: { reply: string, toolsUsed: Array, auditTrail: Array }
 */
router.post('/chat', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized. Authentication required.' });
    }

    const { message, sessionId } = req.body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ error: 'Message is required and must be a non-empty string.' });
    }

    const result = await processMessage({
      message: message.trim(),
      sessionId: sessionId || null,
      user: req.user
    });

    res.status(200).json({
      reply: result.reply,
      toolsUsed: result.toolsUsed,
      auditTrail: result.auditTrail,
      metadata: {
        iterations: result.iterations,
        maxIterationsReached: result.maxIterationsReached || false
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
