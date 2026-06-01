const { OpenAI } = require('openai');
const { similaritySearch } = require('./embeddingService');
const supabase = require('../models/supabaseClient');
const { decrypt } = require('../security/encryption');

const groqClient = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.LLAMA_API_KEY
});

// ─── Per-company chat model (agent chat / agent work / research / doc-gen) ───
// A company can configure a stronger model just for these purposes; everything
// else (embeddings, classification, onboarding, meeting extraction) stays on Groq.
const PROVIDER_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1/',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  agentrouter: null, // custom OpenAI-compatible endpoint — base_url supplied by the user
};
const LLM_PROVIDERS = Object.keys(PROVIDER_BASE_URLS);

function resolveProviderBaseUrl(provider, baseUrl) {
  if (provider === 'agentrouter') return (baseUrl || '').trim() || null;
  return PROVIDER_BASE_URLS[provider] || null;
}

function createClient(baseURL, apiKey) {
  return new OpenAI({ baseURL, apiKey });
}

// Short-lived cache so we don't hit the DB + decrypt on every LLM call.
const _chatModelCache = new Map(); // companyId -> { value, ts }
const _CHAT_MODEL_TTL_MS = 60 * 1000;

function invalidateChatModel(companyId) { if (companyId) _chatModelCache.delete(companyId); }

/**
 * Resolve a company's custom chat model. Returns { client, model, provider } or
 * null (→ caller falls back to Groq). Never throws.
 */
async function resolveChatModel(companyId) {
  if (!companyId) return null;
  const cached = _chatModelCache.get(companyId);
  if (cached && Date.now() - cached.ts < _CHAT_MODEL_TTL_MS) return cached.value;

  let value = null;
  try {
    const { data } = await supabase
      .from('company_llm_config')
      .select('provider, model, base_url, api_key_encrypted, api_key_iv, api_key_tag, is_active')
      .eq('company_id', companyId)
      .maybeSingle();
    if (data && data.is_active && data.provider && data.model && data.api_key_encrypted) {
      const baseURL = resolveProviderBaseUrl(data.provider, data.base_url);
      if (baseURL) {
        const apiKey = decrypt(data.api_key_encrypted, data.api_key_iv, data.api_key_tag);
        value = { client: createClient(baseURL, apiKey), model: data.model, provider: data.provider };
      }
    }
  } catch (e) {
    console.warn('[LLM Service] resolveChatModel failed, using Groq default:', e.message);
    value = null;
  }
  _chatModelCache.set(companyId, { value, ts: Date.now() });
  return value;
}

const FALLBACK_MODELS = [
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'qwen/qwen3-32b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-20b'
];

