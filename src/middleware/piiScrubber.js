/**
 * PII Scrubber — Data Loss Prevention (DLP)
 * 
 * Redacts sensitive information (SSNs, Credit Cards, etc.) from strings
 * before they are sent to external cloud LLMs.
 */

const PII_PATTERNS = {
  // Social Security Numbers (US)
  SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
  
  // Credit Card Numbers (General)
  CREDIT_CARD: /\b(?:\d[ -]*?){13,16}\b/g,
  
  // Email Addresses
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  
  // Phone Numbers (Generic)
  PHONE: /\b(?:\+?\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}\b/g,
  
  // IPv4 Addresses
  IP_ADDRESS: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
};

/**
 * Scrub PII from a string
 * @param {string} text - The input text
 * @returns {string} The scrubbed text
 */
function scrubPII(text) {
  if (typeof text !== 'string') return text;

  let scrubbedText = text;

  for (const [label, pattern] of Object.entries(PII_PATTERNS)) {
    scrubbedText = scrubbedText.replace(pattern, `[REDACTED ${label}]`);
  }

  return scrubbedText;
}

/**
 * Express middleware to scrub specific fields in the request body
 * @param {string[]} fields - Array of field names to scrub
 */
const piiScrubberMiddleware = (fields = ['prompt', 'message', 'input']) => {
  return (req, res, next) => {
    if (req.body) {
      fields.forEach(field => {
        if (req.body[field] && typeof req.body[field] === 'string') {
          req.body[field] = scrubPII(req.body[field]);
        }
      });
    }
    next();
  };
};

module.exports = {
  scrubPII,
  piiScrubberMiddleware
};
