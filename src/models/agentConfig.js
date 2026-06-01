const supabase = require('./supabaseClient');

/**
 * Fetch a soft agent configuration by ID or Name/Role
 * @param {string} agentId
 * @returns {Promise<Object>} The agent configuration
 */
async function getAgentById(agentId) {
  if (!agentId) return null;

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId);
  
  let query = supabase.from('agents').select('*');
  if (isUUID) {
    query = query.eq('id', agentId);
  } else {
    // If it's a template key or label name, check both name and role/type fields
    query = query.or(`name.eq."${agentId}",role.ilike.%${agentId}%`);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.warn(`[agentConfig] Error querying agents table for ID ${agentId}:`, error.message);
  }

  if (data) return data;

  // Fallback 1: search in system agent definitions by name or role/type
  try {
    const orchestrationRoutes = require('../api/orchestrationRoutes');
    const getSystemDefs = orchestrationRoutes.getSystemAgentDefinitions;
    if (typeof getSystemDefs === 'function') {
      const systemDefs = getSystemDefs();
      const matched = systemDefs.find(a => 
        a.name.toLowerCase() === agentId.toLowerCase() || 
        a.role.toLowerCase() === agentId.toLowerCase()
      );
      if (matched) {
        return {
          id: `system_${matched.name.toLowerCase().replace(/\s+/g, '_')}`,
          name: matched.name,
          role: matched.role,
          system_prompt: matched.system_prompt,
          system_prompt_modifier: '',
          tools: matched.tools || []
        };
      }
    }
  } catch (err) {
    console.warn('[agentConfig] Failed to resolve system definitions fallback:', err.message);
  }

  // Fallback 2: check AGENT_DEFINITIONS in agentOrchestrator
  try {
    const { AGENT_DEFINITIONS } = require('../services/agentOrchestrator');
    if (AGENT_DEFINITIONS) {
      const matchedKey = Object.keys(AGENT_DEFINITIONS).find(key => 
        key.toLowerCase() === agentId.toLowerCase() ||
        AGENT_DEFINITIONS[key].label.toLowerCase() === agentId.toLowerCase()
      );
      if (matchedKey) {
        const def = AGENT_DEFINITIONS[matchedKey];
        return {
          id: `system_${matchedKey}`,
          name: def.label,
          role: matchedKey,
          system_prompt: def.systemPrompt,
          system_prompt_modifier: '',
          tools: []
        };
      }
    }
  } catch (err) {
    console.warn('[agentConfig] Failed to resolve AGENT_DEFINITIONS fallback:', err.message);
  }

  return null;
}

module.exports = {
  getAgentById
};

