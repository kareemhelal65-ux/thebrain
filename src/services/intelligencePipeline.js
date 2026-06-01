const { groq } = require('./llmService');

const DEPARTMENTS = ['operations', 'product', 'commercial', 'finance', 'hr', 'general'];

/**
 * Classifies text into one of the designated departments.
 * @param {string} text - The text to classify.
 * @returns {Promise<string>} The classified department.
 */
async function classifyDepartment(text) {
  try {
    // Truncate text to avoid blowing up context window just for classification
    const truncated = text.substring(0, 4000);

    const prompt = `You are a corporate classification AI. Assign the task/content below to the single most relevant department. Pick the closest fit — "General" is a LAST RESORT, only for purely administrative or truly cross-functional items with no dominant function.

Departments (with examples):
- Finance: fundraising, investor pitch decks, financial models, budgets, runway, accounting, pricing, payroll cost.
- Commercial: sales, marketing, growth, social media, outreach, ads, content, SEO, landing pages/marketing websites, partnerships, CRM, customer acquisition.
- Product: building the product, features, engineering, writing code, software systems, APIs, design/UX, technical architecture, roadmap, bug fixes, integrations.
- HR: hiring, recruiting, interviews, job posts, people management, culture, employee onboarding, benefits, performance.
- Operations: internal operations, legal, compliance, IT/infrastructure, vendors, logistics, admin processes, tooling/workflow setup.
- General: ONLY if none of the above clearly dominates.

Examples:
- "Prepare investor pitch deck" -> Finance
- "Start outreach on social media" -> Commercial
- "Create a marketing website" -> Commercial
- "Develop company code invitation system" -> Product
- "Draft the Q3 hiring plan" -> HR
- "Set up the company VPN and access policy" -> Operations

Respond with ONLY the single department word (Finance, Commercial, Product, HR, Operations, or General).

TASK/CONTENT:
${truncated}`;

    // Use a non-reasoning model here: reasoning models (e.g. gpt-oss) burn the token
    // budget on hidden reasoning and return empty content under a small max_tokens cap.
    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0,
      max_tokens: 20
    });

    const raw = (response.choices[0].message.content || '').toLowerCase();
    // Robust parse: find which department keyword appears (prefer a specific one
    // over "general"), so trailing punctuation or stray words don't break matching.
    const specific = DEPARTMENTS.filter(d => d !== 'general');
    const matched = specific.find(d => new RegExp(`\\b${d}\\b`).test(raw));
    return matched || (/\bgeneral\b/.test(raw) ? 'general' : 'general');
  } catch (err) {
    console.error('[Intelligence] Classification failed:', err.message);
    return 'general';
  }
}

/**
 * Extracts universal entities (People, Decisions, Actions, Topics, Projects) from any text.
 * @param {string} text - The text to analyze.
 * @returns {Promise<Object>} The extracted entities in structured JSON.
 */
async function extractEntities(text) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const prompt = `You are an expert document intelligence analyst. Extract structured entities from the following text.
Today's date is ${today}.
    
Return your analysis as a JSON object with exactly these fields:
{
  "people": ["Name 1", "Name 2"],
  "decisions": [
    { 
      "decision": "What was decided", 
      "decider": "Who made the decision",
      "alternatives_rejected": ["Option A", "Option B"],
      "rationale": "Why this option was chosen",
      "outcome": "What happens next as a result"
    }
  ],
  "action_items": [
    { "task": "What needs to be done", "assignee": "Who is responsible (or 'Unassigned')", "deadline": "YYYY-MM-DD format (resolve relative dates like 'next Friday', 'end of month' relative to today ${today}) or 'Not specified'", "priority": "high/medium/low", "department": "operations|product|commercial|finance|hr|general" }
  ],
  "topics": ["topic1", "topic2"],
  "projects": ["project1", "project2"]
}

IMPORTANT: Return ONLY valid JSON, no markdown formatting, no explanation.
For deadlines: If the text says "by Friday", "next week", "end of month", "before June 1", calculate the actual YYYY-MM-DD date. If no deadline is detectable, use "Not specified".
For department: Assign each action item to the most relevant department based on task context.

TEXT:
${text.substring(0, 8000)} // truncate if extremely long
`;

    const response = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0].message.content;
    return JSON.parse(content);
  } catch (err) {
    console.error('[Intelligence] Entity extraction failed:', err.message);
    return {
      people: [],
      decisions: [],
      action_items: [],
      topics: [],
      projects: []
    };
  }
}

module.exports = {
  classifyDepartment,
  extractEntities
};
