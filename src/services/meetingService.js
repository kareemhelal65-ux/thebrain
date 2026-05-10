const { OpenAI } = require('openai');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const supabase = require('../models/supabaseClient');
const { generateEmbedding, upsertVector } = require('./embeddingService');

// OpenAI client for Whisper transcription
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Groq client for Llama 3.3 70B extraction
const groq = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.LLAMA_API_KEY
});

/**
 * MeetingProcessor — Multimodal Meeting Ingestion Engine
 * 
 * Handles two pipelines:
 * Pipeline A (Virtual): Webhook transcripts from Zoom/Meet/Teams
 * Pipeline B (Physical): Audio upload → Whisper transcription
 * 
 * Both pipelines converge at the extraction layer, which uses Llama 3.3 70B
 * to identify Decisions, Action Items, and Deadlines.
 */

// ═══════════════════════════════════════════════════════
// TRANSCRIPT NORMALIZERS (Pipeline A — Virtual)
// ═══════════════════════════════════════════════════════

/**
 * Normalize a Zoom webhook transcript to standard format.
 */
function normalizeZoomTranscript(webhookPayload) {
  const payload = webhookPayload.payload || webhookPayload;

  return {
    title: payload.object?.topic || 'Zoom Meeting',
    meeting_date: payload.object?.start_time || new Date().toISOString(),
    duration_minutes: payload.object?.duration || null,
    participants: (payload.object?.participant_users || []).map(p => ({
      name: p.user_name || p.name,
      email: p.email || null
    })),
    transcript: payload.object?.transcript_content
      || payload.object?.recording_files?.find(f => f.file_type === 'TRANSCRIPT')?.download_url
      || JSON.stringify(payload),
    source_type: 'zoom'
  };
}

/**
 * Normalize a Google Meet webhook transcript.
 */
function normalizeGoogleMeetTranscript(webhookPayload) {
  const data = webhookPayload.message?.data
    ? JSON.parse(Buffer.from(webhookPayload.message.data, 'base64').toString())
    : webhookPayload;

  return {
    title: data.conferenceRecord?.name || data.title || 'Google Meet',
    meeting_date: data.conferenceRecord?.startTime || new Date().toISOString(),
    duration_minutes: null,
    participants: (data.participants || []).map(p => ({
      name: p.displayName || p.name,
      email: p.email || null
    })),
    transcript: data.transcriptContent || data.transcript || JSON.stringify(data),
    source_type: 'google_meet'
  };
}

/**
 * Normalize a Microsoft Teams webhook transcript.
 */
function normalizeTeamsTranscript(webhookPayload) {
  const resource = webhookPayload.value?.[0]?.resource || webhookPayload;

  return {
    title: resource.subject || resource.topic || 'Teams Meeting',
    meeting_date: resource.startDateTime || new Date().toISOString(),
    duration_minutes: null,
    participants: (resource.attendees || resource.participants || []).map(p => ({
      name: p.identity?.user?.displayName || p.displayName || 'Unknown',
      email: p.identity?.user?.email || null
    })),
    transcript: resource.transcriptContent || resource.content || JSON.stringify(resource),
    source_type: 'teams'
  };
}

const NORMALIZERS = {
  'zoom': normalizeZoomTranscript,
  'google-meet': normalizeGoogleMeetTranscript,
  'google_meet': normalizeGoogleMeetTranscript,
  'teams': normalizeTeamsTranscript
};

/**
 * Normalize any webhook payload to a standard TranscriptDocument.
 */
function normalizeTranscript(provider, payload) {
  const normalizer = NORMALIZERS[provider];
  if (!normalizer) {
    throw new Error(`No transcript normalizer for provider: ${provider}`);
  }
  return normalizer(payload);
}

// ═══════════════════════════════════════════════════════
// AUDIO TRANSCRIPTION (Pipeline B — Physical)
// ═══════════════════════════════════════════════════════

/**
 * Transcribe an audio file using OpenAI Whisper.
 * @param {string} filePath - Path to the audio file
 * @param {string} originalName - Original file name
 * @returns {Promise<string>} Transcribed text
 */
