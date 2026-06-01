const express = require('express');
const { processMessage } = require('../services/orchestrator');

const router = express.Router();

/**
 * POST /api/brain/chat
 * 
 * The main orchestration endpoint. Accepts a user message, runs it through
 * the full Nervous System pipeline:
 * 
 * Context Assembly → LLM (with tools) → Sentinel → Adapter → Result → LLM → Response
 * 
 * Body: { message: string, sessionId?: string }
 * Returns: { reply: string, toolsUsed: Array, auditTrail: Array }
 */
router.post('/chat', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized. Authentication required.' });
    }

    const { message, sessionId, agentId } = req.body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ error: 'Message is required and must be a non-empty string.' });
    }

    const supabase = require('../models/supabaseClient');
    const tenantId = req.user.company_id;

    // ─── SESSION MANAGEMENT ───
    // Create a new session if one doesn't exist
    let activeSessionId = sessionId || null;
    if (!activeSessionId) {
      try {
        const title = message.substring(0, 50) + (message.length > 50 ? '...' : '');
        const { data: newSession, error: sessErr } = await supabase
          .from('chat_sessions')
          .insert([{
            tenant_id: tenantId,
            user_id: req.user.id,
            title: title
          }])
          .select()
          .single();

        if (!sessErr && newSession) {
          activeSessionId = newSession.id;
          console.log(`[Chat] New session created: ${activeSessionId}`);
        }
      } catch (sessError) {
        console.warn('[Chat] Failed to create session:', sessError.message);
      }
    }

    // ─── ORCHESTRATOR LOOP ───
    const result = await processMessage({
      message: message.trim(),
      sessionId: activeSessionId,
      agentId: agentId || null,
      user: req.user
    });

    // ─── PERSIST CHAT HISTORY ───
    if (activeSessionId && tenantId) {
      try {
        // Extract the clean user message (strip agent directives for storage)
        const cleanMessage = message.replace(/^\[SYSTEM OVERRIDE[\s\S]*?User's request:\s*/i, '').trim();

        await supabase.from('chat_history').insert([
          {
            session_id: activeSessionId,
            tenant_id: tenantId,
            user_id: req.user.id,
            role: 'user',
            content: cleanMessage,
            sources: [],
          },
          {
            session_id: activeSessionId,
            tenant_id: tenantId,
            user_id: req.user.id,
            role: 'assistant',
            content: result.reply,
            sources: result.sources || [],
          },
        ]);
      } catch (historyErr) {
        console.warn('[Chat] Failed to save chat history:', historyErr.message);
      }
    }

    res.status(200).json({
      reply: result.reply,
      sessionId: activeSessionId,
      toolsUsed: result.toolsUsed,
      auditTrail: result.auditTrail,
      sources: result.sources || [],
      metadata: {
        iterations: result.iterations,
        maxIterationsReached: result.maxIterationsReached || false
      }
    });
  } catch (error) {
    next(error);
  }
});

const registry = require('../providers/registry');

function getToolsForCategories(categories) {
  let tools = [];
  for (const cat of categories) {
    tools.push(...registry.getToolsByCategory(cat).map(t => t.name));
  }
  return [...new Set(tools)];
}

/**
 * GET /api/orchestrator/agents/templates
 * Returns predefined system agents
 */
