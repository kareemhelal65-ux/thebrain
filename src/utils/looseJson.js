/**
 * Tolerant JSON parsing for LLM tool-call arguments and JSON-mode content.
 * Different providers/models (OpenAI, OpenRouter, Anthropic-compat, Gemini-compat,
 * Groq) emit slightly different/occasionally truncated JSON. This recovers as much
 * as possible: strips code fences, extracts the JSON span, and repairs truncation
 * (unclosed strings/brackets, trailing commas).
 */

/** Close any open string/brackets in a truncated JSON string so it can parse. */
function repairTruncatedJson(s) {
  let inStr = false, esc = false;
  const stack = [];
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    out += c;
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  if (inStr) out += '"';                 // close a dangling string
  out = out.replace(/,\s*$/, '');        // drop a trailing comma
  out = out.replace(/:\s*$/, ': null');  // dangling "key":  -> null
  while (stack.length) out += stack.pop(); // close open objects/arrays
  return out;
}

/**
 * Parse possibly-messy JSON. Returns the parsed value, or `undefined` if nothing
 * salvageable. Accepts objects (returned as-is) and strings.
 */
function parseLooseJson(raw) {
  if (raw == null) return undefined;
  if (typeof raw === 'object') return raw;
  let s = String(raw).trim();
  if (!s) return undefined;

  // Strip ```json ... ``` fences if present.
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 1) straight parse
  try { return JSON.parse(s); } catch { /* fall through */ }

  // 2) extract the first JSON-looking span ({...} or [...])
  const start = s.search(/[{[]/);
  if (start > 0) s = s.slice(start);
  if (s[0] !== '{' && s[0] !== '[') return undefined;
  try { return JSON.parse(s); } catch { /* fall through */ }

  // 3) repair truncation and retry
  try {
    const repaired = repairTruncatedJson(s);
    return JSON.parse(repaired);
  } catch {
    return undefined;
  }
}

module.exports = { parseLooseJson, repairTruncatedJson };