async function callGroqWithFallback(requestBody, maxRetries = 5, initialDelay = 1000) {
  let attempt = 0;
  let currentModel = requestBody.model || 'openai/gpt-oss-120b';

  // Force model fallback for JSON response format on Groq, as gpt-oss-120b doesn't support JSON mode.
  if (requestBody.response_format && requestBody.response_format.type === 'json_object') {
    if (currentModel === 'openai/gpt-oss-120b') {
      currentModel = 'llama-3.3-70b-versatile';
    }
  }

  let modelIndex = FALLBACK_MODELS.indexOf(currentModel);
  if (modelIndex === -1) {
    modelIndex = 0;
  }

  while (attempt < maxRetries) {
    try {
      requestBody.model = FALLBACK_MODELS[modelIndex];
      const resp = await groqClient.chat.completions.create(requestBody);
      // Crash-proof EVERY caller of groq.chat.completions.create (R1): if a provider
      // returns a malformed response with no choices/message, return a safe empty stub
      // so `response.choices[0].message.content` never throws
      // "Cannot read properties of undefined (reading '0')".
      if (!resp || !Array.isArray(resp.choices) || !resp.choices[0] || !resp.choices[0].message) {
        console.warn('[LLM Service] Provider returned a malformed response (no choices); returning safe empty stub.');
        return { choices: [{ message: { content: '', role: 'assistant' }, finish_reason: 'stop' }], usage: null };
      }
      return resp;
    } catch (error) {
      attempt++;
      const isRateLimit = error.status === 429 || error.status === 413 || 
                          error.message?.includes('429') || error.message?.includes('413') || 
                          error.message?.includes('rate limit') || error.message?.includes('limit reached') || 
                          error.message?.includes('Limit') || error.message?.includes('too large');
      const isToolUseError = error.status === 400 && (error.code === 'tool_use_failed' || error.message?.includes('Failed to call a function'));
      const isServerError = error.status >= 500 || error.message?.includes('500');
      const isConnectionError = error.code === 'ECONNRESET' || error.message?.includes('network') || error.message?.includes('timeout') || error.message?.includes('fetch');

      if ((isRateLimit || isToolUseError) && modelIndex < FALLBACK_MODELS.length - 1) {
        modelIndex++;
        console.warn(`[LLM Service] Rate/Size limit or Tool Use error hit for model ${FALLBACK_MODELS[modelIndex - 1]}. Falling back to model ${FALLBACK_MODELS[modelIndex]}...`);
        attempt = 0; // Reset attempts for the new model
        continue;
      }

      if ((isRateLimit || isServerError || isConnectionError) && attempt < maxRetries) {
        const delay = initialDelay * Math.pow(2, attempt) * (0.5 + Math.random());
        console.warn(`[LLM Service] API error (${error.message}). Retrying model ${FALLBACK_MODELS[modelIndex]} attempt ${attempt}/${maxRetries} in ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

const groq = {
  chat: {
    completions: {
      create: async (requestBody) => {
        return await callGroqWithFallback(requestBody);
      }
    }
  },
  audio: {
    transcriptions: {
      create: async (requestBody) => {
        return await groqClient.audio.transcriptions.create(requestBody);
      }
    }
  }
};

// ─── Global LLM concurrency gate ───
// Launching all agents at once fires many parallel LLM calls; on Groq's limits this
// trips 429s that cascade into agent failures/fallbacks. Cap how many provider calls
// are in flight at once and queue the rest, so concurrent agent runs throttle instead
// of failing. Tunable via LLM_MAX_CONCURRENCY (default 4).
const LLM_MAX_CONCURRENCY = parseInt(process.env.LLM_MAX_CONCURRENCY || '4', 10);
let _llmActive = 0;
const _llmQueue = [];
function _acquireLLMSlot() {
  if (_llmActive < LLM_MAX_CONCURRENCY) {
    _llmActive++;
    return Promise.resolve();
  }
  return new Promise(resolve => _llmQueue.push(resolve));
}
function _releaseLLMSlot() {
  const next = _llmQueue.shift();
  if (next) next(); // hand the slot directly to the next waiter
  else _llmActive = Math.max(0, _llmActive - 1);
}

async function callLLMWithRetry(fn, maxRetries = 5, initialDelay = 1000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    await _acquireLLMSlot();
    let error;
    try {
      return await fn();
    } catch (e) {
      error = e;
    } finally {
      _releaseLLMSlot(); // release before any backoff sleep so we don't block the queue
    }

    attempt++;
    const isRateLimit = error.status === 429 || error.message?.includes('429') || error.message?.includes('rate limit');
    const isServerError = error.status >= 500 || error.message?.includes('500');
    const isConnectionError = error.code === 'ECONNRESET' || error.message?.includes('network') || error.message?.includes('timeout') || error.message?.includes('fetch');

    if ((isRateLimit || isServerError || isConnectionError) && attempt < maxRetries) {
      const delay = initialDelay * Math.pow(2, attempt) * (0.5 + Math.random());
      console.warn(`[LLM Service] API error (${error.message}). Retrying attempt ${attempt}/${maxRetries} in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    } else {
      throw error;
    }
  }
}

async function getRecentSummaries(companyId, sessionId) {
    const { data, error } = await supabase
        .from('conversation_memory')
        .select('summary')
        .eq('session_id', sessionId)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(3);

    if (error) {
        console.error('Error fetching memory buffer:', error);
        return '';
    }

    if (data && data.length > 0) {
        const summaries = data.map(row => row.summary).reverse().join('\n');
        return `\n\n--- RECENT CONVERSATION CONTEXT ---\n${summaries}\n-----------------------------------\n`;
    }
    return '';
}

async function callLLMWithMemory(prompt, companyId, sessionId) {
    try {
        // 1. Fetch organizational memory from Vector DB
        const relevantContexts = await similaritySearch(prompt, companyId, 3);
        let orgMemoryStr = '';
        if (relevantContexts.length > 0) {
            orgMemoryStr = `\n\n--- ORGANIZATIONAL MEMORY (SOPs, etc.) ---\n${relevantContexts.join('\n\n')}\n------------------------------------------\n`;
        }

        // 2. Fetch conversation memory buffer
        let conversationBufferStr = '';
        if (sessionId) {
            conversationBufferStr = await getRecentSummaries(companyId, sessionId);
        }

        // 3. Construct Augmented Prompt
        const augmentedPrompt = `${prompt}${orgMemoryStr}${conversationBufferStr}`;

        // 4. Call LLM — company's custom chat model if configured, else Groq.
        const custom = companyId ? await resolveChatModel(companyId) : null;
        const reqBody = {
            model: custom ? custom.model : 'openai/gpt-oss-120b',
            messages: [{ role: 'user', content: augmentedPrompt }],
        };
        const response = await callLLMWithRetry(() => (custom ? custom.client : groq).chat.completions.create(reqBody));

        return {
            reply: response.choices[0].message.content,
            augmentedPromptUsed: augmentedPrompt // for debugging/logging
        };
    } catch (error) {
        console.error('Error in LLM call:', error);
        throw error;
    }
}

/**
 * Call the LLM with tool definitions for function calling.
 * Used by the orchestrator loop when the Brain needs to interact with external services.
 * 
 * @param {Object[]} messages - Conversation messages array
 * @param {Object[]} tools - Tool definitions in OpenAI function calling format
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} LLM response with potential tool_calls
 */
async function callLLMWithTools(messages, tools = [], options = {}) {
    try {
        // Route to the company's custom chat model when configured, else Groq.
        const custom = options.companyId ? await resolveChatModel(options.companyId) : null;

        const buildBody = (model) => {
            const body = { model, messages, temperature: options.temperature || 0.3 };
            if (options.max_tokens) body.max_tokens = options.max_tokens;
            if (options.response_format) body.response_format = options.response_format;
            if (tools.length > 0) { body.tools = tools; body.tool_choice = options.tool_choice || 'auto'; }
            return body;
        };

        // One attempt against a given client+model, with response-shape validation so a
        // malformed/empty provider response becomes a clean error (not a crash on
        // response.choices[0]).
        const attempt = async (client, model) => {
            const response = await callLLMWithRetry(() => client.chat.completions.create(buildBody(model)));
            if (!response || !Array.isArray(response.choices) || !response.choices[0] || !response.choices[0].message) {
                throw new Error('LLM returned a malformed response (no choices/message).');
            }
            const message = response.choices[0].message;
            return {
                content: message.content,
                tool_calls: message.tool_calls || null,
                finish_reason: response.choices[0].finish_reason,
                usage: response.usage,
            };
        };

        // Resilience: try the configured model first; if it errors or returns garbage,
        // fall back to a reliable Groq model for THIS call so agent work keeps going.
        const groqFallbackModel = options.model || 'llama-3.3-70b-versatile';
        if (custom) {
            try {
                return await attempt(custom.client, custom.model);
            } catch (customErr) {
                console.warn(`[LLM Service] Configured model '${custom.model}' failed (${customErr.message}); falling back to Groq '${groqFallbackModel}' for this call.`);
                return await attempt(groq, groqFallbackModel);
            }
        }
        return await attempt(groq, options.model || 'openai/gpt-oss-120b');
    } catch (error) {
        console.error('Error in LLM tool call:', error?.message || error);
        // Attach Groq's error details (especially failed_generation) to the thrown error
        if (error.error) {
            error.groqError = error.error;
        }
        throw error;
    }
}

/**
 * Call the LLM with tool definitions for function calling, with streaming support.
 * 
 * @param {Object[]} messages - Conversation messages array
 * @param {Object[]} tools - Tool definitions
 * @param {Object} options - { onChunk: function, model: string, ... }
 */
async function callLLMWithToolsStreaming(messages, tools = [], options = {}) {
    const { onChunk, ...restOptions } = options;

    try {
        const custom = restOptions.companyId ? await resolveChatModel(restOptions.companyId) : null;

        const requestBody = {
            model: custom ? custom.model : (restOptions.model || 'openai/gpt-oss-120b'),
            messages,
            temperature: restOptions.temperature || 0.3,
            stream: true
        };
        if (restOptions.max_tokens) requestBody.max_tokens = restOptions.max_tokens;

        if (tools.length > 0) {
            requestBody.tools = tools;
            requestBody.tool_choice = restOptions.tool_choice || 'auto';
        }

        const runner = custom
            ? () => custom.client.chat.completions.create(requestBody)
            : () => groq.chat.completions.create(requestBody);
        const stream = await callLLMWithRetry(runner);
        
        let fullContent = '';
        let toolCalls = [];

        for await (const chunk of stream) {
            const delta = chunk?.choices?.[0]?.delta;
            if (!delta) continue; // tolerate malformed/keep-alive chunks

            if (delta.content) {
                fullContent += delta.content;
                if (onChunk) onChunk({ type: 'content', data: delta.content });
            }

            if (delta.tool_calls) {
                for (const tcDelta of delta.tool_calls) {
                    if (!toolCalls[tcDelta.index]) {
                        toolCalls[tcDelta.index] = {
                            id: tcDelta.id,
                            type: 'function',
                            function: { name: '', arguments: '' }
                        };
                    }
                    if (tcDelta.function?.name) {
                        toolCalls[tcDelta.index].function.name += tcDelta.function.name;
                    }
                    if (tcDelta.function?.arguments) {
                        toolCalls[tcDelta.index].function.arguments += tcDelta.function.arguments;
                    }
                }
            }
        }

        return {
            content: fullContent,
            tool_calls: toolCalls.length > 0 ? toolCalls : null
        };
    } catch (error) {
        console.error('Error in LLM streaming call:', error);
        throw error;
    }
}

/**
 * Safely parse JSON that came from an LLM (R1). Strips ```json fences, tolerates
 * empty/null, and returns `fallback` instead of throwing on malformed content.
 */
function safeJsonParse(text, fallback = null) {
    if (text == null) return fallback;
    let s = String(text).trim();
    if (!s) return fallback;
    // Strip code fences if present.
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    try { return JSON.parse(s); }
    catch {
        // Last resort: grab the first {...} or [...] block.
        const m = s.match(/[\{\[][\s\S]*[\}\]]/);
        if (m) { try { return JSON.parse(m[0]); } catch { /* noop */ } }
        return fallback;
    }
}

module.exports = {
    groq,
    safeJsonParse,
    callLLMWithMemory,
    callLLMWithTools,
    callLLMWithToolsStreaming,
    getRecentSummaries,
    resolveChatModel,
    invalidateChatModel,
    createClient,
    resolveProviderBaseUrl,
    LLM_PROVIDERS,
};
