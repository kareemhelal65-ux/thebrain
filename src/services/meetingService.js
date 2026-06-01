const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const supabase = require('../models/supabaseClient');
const { generateEmbedding, upsertVector } = require('./embeddingService');
const { groq } = require('./llmService');

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
 * @returns {Promise<{text: string, language: string|null, duration: number|null}>}
 *          Transcribed text plus the auto-detected spoken language and duration (seconds).
 */
async function transcribeAudio(filePath, originalName) {
  const path = require('path');
  const ext = path.extname(originalName) || '.mp3';
  const tempFilePath = filePath + ext;

  try {
    fs.renameSync(filePath, tempFilePath);
    const fileStream = fs.createReadStream(tempFilePath);

    // No `language` param → Whisper auto-detects the spoken language and transcribes
    // in that language. verbose_json also returns the detected language + duration.
    const response = await groq.audio.transcriptions.create({
      model: 'whisper-large-v3-turbo',
      file: fileStream,
      response_format: 'verbose_json',
    });

    return {
      text: typeof response === 'string' ? response : (response.text || ''),
      language: response?.language || null,
      duration: typeof response?.duration === 'number' ? response.duration : null,
    };
  } catch (error) {
    console.error('Whisper transcription failed:', error);
    throw new Error(`Transcription failed: ${error.message}`);
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.renameSync(tempFilePath, filePath);
    }
  }
}

// ═══════════════════════════════════════════════════════
// SPEAKER DIARIZATION (LLM-based, Phase 4)
// ═══════════════════════════════════════════════════════

/**
 * Infer speaker turns from a raw transcript using the LLM. Not as accurate as
 * true acoustic diarization (pyannote) but dramatically better than one wall of
 * text — uses names mentioned, pronoun shifts, and topic changes as cues.
 *
 * @param {string} transcript
 * @returns {Promise<Array<{speaker: string, text: string}>>} Speaker-segmented turns (empty array on failure)
 */
