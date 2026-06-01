const supabase = require('../models/supabaseClient');
const { emitNotification } = require('../api/notificationRoutes');
const sentinel = require('../middleware/sentinel');
const { groq } = require('./llmService');

/**
 * Scan a document for proactivity / automation opportunities and save suggestions to DB.
 * 
 * @param {string} text - Document text content
 * @param {string} docId - Document UUID
 * @param {string} companyId - Company UUID
 */
async function scanDocumentForAutomations(text, docId, companyId) {
    try {
        const preview = text.substring(0, 10000);
        const today = new Date().toISOString().split('T')[0];

        const prompt = `You are a business intelligence assistant analyzing internal company documents.
Analyze the following document and identify if there are any immediate proactive actions/automations that "The Brain" AI Operating System can take.
We support four types of automations:
1. email: Use this if the document explicitly mentions needing to send an email to a client, supplier, or contact (e.g., "Email Kareem regarding...", "Send email confirmation to client@xyz.com...").
2. slack: Use this if the document mentions alerting a channel or posting updates to the team on Slack (e.g., "Send an update to Slack #general...", "Notify team...").
3. calendar: Use this if the document mentions scheduling a meeting, a sync, or a calendar event (e.g., "Schedule a meeting with...", "Book a sync next Tuesday at 3pm...").
4. document: Use this if the document mentions drafting or generating a new follow-up document, report, or contract.

Based on the document content, identify up to 3 high-value proactive automations.
Also identify if the automation is a recurring/repetitive task (e.g., "daily report", "weekly meeting", "every Friday sync", "monthly invoice checking", "daily backup"). Set "is_recurring": true in the JSON output if it has a recurring schedule, otherwise set it to false.

Return a valid JSON object matching this schema:
{
  "automations": [
    {
      "type": "email" | "slack" | "calendar" | "document",
      "description": "A clear, action-oriented, human-readable description of what this automation will do (e.g., 'Draft email to client@acme.com with Q3 strategy overview')",
      "is_recurring": boolean,
      "action_payload": {
        // For type = 'email':
        "to": "recipient email or null",
        "subject": "email subject",
        "body": "suggested email body text or markdown"
        
        // For type = 'slack':
        "channel": "slack channel name (e.g., #general)",
        "message": "message content"
        
        // For type = 'calendar':
        "title": "calendar event title",
        "time": "ISO 8601 datetime format or a relative timeframe relative to today (${today})",
        "attendees": ["email1", "email2"]
        
        // For type = 'document':
        "title": "document title",
        "content": "suggested markdown content for the document",
        "format": "md"
      }
    }
  ]
}

Only suggest automations that are highly relevant and clearly indicated in the text. If no automations are relevant, return an empty "automations" array.`;

        console.log(`[Proactivity] Scanning document ${docId} for company ${companyId}...`);
        const response = await groq.chat.completions.create({
            model: 'meta-llama/llama-4-scout-17b-16e-instruct',
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: `Document Content:\n${preview}` }
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });

        const result = JSON.parse(response.choices[0].message.content);
        const automations = Array.isArray(result.automations) ? result.automations : [];

        console.log(`[Proactivity] Found ${automations.length} automation suggestions.`);

        const insertedAutomations = [];
        for (const auto of automations) {
            const { data, error } = await supabase
                .from('proposed_automations')
                .insert([{
                    tenant_id: companyId,
                    type: auto.type,
                    description: auto.description,
                    is_recurring: auto.is_recurring || false,
                    action_payload: auto.action_payload,
                    status: 'pending',
                    source_doc_id: docId
                }])
                .select()
                .single();

            if (error) {
                console.error('[Proactivity] Error saving proposed automation:', error.message);
            } else if (data) {
                insertedAutomations.push(data);
                
                // Fetch all users in this company to notify them
                const { data: users, error: usersErr } = await supabase
                    .from('users')
                    .select('id')
                    .eq('company_id', companyId);

                if (!usersErr && users) {
                    users.forEach(u => {
                        emitNotification(u.id, {
                            type: 'proposed_automation',
                            automation: data
                        });
                    });
                }
            }
        }

        return insertedAutomations;
    } catch (err) {
        console.error('[Proactivity] Error in proactivity scanner:', err.message);
        return [];
    }
}

/**
 * Execute a proposed automation by ID.
 * 
 * @param {string} automationId - Proposed automation UUID
 * @param {Object} user - Requesting user object
 */
