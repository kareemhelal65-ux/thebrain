/**
 * Feedback Routes — Signal Collection for the Self-Learning Loop (v3 §7.3)
 * 
 * Collects thumbs-up/down on every Brain response, storing them in feedback_events.
 * This is the highest-value dataset for the Phase 2 self-learning loop and
 * immediately valuable for the investor pitch.
 */
const express = require('express');
const supabase = require('../models/supabaseClient');

const router = express.Router();

/**
 * POST /api/feedback
 * Record a user's feedback on a Brain/Agent response
 * Body: { message_id, session_id, rating: 'up'|'down', correction_text?, task_type?, agent_name? }
 */
router.post('/', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { message_id, session_id, rating, correction_text, task_type, agent_name } = req.body;

    if (!rating || !['up', 'down'].includes(rating)) {
      return res.status(400).json({ error: 'Rating must be "up" or "down".' });
    }

    const { data, error } = await supabase.from('feedback_events').insert([{
      tenant_id: req.user.company_id,
      user_id: req.user.id,
      session_id: session_id || null,
      message_id: message_id || null,
      rating,
      correction_text: correction_text || null,
      task_type: task_type || null,
      agent_name: agent_name || null,
    }]).select().single();

    if (error) {
      // If table doesn't exist yet, return gracefully
      if (error.code === '42P01') {
        console.warn('[Feedback] feedback_events table not found. Run migration 023.');
        return res.status(200).json({ message: 'Feedback noted (table pending migration).' });
      }
      throw error;
    }

    console.log(`[Feedback] ${rating === 'up' ? '👍' : '👎'} recorded for message ${message_id || 'N/A'}`);
    res.status(201).json({ message: 'Feedback recorded.', id: data?.id });
  } catch (error) {
    console.error('[Feedback] Error:', error.message);
    next(error);
  }
});

/**
 * GET /api/feedback/stats
 * Returns feedback signal counts — valuable for investor pitch metrics
 * "The Brain has collected N feedback signals from X companies in Y days"
 */
router.get('/stats', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const tenantId = req.user.company_id;

    // Count total, up, down
    const { data: totalData, error: totalErr } = await supabase
      .from('feedback_events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId);

    const { data: upData, error: upErr } = await supabase
      .from('feedback_events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('rating', 'up');

    const { data: downData, error: downErr } = await supabase
      .from('feedback_events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('rating', 'down');

    // Get oldest feedback for "days collecting" metric
    const { data: oldestData } = await supabase
      .from('feedback_events')
      .select('created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
      .limit(1);

    const totalCount = totalErr ? 0 : (totalData?.length ?? 0);
    const upCount = upErr ? 0 : (upData?.length ?? 0);
    const downCount = downErr ? 0 : (downData?.length ?? 0);
    const firstSignalDate = oldestData?.[0]?.created_at || null;
    const daysCollecting = firstSignalDate
      ? Math.ceil((Date.now() - new Date(firstSignalDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    res.json({
      total: totalCount,
      thumbs_up: upCount,
      thumbs_down: downCount,
      satisfaction_rate: totalCount > 0 ? Math.round((upCount / totalCount) * 100) : null,
      days_collecting: daysCollecting,
      first_signal_date: firstSignalDate,
    });
  } catch (error) {
    // Gracefully handle missing table
    if (error.code === '42P01') {
      return res.json({ total: 0, thumbs_up: 0, thumbs_down: 0, satisfaction_rate: null, days_collecting: 0 });
    }
    console.error('[Feedback] Stats error:', error.message);
    next(error);
  }
});

module.exports = router;
