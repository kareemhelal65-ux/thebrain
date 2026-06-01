const express = require('express');

const router = express.Router();

// Simple in-memory client store for SSE
const clients = new Map();

/**
 * GET /api/notifications/stream
 * Connects the frontend to an SSE stream for real-time notifications.
 */
router.get('/stream', (req, res) => {
  const userId = req.user?.id || req.query.token || 'demo-user';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE connection established' })}\n\n`);

  if (!clients.has(userId)) {
    clients.set(userId, []);
  }
  clients.get(userId).push(res);

  // Remove client on close
  req.on('close', () => {
    const userClients = clients.get(userId);
    if (userClients) {
      const idx = userClients.indexOf(res);
      if (idx !== -1) userClients.splice(idx, 1);
      if (userClients.length === 0) clients.delete(userId);
    }
  });
});

/**
 * Helper to emit a notification to a specific user
 */
function emitNotification(userId, notification) {
  const userClients = clients.get(userId);
  if (userClients) {
    const data = JSON.stringify(notification);
    userClients.forEach(res => {
      res.write(`data: ${data}\n\n`);
    });
  }
}

module.exports = {
  router,
  emitNotification
};
