const { OpenAI } = require('openai');
const { similaritySearch } = require('./embeddingService');
const supabase = require('../models/supabaseClient');

const groq = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.LLAMA_API_KEY
});

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

        // 4. Call LLM (using Llama 3.3 70b on Groq)
        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: augmentedPrompt }],
        });

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
        const requestBody = {
            model: options.model || 'llama-3.3-70b-versatile',
            messages,
            temperature: options.temperature || 0.3
        };

        // Only include tools if we have them
        if (tools.length > 0) {
            requestBody.tools = tools;
            requestBody.tool_choice = options.tool_choice || 'auto';
        }

        const response = await groq.chat.completions.create(requestBody);
        const message = response.choices[0].message;

        return {
            content: message.content,
            tool_calls: message.tool_calls || null,
            finish_reason: response.choices[0].finish_reason,
            usage: response.usage
        };
    } catch (error) {
        console.error('Error in LLM tool call:', error);
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
        const requestBody = {
            model: restOptions.model || 'llama-3.3-70b-versatile',
            messages,
            temperature: restOptions.temperature || 0.3,
            stream: true
        };

        if (tools.length > 0) {
            requestBody.tools = tools;
            requestBody.tool_choice = restOptions.tool_choice || 'auto';
        }

        const stream = await groq.chat.completions.create(requestBody);
        
        let fullContent = '';
        let toolCalls = [];

        for await (const chunk of stream) {
            const delta = chunk.choices[0].delta;
            
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

module.exports = {
    callLLMWithMemory,
    callLLMWithTools,
    callLLMWithToolsStreaming,
    getRecentSummaries
};