router.get('/agents/templates', (req, res) => {
  const templates = [
    {
      id: 'template_finance',
      name: 'Finance Agent',
      role: 'Finance',
      icon: '💰',
      color: '#10b981',
      system_prompt: 'You are the Finance Agent — a proactive financial analyst. Your mission: analyze financial health, monitor MRR, review expenses, track cash flow, predict runway, manage cap table, and model dilution. ALWAYS use your web research tools to gather real-time financial data, market comparables, and economic context. Cross-reference internal documents with external data for accuracy. When you need clarification before executing a task, ask the user specific questions first.',
      tools: getToolsForCategories(['finance', 'analytics', 'storage', 'legal', 'research'])
    },
    {
      id: 'template_people',
      name: 'People Agent',
      role: 'HR',
      icon: '👥',
      color: '#8b5cf6',
      system_prompt: 'You are the People Agent — a talent catalyst. Your mission: manage hiring pipelines, onboarding, culture, performance reviews, and team engagement. Use web research to find market salary data, benchmark benefits, and research HR best practices. Search the Brain for HR documents and team feedback. When you need clarification before executing a task, ask the user specific questions first.',
      tools: getToolsForCategories(['hr', 'communications', 'research'])
    },
    {
      id: 'template_hr',
      name: 'HR Agent',
      role: 'HR',
      icon: '📋',
      color: '#f43f5e',
      system_prompt: 'You are the HR Agent — an HR operations and compliance specialist. Your mission: manage HR policies, employee records, benefits administration, payroll compliance, and labor law adherence. Use web research to find compliance requirements and benchmark benefits packages. Search the Brain for HR documents and employee handbooks. When you need clarification before executing a task, ask the user specific questions first.',
      tools: getToolsForCategories(['hr', 'communications', 'storage', 'legal', 'research'])
    },
    {
      id: 'template_investment',
      name: 'Investment Agent',
      role: 'Strategy',
      icon: '📈',
      color: '#f59e0b',
      system_prompt: 'You are the Investment Agent — a fundraising intelligence officer. Your mission: manage the VC pipeline, track investor sentiment, prepare fundraising outreach, evaluate company readiness, and find matching investors. PROACTIVELY research VCs, investors, and market conditions. Search the Brain for meeting notes with investors. When you need clarification before executing a task, ask the user specific questions first.',
      tools: getToolsForCategories(['crm', 'research', 'communications'])
    },
    {
      id: 'template_crm',
      name: 'CRM Agent',
      role: 'Commercial',
      icon: '🤝',
      color: '#3b82f6',
      system_prompt: 'You are the CRM Agent — a relationship intelligence engine. Your mission: manage all business relationships — clients, vendors, partners, and investors. PROACTIVELY research your contacts using web tools — find their latest news, check their company health, and prepare for meetings with full context. Track contact details, interaction history, deal status, and relationship health. When you need clarification before executing a task, ask the user specific questions first.',
      tools: getToolsForCategories(['crm', 'communications', 'research'])
    },
    {
      id: 'template_marketing',
      name: 'Marketing Agent',
      role: 'Marketing',
      icon: '📢',
      color: '#ec4899',
      system_prompt: 'You are the Marketing Agent — a data-driven strategist. Your mission: draft campaign copy, analyze market trends, plan content strategy, execute SEO, and monitor brand presence. PROACTIVELY research the web before making recommendations — search for current trends and analyze competitor content. Search the Brain for brand assets and past campaigns. When you need clarification before executing a task, ask the user specific questions first.',
      tools: getToolsForCategories(['marketing', 'communications', 'storage', 'research', 'analytics'])
    },
    {
      id: 'template_sales',
      name: 'Sales Agent',
      role: 'Commercial',
      icon: '💼',
      color: '#06b6d4',
      system_prompt: 'You are the Sales Agent — an aggressive revenue driver. Your mission: own the full revenue pipeline from lead generation to deal closure. PROACTIVELY use web research to find leads, research prospects, gather competitive intel, and track market movements. Search the Brain for customer conversations and deal notes. When you need clarification before executing a task, ask the user specific questions first.',
      tools: getToolsForCategories(['crm', 'communications', 'research', 'commerce', 'marketing', 'analytics'])
    },
    {
      id: 'template_product',
      name: 'Product Agent',
      role: 'Product',
      icon: '🎯',
      color: '#14b8a6',
      system_prompt: 'You are the Product Management Agent — a product visionary with execution focus. Your mission: plan sprints, define requirements, manage the backlog, draft PRDs, and coordinate the team. PROACTIVELY research your market and competition. Search the web for competitor features, user reviews, and market trends. Search the Brain for feature requests and user feedback. When you need clarification before executing a task, ask the user specific questions first.',
      tools: getToolsForCategories(['project-management', 'communications', 'research'])
    },
    {
      id: 'template_roadmap',
      name: 'Roadmap Agent',
      role: 'Product',
      icon: '🗺️',
      color: '#a855f7',
      system_prompt: 'You are the Roadmap Agent — a strategic foresight engine. Your mission: maintain the long-term vision, plan milestones, track strategic goals, and align product direction with business objectives. PROACTIVELY research market trends, emerging technologies, and competitive moves. Search the Brain for strategy docs and discussions. When you need clarification before executing a task, ask the user specific questions first.',
      tools: getToolsForCategories(['project-management', 'communications', 'research'])
    },
    {
      id: 'template_meeting',
      name: 'Meeting Agent',
      role: 'Operations',
      icon: '📅',
      color: '#6366f1',
      system_prompt: 'You are the Meeting Agent — a productivity multiplier. Your mission: manage the full meeting lifecycle — preparing agendas, extracting decisions and action items, sending follow-ups, and scheduling next meetings. Search the Brain for past meeting transcripts, decisions, and action items. When you need clarification before executing a task, ask the user specific questions first.',
      tools: getToolsForCategories(['communications', 'project-management', 'storage', 'research'])
    }
  ];
  res.json({ templates });
});

