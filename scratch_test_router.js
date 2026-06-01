const { getRelevantTools } = require('./src/services/semanticRouter');
const registry = require('./src/providers/registry');

async function run() {
  const companyTools = registry.getAllTools();
  console.log('Total tools:', companyTools.length);

  const testPrompts = [
    'create a new document detailing the marketing plan',
    'draft a roadmap for the product launch',
    'save this to a file',
    'create a report',
    'What is our MRR?'
  ];

  for (const prompt of testPrompts) {
    const tools = await getRelevantTools(prompt, companyTools);
    console.log(`\nPrompt: "${prompt}"`);
    console.log('Matched tools:', tools.map(t => t.name));
  }
}

run();
