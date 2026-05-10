const supabase = require('./supabaseClient');

/**
 * Fetch a soft agent configuration by ID
 * @param {string} agentId
 * @returns {Promise<Object>} The agent configuration
 */
async function getAgentById(agentId) {
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .single();

  if (error) {
    throw new Error(`Failed to fetch agent configuration: ${error.message}`);
  }
  return data;
}

module.exports = {
  getAgentById
};
