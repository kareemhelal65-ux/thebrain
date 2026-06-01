/**
 * Agent Execution Routes
 * 
 * Endpoints for managing agent executions:
 * - POST /api/agents/launch — Launch a new agent or startup agent package
 * - GET /api/agents/runs — List all agent executions for the company
 * - GET /api/agents/runs/:id — Get agent execution details + conversation history
 * - POST /api/agents/runs/:id/respond — Respond to an agent's question
 * - POST /api/agents/runs/:id/cancel — Cancel a running agent
 * - GET /api/agents/definitions — List available agent types
 * - POST /api/agents/research — Trigger company research scan
 */

const express = require('express');
const router = express.Router();
const supabase = require('../models/supabaseClient');
const { launchAgent, launchStartupAgents, launchRecipe, respondToAgent, getCompanyExecutions, getExecution, AGENT_DEFINITIONS, AGENT_RECIPES, requestStop } = require('../services/agentOrchestrator');
const { triggerCompanyResearch } = require('../services/companyResearchService');
const { listPendingActions, approveAction, rejectAction } = require('../services/actionApprovalService');

/**
 * GET /api/agents/definitions
 * Returns all available agent type definitions and their initial questions.
 */
router.get('/definitions', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const definitions = {};
    for (const [key, def] of Object.entries(AGENT_DEFINITIONS)) {
      definitions[key] = {
        label: def.label,
        icon: def.icon,
        color: def.color,
        description: def.description,
        priority: def.priority,
        initialQuestions: def.initialQuestions,
      };
    }

    res.json({ agentTypes: definitions });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/agents/recipes
 * Returns the capability recipe catalog per agent (Phase W) for the workspace tabs.
 */
router.get('/recipes', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const recipes = {};
    for (const [agentType, list] of Object.entries(AGENT_RECIPES || {})) {
      recipes[agentType] = (list || []).map(r => ({
        id: r.id, label: r.label, icon: r.icon, output_type: r.output_type,
        render: r.render, description: r.description,
        hasQuestions: Array.isArray(r.suggestedQuestions) && r.suggestedQuestions.length > 0,
      }));
    }
    res.json({ recipes });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agents/launch-recipe
 * Launch a capability recipe run. Body: { agentType, recipeId, requirePlan }.
 */
router.post('/launch-recipe', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { agentType, recipeId, requirePlan } = req.body;
    if (!agentType || !recipeId) {
      return res.status(400).json({ error: 'agentType and recipeId are required' });
    }
    if (!AGENT_DEFINITIONS[agentType]) {
      return res.status(400).json({ error: `Unknown agent type: ${agentType}` });
    }

    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('*')
      .eq('id', req.user.company_id)
      .single();
    if (companyErr || !company) return res.status(404).json({ error: 'Company not found' });

    const execution = await launchRecipe({
      companyId: company.id,
      agentType,
      recipeId,
      companyProfile: company,
      user: req.user,
      requirePlan: !!requirePlan,
    });

    res.status(201).json({ success: true, execution });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agents/launch
 * Launch agent(s). Supports:
 * - Individual agent: { agentType: 'competitor_researcher' }
 * - Startup package: { launchAll: true } — launches all agents for new company
 */
router.post('/launch', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { agentType, launchAll, requirePlan } = req.body;

    // Fetch company profile
    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('*')
      .eq('id', req.user.company_id)
      .single();

    if (companyErr || !company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    if (launchAll) {
      // Launch the full startup agent package
      const agentIds = await launchStartupAgents({
        companyId: company.id,
        companyProfile: company,
        user: req.user,
      });

      return res.status(201).json({
        success: true,
        message: 'All agents launched successfully',
        agentIds,
      });
    }

    if (!agentType) {
      return res.status(400).json({ error: 'agentType or launchAll is required' });
    }

    if (!AGENT_DEFINITIONS[agentType]) {
      return res.status(400).json({ error: `Unknown agent type: ${agentType}. Use GET /api/agents/definitions to see available types.` });
    }

    const execution = await launchAgent({
      companyId: company.id,
      agentType,
      companyProfile: company,
      user: req.user,
      requirePlan, // undefined → default (on for engineering); true/false → explicit
    });

    res.status(201).json({
      success: true,
      execution,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/agents/runs
 * List all agent executions for the current company.
 */
router.get('/runs', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const executions = await getCompanyExecutions(req.user.company_id);

    res.json({ executions });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/agents/runs/:id
 * Get details for a specific agent execution.
 */
router.get('/runs/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const execution = await getExecution(req.params.id);

    // Verify company ownership
    if (execution.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({ execution });
  } catch (error) {
    if (error.message === 'Execution not found') {
      return res.status(404).json({ error: 'Execution not found' });
    }
    next(error);
  }
});

/**
 * POST /api/agents/runs/:id/stop
 * Ask a running agent to stop working on its current task.
 */
router.post('/runs/:id/stop', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: execution } = await supabase
      .from('agent_executions')
      .select('company_id, status')
      .eq('id', req.params.id)
      .single();

    if (!execution) return res.status(404).json({ error: 'Execution not found' });
    if (execution.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Flag the in-process loop to bail at its next checkpoint, and reflect the
    // stop immediately by returning the agent to an idle, usable state (not a
    // terminal "stopped" status the user gets stuck on).
    requestStop(req.params.id);
    if (['running', 'awaiting_input'].includes(execution.status)) {
      await supabase
        .from('agent_executions')
        .update({ status: 'idle', current_action: '', progress_pct: 0, current_question: null, current_question_choices: null, current_question_id: null, updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
    }

    res.json({ success: true, message: 'Stop requested' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agents/runs/:id/respond
 * Send a response to an agent that's waiting for user input.
 */
router.post('/runs/:id/respond', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { answer, answers } = req.body;
    if (!answer && !answers) {
      return res.status(400).json({ error: 'Answer or answers is required' });
    }

    // Verify company ownership before responding
    const { data: execution } = await supabase
      .from('agent_executions')
      .select('company_id, status')
      .eq('id', req.params.id)
      .single();

    if (!execution) return res.status(404).json({ error: 'Execution not found' });
    if (execution.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Fetch company profile for context
    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', req.user.company_id)
      .single();

    const payload = answers || (typeof answer === 'string' ? answer.trim() : answer);
    await respondToAgent(req.params.id, payload, company || {}, req.user);

    res.json({ success: true, message: 'Response sent to agent' });
  } catch (error) {
    if (error.message.includes('not waiting for input')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * POST /api/agents/runs/:id/cancel
 * Cancel a running or awaiting_input agent execution.
 */
router.post('/runs/:id/cancel', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data: execution } = await supabase
      .from('agent_executions')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!execution) return res.status(404).json({ error: 'Execution not found' });
    if (execution.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await supabase
      .from('agent_executions')
      .update({
        status: 'cancelled',
        current_action: 'Cancelled by user',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    res.json({ success: true, message: 'Agent cancelled' });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agents/research
 * Trigger a full company research scan (website + social media).
 */
router.post('/research', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const result = await triggerCompanyResearch(req.user.company_id);

    res.json({
      success: true,
      message: 'Company research scan completed',
      research: result,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/agents/actions
 * List proposed agent actions awaiting user approval (approval-first workflow).
 */
router.get('/actions', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const actions = await listPendingActions(req.user.company_id);
    res.json({ actions });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/agents/actions/:id/approve
 * Approve (and execute) a proposed action. Optional body { overrides } to edit args first.
 */
router.post('/actions/:id/approve', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const result = await approveAction(req.params.id, req.user, req.body?.overrides || null);
    res.json({ success: true, action: result });
  } catch (error) {
    if (/not found/i.test(error.message)) return res.status(404).json({ error: error.message });
    if (/unauthorized/i.test(error.message)) return res.status(403).json({ error: error.message });
    if (/already|denied/i.test(error.message)) return res.status(400).json({ error: error.message });
    next(error);
  }
});

/**
 * POST /api/agents/actions/:id/reject
 * Reject a proposed action. Optional body { reason }.
 */
router.post('/actions/:id/reject', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const result = await rejectAction(req.params.id, req.user, req.body?.reason || null);
    res.json({ success: true, action: result });
  } catch (error) {
    if (/not found/i.test(error.message)) return res.status(404).json({ error: error.message });
    if (/unauthorized/i.test(error.message)) return res.status(403).json({ error: error.message });
    next(error);
  }
});

module.exports = router;