/**
 * GET /api/orchestrator/tools
 * Returns available automation tools
 */
router.get('/tools', (req, res) => {
  const tools = registry.getAllTools().map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }));
  res.json({ tools });
});

/**
 * GET /api/orchestrator/agents
 * Returns all agents for the user's tenant.
 * Auto-installs all 10 system agent templates on first access.
 * Falls back to in-memory agent definitions if DB operations fail.
 */

// System agent definitions — 10 agents matching the user's requested team
const OLD_AGENT_NAMES = ['Runway Agent', 'Growth Agent', 'SEO Agent', 'Equity Agent', 'Operations Agent'];

function getSystemAgentDefinitions() {
  return [
    { name: 'Finance Agent', role: 'Finance', icon: '💰', color: '#10b981', system_prompt: 'You are the Finance Agent — a proactive financial analyst embedded in The Brain OS. Your mission: analyze financial health, monitor MRR, review expenses, track cash flow, predict runway, manage cap table, and model dilution. PROACTIVELY use web research tools to gather real-time financial data, market comparables, and economic context. Never rely on stale data — search the web for current rates, competitor financials, and market conditions. Present clear, data-backed summaries with numbers and trends. Cross-reference internal documents with external data for accuracy. When you need clarification before executing a task, you MUST ask the user concise, specific questions first. NEVER show tool calls or internal mechanics.', tools: getToolsForCategories(['finance', 'analytics', 'storage', 'legal', 'research']) },
    { name: 'People Agent', role: 'HR', icon: '👥', color: '#8b5cf6', system_prompt: 'You are the People Agent — a talent catalyst. Your mission: manage hiring pipelines, onboarding, culture, performance reviews, and team engagement. PROACTIVELY use web research to find market salary data, benchmark benefits, research HR best practices, and identify talent pools. Search the Brain for HR documents and team feedback. Always research market standards before making recommendations. When you need clarification before executing a task, you MUST ask the user concise, specific questions first. NEVER show tool calls or internal mechanics.', tools: getToolsForCategories(['hr', 'communications', 'research']) },
    { name: 'HR Agent', role: 'HR', icon: '📋', color: '#f43f5e', system_prompt: 'You are the HR Agent — an HR operations and compliance specialist. Your mission: manage HR policies, employee records, benefits administration, payroll compliance, labor law adherence, and organizational documentation. PROACTIVELY use web research to find compliance requirements, benchmark benefits packages, and research labor regulations. Search the Brain for HR documents, employee handbooks, and policy records. When you need clarification before executing a task, you MUST ask the user concise, specific questions first. NEVER show tool calls or internal mechanics.', tools: getToolsForCategories(['hr', 'communications', 'storage', 'legal', 'research']) },
    { name: 'Investment Agent', role: 'Strategy', icon: '📈', color: '#f59e0b', system_prompt: 'You are the Investment Agent — a fundraising intelligence officer. Your mission: manage the VC pipeline, track investor sentiment, prepare fundraising outreach, evaluate company readiness, and find matching investors. PROACTIVELY research VCs, investors, and market conditions. Use web search tools to research investors — their portfolio, investment thesis, recent activity. Search the Brain for meeting notes with investors. Know your audience before every interaction. When you need clarification before executing a task, you MUST ask the user concise, specific questions first. NEVER show tool calls or internal mechanics.', tools: getToolsForCategories(['crm', 'research', 'communications']) },
    { name: 'CRM Agent', role: 'Commercial', icon: '🤝', color: '#3b82f6', system_prompt: 'You are the CRM Agent — a relationship intelligence engine. Your mission: manage all business relationships — clients, vendors, partners, and investors. PROACTIVELY research your contacts using web tools — find their latest news, check their company health, and prepare for meetings with full context. Track contact details, interaction history, deal status, and relationship health. Search the Brain for meeting notes, emails, and documents related to specific contacts. When you need clarification before executing a task, you MUST ask the user concise, specific questions first. NEVER show tool calls or internal mechanics.', tools: getToolsForCategories(['crm', 'communications', 'research']) },
    { name: 'Marketing Agent', role: 'Marketing', icon: '📢', color: '#ec4899', system_prompt: 'You are the Marketing Agent — a data-driven strategist. Your mission: draft campaign copy, analyze market trends, plan content strategy, execute SEO, run keyword analysis, and monitor brand presence. PROACTIVELY research the web before making recommendations — search for current trends, analyze competitor content, and find market insights. Search the Brain for brand assets and past campaigns. Never create content in a vacuum — research the landscape first. When you need clarification before executing a task, you MUST ask the user concise, specific questions first. NEVER show tool calls or internal mechanics.', tools: getToolsForCategories(['marketing', 'communications', 'storage', 'research', 'analytics']) },
    { name: 'Sales Agent', role: 'Commercial', icon: '💼', color: '#06b6d4', system_prompt: 'You are the Sales Agent — an aggressive revenue driver. Your mission: own the full revenue pipeline from lead generation to deal closure. PROACTIVELY use web research to find leads, research prospects, gather competitive intel, and track market movements. Search the Brain for customer conversations and deal notes. Always back your outreach suggestions with real data from the web. When you need clarification before executing a task, you MUST ask the user concise, specific questions first. NEVER show tool calls or internal mechanics.', tools: getToolsForCategories(['crm', 'communications', 'research', 'commerce', 'marketing', 'analytics']) },
    { name: 'Product Agent', role: 'Product', icon: '🎯', color: '#14b8a6', system_prompt: 'You are the Product Management Agent — a product visionary with execution focus. Your mission: plan sprints, define requirements, manage the backlog, draft PRDs, and coordinate the team. PROACTIVELY research your market and competition. Search the web to find competitor features, user reviews, and market trends. Search the Brain for feature requests and user feedback. Always validate assumptions with real market data. When you need clarification before executing a task, you MUST ask the user concise, specific questions first. NEVER show tool calls or internal mechanics.', tools: getToolsForCategories(['project-management', 'communications', 'research']) },
    { name: 'Roadmap Agent', role: 'Product', icon: '🗺️', color: '#a855f7', system_prompt: 'You are the Roadmap Agent — a strategic foresight engine. Your mission: maintain the long-term vision, plan milestones, track strategic goals, and align product direction with business objectives. PROACTIVELY research market trends, emerging technologies, and competitive moves. Search the web for industry analysis and technology trends. Search the Brain for strategy docs and discussions. When you need clarification before executing a task, you MUST ask the user concise, specific questions first. NEVER show tool calls or internal mechanics.', tools: getToolsForCategories(['project-management', 'communications', 'research']) },
    { name: 'Meeting Agent', role: 'Operations', icon: '📅', color: '#6366f1', system_prompt: 'You are the Meeting Agent — a productivity multiplier. Your mission: manage the full meeting lifecycle — preparing agendas, extracting decisions and action items, sending follow-ups, and scheduling next meetings. PROACTIVELY use web research to prepare meeting briefs with current context on topics being discussed. Search the Brain for past meeting transcripts, decisions, and action items to provide context. When you need clarification before executing a task, you MUST ask the user concise, specific questions first. NEVER show tool calls or internal mechanics.', tools: getToolsForCategories(['communications', 'project-management', 'storage', 'research']) }
  ];
}