async function transcribeAudio(filePath, originalName) {
  try {
    const fileStream = fs.createReadStream(filePath);

    const response = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file: fileStream,
      response_format: 'text',
      language: 'en' // Can be made configurable
    });

    return response;
  } catch (error) {
    console.error('Whisper transcription failed:', error);
    throw new Error(`Transcription failed: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════
// INSIGHT EXTRACTION (Shared Layer)
// ═══════════════════════════════════════════════════════

const EXTRACTION_PROMPT = `You are an expert meeting analyst. Analyze the following meeting transcript and extract structured insights.

Return your analysis as a JSON object with exactly these fields:
{
  "summary": "A concise 2-3 sentence summary of the meeting",
  "decisions": [
    { "decision": "What was decided", "context": "Brief context" }
  ],
  "action_items": [
    { "task": "What needs to be done", "assignee": "Who is responsible (or 'Unassigned')", "deadline": "When it's due (or 'Not specified')", "priority": "high/medium/low" }
  ],
  "deadlines": [
    { "item": "What has a deadline", "date": "The deadline date", "owner": "Who owns it" }
  ],
  "key_topics": ["topic1", "topic2"]
}

IMPORTANT: Return ONLY valid JSON, no markdown, no explanation.

TRANSCRIPT:
`;

/**
 * Extract insights from a transcript using Llama 3.3 70B.
 * @param {string} transcript - The meeting transcript text
 * @returns {Promise<Object>} Structured insights
 */
async function extractInsights(transcript) {
  try {
    // Truncate very long transcripts to avoid token limits
    const maxChars = 30000;
    const truncatedTranscript = transcript.length > maxChars
      ? transcript.substring(0, maxChars) + '\n\n[TRANSCRIPT TRUNCATED]'
      : transcript;

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'user', content: EXTRACTION_PROMPT + truncatedTranscript }
      ],
      temperature: 0.1,  // Low temperature for structured extraction
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content;
    return JSON.parse(content);
  } catch (error) {
    console.error('Insight extraction failed:', error);
    return {
      summary: 'Extraction failed — manual review required.',
      decisions: [],
      action_items: [],
      deadlines: [],
      key_topics: [],
      error: error.message
    };
  }
}

// ═══════════════════════════════════════════════════════
// VECTOR INDEXING
// ═══════════════════════════════════════════════════════

/**
 * Chunk text for embedding.
 */
function chunkText(text, maxChars = 1000) {
  const chunks = [];
  let current = '';
  const sentences = text.split(/(?<=[.?!])\s+/);

  for (const sentence of sentences) {
    if ((current.length + sentence.length) > maxChars) {
      if (current) chunks.push(current.trim());
      current = sentence + ' ';
    } else {
      current += sentence + ' ';
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

/**
 * Index meeting transcript and insights into the company's vector memory.
 */
async function indexMeetingToMemory(meetingId, companyId, transcript, insights, meetingDate) {
  // Combine transcript + structured insights for comprehensive indexing
  const insightText = [
    `Meeting Summary: ${insights.summary || ''}`,
    `Decisions: ${(insights.decisions || []).map(d => d.decision).join('; ')}`,
    `Action Items: ${(insights.action_items || []).map(a => `${a.task} (${a.assignee})`).join('; ')}`,
    `Key Topics: ${(insights.key_topics || []).join(', ')}`
  ].join('\n');

  const fullText = `${insightText}\n\nFull Transcript:\n${transcript}`;
  const chunks = chunkText(fullText);

  for (const chunk of chunks) {
    const vector = await generateEmbedding(chunk);
    const id = uuidv4();
    await upsertVector(id, vector, {
      company_id: companyId,
      document_name: `meeting_${meetingId}`,
      text_chunk: chunk,
      source_type: 'meeting',
      meeting_id: meetingId,
      meeting_date: meetingDate || new Date().toISOString()
    });
  }

  return chunks.length;
}

// ═══════════════════════════════════════════════════════
// MAIN PROCESSING PIPELINE
// ═══════════════════════════════════════════════════════

/**
 * Process a virtual meeting transcript (from webhook).
 */
async function processWebhookTranscript(provider, webhookPayload, companyId) {
  // Step 1: Normalize
  const normalized = normalizeTranscript(provider, webhookPayload);

  // Step 2: Extract insights
  const insights = await extractInsights(normalized.transcript);

  // Step 3: Save to database
  const { data: meeting, error } = await supabase
    .from('meetings')
    .insert([{
      company_id: companyId,
      source_type: normalized.source_type,
      title: normalized.title,
      raw_transcript: normalized.transcript,
      insights,
      meeting_date: normalized.meeting_date,
      duration_minutes: normalized.duration_minutes,
      participants: normalized.participants,
      processed_at: new Date().toISOString()
    }])
    .select()
    .single();

  if (error) throw new Error(`Failed to save meeting: ${error.message}`);

  // Step 4: Index into vector memory
  const chunksIndexed = await indexMeetingToMemory(
    meeting.id, companyId, normalized.transcript, insights, normalized.meeting_date
  );

  // Step 5: Mark as indexed
  await supabase
    .from('meetings')
    .update({ vector_indexed: true })
    .eq('id', meeting.id);

  return {
    meeting_id: meeting.id,
    title: normalized.title,
    insights,
    chunks_indexed: chunksIndexed
  };
}

/**
 * Process an uploaded audio file (physical meeting).
 */
async function processAudioUpload(filePath, originalName, companyId, title) {
  try {
    // Step 1: Transcribe with Whisper
    const transcript = await transcribeAudio(filePath, originalName);

    // Step 2: Extract insights
    const insights = await extractInsights(transcript);

    // Step 3: Save to database
    const { data: meeting, error } = await supabase
      .from('meetings')
      .insert([{
        company_id: companyId,
        source_type: 'audio_upload',
        title: title || originalName,
        raw_transcript: transcript,
        insights,
        meeting_date: new Date().toISOString(),
        processed_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw new Error(`Failed to save meeting: ${error.message}`);

    // Step 4: Index into vector memory
    const chunksIndexed = await indexMeetingToMemory(
      meeting.id, companyId, transcript, insights
    );

    // Step 5: Mark as indexed
    await supabase
      .from('meetings')
      .update({ vector_indexed: true })
      .eq('id', meeting.id);

    // Clean up uploaded file
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    return {
      meeting_id: meeting.id,
      title: title || originalName,
      insights,
      chunks_indexed: chunksIndexed
    };
  } catch (error) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    throw error;
  }
}

/**
 * Retrieve meeting insights by ID.
 */
async function getMeetingInsights(meetingId, companyId) {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', meetingId)
    .eq('company_id', companyId)
    .single();

  if (error) throw new Error(`Meeting not found: ${error.message}`);
  return data;
}

module.exports = {
  processWebhookTranscript,
  processAudioUpload,
  getMeetingInsights,
  normalizeTranscript,
  transcribeAudio,
  extractInsights
};
