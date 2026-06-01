/**
 * Approval Service
 * 
 * Manages the approval workflow for agent-produced deliverables.
 * 
 * Flow:
 * 1. Agent produces output → createApproval() stores it as 'pending_approval'
 * 2. User reviews in Decisions page → approves or rejects
 * 3. If approved → storeOutputToBrain() saves it permanently to document_chunks
 * 4. If rejected → record feedback, allow agent to revise
 * 
 * Output Types:
 * - marketing_strategy: Full marketing strategy document
 * - lead_list: List of potential leads with details
 * - investor_list: List of matching investors with details
 * - competitor_analysis: Competitive landscape analysis
 * - company_profile: Company research profile
 * - content_draft: Marketing content drafts
 * - social_post: Ready-to-publish social media posts
 */

const supabase = require('../models/supabaseClient');
const { generateEmbedding } = require('./embeddingService');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a new approval record for an agent output.
 * @param {Object} params
 * @param {string} params.executionId - Agent execution ID
 * @param {string} params.companyId - Company ID
 * @param {string} params.outputType - Type of output
 * @param {string} params.title - Display title
 * @param {string} params.summary - One-paragraph summary
 * @param {Object} params.content - Full structured content
 * @returns {Promise<Object>} Created approval record
 */
async function createApproval({ executionId, companyId, outputType, title, summary, content }) {
  // ─── Versioning (Phase A): if a prior output of the SAME type exists for this
  // execution, this is a revision — link it and bump the version. Different types
  // (e.g. a 'plan' followed by the real deliverable) are NOT treated as revisions.
  let version = 1;
  let revisionOf = null;
  try {
    const { data: prior } = await supabase
      .from('agent_outputs')
      .select('id, version')
      .eq('agent_execution_id', executionId)
      .eq('output_type', outputType)
      .order('version', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    if (prior && prior.length > 0) {
      version = (prior[0].version || 1) + 1;
      revisionOf = prior[0].id;
    }
  } catch (e) {
    console.warn('[ApprovalService] version lookup failed:', e.message);
  }

  const record = {
    agent_execution_id: executionId,
    company_id: companyId,
    output_type: outputType,
    title,
    summary: summary || content?.summary || '',
    content: content || {},
    status: 'pending_approval',
    version,
    revision_of: revisionOf,
  };

  const { data, error } = await supabase
    .from('agent_outputs')
    .insert([record])
    .select()
    .single();

  if (error) {
    console.error('[ApprovalService] Failed to create approval:', error.message);
    throw new Error(`Failed to create approval: ${error.message}`);
  }

  // When this is a revision, mark the predecessor's open comments as addressed —
  // the new version is the response to them.
  if (revisionOf) {
    await supabase
      .from('agent_output_comments')
      .update({ status: 'addressed' })
      .eq('agent_output_id', revisionOf)
      .eq('status', 'open');
  }

  console.log(`[ApprovalService] Created approval: "${title}" (${outputType}) v${version}`);
  return data;
}

/**
 * Add a review comment to an agent output (Phase A3).
 * section_ref: null = threaded/whole-deliverable; non-null = a section/step/file anchor.
 */
async function addOutputComment({ outputId, user, body, sectionRef = null }) {
  const { data: output, error: fetchError } = await supabase
    .from('agent_outputs')
    .select('id, company_id')
    .eq('id', outputId)
    .single();
  if (fetchError || !output) throw new Error('Output not found');
  if (output.company_id !== user.company_id) throw new Error('Unauthorized');

  const { data, error } = await supabase
    .from('agent_output_comments')
    .insert([{
      agent_output_id: outputId,
      company_id: output.company_id,
      user_id: user.id,
      body: String(body || '').trim(),
      section_ref: sectionRef || null,
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Get the comment thread for an output (Phase A3).
 */
async function getOutputComments(outputId, user) {
  const { data: output } = await supabase
    .from('agent_outputs')
    .select('company_id')
    .eq('id', outputId)
    .single();
  if (!output) throw new Error('Output not found');
  if (output.company_id !== user.company_id) throw new Error('Unauthorized');

  const { data, error } = await supabase
    .from('agent_output_comments')
    .select('*')
    .eq('agent_output_id', outputId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

/**
 * Submit the open comments on an output as a revision brief and resume the agent
 * to produce a revised version (Phase A4). Does NOT hard-reject — the deliverable
 * stays in review while the agent iterates.
 */
async function requestRevision(outputId, user) {
  const { data: output, error: fetchError } = await supabase
    .from('agent_outputs')
    .select('*')
    .eq('id', outputId)
    .single();
  if (fetchError || !output) throw new Error('Output not found');
  if (output.company_id !== user.company_id) throw new Error('Unauthorized');

  // Require at least one open comment to act on.
  const { data: open } = await supabase
    .from('agent_output_comments')
    .select('id')
    .eq('agent_output_id', outputId)
    .eq('status', 'open')
    .limit(1);
  if (!open || open.length === 0) {
    throw new Error('No open comments to revise against. Add a comment first.');
  }

  if (output.agent_execution_id) {
    await supabase
      .from('agent_executions')
      .update({
        status: 'running',
        current_action: 'Revising based on your comments...',
        updated_at: new Date().toISOString(),
      })
      .eq('id', output.agent_execution_id);

    try {
      const { resumeAgentWorkWithComments } = require('./agentOrchestrator');
      resumeAgentWorkWithComments(output.agent_execution_id, user).catch(err =>
        console.error('[ApprovalService] Failed to resume for comments:', err.message));
    } catch (err) {
      console.error('[ApprovalService] Failed to load agentOrchestrator for comment resume:', err.message);
    }
  }
  return { success: true };
}

/**
 * Approve an agent output and store it to The Brain's permanent memory.
 * @param {string} outputId - Agent output ID
 * @param {Object} user - User approving
 * @param {Object} [options]
 * @param {string} [options.feedback] - Optional approval note
 * @returns {Promise<Object>} Updated output with brain storage info
 */
async function approveOutput(outputId, user, options = {}) {
  const { data: output, error: fetchError } = await supabase
    .from('agent_outputs')
    .select('*')
    .eq('id', outputId)
    .single();

  if (fetchError || !output) {
    throw new Error('Output not found');
  }

  // Verify company ownership
  if (output.company_id !== user.company_id) {
    throw new Error('Unauthorized: output belongs to a different company');
  }

  // ─── Plan approval (Phase A0): a 'plan' is not a final deliverable. Approving it
  // flips the execution from planning → executing and resumes the agent to build the
  // real deliverable, instead of completing the run or storing the plan to the Brain. ───
  if (output.output_type === 'plan') {
    const { data: exec } = await supabase
      .from('agent_executions')
      .select('conversation_history')
      .eq('id', output.agent_execution_id)
      .single();

    const history = Array.isArray(exec?.conversation_history) ? exec.conversation_history : [];
    history.push({
      role: 'user',
      content: `The plan was APPROVED. Now EXECUTE it fully and produce the actual deliverable via produce_agent_output. Approved plan:\n${JSON.stringify(output.content || {})}`,
      timestamp: new Date().toISOString(),
    });

    const { data: updatedPlan } = await supabase
      .from('agent_outputs')
      .update({
        status: 'approved',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', outputId)
      .select()
      .single();

    await supabase
      .from('agent_executions')
      .update({
        mode: 'executing',
        status: 'running',
        current_action: 'Executing approved plan...',
        conversation_history: history,
        progress_pct: 45,
        updated_at: new Date().toISOString(),
      })
      .eq('id', output.agent_execution_id);

    try {
      const { resumeAgentExecution } = require('./agentOrchestrator');
      resumeAgentExecution(output.agent_execution_id, user).catch(err =>
        console.error('[ApprovalService] Failed to resume after plan approval:', err.message));
    } catch (err) {
      console.error('[ApprovalService] Failed to load agentOrchestrator for plan resume:', err.message);
    }

    console.log(`[ApprovalService] Plan approved → executing: "${output.title}"`);
    return updatedPlan;
  }

  // ─── Store to The Brain ───
  let brainDocId = null;
  try {
    brainDocId = await storeOutputToBrain(output);
  } catch (err) {
    console.error('[ApprovalService] Failed to store to brain:', err.message);
    // Non-fatal — approval still goes through
  }

  // Update the approval record
  const updates = {
    status: 'approved',
    feedback: options.feedback || null,
    approved_by: user.id,
    approved_at: new Date().toISOString(),
    stored_in_brain: !!brainDocId,
    brain_document_id: brainDocId,
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error: updateError } = await supabase
    .from('agent_outputs')
    .update(updates)
    .eq('id', outputId)
    .select()
    .single();

  if (updateError) throw updateError;

  // ─── Update the agent execution ───
  if (output.agent_execution_id) {
    await supabase
      .from('agent_executions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', output.agent_execution_id);
  }

  // ─── Auto-complete related roadmap objectives ───
  try {
    const { autoCompleteObjectivesOnApproval } = require('./roadmapService');
    if (output.agent_execution_id) {
      // Get the agent type from the execution
      const { data: exec } = await supabase
        .from('agent_executions')
        .select('agent_type')
        .eq('id', output.agent_execution_id)
        .single();

      if (exec) {
        await autoCompleteObjectivesOnApproval(user.company_id, exec.agent_type, output.content || {});
        // Also let the agent contribute objectives to the roadmap
        const { addAgentContributedObjectives } = require('./roadmapService');
        if (output.content && output.content.objectives) {
          await addAgentContributedObjectives(user.company_id, exec.agent_type, output.content);
        }
      }
    }
  } catch (roadmapErr) {
    console.error('[ApprovalService] Failed to update roadmap objectives:', roadmapErr.message);
    // Non-fatal — approval still goes through
  }

  // ─── Closed feedback loop (Phase 1C): persist approved output as a few-shot example ───
  try {
    let agentType = null;
    if (output.agent_execution_id) {
      const { data: exec } = await supabase
        .from('agent_executions')
        .select('agent_type')
        .eq('id', output.agent_execution_id)
        .single();
      agentType = exec?.agent_type || null;
    }
    if (agentType) {
      await saveAgentExample({ companyId: output.company_id, agentType, output });
      // Capture the comments that preceded this approval (across the revision chain)
      // so learning + the playbook reflect what the founder asked us to change.
      const priorComments = await getRevisionChainComments(output);
      // Fire-and-forget preference synthesis (now also distills avoid-rules from comments)
      synthesizeAgentPreferences(output.company_id, agentType, priorComments).catch(err =>
        console.warn('[ApprovalService] Preference synthesis failed:', err.message));
      // Fire-and-forget: distill a reusable "play" into the growing playbook (Phase B2)
      distillPlaybook(output.company_id, agentType, output, priorComments).catch(err =>
        console.warn('[ApprovalService] Playbook distill failed:', err.message));
    }
  } catch (exampleErr) {
    console.warn('[ApprovalService] Failed to save agent example:', exampleErr.message);
    // Non-fatal — approval still goes through
  }

  console.log(`[ApprovalService] Approved: "${output.title}"`);
  return updated;
}

/**
 * Persist an approved output as a company-specific few-shot example for its agent type.
 */
async function saveAgentExample({ companyId, agentType, output }) {
  const { error } = await supabase.from('agent_examples').insert([{
    company_id: companyId,
    agent_type: agentType,
    title: output.title,
    content_summary: output.summary || '',
    full_content: output.content || {},
    output_type: output.output_type || null,
  }]);
  if (error) {
    console.warn('[ApprovalService] agent_examples insert failed:', error.message);
  } else {
    console.log(`[ApprovalService] Saved approved example for ${agentType}: "${output.title}"`);
  }
}

/**
 * Gather all reviewer comments across an output's revision chain (this output plus
 * any predecessors via revision_of). Used to feed learning + the playbook.
 */
async function getRevisionChainComments(output) {
  const ids = [output.id];
  let cur = output;
  // Walk back up the revision chain (bounded).
  for (let i = 0; i < 10 && cur && cur.revision_of; i++) {
    const { data: prev } = await supabase
      .from('agent_outputs')
      .select('id, revision_of')
      .eq('id', cur.revision_of)
      .single();
    if (!prev) break;
    ids.push(prev.id);
    cur = prev;
  }
  const { data: comments } = await supabase
    .from('agent_output_comments')
    .select('body, section_ref')
    .in('agent_output_id', ids);
  return comments || [];
}

/** Cosine similarity between two equal-length number arrays. */
function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Distill a reusable "play" from an approved output (Phase B2) and store it in the
 * growing playbook. Dedups against existing plays by embedding similarity — a near
 * duplicate bumps win_count instead of inserting.
 */
async function distillPlaybook(companyId, agentType, output, comments = []) {
  const { callLLMWithTools } = require('./llmService');
  const commentStr = (comments || []).map(c => `- ${c.section_ref ? `[${c.section_ref}] ` : ''}${c.body}`).join('\n');
  const prompt = `An output from the "${agentType}" agent was APPROVED by the company. Distill ONE reusable "play" that future runs of this agent should follow to get approved faster. Return ONLY JSON: {"trigger": "when this play applies (short)", "play": "the distilled, reusable approach/structure that worked (2-4 sentences)"}.

APPROVED OUTPUT
Title: ${output.title}
Type: ${output.output_type}
Summary: ${output.summary || ''}
Content: ${JSON.stringify(output.content || {}).substring(0, 2000)}
${commentStr ? `\nREVIEWER CHANGES THAT LED TO APPROVAL:\n${commentStr}` : ''}`;

  let distilled;
  try {
    const resp = await callLLMWithTools(
      [{ role: 'system', content: prompt }],
      [],
      { model: 'llama-3.3-70b-versatile', response_format: { type: 'json_object' }, temperature: 0.3 }
    );
    distilled = JSON.parse(resp.content);
  } catch (err) {
    console.warn('[ApprovalService] distillPlaybook LLM failed:', err.message);
    return;
  }
  if (!distilled || !distilled.play) return;

  let embedding = null;
  try {
    embedding = await generateEmbedding(`${distilled.trigger || ''} ${distilled.play}`.substring(0, 2000));
  } catch { /* embedding optional */ }

  // Dedup against existing plays for this agent.
  const { data: existing } = await supabase
    .from('agent_playbooks')
    .select('id, embedding, win_count')
    .eq('company_id', companyId)
    .eq('agent_type', agentType);

  if (embedding && Array.isArray(existing)) {
    for (const row of existing) {
      const emb = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding;
      if (emb && cosineSim(embedding, emb) > 0.9) {
        await supabase.from('agent_playbooks')
          .update({ win_count: (row.win_count || 1) + 1, updated_at: new Date().toISOString() })
          .eq('id', row.id);
        console.log(`[ApprovalService] Reinforced existing playbook for ${agentType} (win_count++)`);
        return;
      }
    }
  }

  await supabase.from('agent_playbooks').insert([{
    company_id: companyId,
    agent_type: agentType,
    trigger: distilled.trigger || output.output_type || 'general',
    play: distilled.play,
    embedding: embedding ? JSON.stringify(embedding) : null,
    source_output_id: output.id,
    win_count: 1,
  }]);
  console.log(`[ApprovalService] New playbook distilled for ${agentType}: "${(distilled.trigger || '').substring(0, 50)}"`);
}

/**
 * Retrieve the top-K most relevant plays for an agent given the current task text
 * (Phase B2 read path). Ranks by embedding similarity, breaking ties by win_count.
 */
async function getRelevantPlaybooks(companyId, agentType, taskText, k = 3) {
  const { data: plays } = await supabase
    .from('agent_playbooks')
    .select('trigger, play, embedding, win_count')
    .eq('company_id', companyId)
    .eq('agent_type', agentType);
  if (!plays || plays.length === 0) return [];

  let taskEmb = null;
  try { taskEmb = await generateEmbedding((taskText || '').substring(0, 2000)); } catch { /* fall back to win_count */ }

  const scored = plays.map(p => {
    const emb = typeof p.embedding === 'string' ? (() => { try { return JSON.parse(p.embedding); } catch { return null; } })() : p.embedding;
    const sim = (taskEmb && emb) ? cosineSim(taskEmb, emb) : 0;
    return { ...p, sim };
  });
  scored.sort((a, b) => (b.sim - a.sim) || ((b.win_count || 0) - (a.win_count || 0)));
  return scored.slice(0, k);
}

/**
 * After 3+ approved runs of the same agent type for a company, synthesize a compact
 * style-preference profile and store it on companies.agent_preferences[agentType].
 */
async function synthesizeAgentPreferences(companyId, agentType, recentComments = []) {
  const { data: examples, error } = await supabase
    .from('agent_examples')
    .select('title, content_summary, full_content')
    .eq('company_id', companyId)
    .eq('agent_type', agentType)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error || !examples || examples.length < 3) return; // need at least 3 approvals

  const { callLLMWithTools } = require('./llmService');
  const sample = examples.map((e, i) =>
    `Example ${i + 1}: ${e.title}\nSummary: ${e.content_summary}\nContent: ${JSON.stringify(e.full_content).substring(0, 1500)}`
  ).join('\n\n');

  // B1: also pull recent rejection feedback + the comments that led to approvals so
  // we can distill explicit "avoid rules" (what the founder keeps correcting).
  const { data: rejected } = await supabase
    .from('agent_outputs')
    .select('feedback')
    .eq('company_id', companyId)
    .eq('status', 'rejected')
    .not('feedback', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(8);
  const corrections = [
    ...((recentComments || []).map(c => c.body)),
    ...(((rejected || []).map(r => r.feedback)).filter(Boolean)),
  ];
  const correctionsStr = corrections.length ? corrections.map(c => `- ${c}`).join('\n') : '(none)';

  const prompt = `These are outputs from the "${agentType}" agent that a specific company has APPROVED, plus corrections/comments the founder has given. Infer the company's consistent style/depth preferences AND explicit "avoid rules" (recurring things to never do / always do), so future outputs match and stop repeating mistakes. Return ONLY JSON with concise values:
{"tone": "conservative", "prefers_bullet_points": true, "depth": "detailed", "notes": "short free-text guidance", "avoid_rules": ["never …", "always …"]}

APPROVED OUTPUTS:
${sample}

CORRECTIONS & COMMENTS:
${correctionsStr}`;

  try {
    const response = await callLLMWithTools(
      [{ role: 'system', content: prompt }],
      [],
      { model: 'llama-3.3-70b-versatile', response_format: { type: 'json_object' }, temperature: 0.3 }
    );
    const prefs = JSON.parse(response.content);

    // Merge into companies.agent_preferences[agentType]
    const { data: company } = await supabase
      .from('companies')
      .select('agent_preferences')
      .eq('id', companyId)
      .single();

    const allPrefs = (company && company.agent_preferences) || {};
    allPrefs[agentType] = prefs;

    await supabase
      .from('companies')
      .update({ agent_preferences: allPrefs })
      .eq('id', companyId);

    console.log(`[ApprovalService] Synthesized ${agentType} preferences for company ${companyId}`);
  } catch (err) {
    console.warn('[ApprovalService] Preference synthesis LLM call failed:', err.message);
  }
}

/**
 * Reject an agent output with feedback.
 * @param {string} outputId - Agent output ID
 * @param {Object} user - User rejecting
 * @param {string} feedback - Reason for rejection
 * @returns {Promise<Object>} Updated output
 */
async function rejectOutput(outputId, user, feedback) {
  const { data: output, error: fetchError } = await supabase
    .from('agent_outputs')
    .select('*')
    .eq('id', outputId)
    .single();

  if (fetchError || !output) throw new Error('Output not found');
  if (output.company_id !== user.company_id) throw new Error('Unauthorized');

  const updates = {
    status: 'rejected',
    feedback: feedback || 'No feedback provided',
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error: updateError } = await supabase
    .from('agent_outputs')
    .update(updates)
    .eq('id', outputId)
    .select()
    .single();

  if (updateError) throw updateError;

  // ─── Update the agent execution for revision ───
  if (output.agent_execution_id) {
    await supabase
      .from('agent_executions')
      .update({
        status: 'running', // Allow agent to revise
        current_action: `Revising based on feedback: ${feedback}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', output.agent_execution_id);

    // Asynchronously resume the agent work loop
    try {
      const { resumeAgentWorkAfterRejection } = require('./agentOrchestrator');
      resumeAgentWorkAfterRejection(output.agent_execution_id, user).catch(err => {
        console.error('[ApprovalService] Failed to resume agent work in background:', err.message);
      });
    } catch (err) {
      console.error('[ApprovalService] Failed to load agentOrchestrator for resuming:', err.message);
    }
  }

  console.log(`[ApprovalService] Rejected: "${output.title}" — ${feedback}`);
  return updated;
}

/**
 * Get all pending approvals for a company.
 */
async function getPendingApprovals(companyId) {
  const { data, error } = await supabase
    .from('agent_outputs')
    .select(`
      *,
      agent_executions:agent_execution_id (
        agent_label,
        agent_type,
        icon,
        color
      )
    `)
    .eq('company_id', companyId)
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Get all approved/rejected outputs for history.
 */
async function getOutputHistory(companyId, limit = 50) {
  const { data, error } = await supabase
    .from('agent_outputs')
    .select(`
      *,
      agent_executions:agent_execution_id (
        agent_label,
        agent_type,
        icon,
        color
      )
    `)
    .eq('company_id', companyId)
    .neq('status', 'pending_approval')
    .order('approved_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Store an approved output into The Brain's permanent memory (document_chunks).
 * This makes it searchable via the retrieval service.
 * 
 * @param {Object} output - The approved agent_output record
 * @returns {Promise<string|null>} The brain_document ID or null
 */
async function storeOutputToBrain(output) {
  // Build the document content from the structured output
  const contentParts = [];
  contentParts.push(`# ${output.title}`);
  contentParts.push(`\n${output.summary || ''}\n`);

  const data = output.content || {};

  // Format based on output type
  switch (output.output_type) {
    case 'web_artifact': {
      // Store the HTML so it can be re-previewed/downloaded later.
      contentParts.push('\n## Web Artifact (HTML)');
      if (typeof data.html === 'string') {
        contentParts.push('\n```html\n' + data.html.slice(0, 100000) + '\n```');
      }
      break;
    }
    case 'code_project': {
      contentParts.push('\n## Code Project');
      if (data.entry) contentParts.push(`Entry: ${data.entry}`);
      if (Array.isArray(data.files) && data.files.length) {
        contentParts.push('\n### Files');
        data.files.forEach(f => contentParts.push(`- ${typeof f === 'string' ? f : f.path}`));
      }
      if (typeof data.html === 'string') {
        contentParts.push('\n### Preview (assembled HTML)');
        contentParts.push('\n```html\n' + data.html.slice(0, 80000) + '\n```');
      }
      break;
    }
    case 'asset_collection': {
      contentParts.push('\n## Assets');
      (Array.isArray(data.assets) ? data.assets : []).forEach((a, i) => {
        const caption = a.caption || `Asset ${i + 1}`;
        if (typeof a.code === 'string' && a.code.trim()) {
          // Code-based asset (SVG/HTML) — store the markup so it can be re-rendered/edited later.
          const lang = a.kind === 'html' ? 'html' : 'svg';
          contentParts.push(`\n### ${caption}`);
          contentParts.push('\n```' + lang + '\n' + a.code.slice(0, 50000) + '\n```');
        } else {
          const src = a.url || a.dataUri || '';
          contentParts.push(`- ${caption}${src ? `: ${src.startsWith('data:') ? '(embedded image)' : src}` : ''}`);
        }
      });
      break;
    }
    case 'marketing_strategy': {
      contentParts.push('## Marketing Strategy');
      if (data.executiveSummary) contentParts.push(`\n### Executive Summary\n${data.executiveSummary}`);
      if (data.channels && Array.isArray(data.channels)) {
        contentParts.push('\n### Recommended Channels');
        data.channels.forEach(ch => contentParts.push(`- ${ch.name}: ${ch.description} (Budget: ${ch.budget || 'N/A'}, Priority: ${ch.priority || 'Medium'})`));
      }
      if (data.timeline) contentParts.push(`\n### Timeline\n${data.timeline}`);
      if (data.keyMetrics) contentParts.push(`\n### Key Metrics\n${data.keyMetrics}`);
      if (data.recommendations && Array.isArray(data.recommendations)) {
        contentParts.push('\n### Recommendations');
        data.recommendations.forEach(r => contentParts.push(`- ${r}`));
      }
      break;
    }
    case 'lead_list':
    case 'investor_list': {
      const itemType = output.output_type === 'lead_list' ? 'Leads' : 'Investors';
      contentParts.push(`\n## ${itemType}`);
      if (data.totalFound) contentParts.push(`Total Found: ${data.totalFound}`);
      if (data.leads && Array.isArray(data.leads)) {
        data.leads.forEach((lead, i) => {
          contentParts.push(`\n### ${i + 1}. ${lead.name || lead.company || 'Unnamed'}`);
          if (lead.website) contentParts.push(`- Website: ${lead.website}`);
          if (lead.reason) contentParts.push(`- Why: ${lead.reason}`);
          if (lead.priority) contentParts.push(`- Priority: ${lead.priority}`);
          if (lead.notes) contentParts.push(`- Notes: ${lead.notes}`);
        });
      }
      if (data.investors && Array.isArray(data.investors)) {
        data.investors.forEach((inv, i) => {
          contentParts.push(`\n### ${i + 1}. ${inv.firm || inv.name || 'Unnamed'}`);
          if (inv.website) contentParts.push(`- Website: ${inv.website}`);
          if (inv.checkSize) contentParts.push(`- Check Size: ${inv.checkSize}`);
          if (inv.focus) contentParts.push(`- Focus: ${inv.focus}`);
          if (inv.portfolio) contentParts.push(`- Portfolio: ${inv.portfolio}`);
          if (inv.approach) contentParts.push(`- Contact: ${inv.approach}`);
        });
      }
      break;
    }
    case 'competitor_analysis': {
      contentParts.push('\n## Competitive Analysis');
      if (data.competitors && Array.isArray(data.competitors)) {
        data.competitors.forEach((comp, i) => {
          contentParts.push(`\n### ${i + 1}. ${comp.name || 'Unnamed Competitor'}`);
          if (comp.website) contentParts.push(`- Website: ${comp.website}`);
          if (comp.overview) contentParts.push(`- Overview: ${comp.overview}`);
          if (comp.strengths) contentParts.push(`- Strengths: ${comp.strengths}`);
          if (comp.weaknesses) contentParts.push(`- Weaknesses: ${comp.weaknesses}`);
          if (comp.pricing) contentParts.push(`- Pricing: ${comp.pricing}`);
          if (comp.marketingStrategy) contentParts.push(`- Marketing: ${comp.marketingStrategy}`);
          if (comp.gap) contentParts.push(`- Opportunity: ${comp.gap}`);
        });
      }
      if (data.marketPosition) contentParts.push(`\n### Market Position\n${data.marketPosition}`);
      if (data.opportunities && Array.isArray(data.opportunities)) {
        contentParts.push('\n### Opportunities');
        data.opportunities.forEach(o => contentParts.push(`- ${o}`));
      }
      break;
    }
    case 'content_draft':
    case 'social_post': {
      contentParts.push(`\n## ${output.output_type === 'social_post' ? 'Social Media Posts' : 'Content Drafts'}`);
      if (data.platform) contentParts.push(`Platform: ${data.platform}`);
      if (data.posts && Array.isArray(data.posts)) {
        data.posts.forEach((post, i) => {
          contentParts.push(`\n### Post ${i + 1}${post.platform ? ` (${post.platform})` : ''}`);
          if (post.hook) contentParts.push(`Hook: ${post.hook}`);
          if (post.body) contentParts.push(`\n${post.body}`);
          if (post.cta) contentParts.push(`\nCTA: ${post.cta}`);
          if (post.hashtags) contentParts.push(`\nHashtags: ${post.hashtags}`);
        });
      }
      if (data.content && typeof data.content === 'string') {
        contentParts.push(`\n${data.content}`);
      }
      break;
    }
    case 'company_profile': {
      contentParts.push('\n## Company Research Profile');
      Object.entries(data).forEach(([key, value]) => {
        if (value && typeof value !== 'object') {
          contentParts.push(`- ${key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}: ${value}`);
        }
      });
      break;
    }
    case 'plan': {
      contentParts.push('\n## Plan');
      if (data.objective) contentParts.push(`\n**Objective:** ${data.objective}`);
      if (data.approach) contentParts.push(`\n**Approach:** ${data.approach}`);
      if (Array.isArray(data.deliverables) && data.deliverables.length) {
        contentParts.push('\n### Deliverables');
        data.deliverables.forEach(d => contentParts.push(`- ${typeof d === 'string' ? d : (d.title || JSON.stringify(d))}`));
      }
      if (Array.isArray(data.steps) && data.steps.length) {
        contentParts.push('\n### Steps');
        data.steps.forEach((s, i) => contentParts.push(`${i + 1}. ${s.title || s}${s.detail ? ` — ${s.detail}` : ''}`));
      }
      if (Array.isArray(data.assumptions) && data.assumptions.length) {
        contentParts.push('\n### Assumptions');
        data.assumptions.forEach(a => contentParts.push(`- ${a}`));
      }
      break;
    }
    default: {
      // Generic structured formatting: render every top-level key sensibly so
      // new deliverable types (financial_model, prd, content_calendar, sprint_plan,
      // board_update, tech_spec, …) embed as readable markdown without a bespoke case.
      const labelize = (k) => k.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').replace(/^./, s => s.toUpperCase()).trim();
      const renderValue = (val) => {
        if (val == null) return;
        if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
          contentParts.push(`${val}`);
        } else if (Array.isArray(val)) {
          val.forEach(item => {
            if (item && typeof item === 'object') {
              const label = item.name || item.title || item.label || '';
              const rest = Object.entries(item)
                .filter(([k]) => !['name', 'title', 'label'].includes(k))
                .map(([k, v]) => `${labelize(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                .join('; ');
              contentParts.push(`- ${label}${label && rest ? ' — ' : ''}${rest}`);
            } else {
              contentParts.push(`- ${item}`);
            }
          });
        } else if (typeof val === 'object') {
          Object.entries(val).forEach(([k, v]) => contentParts.push(`- ${labelize(k)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`));
        }
      };
      // Back-compat: keep findings/recommendations as a fast path.
      if (data.findings) contentParts.push(`\n${data.findings}`);
      Object.entries(data).forEach(([key, value]) => {
        if (key === 'findings') return;
        contentParts.push(`\n### ${labelize(key)}`);
        renderValue(value);
      });
      break;
    }
  }

  const documentText = contentParts.join('\n');

  // For visual/code deliverables the raw SVG/HTML/code markup is not useful to embed —
  // it pollutes semantic search (a query for "our logo" would match against <path d="…">
  // noise). Embed a clean DESCRIPTION (title, summary, captions, palette) instead, while
  // the full markup stays in brain_documents.content so the asset can be re-rendered/edited.
  let embeddingText = documentText;
  const vdata = output.content || {};
  if (output.output_type === 'asset_collection') {
    const assets = Array.isArray(vdata.assets) ? vdata.assets : [];
    const captions = assets.map((a, i) => a.caption || `Asset ${i + 1}`).filter(Boolean);
    const kinds = [...new Set(assets.map(a => a.kind).filter(Boolean))];
    const palette = [...new Set(JSON.stringify(vdata).match(/#[0-9a-fA-F]{3,8}\b/g) || [])].slice(0, 10);
    embeddingText = [
      `# ${output.title}`, output.summary || '',
      'Visual brand asset set (editable SVG/HTML — logos, marks, palette, typography).',
      captions.length ? `Assets: ${captions.join('; ')}.` : '',
      kinds.length ? `Formats: ${kinds.join(', ')}.` : '',
      palette.length ? `Brand colors: ${palette.join(', ')}.` : '',
    ].filter(Boolean).join('\n');
  } else if (output.output_type === 'web_artifact') {
    embeddingText = [`# ${output.title}`, output.summary || '', 'Web artifact / landing page (self-contained HTML).'].filter(Boolean).join('\n');
  } else if (output.output_type === 'code_project') {
    const files = Array.isArray(vdata.files) ? vdata.files.map(f => (typeof f === 'string' ? f : f.path)) : [];
    embeddingText = [`# ${output.title}`, output.summary || '', 'Code project.', files.length ? `Files: ${files.slice(0, 30).join(', ')}.` : ''].filter(Boolean).join('\n');
  }

  // First, create a brain_document record
  const { data: brainDoc, error: docError } = await supabase
    .from('brain_documents')
    .insert([{
      company_id: output.company_id,
      title: output.title,
      document_type: 'ai_generated',
      sub_type: output.output_type,
      content: documentText,
      metadata: {
        agent_output_id: output.id,
        agent_execution_id: output.agent_execution_id,
        output_type: output.output_type,
        generated_at: output.created_at,
      },
    }])
    .select()
    .single();

  if (docError) {
    console.error('[ApprovalService] Failed to create brain document:', docError.message);
    return null;
  }

  // Resolve the producing agent's department so the chunk is retrievable under the
  // matching department tab (e.g. a logo stored by the marketing agent → 'commercial').
  let chunkDept = null;
  try {
    if (output.agent_execution_id) {
      const { data: ex } = await supabase
        .from('agent_executions').select('agent_type').eq('id', output.agent_execution_id).single();
      const AGENT_DEPT = {
        marketing: 'commercial', sales: 'commercial', crm: 'commercial',
        finance: 'finance', investment: 'finance',
        product: 'product', engineering: 'product',
        people: 'hr', hr: 'hr',
      };
      chunkDept = ex ? (AGENT_DEPT[ex.agent_type] || null) : null;
    }
  } catch { /* department tag is best-effort */ }

  // Generate embedding and store as document chunk for semantic search
  try {
    const embedding = await generateEmbedding(embeddingText.substring(0, 8000));
    await supabase.from('document_chunks').insert([{
      id: uuidv4(),
      tenant_id: output.company_id,
      content: embeddingText.substring(0, 8000),
      embedding: JSON.stringify(embedding),
      source_type: 'agent_output',
      source_id: brainDoc.id,
      source_title: output.title,
      department: chunkDept,
      metadata: {
        output_type: output.output_type,
        agent_execution_id: output.agent_execution_id,
        approved_by: output.approved_by,
        approved_at: output.approved_at,
      },
    }]);
  } catch (embedErr) {
    console.error('[ApprovalService] Failed to embed output:', embedErr.message);
  }

  return brainDoc.id;
}

module.exports = {
  createApproval,
  approveOutput,
  rejectOutput,
  getPendingApprovals,
  getOutputHistory,
  saveAgentExample,
  synthesizeAgentPreferences,
  distillPlaybook,
  getRelevantPlaybooks,
  addOutputComment,
  getOutputComments,
  requestRevision,
};
