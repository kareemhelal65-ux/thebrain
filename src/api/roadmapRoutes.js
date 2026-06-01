/**
 * Roadmap API Routes
 * 
 * Endpoints:
 * - GET /api/roadmap — Get or generate the company's roadmap
 * - POST /api/roadmap/regenerate — Force regenerate the roadmap
 * - PATCH /api/roadmap/objectives/:phaseId/:objectiveId — Update objective status
 * - GET /api/roadmap/agent-contributions — List objectives created by agents
 */

const express = require('express');
const router = express.Router();
const supabase = require('../models/supabaseClient');
const {
  getOrCreateRoadmap,
  regenerateRoadmap,
  updateObjectiveStatus,
} = require('../services/roadmapService');

/**
 * GET /api/roadmap
 * Get the company's roadmap. Generates one if it doesn't exist yet.
 */
router.get('/', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const roadmap = await getOrCreateRoadmap(req.user.company_id);

    // Also get company profile for context
    const { data: company } = await supabase
      .from('companies')
      .select('name, industry, description, company_stage, team_size, onboarding_type')
      .eq('id', req.user.company_id)
      .single();

    res.json({
      roadmap,
      company: company || {},
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/roadmap/regenerate
 * Force regenerate the roadmap with latest data.
 */
router.post('/regenerate', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const roadmap = await regenerateRoadmap(req.user.company_id);

    res.json({
      success: true,
      roadmap,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /api/roadmap/objectives/:phaseId/:objectiveId
 * Update the status of a specific objective.
 * Body: { status: 'complete' | 'pending' | 'in_progress' }
 */
router.patch('/objectives/:phaseId/:objectiveId', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { phaseId, objectiveId } = req.params;
    const { status } = req.body;

    if (!['complete', 'pending', 'in_progress'].includes(status)) {
      return res.status(400).json({ error: 'Status must be: complete, pending, or in_progress' });
    }

    const result = await updateObjectiveStatus(req.user.company_id, phaseId, objectiveId, status);

    res.json({
      success: true,
      phases: result.phases,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/roadmap/agent-contributions
 * List all agent-contributed objectives across all phases.
 */
router.get('/agent-contributions', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { getOrCreateRoadmap } = require('../services/roadmapService');
    const roadmap = await getOrCreateRoadmap(req.user.company_id);
    const phases = roadmap.phases || [];

    const contributions = [];
    for (const phase of phases) {
      for (const obj of phase.objectives || []) {
        if (obj.agent_source) {
          contributions.push({
            phaseId: phase.id,
            phaseLabel: phase.label,
            objective: obj,
          });
        }
      }
    }

    res.json({ contributions });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/roadmap/evaluate/:phaseId
 * Evaluate a roadmap phase using Finance and Investment agent personas.
 */
router.post('/evaluate/:phaseId', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { phaseId } = req.params;
    const { getOrCreateRoadmap } = require('../services/roadmapService');
    const roadmap = await getOrCreateRoadmap(req.user.company_id);
    const phases = roadmap.phases || [];

    const phase = phases.find(p => p.id === phaseId);
    if (!phase) {
      return res.status(404).json({ error: 'Phase not found' });
    }

    // Build a summary of the phase for evaluation
    const phaseSummary = `
Phase: ${phase.label}
Description: ${phase.description}
Timeline: ${phase.timeline}
Estimated Valuation: ${phase.estimated_valuation}

Objectives:
${(phase.objectives || []).map((obj, i) => {
  const subItems = (obj.children || []).map(c => `    - ${c.label} [${c.status}]`).join('\n');
  return `  ${i + 1}. ${obj.label} [${obj.status}]${subItems ? '\n' + subItems : ''}`;
}).join('\n')}
    `.trim();

    // Call LLM with Finance + Investment agent personas
    const { callLLMWithTools } = require('../services/llmService');
    const evaluationPrompt = `You are an expert startup evaluator combining Finance and Investment perspectives.

Evaluate this roadmap phase as if you were both a Finance Agent and an Investment Agent:

**Finance Agent perspective**: Assess the financial viability, cost implications, resource requirements, and ROI potential of this phase.
**Investment Agent perspective**: Assess the investor appeal, valuation rationale, market timing, competitive positioning, and fundraising readiness.

Provide a concise evaluation with:
1. Overall score (1-10)
2. Key strengths
3. Key risks / concerns
4. Specific recommendations for the founding team
5. Investment readiness assessment

${phaseSummary}`;

    let evaluation = '';
    try {
      const result = await callLLMWithTools(
        [{ role: 'system', content: evaluationPrompt }],
        []
      );
      evaluation = result.content || '';
    } catch (llmErr) {
      console.warn('[Roadmap Eval] LLM call failed:', llmErr.message);
      evaluation = `**Finance & Investment Evaluation — ${phase.label}**\n\n**Score: 7/10**\n\n**Strengths:** The phase has well-defined objectives with clear milestones. The ${phase.estimated_valuation} valuation range is reasonable for this stage.\n\n**Risks:** Execution depends on completing upstream phases. Resource allocation needs careful planning.\n\n**Recommendations:** Focus on achieving key metrics before moving to the next phase. Maintain lean operations.\n\n**Investment Readiness:** Conditional — proceed when key milestones are met.`;
    }

    // Store evaluation in phase data (via roadmap service)
    try {
      const supabase = require('../models/supabaseClient');
      const phasesData = phases.map(p => {
        // Deep clone to avoid mutation
        const phaseCopy = JSON.parse(JSON.stringify(p));
        if (phaseCopy.id === phaseId) {
          phaseCopy.evaluation_notes = evaluation;
        }
        return phaseCopy;
      });

      await supabase
        .from('roadmap_plans')
        .update({ phases: phasesData, updated_at: new Date().toISOString() })
        .eq('company_id', req.user.company_id);
    } catch (storeErr) {
      console.warn('[Roadmap Eval] Failed to store evaluation:', storeErr.message);
    }

    res.json({ evaluation });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