async function diarizeTranscript(transcript) {
  if (!transcript || transcript.trim().length < 40) return [];

  const maxChars = 24000;
  const input = transcript.length > maxChars ? transcript.substring(0, maxChars) + '\n[TRUNCATED]' : transcript;

  try {
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `Segment this meeting transcript into speaker turns. Infer speakers from names mentioned, pronoun shifts, and topic changes. If a speaker's name is unknown, label them "Speaker 1", "Speaker 2", etc. consistently.

Return ONLY JSON: {"segments":[{"speaker":"Name","text":"what they said"}, ...]}

TRANSCRIPT:
${input}`
      }],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
    return segments
      .filter(s => s && (s.text || s.speaker))
      .map(s => ({ speaker: String(s.speaker || 'Unknown').trim(), text: String(s.text || '').trim() }));
  } catch (err) {
    console.warn('[MeetingService] Diarization failed:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════
// TEAM ROSTER (for assigning action items to real people)
// ═══════════════════════════════════════════════════════

/**
 * Fetch named team members for a company (users joined with their profiles).
 * Only returns members who have a full name to match against.
 * @returns {Promise<Array<{user_id, full_name, position, department}>>}
 */
async function getTeamRoster(companyId) {
  try {
    const { data: members } = await supabase
      .from('users').select('id, role, department').eq('company_id', companyId);
    if (!members || members.length === 0) return [];
    const ids = members.map(m => m.id);
    const { data: profiles } = await supabase
      .from('user_profiles').select('user_id, full_name, position').in('user_id', ids);
    const pmap = {};
    (profiles || []).forEach(p => { pmap[p.user_id] = p; });
    // Return ALL members (the LLM-prompt builder filters to those with names; the
    // fallback assigner can still target a profile-less admin).
    return members.map(m => ({
      user_id: m.id,
      role: m.role || null,
      department: m.department || null,
      full_name: pmap[m.id]?.full_name || null,
      position: pmap[m.id]?.position || null,
    }));
  } catch (e) {
    console.warn('[MeetingService] getTeamRoster failed:', e.message);
    return [];
  }
}

/**
 * Resolve an assignee name string to a team member's user id (case/space-insensitive,
 * tolerant of first-name-only or partial matches). Returns null if no confident match.
 */
function resolveAssigneeUserId(assigneeName, roster) {
  if (!assigneeName || !Array.isArray(roster) || roster.length === 0) return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const target = norm(assigneeName);
  if (!target || target === 'unassigned') return null;
  // Exact full-name match first.
  let hit = roster.find(m => norm(m.full_name) === target);
  // Then first-name / contains match (e.g. "Kareem" → "Kareem Helal").
  if (!hit) hit = roster.find(m => {
    const full = norm(m.full_name);
    return full.startsWith(target + ' ') || full.split(' ')[0] === target || full.includes(target);
  });
  return hit ? hit.user_id : null;
}

const POSITION_KEYWORDS = {
  finance: ['finance', 'cfo', 'account', 'fundrais', 'invest'],
  commercial: ['sales', 'marketing', 'growth', 'bd', 'business development', 'revenue', 'crm'],
  product: ['product', 'engineer', 'cto', 'design', 'tech', 'developer', 'pm'],
  hr: ['hr', 'people', 'recruit', 'talent', 'culture'],
  operations: ['ops', 'operation', 'coo', 'legal', 'admin'],
};

/**
 * Fallback assignment so tasks don't sit unassigned: a single-member company gets
 * everything; multi-member picks the best fit by the task's department vs each
 * member's department/position, preferring the Admin as a tiebreaker.
 * @returns {{user_id, full_name}|null}
 */
function pickBestMember(roster, department) {
  if (!Array.isArray(roster) || roster.length === 0) return null;
  if (roster.length === 1) return roster[0];
  const dept = String(department || 'general').toLowerCase();
  const kws = POSITION_KEYWORDS[dept] || [];
  let best = null, bestScore = -1;
  for (const m of roster) {
    let score = 0;
    if (m.department && String(m.department).toLowerCase() === dept) score += 3;
    const pos = String(m.position || '').toLowerCase();
    if (kws.some(k => pos.includes(k))) score += 2;
    if (m.role === 'Admin') score += 0.5;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best || roster.find(m => m.role === 'Admin') || roster[0];
}

// ═══════════════════════════════════════════════════════
// INSIGHT EXTRACTION (Shared Layer)
// ═══════════════════════════════════════════════════════

const EXTRACTION_PROMPT = `You are an expert meeting analyst. Analyze the following meeting transcript and extract structured insights.

Return your analysis as a JSON object with exactly these fields:
{
  "title": "A short, specific title (3-7 words) capturing the MAIN topic discussed — e.g. 'Q3 Fundraising Strategy', 'Mobile App Onboarding Redesign'. No date, no generic words like 'Meeting' or 'Discussion'.",
  "summary": "A concise 2-3 sentence summary of the meeting",
  "decisions": [
    { 
      "temp_id": "string (temporary ID e.g. decision_temp_1, decision_temp_2 to map relations)",
      "decision": "What was decided", 
      "decider": "Who made the decision",
      "alternatives_rejected": ["Option A", "Option B"],
      "rationale": "Why this option was chosen",
      "outcome": "What happens next as a result"
    }
  ],
  "action_items": [
    {
      "task": "The OBJECTIVE / deliverable (a meaningful unit of work), NOT a tiny step",
      "assignee": "Who is responsible (or 'Unassigned')",
      "deadline": "Absolute date in YYYY-MM-DD. RESOLVE every relative reference against TODAY'S DATE given below (e.g. 'by Friday', 'end of the week', 'next Monday', 'in two weeks', 'end of the month', 'before the launch on the 15th'). If genuinely no due date was discussed, use 'Not specified'.",
      "priority": "high/medium/low",
      "department": "Which team owns this task — EXACTLY one of: operations | product | commercial | finance | hr | general. Pick the closest fit; 'general' is a LAST RESORT. Guide: commercial = sales/marketing/growth/social media/outreach/ads/marketing websites/CRM/partnerships; product = building the product/features/writing code/software systems/APIs/design/roadmap; finance = fundraising/investor pitch decks/budgets/runway/accounting/pricing; hr = hiring/recruiting/interviews/people/culture/employee onboarding; operations = internal ops/legal/compliance/IT/infrastructure/admin/tooling.",
      "related_decision_temp_id": "string (set to temp_id of decision extracted above if spawned by it, or null)",
      "related_decision_id": "string (set to existing decision database ID if spawned by an existing decision, or null)",
      "parent_action_id": "string (set to existing open action item database ID if this task is a sub-task or checklist item under that existing action item, otherwise null)",
      "sub_tasks": ["Sub-task step 1", "Sub-task step 2"]
    }
  ],
  "deadlines": [
    { "item": "What has a deadline", "date": "The deadline date", "owner": "Who owns it" }
  ],
  "key_topics": ["topic1", "topic2"]
}

IMPORTANT DEDUPLICATION & GROUPING RULES:
1. Deduplicate Decisions: Check the transcript against the "EXISTING RECENT DECISIONS" list. If a decision discussed in the transcript is already in the list, DO NOT output it in the "decisions" array.
2. Deduplicate Action Items: Check the transcript against the "EXISTING OPEN ACTION ITEMS" list. If a task is already in that list, DO NOT create a duplicate action item.
3. Group related tasks as Sub-tasks: If a new task in the transcript is actually a sub-step, detail, or checklist item under an existing open action item (from the "EXISTING OPEN ACTION ITEMS" list), DO NOT create a new action item. Instead, specify its "parent_action_id" pointing to the existing action item's ID, and list the task text as a new subtask item.
4. Link Action Items to Decisions: For any action item (new or existing mapped as subtask), if it is directly spawned by a decision extracted in this segment, set "related_decision_temp_id" to the "temp_id" of that decision. If it is related to an existing decision in the "EXISTING RECENT DECISIONS" list, set "related_decision_id" to the database ID of that decision.
5. For action_items sub_tasks: If a task has a list of nested steps, sub-tasks, or checklists discussed, extract these as an array of strings in sub_tasks. If there are no sub-tasks, return an empty array [].
6. ORGANIZE into cohesive objectives — this is critical. Do NOT emit a long flat list of tiny tasks, but also do NOT lump unrelated work under one giant objective. Group only the granular steps that DIRECTLY serve the same concrete goal under one action item (the "task" is that objective; its steps go in "sub_tasks"). Each objective must be tightly scoped — every sub_task clearly belongs to it. If steps serve different goals, create SEPARATE objectives. A standalone task with no real sub-steps stays its own action item (empty sub_tasks). Aim for several well-scoped objectives, not one catch-all and not 20 fragments.
7. A consolidated objective inherits the deadline of its latest/most-binding sub-step, and the assignee/department of the person who owns the overall objective.

Return ONLY valid JSON, no markdown, no explanation.

TRANSCRIPT:
`;

/**
 * Extract insights from a transcript using Llama 3.3 70B.
 * @param {string} transcript - The meeting transcript text
 * @param {string} companyId - The tenant company ID
 * @returns {Promise<Object>} Structured insights
 */
async function extractInsights(transcript, companyId) {
  try {
    let existingDecisions = [];
    let existingActionItems = [];
    let teamMembers = [];

    if (companyId) {
      try {
        const { data: decs } = await supabase
          .from('decisions')
          .select('id, text, made_by, date')
          .eq('tenant_id', companyId)
          .order('created_at', { ascending: false })
          .limit(40);
        if (decs) existingDecisions = decs;

        const { data: acts } = await supabase
          .from('action_items')
          .select('id, task, assignee, due_date, status, sub_tasks')
          .eq('tenant_id', companyId)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(40);
        if (acts) existingActionItems = acts;

        // Team roster — lets the model assign action items to real people by name.
        teamMembers = await getTeamRoster(companyId);
      } catch (dbErr) {
        console.warn('[MeetingService] Failed to fetch existing entities for context:', dbErr.message);
      }
    }

    let contextStr = '';
    if (existingDecisions.length > 0) {
      contextStr += '\n\n--- EXISTING RECENT DECISIONS (Use for deduplication check) ---\n';
      existingDecisions.forEach(d => {
        contextStr += `- [ID: ${d.id}] "${d.text}" (made by: ${d.made_by || 'Unknown'} on ${d.date || 'Unknown'})\n`;
      });
    }
    if (existingActionItems.length > 0) {
      contextStr += '\n\n--- EXISTING OPEN ACTION ITEMS (Use for deduplication & sub-task grouping checks) ---\n';
      existingActionItems.forEach(a => {
        const subTasksStr = Array.isArray(a.sub_tasks) && a.sub_tasks.length > 0
          ? ` (sub-tasks: ${a.sub_tasks.map(st => st.text).join(', ')})`
          : '';
        contextStr += `- [ID: ${a.id}] "${a.task}" (assignee: ${a.assignee || 'Unassigned'}, due: ${a.due_date || 'None'})${subTasksStr}\n`;
      });
    }
    const namedMembers = teamMembers.filter(m => m.full_name && m.full_name.trim());
    if (namedMembers.length > 0) {
      contextStr += '\n\n--- TEAM MEMBERS (set each action item\'s "assignee" to the EXACT full name of the most relevant person below when the task clearly belongs to them or their role; otherwise use "Unassigned") ---\n';
      namedMembers.forEach(m => {
        contextStr += `- ${m.full_name}${m.position ? ` — ${m.position}` : ''}${m.department ? ` (${m.department})` : ''}\n`;
      });
    }

    // Truncate very long transcripts to avoid token limits
    const maxChars = 30000;
    const truncatedTranscript = transcript.length > maxChars
      ? transcript.substring(0, maxChars) + '\n\n[TRANSCRIPT TRUNCATED]'
      : transcript;

    const todayStr = new Date().toISOString().split('T')[0];
    const dateLine = `\n\n--- TODAY'S DATE: ${todayStr} (resolve ALL relative deadlines to absolute YYYY-MM-DD against this date) ---\n`;

    const response = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [
        { role: 'user', content: EXTRACTION_PROMPT + dateLine + contextStr + '\n\nTRANSCRIPT:\n' + truncatedTranscript }
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

function isValidDate(dateStr) {
  if (!dateStr) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Normalize a model-produced deadline into YYYY-MM-DD, or null if none.
 * The LLM is asked to return ISO already; this is a safety net that also resolves
 * common relative phrases ("tomorrow", "next friday", "in 2 weeks", "end of month").
 */
function normalizeDueDate(raw, reference = new Date()) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s || s === 'not specified' || s === 'none' || s === 'tbd' || s === 'n/a') return null;

  // Already ISO (possibly with time) — take the date part if it's a real date.
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    const d = new Date(isoMatch[1] + 'T00:00:00');
    return isNaN(d.getTime()) ? null : isoMatch[1];
  }

  const fmt = (d) => {
    const x = new Date(d);
    if (isNaN(x.getTime())) return null;
    // Format in LOCAL time (not UTC) to avoid an off-by-one in non-UTC timezones.
    const y = x.getFullYear();
    const mo = String(x.getMonth() + 1).padStart(2, '0');
    const da = String(x.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  };
  const base = new Date(reference); base.setHours(0, 0, 0, 0);

  if (s === 'today') return fmt(base);
  if (s === 'tomorrow') { const d = new Date(base); d.setDate(d.getDate() + 1); return fmt(d); }

  let m;
  if ((m = s.match(/in\s+(\d+)\s+day/))) { const d = new Date(base); d.setDate(d.getDate() + parseInt(m[1], 10)); return fmt(d); }
  if ((m = s.match(/in\s+(\d+)\s+week/))) { const d = new Date(base); d.setDate(d.getDate() + parseInt(m[1], 10) * 7); return fmt(d); }
  if ((m = s.match(/in\s+(\d+)\s+month/))) { const d = new Date(base); d.setMonth(d.getMonth() + parseInt(m[1], 10)); return fmt(d); }

  if (s.includes('end of the week') || s.includes('end of week') || s === 'eow') {
    const d = new Date(base); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7)); return fmt(d); // Friday
  }
  if (s.includes('end of the month') || s.includes('end of month') || s === 'eom') {
    const d = new Date(base.getFullYear(), base.getMonth() + 1, 0); return fmt(d);
  }
  if (s.includes('next week')) { const d = new Date(base); d.setDate(d.getDate() + 7); return fmt(d); }

  // Weekday names, optionally prefixed with "next"/"this"/"by".
  const wd = WEEKDAYS.findIndex(w => s.includes(w));
  if (wd >= 0) {
    const d = new Date(base);
    let delta = (wd - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7;            // "Friday" when today is Friday → next Friday
    if (s.includes('next')) delta += (delta <= 0 ? 7 : 0);
    d.setDate(d.getDate() + delta);
    return fmt(d);
  }

  // Last resort: let Date try (handles "March 15, 2026", "Mar 15").
  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) {
    // Guard against year defaulting to 2001 etc.; require a 4-digit year or assume current.
    if (!/\d{4}/.test(s)) parsed.setFullYear(base.getFullYear());
    return fmt(parsed);
  }
  return null;
}

async function registerMeetingEntities(meeting, companyId, insights, department) {
  try {
    // Roster for resolving action-item assignees to real team members.
    const roster = await getTeamRoster(companyId);
    // 1. Insert into brain_documents
    const { error: docError } = await supabase
      .from('brain_documents')
      .insert([{
        id: meeting.id,
        company_id: companyId,
        title: meeting.title || 'Untitled Meeting',
        document_type: 'meeting',
        content: meeting.raw_transcript || '',
        metadata: { source: 'meeting', meeting_id: meeting.id },
        department: department || 'general',
        semantic_type: 'discussion',
        sub_type: 'meeting'
      }]);

    if (docError) {
      console.error('[MeetingService] Error registering meeting doc:', docError.message);
    }

    // 2. Insert Decisions (retaining temp_id mapping to link Action Items)
    const insertedDecisions = [];
    if (insights?.decisions && insights.decisions.length > 0) {
      const defaultDate = meeting.meeting_date 
        ? new Date(meeting.meeting_date).toISOString().split('T')[0] 
        : new Date().toISOString().split('T')[0];
        
      for (const d of insights.decisions) {
        const { data: newDec, error: decError } = await supabase
          .from('decisions')
          .insert([{
            tenant_id: companyId,
            source_doc_id: meeting.id,
            text: d.decision,
            made_by: d.decider || null,
            date: defaultDate
          }])
          .select()
          .single();
        if (decError) {
          console.error('[MeetingService] Error inserting decisions:', decError.message);
        } else if (newDec) {
          insertedDecisions.push({ temp_id: d.temp_id, db_id: newDec.id });
        }
      }
    }

    // 3. Insert or update Action Items
    if (insights?.action_items && insights.action_items.length > 0) {
      for (const a of insights.action_items) {
        if (a.parent_action_id) {
          // Append to existing action item's sub_tasks
          const { data: existingItem, error: fetchErr } = await supabase
            .from('action_items')
            .select('sub_tasks')
            .eq('id', a.parent_action_id)
            .single();
          if (!fetchErr && existingItem) {
            const currentSubTasks = existingItem.sub_tasks || [];
            const newSubs = Array.isArray(a.sub_tasks) && a.sub_tasks.length > 0 ? a.sub_tasks : [a.task];
            newSubs.forEach(text => {
              if (text && !currentSubTasks.some(st => st.text.toLowerCase().trim() === text.toLowerCase().trim())) {
                currentSubTasks.push({ id: uuidv4(), text, status: 'open' });
              }
            });
            await supabase
              .from('action_items')
              .update({ sub_tasks: currentSubTasks })
              .eq('id', a.parent_action_id);
          }
        } else {
          // Link to decision
          let decisionId = null;
          if (a.related_decision_id) {
            decisionId = a.related_decision_id;
          } else if (a.related_decision_temp_id) {
            const foundDec = insertedDecisions.find(idMap => idMap.temp_id === a.related_decision_temp_id);
            if (foundDec) decisionId = foundDec.db_id;
          }

          const subTasksMapped = Array.isArray(a.sub_tasks)
            ? a.sub_tasks.map(st => ({ id: uuidv4(), text: st, status: 'open' }))
            : [];

          // Assign each action item to a department so it shows up under the right
          // group in the Decision Log. Prefer the LLM's per-item classification;
          // fall back to the meeting-level department from classifyDepartment.
          const VALID_DEPTS = ['operations', 'product', 'commercial', 'finance', 'hr', 'general'];
          const itemDept = (a.department && VALID_DEPTS.includes(String(a.department).toLowerCase().trim()))
            ? String(a.department).toLowerCase().trim()
            : (department || 'general');

          // Resolve to a real teammate by name; if the model left it unassigned,
          // fall back to the best-fit member so tasks never sit ownerless.
          let assigneeUserId = resolveAssigneeUserId(a.assignee, roster);
          let assigneeName = (a.assignee && a.assignee.trim().toLowerCase() !== 'unassigned') ? a.assignee : null;
          if (!assigneeUserId) {
            const fallback = pickBestMember(roster, itemDept);
            if (fallback) {
              assigneeUserId = fallback.user_id;
              if (!assigneeName && fallback.full_name) assigneeName = fallback.full_name;
            }
          }

          const { error: actError } = await supabase
            .from('action_items')
            .insert([{
              tenant_id: companyId,
              source_doc_id: meeting.id,
              task: a.task,
              assignee: assigneeName,
              assignee_user_id: assigneeUserId,
              due_date: normalizeDueDate(a.deadline),
              status: 'open',
              department: itemDept,
              sub_tasks: subTasksMapped,
              decision_id: decisionId
            }]);
          if (actError) console.error('[MeetingService] Error inserting action items:', actError.message);
        }
      }
    }
  } catch (err) {
    console.error('[MeetingService] Error in registerMeetingEntities:', err.message);
  }
}

/**
 * Index meeting transcript and insights into the company's vector memory.
 * Stores to pgvector (Supabase) for the demo, and optionally to Pinecone.
 */
async function indexMeetingToMemory(meetingId, companyId, transcript, insights, meetingDate, meetingTitle) {
  // --- INTELLIGENCE PIPELINE ---
  const { classifyDepartment } = require('./intelligencePipeline');
  const department = await classifyDepartment(transcript);
  
  // Register as brain document and extract decisions/action items
  await registerMeetingEntities({
    id: meetingId,
    title: meetingTitle,
    raw_transcript: transcript,
    meeting_date: meetingDate
  }, companyId, insights, department);
  // -----------------------------

  // Combine transcript + structured insights for comprehensive indexing
  const insightText = [
    `Meeting Summary: ${insights.summary || ''}`,
    `Decisions: ${(insights.decisions || []).map(d => d.decision).join('; ')}`,
    `Action Items: ${(insights.action_items || []).map(a => `${a.task} (${a.assignee})`).join('; ')}`,
    `Key Topics: ${(insights.key_topics || []).join(', ')}`
  ].join('\n');

  const fullText = `${insightText}\n\nFull Transcript:\n${transcript}`;
  const chunks = chunkText(fullText);
  const vectorStore = process.env.VECTOR_STORE || 'supabase';

  for (const chunk of chunks) {
    const vector = await generateEmbedding(chunk);
    const id = uuidv4();

    // Store to Supabase pgvector (primary for demo)
    if (vectorStore === 'supabase') {
      try {
        await supabase.from('document_chunks').insert([{
          id,
          tenant_id: companyId,
          content: chunk,
          embedding: JSON.stringify(vector),
          source_type: 'meeting',
          source_id: meetingId,
          source_title: meetingTitle || `Meeting ${meetingId}`,
          metadata: {
            meeting_id: meetingId,
            meeting_date: meetingDate || new Date().toISOString(),
            department,     // From intelligence pipeline
            entities: insights // Extracted structural knowledge
          }
        }]);
      } catch (pgErr) {
        console.error('[pgvector] Insert failed:', pgErr.message);
      }
    }

    // Also store to Pinecone if configured (post-raise)
    if (vectorStore === 'pinecone' || process.env.PINECONE_API_KEY) {
      try {
        await upsertVector(id, vector, {
          company_id: companyId,
          document_name: `meeting_${meetingId}`,
          text_chunk: chunk,
          source_type: 'meeting',
          meeting_id: meetingId,
          meeting_date: meetingDate || new Date().toISOString()
        });
      } catch (pcErr) {
        console.warn('[Pinecone] Upsert skipped:', pcErr.message);
      }
    }
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

  // Step 2: Extract insights (+ speaker diarization)
  const insights = await extractInsights(normalized.transcript, companyId);
  try { insights.speaker_segments = await diarizeTranscript(normalized.transcript); } catch { /* non-fatal */ }

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
    meeting.id, companyId, normalized.transcript, insights, normalized.meeting_date, normalized.title
  );

  // Step 5: Mark as indexed
  await supabase
    .from('meetings')
    .update({ vector_indexed: true })
    .eq('id', meeting.id);

  // Step 6: Send Slack notification
  try {
    const { notifyMeetingSummary } = require('./slackNotificationService');
    await notifyMeetingSummary({
      title: normalized.title,
      meeting_date: normalized.meeting_date,
      source_type: normalized.source_type,
      insights,
    });
  } catch (slackErr) {
    console.warn('[Slack] Notification failed:', slackErr.message);
  }

  // Step 7: Auto-trigger the Meeting agent in the background (fire-and-forget)
  autoTriggerMeetingAgent(meeting.id, companyId, normalized.transcript, insights, normalized.title)
    .catch(err => console.warn('[MeetingService] auto-trigger failed:', err.message));

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
/**
 * COMPUTE half: transcribe audio + extract insights (+ diarization). Persists NOTHING.
 * Used by both the normal upload flow and the ephemeral brainstorming flow.
 * @returns {Promise<{transcript, language, duration, insights}>}
 */
async function transcribeMeeting(filePath, originalName, companyId = null) {
  const { text: transcript, language: detectedLanguage, duration } = await transcribeAudio(filePath, originalName);
  const insights = await extractInsights(transcript, companyId);
  try { insights.speaker_segments = await diarizeTranscript(transcript); } catch { /* non-fatal */ }
  if (detectedLanguage) insights.language = detectedLanguage;
  return { transcript, language: detectedLanguage || null, duration: duration || null, insights };
}

/**
 * PERSIST half: save a meeting + index to memory + notify + auto-trigger the Meeting
 * agent. Used when the user explicitly stores (upload, or "Store to Brain" on a brainstorm).
 */
async function storeMeeting({ companyId, title, transcript, language, insights, sourceType = 'audio_upload', durationMinutes = null, indexToBrain = true }) {
  const finalInsights = insights || {};
  if (language && !finalInsights.language) finalInsights.language = language;

  // Prefer the AI-generated topic title; fall back to whatever the caller passed.
  const finalTitle = (finalInsights.title && String(finalInsights.title).trim())
    ? String(finalInsights.title).trim()
    : (title || 'Untitled');

  const { data: meeting, error } = await supabase
    .from('meetings')
    .insert([{
      company_id: companyId,
      source_type: sourceType,
      title: finalTitle,
      raw_transcript: transcript,
      insights: finalInsights,
      duration_minutes: durationMinutes,
      meeting_date: new Date().toISOString(),
      processed_at: new Date().toISOString(),
      vector_indexed: false,
    }])
    .select()
    .single();

  if (error) throw new Error(`Failed to save meeting: ${error.message}`);

  // A brainstorm is saved to the Meetings tab but NOT committed to the Brain
  // (no memory indexing, no decisions/actions registered) until the user asks.
  if (!indexToBrain) {
    return { meeting_id: meeting.id, title: finalTitle, insights: finalInsights, stored_to_brain: false };
  }

  const chunksIndexed = await indexMeetingToMemory(meeting.id, companyId, transcript, finalInsights, null, finalTitle);
  await supabase.from('meetings').update({ vector_indexed: true }).eq('id', meeting.id);

  try {
    const { notifyMeetingSummary } = require('./slackNotificationService');
    await notifyMeetingSummary({ title: finalTitle, meeting_date: new Date().toISOString(), source_type: sourceType, insights: finalInsights });
  } catch (slackErr) {
    console.warn('[Slack] Notification failed:', slackErr.message);
  }

  autoTriggerMeetingAgent(meeting.id, companyId, transcript, finalInsights, finalTitle)
    .catch(err => console.warn('[MeetingService] auto-trigger failed:', err.message));

  return { meeting_id: meeting.id, title: finalTitle, insights: finalInsights, chunks_indexed: chunksIndexed, stored_to_brain: true };
}

/**
 * Commit an already-saved meeting/brainstorm to the Brain: index its transcript to
 * vector memory and register its decisions + action items. Idempotent. Does NOT
 * launch agents (the user does that explicitly via "Send to agents").
 */
async function commitMeetingToBrain(meetingId, companyId) {
  const { data: meeting, error } = await supabase
    .from('meetings').select('*').eq('id', meetingId).eq('company_id', companyId).single();
  if (error || !meeting) throw new Error('Meeting not found');
  if (meeting.vector_indexed) {
    return { meeting_id: meetingId, already_stored: true, insights: meeting.insights || {} };
  }

  const chunksIndexed = await indexMeetingToMemory(
    meetingId, companyId, meeting.raw_transcript || '', meeting.insights || {}, meeting.meeting_date, meeting.title
  );
  await supabase.from('meetings').update({ vector_indexed: true }).eq('id', meetingId);

  try {
    const { notifyMeetingSummary } = require('./slackNotificationService');
    await notifyMeetingSummary({ title: meeting.title, meeting_date: meeting.meeting_date, source_type: meeting.source_type, insights: meeting.insights || {} });
  } catch (slackErr) {
    console.warn('[Slack] Notification failed:', slackErr.message);
  }

  return { meeting_id: meetingId, chunks_indexed: chunksIndexed, stored_to_brain: true, insights: meeting.insights || {} };
}

async function processAudioUpload(filePath, originalName, companyId, title) {
  try {
    const { transcript, language, duration, insights } = await transcribeMeeting(filePath, originalName, companyId);
    const durationMinutes = duration ? Math.max(1, Math.round(duration / 60)) : null;
    return await storeMeeting({
      companyId, title: title || originalName, transcript, language, insights,
      sourceType: 'audio_upload', durationMinutes,
    });
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

/**
 * Auto-trigger the Meeting agent in the background after a meeting is ingested.
 * The transcript + pre-extracted insights ARE the context, so discovery questions
 * are skipped. The agent produces structured output (decisions, action items,
 * follow-up email drafts) that the user finds ready on their dashboard.
 */
async function autoTriggerMeetingAgent(meetingId, companyId, transcript, insights, title) {
  try {
    const { data: companyProfile } = await supabase
      .from('companies').select('*').eq('id', companyId).single();

    // Use a real admin user for audit context when available; fall back to a system Admin.
    let user = { id: null, company_id: companyId, role: 'Admin', department: 'operations' };
    try {
      const { data: adminUser } = await supabase
        .from('users')
        .select('id, company_id, role, department')
        .eq('company_id', companyId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (adminUser) user = { ...adminUser, role: adminUser.role || 'Admin' };
    } catch { /* keep system user */ }

    const insightsStr = insights
      ? JSON.stringify({
          summary: insights.summary,
          decisions: insights.decisions,
          action_items: insights.action_items,
          key_topics: insights.key_topics,
        }).substring(0, 4000)
      : '';

    const contextMessage =
      `A meeting titled "${title || 'Untitled'}" just concluded and was transcribed. ` +
      `Produce the structured meeting deliverable (decisions, action_items, follow_up_emails, open_questions) ` +
      `from this transcript and the pre-extracted insights below. Do NOT ask discovery questions — act on what is here.\n\n` +
      `PRE-EXTRACTED INSIGHTS:\n${insightsStr}\n\n` +
      `TRANSCRIPT (may be truncated):\n${(transcript || '').substring(0, 12000)}`;

    const { launchAgentWithContext } = require('./agentOrchestrator');
    await launchAgentWithContext({
      companyId,
      agentType: 'meeting',
      companyProfile: companyProfile || { id: companyId, name: title || 'Company' },
      user,
      contextMessage,
    });
    console.log(`[MeetingService] Auto-triggered Meeting agent for meeting ${meetingId}`);
  } catch (err) {
    console.warn('[MeetingService] Auto-trigger Meeting agent failed:', err.message);
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

/**
 * Keyword search over a company's meeting transcripts, titles, and summaries.
 * @param {string} companyId
 * @param {Object} [opts]
 * @param {string} [opts.query] - Keyword(s) to match
 * @param {string} [opts.participant] - Participant name/email to match
 * @param {string} [opts.date_from] - ISO date lower bound
 * @param {string} [opts.date_to] - ISO date upper bound
 * @param {number} [opts.limit=25]
 */
async function searchMeetings(companyId, { query, participant, date_from, date_to, limit = 25 } = {}) {
  let q = supabase
    .from('meetings')
    .select('id, title, meeting_date, source_type, duration_minutes, participants, insights')
    .eq('company_id', companyId);

  if (date_from) q = q.gte('meeting_date', date_from);
  if (date_to) q = q.lte('meeting_date', date_to);

  if (query && query.trim()) {
    const term = `%${query.trim()}%`;
    // Match against title or raw transcript
    q = q.or(`title.ilike.${term},raw_transcript.ilike.${term}`);
  }

  q = q.order('meeting_date', { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) throw new Error(`Meeting search failed: ${error.message}`);

  let results = data || [];

  // Participant filter (participants is JSONB array) — filter in-memory for flexibility
  if (participant && participant.trim()) {
    const p = participant.trim().toLowerCase();
    results = results.filter(m =>
      Array.isArray(m.participants) &&
      m.participants.some(x => `${x.name || ''} ${x.email || ''}`.toLowerCase().includes(p)));
  }

  return results.map(m => ({
    id: m.id,
    title: m.title,
    meeting_date: m.meeting_date,
    source_type: m.source_type,
    duration_minutes: m.duration_minutes,
    participants: m.participants,
    summary: m.insights?.summary || '',
  }));
}

module.exports = {
  processWebhookTranscript,
  processAudioUpload,
  getMeetingInsights,
  normalizeTranscript,
  transcribeAudio,
  extractInsights,
  diarizeTranscript,
  autoTriggerMeetingAgent,
  searchMeetings,
  normalizeDueDate,
  transcribeMeeting,
  storeMeeting,
  commitMeetingToBrain,
};