router.get('/agents', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const companyId = req.user.company_id;
    console.log(`[Agents] GET /agents called for company: ${companyId}, user: ${req.user.email}`);

    // If no company_id, return in-memory agents as fallback
    if (!companyId) {
      console.warn('[Agents] No company_id on user — returning in-memory agents');
      const fallback = getSystemAgentDefinitions().map((a, i) => ({
        id: `system_${i}`, ...a, created_at: new Date().toISOString()
      }));
      return res.json({ agents: fallback });
    }

    const supabase = require('../models/supabaseClient');

    // Try to fetch existing agents
    let { data, error } = await supabase
      .from('agents')
      .select('*')
      .eq('tenant_id', companyId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Agents] DB query error:', error.message);
      // Table might not exist — return in-memory agents
      const fallback = getSystemAgentDefinitions().map((a, i) => ({
        id: `system_${i}`, ...a, created_at: new Date().toISOString()
      }));
      return res.json({ agents: fallback });
    }

    // ─── Step 1: Clean up deprecated agents ───
    const deprecatedInDB = (data || []).filter(a => OLD_AGENT_NAMES.includes(a.name));
    if (deprecatedInDB.length > 0) {
      console.log(`[Agents] Removing ${deprecatedInDB.length} deprecated agents: ${deprecatedInDB.map(a => a.name).join(', ')}`);
      const deprecatedIds = deprecatedInDB.map(a => a.id);
      await supabase.from('agents').delete().in('id', deprecatedIds);
      // Remove from local data array
      const cleanedData = (data || []).filter(a => !OLD_AGENT_NAMES.includes(a.name));
      // Continue with cleaned data
      data = cleanedData;
    }

    // ─── Step 2: Update existing agents with new prompts/tools if changed ───
    const systemDefs = getSystemAgentDefinitions();
    for (const def of systemDefs) {
      const existing = (data || []).find(a => a.name === def.name);
      if (existing && (existing.system_prompt !== def.system_prompt || existing.role !== def.role)) {
        console.log(`[Agents] Updating prompt/role for "${def.name}"`);
        await supabase.from('agents').update({
          system_prompt: def.system_prompt,
          role: def.role,
          tools: def.tools,
        }).eq('id', existing.id);
        // Update local copy
        existing.system_prompt = def.system_prompt;
        existing.role = def.role;
        existing.tools = def.tools;
      }
    }

    // ─── Step 3: Install missing agents ───
    const existingNames = (data || []).map((a) => a.name);
    const missingAgents = systemDefs.filter(a => !existingNames.includes(a.name));

    if (missingAgents.length > 0) {
      console.log(`[Agents] ${missingAgents.length} system agents missing — auto-installing...`);
      const agentsToInsert = missingAgents.map(a => ({
        tenant_id: companyId,
        name: a.name,
        role: a.role,
        system_prompt: a.system_prompt,
        tools: a.tools,
      }));

      const { data: insertedAgents, error: insertError } = await supabase
        .from('agents')
        .insert(agentsToInsert)
        .select();

      if (insertError) {
        console.error('[Agents] Auto-install DB error:', insertError.message);
      } else {
        console.log(`[Agents] Successfully auto-installed ${insertedAgents.length} agents`);
        // Merge with existing and return
        const allAgents = [...(data || []), ...insertedAgents];
        return res.json({ agents: allAgents });
      }
    }

    // Return existing agents (all system agents already present)
    if (data && data.length > 0) {
      console.log(`[Agents] Returning ${data.length} agents from DB`);
      return res.json({ agents: data });
    }

    // Fallback: return in-memory agents if DB is completely empty
    const fallback = getSystemAgentDefinitions().map((a, i) => ({
      id: `system_${i}`, ...a, created_at: new Date().toISOString()
    }));
    return res.json({ agents: fallback });
  } catch (error) {
    console.error('[Agents] Unexpected error:', error.message);
    // Ultimate fallback — always return agents
    const fallback = getSystemAgentDefinitions().map((a, i) => ({
      id: `system_${i}`, ...a, created_at: new Date().toISOString()
    }));
    return res.json({ agents: fallback });
  }
});

