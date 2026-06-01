const express = require('express');
const multer = require('multer');
const { webhookAuth } = require('../middleware/webhookAuth');
const fs = require('fs');
const supabase = require('../models/supabaseClient');
const { processWebhookTranscript, processAudioUpload, getMeetingInsights, searchMeetings, transcribeMeeting, storeMeeting, commitMeetingToBrain } = require('../services/meetingService');
const { detectAgentTasks, launchAgentWithContext } = require('../services/agentOrchestrator');

const router = express.Router();
const upload = multer({ dest: 'uploads/meetings/' });

/**
 * POST /api/meetings/transcribe
 * Transcribe + analyze audio WITHOUT saving anything (ephemeral brainstorming).
 * Returns { transcript, language, insights } for the user to review, then either
 * Store (POST /store) or Discard. The temp file is always deleted.
 */
router.post('/transcribe', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file uploaded. Use field name "audio".' });
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const result = await transcribeMeeting(req.file.path, req.file.originalname, req.user.company_id);
      res.status(200).json({ message: 'Transcribed (not saved).', ...result });
    } finally {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/meetings/store
 * Persist a previously-transcribed session (e.g. a brainstorm the user chose to keep).
 * Body: { title, transcript, language?, insights?, source_type? }
 */
router.post('/store', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { title, transcript, language, insights, source_type } = req.body || {};
    if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
      return res.status(400).json({ error: 'A transcript is required to store.' });
    }
    const result = await storeMeeting({
      companyId: req.user.company_id,
      title: title || `Brainstorm — ${new Date().toLocaleString()}`,
      transcript,
      language: language || null,
      insights: insights || {},
      sourceType: source_type === 'brainstorm' ? 'brainstorm' : 'audio_upload',
      // Brainstorms are saved to the Meetings tab but NOT committed to the Brain yet.
      indexToBrain: source_type === 'brainstorm' ? false : true,
    });
    res.status(200).json({ message: 'Saved.', ...result });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/meetings/:id/commit-to-brain
 * Commit a saved meeting/brainstorm to the Brain (index + register decisions/actions),
 * and return the agent-actionable tasks detected from it.
 */
router.post('/:id/commit-to-brain', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const result = await commitMeetingToBrain(req.params.id, req.user.company_id);
    const agentTasks = detectAgentTasks(result.insights || {});
    res.status(200).json({ ...result, agent_tasks: agentTasks });
  } catch (error) {
    if (error.message === 'Meeting not found') return res.status(404).json({ error: error.message });
    next(error);
  }
});

/**
 * GET /api/meetings/:id/agent-tasks
 * Detected tasks (and which agent should handle each) for a meeting/brainstorm.
 */