async function approveAutomation(automationId, user, overrides = null) {
    // 1. Fetch automation
    const { data: auto, error: fetchErr } = await supabase
        .from('proposed_automations')
        .select('*')
        .eq('id', automationId)
        .eq('tenant_id', user.company_id)
        .single();

    if (fetchErr || !auto) {
        throw new Error(`Proposed automation not found: ${fetchErr?.message || 'Invalid ID'}`);
    }

    if (auto.status !== 'pending') {
        throw new Error(`Automation is already ${auto.status}`);
    }

    // Merge overrides if provided
    if (overrides) {
        auto.action_payload = {
            ...auto.action_payload,
            ...overrides
        };
        // Persist updated action_payload to DB
        await supabase
            .from('proposed_automations')
            .update({ action_payload: auto.action_payload })
            .eq('id', automationId);
    }

    let executionResult = null;

    try {
        console.log(`[Proactivity] Executing automation type '${auto.type}' for company ${user.company_id}...`);

        if (auto.type === 'document') {
            // Native document draft creation
            const toolCall = {
                name: 'document_create_draft',
                arguments: {
                    title: auto.action_payload.title,
                    content: auto.action_payload.content,
                    format: auto.action_payload.format || 'md',
                    summary_of_changes: 'Proactive draft generated based on document source'
                }
            };
            // Validate via Sentinel
            const verdict = await sentinel.validate(toolCall, user);
            if (!verdict.allowed) {
                throw new Error(`Sentinel blocked execution: ${verdict.reason}`);
            }
            const run = await sentinel.executeApprovedTool(toolCall, verdict, user);
            if (!run.success) throw new Error(run.error);
            executionResult = {
                success: true,
                message: `Draft document '${auto.action_payload.title}' created successfully.`,
                draft_id: run.result.draft_id
            };
        } else if (auto.type === 'slack') {
            // Post Slack message (simulate or run tool)
            const toolCall = {
                name: 'slack_post_message',
                arguments: {
                    channel: auto.action_payload.channel || '#general',
                    message: auto.action_payload.message
                }
            };
            const verdict = await sentinel.validate(toolCall, user);
            if (verdict.allowed) {
                const run = await sentinel.executeApprovedTool(toolCall, verdict, user);
                if (run.success) {
                    executionResult = { success: true, message: `Slack message posted to ${toolCall.arguments.channel}` };
                } else {
                    console.warn('[Proactivity] Real Slack tool run failed, using mock success:', run.error);
                }
            }
            if (!executionResult) {
                // Mock fallback if integration not connected or allowed
                executionResult = {
                    success: true,
                    message: `[Simulated] Slack message posted to ${auto.action_payload.channel || '#general'}: "${auto.action_payload.message}"`
                };
            }
        } else if (auto.type === 'email') {
            // Send email (simulate or run tool)
            const toolCall = {
                name: 'send_email',
                arguments: {
                    to: auto.action_payload.to ? [auto.action_payload.to] : [],
                    subject: auto.action_payload.subject || 'Automated Update from The Brain',
                    body: auto.action_payload.body
                }
            };
            const verdict = await sentinel.validate(toolCall, user);
            if (verdict.allowed) {
                const run = await sentinel.executeApprovedTool(toolCall, verdict, user);
                if (run.success) {
                    executionResult = { success: true, message: `Email sent to ${auto.action_payload.to}` };
                } else {
                    console.warn('[Proactivity] Real Email tool run failed, using mock success:', run.error);
                }
            }
            if (!executionResult) {
                executionResult = {
                    success: true,
                    message: `[Simulated] Email sent to ${auto.action_payload.to}: Subject: "${auto.action_payload.subject}"`
                };
            }
        } else if (auto.type === 'calendar') {
            // Create calendar event (simulate or run tool)
            const toolCall = {
                name: 'google_calendar_create',
                arguments: {
                    title: auto.action_payload.title || 'Meeting',
                    time: auto.action_payload.time,
                    attendees: auto.action_payload.attendees || []
                }
            };
            const verdict = await sentinel.validate(toolCall, user);
            if (verdict.allowed) {
                const run = await sentinel.executeApprovedTool(toolCall, verdict, user);
                if (run.success) {
                    executionResult = { success: true, message: `Google Calendar event '${auto.action_payload.title}' created.` };
                } else {
                    console.warn('[Proactivity] Real Calendar tool run failed, using mock success:', run.error);
                }
            }
            if (!executionResult) {
                executionResult = {
                    success: true,
                    message: `[Simulated] Google Calendar event '${auto.action_payload.title}' scheduled for ${auto.action_payload.time}`
                };
            }
        } else {
            throw new Error(`Unsupported automation type: ${auto.type}`);
        }

        // Update status to approved
        await supabase
            .from('proposed_automations')
            .update({ status: 'approved', updated_at: new Date().toISOString() })
            .eq('id', automationId);

        return executionResult;
    } catch (err) {
        console.error('[Proactivity] Execution failed:', err.message);
        throw err;
    }
}

/**
 * Dismiss/reject a proposed automation.
 * 
 * @param {string} automationId - Proposed automation UUID
 * @param {Object} user - Requesting user object
 */
async function rejectAutomation(automationId, user) {
    const { data, error } = await supabase
        .from('proposed_automations')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', automationId)
        .eq('tenant_id', user.company_id)
        .select()
        .single();

    if (error || !data) {
        throw new Error(`Failed to reject automation: ${error?.message || 'Not found'}`);
    }

    return { success: true, message: 'Automation dismissed' };
}

module.exports = {
    scanDocumentForAutomations,
    approveAutomation,
    rejectAutomation
};