/**
 * POST /api/orchestrator/agent-chat
 * Direct agent-specific chat endpoint that bypasses DB agent lookup.
 * Takes agentName and agentSystemPrompt to route the message to the correct agent personality.
 * Body: { message, sessionId, agentName, agentSystemPrompt }
 */
router.post('/agent-chat', async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized. Authentication required.' });
    }

    const { message, sessionId, agentName, agentSystemPrompt } = req.body;

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ error: 'Message is required and must be a non-empty string.' });
    }

    // Build the agent-specific system prompt.
    // The `ask_user_question` tool and its CRITICAL instruction are injected automatically
    // by orchestrator.js when agentId is present — no need to duplicate them here.
    const systemPrompt = agentSystemPrompt
      ? `You are ${agentName}, an AI agent operating as part of The Brain AIOS.

${agentSystemPrompt}

CRITICAL RULES:
- NEVER show tool calls or internal mechanics to the user.
- After the user answers a question, continue the conversation naturally.
- ACT, don't just describe. When the user asks you to produce a deliverable (a list, analysis, plan, research, or document), actually DO it: use your web research tools to gather real, current data and your document tools to create the file when appropriate, then present the COMPLETE result to the user. Never reply with only "I will…" or a description of what you would do — produce the actual output in this turn.
- NEVER promise future autonomous work. You only act within THIS turn. Do NOT say "once you approve, I'll generate…" or "after you approve this brief I'll create…" — you will NOT automatically continue after an approval. Produce the real deliverable NOW.
- VISUAL ASSETS (logos, icons, graphics, banners, mockups): do NOT write a brief and promise to design later, and do NOT generate raster images. Produce 2-4 distinct concepts IMMEDIATELY as self-contained code in your reply, each inside a fenced \`\`\`svg block (or \`\`\`html for richer compositions) — the app renders these as live previews so the user sees the actual logos right away. Caption each concept. Only create a written brief document if the user explicitly asks for one.
- Ask AT MOST one clarifying question, and only if essential. If the user has given you enough to proceed (or has already answered), get to work immediately instead of asking more questions.`
      : '';

    // ─── SESSION MANAGEMENT ───
    // Create a session if one doesn't exist (needed for conversation history to persist
    // across multi-turn agent question flows)
    let activeSessionId = sessionId || null;
    if (!activeSessionId) {
      try {
        const supabaseSession = require('../models/supabaseClient');
        const title = message.substring(0, 50) + (message.length > 50 ? '...' : '');
        const { data: newSession, error: sessErr } = await supabaseSession
          .from('chat_sessions')
          .insert([{
            tenant_id: req.user.company_id,
            user_id: req.user.id,
            title: `Agent: ${agentName || 'Chat'} - ${title}`
          }])
          .select()
          .single();

        if (!sessErr && newSession) {
          activeSessionId = newSession.id;
          console.log(`[AgentChat] New session created: ${activeSessionId}`);
        }
      } catch (sessError) {
        console.warn('[AgentChat] Failed to create session:', sessError.message);
      }
    }

    const result = await processMessage({
      message: message.trim(),
      sessionId: activeSessionId,
      user: req.user,
      agentId: agentName || 'agent',
      systemPrompt: systemPrompt || undefined,
    });

    // ─── Handle question responses (ask_user_question tool call) ───
    if (result.type === 'question') {
      // Save the question to chat history so the agent has context when user responds
      try {
        const supabase = require('../models/supabaseClient');
        if (activeSessionId) {
          await supabase.from('chat_history').insert({
            session_id: activeSessionId,
            tenant_id: req.user.company_id,
            user_id: req.user.id,
            role: 'assistant',
            content: result.question,
            agent_name: agentName || null,
            sources: result.sources || [],
            choices: result.choices || [],
          });
        }
      } catch (saveErr) {
        console.warn('[AgentChat] Failed to save question to history:', saveErr.message);
      }

      return res.status(200).json({
        type: 'question',
        question: result.question,
        choices: result.choices,
        sessionId: activeSessionId,
        sources: result.sources || [],
      });
    }

    // ─── PERSIST AGENT CHAT HISTORY with agent_name ───
    if (activeSessionId && req.user.company_id) {
      try {
        const supabaseHistory = require('../models/supabaseClient');
        await supabaseHistory.from('chat_history').insert([
          {
            session_id: activeSessionId,
            tenant_id: req.user.company_id,
            user_id: req.user.id,
            role: 'user',
            content: message,
            agent_name: agentName || null,
            sources: [],
          },
          {
            session_id: activeSessionId,
            tenant_id: req.user.company_id,
            user_id: req.user.id,
            role: 'assistant',
            content: result.reply,
            agent_name: agentName || null,
            sources: result.sources || [],
          },
        ]);
      } catch (historyErr) {
        console.warn('[AgentChat] Failed to save chat history:', historyErr.message);
      }
    }

    res.status(200).json({
      reply: result.reply,
      sessionId: result.sessionId || activeSessionId,
      toolsUsed: result.toolsUsed,
      sources: result.sources || [],
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orchestrator/agent-chat/history/:agentName
 * Retrieve per-agent chat history, filtered by agent_name.
 */
router.get('/agent-chat/history/:agentName', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { agentName } = req.params;
    const supabase = require('../models/supabaseClient');

    const { data: sessions, error: sessErr } = await supabase
      .from('chat_sessions')
      .select('id, title, created_at')
      .eq('user_id', req.user.id)
      .eq('tenant_id', req.user.company_id)
      .ilike('title', `Agent: ${agentName}%`)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (sessErr) {
      console.warn('[AgentChat History] Failed to fetch sessions:', sessErr.message);
      return res.json({ sessions: [], messages: [] });
    }

    // Fetch all messages for those sessions
    let allMessages = [];
    if (sessions && sessions.length > 0) {
      const sessionIds = sessions.map(s => s.id);
      const { data: messages, error: msgErr } = await supabase
        .from('chat_history')
        .select('id, role, content, agent_name, sources, choices, created_at')
        .in('session_id', sessionIds)
        .eq('agent_name', agentName)
        .order('created_at', { ascending: true })
        .limit(100);

      if (!msgErr && messages) {
        // Filter out system messages
        allMessages = messages.filter(m => m.role !== 'system');
      }
    }

    res.json({ sessions: sessions || [], messages: allMessages });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/orchestrator/chat/history
 * Retrieve Brain-specific chat history (where agent_name is null).
 */
router.get('/chat/history', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const supabase = require('../models/supabaseClient');

    const { data: sessions, error: sessErr } = await supabase
      .from('chat_sessions')
      .select('id, title, created_at')
      .eq('user_id', req.user.id)
      .eq('tenant_id', req.user.company_id)
      .not('title', 'ilike', 'Agent: %')
      .order('updated_at', { ascending: false })
      .limit(10);

    if (sessErr) {
      return res.json({ sessions: [], messages: [] });
    }

    let allMessages = [];
    if (sessions && sessions.length > 0) {
      const sessionIds = sessions.map(s => s.id);
      const { data: messages, error: msgErr } = await supabase
        .from('chat_history')
        .select('id, role, content, agent_name, sources, choices, created_at')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: true })
        .limit(100);

      if (!msgErr && messages) {
        // Filter out system messages
        allMessages = messages.filter(m => m.role !== 'system');
      }
    }

    res.json({ sessions: sessions || [], messages: allMessages });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/orchestrator/agents
 * Saves a new custom agent
 */
router.post('/agents', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { name, role, system_prompt, tools } = req.body;
    if (!name || !role || !system_prompt) {
      return res.status(400).json({ error: 'Name, role, and system_prompt are required.' });
    }

    const supabase = require('../models/supabaseClient');
    const { data, error } = await supabase
      .from('agents')
      .insert([{
        tenant_id: req.user.company_id,
        name,
        role,
        system_prompt,
        tools: tools || [],
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ agent: data });
  } catch (error) {
    next(error);
  }
});

router.getSystemAgentDefinitions = getSystemAgentDefinitions;
module.exports = router;
