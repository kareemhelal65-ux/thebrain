const express = require('express');
const multer = require('multer');
const { webhookAuth } = require('../middleware/webhookAuth');
const { processWebhookTranscript, processAudioUpload, getMeetingInsights } = require('../services/meetingService');

const router = express.Router();
const upload = multer({ dest: 'uploads/meetings/' });

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

module.exports = router;