router.get('/:id/agent-tasks', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { data: meeting } = await supabase
      .from('meetings').select('insights').eq('id', req.params.id).eq('company_id', req.user.company_id).maybeSingle();
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    res.json({ agent_tasks: detectAgentTasks(meeting.insights || {}) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/meetings/:id/send-to-agents
 * Launch the relevant agents to work on the tasks detected from this meeting/brainstorm.
 * Each agent runs with the transcript + its assigned tasks as seeded context.
 */
router.post('/:id/send-to-agents', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: meeting } = await supabase
      .from('meetings').select('*').eq('id', req.params.id).eq('company_id', req.user.company_id).maybeSingle();
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const tasks = detectAgentTasks(meeting.insights || {});
    if (tasks.length === 0) return res.json({ launched: [], message: 'No agent-actionable tasks found.' });

    // Group tasks by agent and launch each agent once with its tasks as context.
    const byAgent = {};
    for (const t of tasks) (byAgent[t.agent_type] = byAgent[t.agent_type] || []).push(t.task);

    const { data: company } = await supabase
      .from('companies').select('*').eq('id', req.user.company_id).single();

    const launched = [];
    for (const [agentType, agentTasks] of Object.entries(byAgent)) {
      const contextMessage =
        `These tasks came out of a ${meeting.source_type === 'brainstorm' ? 'brainstorm' : 'meeting'} titled "${meeting.title}". ` +
        `Complete the ones relevant to your specialty and produce a deliverable:\n` +
        agentTasks.map((t, i) => `${i + 1}. ${t}`).join('\n') +
        `\n\n--- Source transcript (for context) ---\n${(meeting.raw_transcript || '').slice(0, 8000)}`;
      try {
        const exec = await launchAgentWithContext({
          companyId: req.user.company_id, agentType, companyProfile: company || {}, user: req.user, contextMessage,
        });
        launched.push({ agent_type: agentType, execution_id: exec.id, task_count: agentTasks.length });
      } catch (e) {
        console.warn(`[Meetings] Failed to launch ${agentType}:`, e.message);
      }
    }

    res.json({ launched, message: `Sent ${tasks.length} task(s) to ${launched.length} agent(s).` });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/meetings/webhook/:provider
 * 
 * Unified webhook endpoint for virtual meeting transcripts.
 * Supported providers: zoom, google-meet, teams
 * 
 * The WebhookAuthenticator middleware handles:
 * - Zoom URL validation challenge (automatic response)
 * - HMAC SHA-256 signature verification per provider
 * - Webhook secret lookup from company's encrypted store
 * 
 * Query params: company_id (required)
 */
router.post('/webhook/:provider', webhookAuth(), async (req, res, next) => {
  try {
    const provider = req.webhookProvider;
    const companyId = req.webhookCompanyId;

    const result = await processWebhookTranscript(provider, req.body, companyId);

    res.status(200).json({
      message: 'Meeting transcript processed and indexed successfully.',
      ...result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/meetings/upload
 * 
 * Audio file upload endpoint for physical meeting recordings.
 * Accepts: MP3, WAV, M4A, WEBM, OGG
 * 
 * The audio is transcribed via OpenAI Whisper, then insights are
 * extracted via Llama 3.3 70B and indexed into the company's vector memory.
 */
router.post('/upload', upload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded. Use field name "audio".' });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Validate file type
    const allowedTypes = [
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
      'audio/m4a', 'audio/mp4', 'audio/webm', 'audio/ogg'
    ];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        error: `Unsupported audio format: ${req.file.mimetype}. Supported: MP3, WAV, M4A, WEBM, OGG`
      });
    }

    const title = req.body.title || req.file.originalname;
    const result = await processAudioUpload(
      req.file.path,
      req.file.originalname,
      req.user.company_id,
      title
    );

    res.status(200).json({
      message: 'Audio transcribed, insights extracted, and indexed successfully.',
      ...result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/meetings/search
 * Keyword/participant/date search over the company's meeting transcripts.
 * Query params: query, participant, date_from, date_to, limit
 */
router.get('/search', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { query, participant, date_from, date_to, limit } = req.query;
    const results = await searchMeetings(req.user.company_id, {
      query,
      participant,
      date_from,
      date_to,
      limit: limit ? parseInt(limit, 10) : 25,
    });
    res.json({ results, count: results.length });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/meetings/:id
 * Delete a meeting/brainstorm and any records derived from it (if it was committed
 * to the Brain): its brain document, memory chunks, decisions, and action items.
 */
router.delete('/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const id = req.params.id;

    const { data: meeting } = await supabase
      .from('meetings').select('id, company_id').eq('id', id).maybeSingle();
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (meeting.company_id !== req.user.company_id) return res.status(403).json({ error: 'Forbidden' });

    // Best-effort cleanup of derived records (registerMeetingEntities used meeting.id
    // as the brain_documents id and source_doc_id; indexMeetingToMemory used source_id).
    await Promise.allSettled([
      supabase.from('action_items').delete().eq('source_doc_id', id),
      supabase.from('decisions').delete().eq('source_doc_id', id),
      supabase.from('document_chunks').delete().eq('source_id', id),
      supabase.from('brain_documents').delete().eq('id', id),
    ]);

    const { error } = await supabase.from('meetings').delete().eq('id', id);
    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/meetings/:meetingId/insights
 * 
 * Retrieve extracted insights for a specific meeting.
 * Company-scoped — users can only access their own company's meetings.
 */
router.get('/:meetingId/insights', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const insights = await getMeetingInsights(req.params.meetingId, req.user.company_id);

    res.status(200).json({ meeting: insights });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/meetings/sync
 * 
 * Synchronize Google Meet transcripts from Google Drive.
 * (Zero-spend demo scope implementation)
 */
router.post('/sync', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const tenantId = req.user.company_id;

    // In a real scenario, retrieve the user's Google OAuth token from the database
    const supabase = require('../models/supabaseClient');
    const { data: creds } = await supabase
      .from('oauth_credentials')
      .select('access_token')
      .eq('tenant_id', tenantId)
      .eq('provider', 'google')
      .single();

    const token = creds?.access_token || process.env.DEMO_MOCK_TOKEN;

    if (!token) {
      return res.status(400).json({ error: 'Google Workspace not connected.' });
    }

    const { ingestGoogleMeetTranscripts } = require('../services/googleMeetIngestion');
    const result = await ingestGoogleMeetTranscripts(token, tenantId);

    res.status(200).json({
      message: `Successfully synchronized ${result.processedCount} meetings from Google Meet.`,
      ...result
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
