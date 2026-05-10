const { Pinecone } = require('@pinecone-database/pinecone');
const { OpenAI } = require('openai');
const { captureException, trackLatency } = require('./errorTracker');

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX || 'the-brain-memory');

// Initialize Groq via OpenAI SDK
const groq = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.LLAMA_API_KEY
});

/**
 * Generates an embedding for a given text using Gemini.
 * @param {string} text 
 * @returns {Promise<number[]>}
 */
async function generateEmbedding(text) {
  try {
    const response = await groq.embeddings.create({
      model: 'nomic-embed-text-v1_5',
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw new Error('Failed to generate embedding');
  }
}

/**
 * Simple 32-bit FNV-1a hash algorithm to convert words to integer indices
 */
function hashString(str) {
  let hval = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hval ^= str.charCodeAt(i);
    hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
  }
  return hval >>> 0; // Ensure unsigned 32-bit
}

/**
 * Generates a sparse vector (BM25 Term Frequency equivalent) for Pinecone
 * @param {string} text
 * @returns {object} { indices: number[], values: number[] }
 */
function generateSparseVector(text) {
  const tokens = text.toLowerCase().match(/\b\w+\b/g) || [];
  const freqMap = {};
  
  for (const token of tokens) {
    freqMap[token] = (freqMap[token] || 0) + 1;
  }
  
  const indices = [];
  const values = [];
  
  for (const [token, count] of Object.entries(freqMap)) {
    indices.push(hashString(token));
    values.push(count); // Raw term frequency acts as a simple sparse weight
  }
  
  return { indices, values };
}

/**
 * Upserts a document chunk to Pinecone using Hybrid Search (Dense + Sparse).
 * @param {string} id - Unique ID for the chunk
 * @param {number[]} vector - The dense embedding
 * @param {object} sparseValues - { indices, values }
 * @param {object} metadata - Must include company_id, document_name, text_chunk, and source_type
 */
async function upsertVector(id, vector, sparseValues, metadata) {
  // CRUCIAL B2B SECURITY: Validate mandatory metadata
  if (!metadata || !metadata.company_id || !metadata.source_type) {
    throw new Error('SECURITY VIOLATION: company_id and source_type are required in metadata.');
  }

  const startTime = Date.now();
  try {
    await pineconeIndex.upsert([
      {
        id,
        values: vector,
        sparseValues,
        metadata
      }
    ]);
    trackLatency('pinecone.upsert', Date.now() - startTime);
  } catch (error) {
    console.error('Error upserting to Pinecone:', error);
    captureException(error, { component: 'Pinecone', extra: { operation: 'upsert', id } });
    throw new Error('Failed to upsert to Pinecone');
  }
}

/**
 * Performs a Hybrid Search (Dense + Sparse) in Pinecone for a given query.
 * @param {string} query 
 * @param {string} companyId 
 * @param {number} topK 
 * @returns {Promise<string[]>} List of text chunks
 */
async function similaritySearch(query, companyId, topK = 3) {
  const startTime = Date.now();
  try {
    const queryEmbedding = await generateEmbedding(query);
    const sparseValues = generateSparseVector(query);
    
    const results = await pineconeIndex.query({
      vector: queryEmbedding,
      sparseVector: sparseValues,
      topK,
      includeMetadata: true,
      filter: {
        company_id: { $eq: companyId }
      }
    });

    trackLatency('pinecone.query', Date.now() - startTime);

    if (results.matches) {
      return results.matches.map(match => match.metadata.text_chunk);
    }
    return [];
  } catch (error) {
    console.error('Error performing similarity search:', error);
    captureException(error, { component: 'Pinecone', companyId, extra: { operation: 'query' } });
    throw new Error('Failed to perform similarity search');
  }
}

module.exports = {
  generateEmbedding,
  generateSparseVector,
  upsertVector,
  similaritySearch
};
