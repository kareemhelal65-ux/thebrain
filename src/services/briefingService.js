const supabase = require('../models/supabaseClient');
const { generateEmbedding } = require('./embeddingService');
const { notifyText } = require('./slackNotificationService');
const { groq } = require('./llmService');

/**
 * Pre-Meeting Briefing Service
 * Generates a pre-meeting briefing card 15 minutes before an event and posts it to Slack.
 */

async function generatePreMeetingBriefing(tenantId, eventTitle, participants) {
  try {
    // 1. Gather context from vector memory
    // Embed the meeting title to find semantic matches
    const searchEmbedding = await generateEmbedding(eventTitle);
    
    const { data: chunks, error } = await supabase.rpc('match_documents', {
      query_embedding: JSON.stringify(searchEmbedding),
      match_threshold: 0.2,
      match_count: 5,
      filter_tenant_id: tenantId
    });

    let contextString = '';
    if (!error && chunks && chunks.length > 0) {
      contextString = chunks.map((chunk, i) => {
        const source = chunk.source_title || `Source ${i+1}`;
        return `[Source: ${source}]\n${chunk.content}`;
      }).join('\n\n');
    }

    // 2. Fetch open action items for participants
    const { data: openTasks } = await supabase
      .from('meetings')
      .select('title, insights, meeting_date')
      .eq('company_id', tenantId)
      .order('meeting_date', { ascending: false })
      .limit(10);

    let openActionItemsText = '';
    if (openTasks) {
      const allActionItems = openTasks.flatMap(m => m.insights?.action_items || [])
        .filter(ai => participants.some(p => ai.assignee?.toLowerCase().includes(p.name?.toLowerCase())));
      
      if (allActionItems.length > 0) {
        openActionItemsText = allActionItems.map(ai => `- ${ai.task} (Assigned to: ${ai.assignee})`).join('\n');
      }
    }

    // 3. Generate Briefing via Llama 3.3 70B
    const systemPrompt = `You are "The Brain", an AI generating a pre-meeting intelligence briefing.
Your goal is to prepare the team for the upcoming meeting: "${eventTitle}".

Use the provided semantic context and open action items to generate a briefing.
Format your response as a Markdown card with the following sections:
- **Participant Context**: Briefly mention any open action items for the participants.
- **Relevant Past Knowledge**: Summarize 2-3 relevant facts or decisions from the semantic context.
- **Suggested Agenda**: Suggest 2-3 items to discuss based on unresolved issues or context.

Be highly concise. If there is no context available, just output a generic welcoming briefing.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Participants: ${participants.map(p => p.name).join(', ')}\n\nOpen Action Items for Participants:\n${openActionItemsText || 'None found.'}\n\nRelevant Semantic Context:\n${contextString || 'No direct context found.'}` }
    ];

    const llmResponse = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages,
      temperature: 0.2,
      max_tokens: 1024,
    });

    const briefingText = llmResponse.choices[0].message.content;

    // 4. Send to Slack
    const slackMessage = `*🧠 Pre-Meeting Briefing: ${eventTitle}*\n\n${briefingText}`;
    await notifyText(slackMessage);
    
    return { success: true, briefing: briefingText };

  } catch (error) {
    console.error('[BriefingService] Error generating briefing:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { generatePreMeetingBriefing };
