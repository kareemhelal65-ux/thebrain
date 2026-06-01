/**
 * Document Enhancement Service
 *
 * Uses the LLM to:
 * 1. Structure raw content into well-organized sections with tables, lists, and formatting
 * 2. Adapt content quality and structure for each export format (PDF, DOCX, PPTX, CSV)
 * 3. Generate executive summaries, key takeaways, and metadata
 * 4. Detect data tables in text and format them properly
 * 5. Provide format-specific recommendations
 */

const llmService = require('./llmService');

/**
 * Enhance document content for a specific export format.
 * Uses the LLM to restructure and optimize the content for the target format.
 *
 * @param {string} title - Document title
 * @param {string} content - Raw markdown/plaintext content
 * @param {'pdf'|'docx'|'pptx'|'csv'} format - Target export format
 * @returns {Promise<{title: string, content: string, metadata: object}>}
 */
async function enhanceForFormat(title, content, format) {
  const formatGuides = {
    pdf: `REFORMAT this document for a professional PDF report.
- RESTRUCTURE with clear heading hierarchy (# Main, ## Section, ### Subsection)
- Add an executive summary section at the top
- Format any tabular data as markdown tables with | pipes
- Use bullet lists (- items) for enumeration
- Keep content comprehensive (500-1500 words)
- Add a "Key Takeaways" section at the end with 3-5 bullet points
- Ensure all sections have 2-4 paragraphs of substantive content`,

    docx: `REFORMAT this document for a Microsoft Word document.
- Use proper heading levels (# for main title, ## for sections, ### for subsections)
- Create proper markdown tables for any structured data
- Use bullet lists (-) and numbered lists (1.) where appropriate
- Include a document header with title and date information
- Organize content into well-structured paragraphs
- Target 500-1500 words of detailed content
- Add action items or next steps section at the end if applicable`,

    pptx: `REFORMAT this document for a PowerPoint presentation.
- Start with a clear main heading (#)
- Break content into multiple sections (##) — each becomes a slide
- Each section should have 3-6 concise bullet points
- Use short, scannable phrases — not long paragraphs
- Include data as simple comparison points
- Keep each section focused on ONE key message
- Aim for 3-8 slides total
- Add a "Key Takeaways" slide at the end with 3-5 bullets`,

    csv: `REFORMAT this content as structured tabular data for CSV export.
- Identify any data tables, metrics, or structured information
- Format the primary data table with | pipe syntax (header row, separator row, data rows)
- If multiple tables exist, separate them with a blank line
- If no natural table exists, create a structured "Key Points" table with columns: Category | Detail | Priority
- Keep data factual and concise
- Remove narrative prose, keep structured data only`,
  };

  const guide = formatGuides[format] || formatGuides.pdf;

  const messages = [
    {
      role: 'system',
      content: `You are a professional document formatting expert. Your job is to restructure raw content into beautifully formatted markdown optimized for ${format.toUpperCase()} export.

${guide}

CRITICAL RULES:
1. Return ONLY valid JSON — no markdown fences, no code blocks, no extra text
2. The JSON must have exactly these fields: "title", "content", "format", "metadata"
3. "content" must be formatted markdown using proper headings, tables (| syntax), lists, etc.
4. "metadata" must be an object with: "sections" (number), "wordCount" (number), "hasTables" (boolean), "qualityScore" (number 1-100)
5. Quality score must be 85-100 — never settle for low quality
6. Content must be comprehensive and substantive

Example response:
{
  "title": "Q3 Marketing Strategy",
  "content": "# Q3 Marketing Strategy\\n\\n## Executive Summary\\n...",
  "format": "${format}",
  "metadata": {
    "sections": 6,
    "wordCount": 850,
    "hasTables": true,
    "qualityScore": 95
  }
}`,
    },
    {
      role: 'user',
      content: `Please enhance and restructure this content for ${format.toUpperCase()} export:

Title: ${title}

Content:
---
${content}
---

Return the JSON response with the enhanced content optimized for ${format.toUpperCase()}.`,
    },
  ];

  try {
    const llmRes = await llmService.callLLMWithTools(messages, [], {
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    let cleaned = llmRes.content.trim();
    // Strip any markdown fences
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\w*\s*/, '').replace(/\s*```$/, '').trim();
    }

    const parsed = JSON.parse(cleaned);

    const meta = parsed.metadata || {};

    return {
      title: parsed.title || title,
      content: parsed.content || content,
      metadata: {
        sections: meta.sections || 1,
        wordCount: meta.wordCount || content.split(/\s+/).length,
        hasTables: meta.hasTables || false,
        qualityScore: Math.min(100, Math.max(1, meta.qualityScore || 70)),
      },
    };
  } catch (err) {
    console.error('[DocumentEnhancement] LLM enhancement failed:', err.message);
    // Return original content with basic metadata
    return {
      title,
      content,
      metadata: {
        sections: content.split('\n## ').length,
        wordCount: content.split(/\s+/).length,
        hasTables: content.includes('|'),
        qualityScore: 70,
      },
    };
  }
}

/**
 * Generate a structured brief/outline from raw content
 */
async function generateBrief(title, content) {
  const messages = [
    {
      role: 'system',
      content: `You are a document analysis expert. Given raw document content, produce a structured brief.

Return ONLY JSON with:
{
  "title": "document title",
  "executiveSummary": "2-3 sentence summary",
  "sections": ["section1", "section2", ...],
  "keyTakeaways": ["takeaway1", "takeaway2", "takeaway3"],
  "documentType": "report|proposal|analysis|memo|strategy",
  "recommendedFormat": "pdf|docx|pptx|csv",
  "wordCount": number
}`,
    },
    {
      role: 'user',
      content: `Analyze this document and produce a brief:

Title: ${title}

Content:
${content.substring(0, 4000)}`,
    },
  ];

  try {
    const llmRes = await llmService.callLLMWithTools(messages, [], {
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    let cleaned = llmRes.content.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\w*\s*/, '').replace(/\s*```$/, '').trim();
    }

    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[DocumentEnhancement] Brief generation failed:', err.message);
    return {
      title,
      executiveSummary: 'Brief generation failed. Please review the document manually.',
      sections: [],
      keyTakeaways: [],
      documentType: 'document',
      recommendedFormat: 'pdf',
      wordCount: content.split(/\s+/).length,
    };
  }
}

module.exports = {
  enhanceForFormat,
  generateBrief,
};
