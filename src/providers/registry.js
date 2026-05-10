const fs = require('fs');
const path = require('path');
const { getEnabledCategories } = require('../models/companyConfig');

/**
 * Dynamic Function Registry
 * 
 * The single source of truth for all tool definitions.
 * Loads JSON tool schemas from /tools at startup, indexes them by category and name.
 * The LLM only sees tools the company has access to — no hallucinated function calls
 * to disabled services.
 */

// Internal stores
const toolsByCategory = {};  // { category: [tool, tool, ...] }
const toolsByName = {};      // { toolName: tool }
const allCategories = new Set();

/**
 * Load all tool definition files from the /tools directory.
 * Called once at startup.
 */
function loadToolDefinitions() {
  const toolsDir = path.join(__dirname, '..', 'tools');
  const files = fs.readdirSync(toolsDir).filter(f => f.endsWith('.tools.json'));

  for (const file of files) {
    const filePath = path.join(toolsDir, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const category = data.category;

    allCategories.add(category);
    toolsByCategory[category] = data.tools;

    for (const tool of data.tools) {
      toolsByName[tool.name] = {
        ...tool,
        category // Ensure category is always attached
      };
    }
  }

  console.log(`[Registry] Loaded ${Object.keys(toolsByName).length} tools across ${allCategories.size} categories: ${[...allCategories].join(', ')}`);
}

/**
 * Resolve which tools a company can access based on their enabled services.
 * Only returns tool schemas for categories the company has active providers for.
 * 
 * @param {string} companyId
 * @returns {Promise<Object[]>} Array of tool definitions (for LLM function calling)
 */
async function resolveToolsForCompany(companyId) {
  const enabledCategories = await getEnabledCategories(companyId);
  const tools = [];

  for (const category of enabledCategories) {
    if (toolsByCategory[category]) {
      tools.push(...toolsByCategory[category]);
    }
  }

  return tools;
}

/**
 * Convert tool definitions to OpenAI-compatible function calling format.
 * @param {Object[]} tools - Array of tool definitions
 * @returns {Object[]} OpenAI function calling format
 */
function toFunctionCallingFormat(tools) {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

/**
 * Get a specific tool by name.
 * @param {string} name
 * @returns {Object|null} Tool definition or null
 */
function getToolByName(name) {
  return toolsByName[name] || null;
}

/**
 * Get all tools in a specific category.
 * @param {string} category
 * @returns {Object[]}
 */
function getToolsByCategory(category) {
  return toolsByCategory[category] || [];
}

/**
 * Get all registered categories.
 * @returns {string[]}
 */
function getCategories() {
  return [...allCategories];
}

/**
 * Get all loaded tools.
 * @returns {Object[]}
 */
function getAllTools() {
  return Object.values(toolsByName);
}

// Initialize on load
loadToolDefinitions();

module.exports = {
  resolveToolsForCompany,
  toFunctionCallingFormat,
  getToolByName,
  getToolsByCategory,
  getCategories,
  getAllTools,
  loadToolDefinitions // Exposed for testing/reloading
};
