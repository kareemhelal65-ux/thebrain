const express = require('express');
const supabase = require('../models/supabaseClient');

const router = express.Router();

/**
 * GET /api/dashboard/stats
 * Returns source counts, last sync time, and recent meetings for the dashboard.
 */
router.get('/stats', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const companyId = req.user.company_id;

    // Count meetings
    const { count: meetingCount } = await supabase
      .from('meetings')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId);

    // Count document chunks by source type
    const { data: chunkCounts } = await supabase
      .from('document_chunks')
      .select('source_type')
      .eq('tenant_id', companyId);

    const docCount = (chunkCounts || []).filter(c => c.source_type === 'document' || c.source_type === 'google_doc').length;
    const slackCount = (chunkCounts || []).filter(c => c.source_type === 'slack').length;

    // Get last sync time from most recent meeting
    const { data: lastMeeting } = await supabase
      .from('meetings')
      .select('processed_at')
      .eq('company_id', companyId)
      .order('processed_at', { ascending: false })
      .limit(1)
      .single();

    // Get recent meetings
    const { data: recentMeetings } = await supabase
      .from('meetings')
      .select('id, title, meeting_date, source_type, insights, duration_minutes, participants')
      .eq('company_id', companyId)
      .order('meeting_date', { ascending: false })
      .limit(5);

    res.status(200).json({
      stats: {
        meetings: meetingCount || 0,
        documents: docCount,
        slackMessages: slackCount,
        brainQueries: 0, // TODO: Track query count
        lastSync: lastMeeting?.processed_at || null,
      },
      recentMeetings: recentMeetings || [],
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
