const { OpenAI } = require('openai');
const { captureException, trackLatency } = require('./errorTracker');
const { pipeline } = require('@xenova/transformers');

// Pinecone is optional — only initialize if API key is properly configured
let pineconeIndex = null;
function getPineconeIndex() {
  if (pineconeIndex) return pineconeIndex;
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey || apiKey === 'your_pinecone_api_key_here') return null;
  try {
    const { Pinecone } = require('@pinecone-database/pinecone');
    const pinecone = new Pinecone({ apiKey });
    pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX || 'the-brain-memory');
    return pineconeIndex;
  } catch (err) {
    console.warn('[Embeddings] Pinecone not available:', err.message);
    return null;
  }
}



// Local embedding model (runs on CPU, zero cost)
let embeddingPipeline = null;

async function getEmbeddingPipeline() {
  if (!embeddingPipeline) {
    console.log('[Embeddings] Loading local model (first time takes ~10s)...');
    embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('[Embeddings] Model loaded successfully.');
  }
  return embeddingPipeline;
}

/**
 * Generates an embedding for a given text using a local transformer model.
 * Uses all-MiniLM-L6-v2 (384 dimensions) — runs locally, zero API cost.
 * @param {string} text 
 * @returns {Promise<number[]>}
 */
async function generateEmbedding(text) {
  try {
    const extractor = await getEmbeddingPipeline();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
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

  const index = getPineconeIndex();
  if (!index) {
    console.warn('[Embeddings] Pinecone not configured, skipping upsert.');
    return;
  }

  const startTime = Date.now();
  try {
    await index.upsert([
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
    // Don't throw — allow ingestion to continue without Pinecone
    console.warn('[Embeddings] Pinecone upsert failed, data saved to pgvector only.');
  }
}

/**
 * Performs a similarity search. Uses Pinecone if available, otherwise returns empty
 * (the retrievalService handles pgvector search separately).
 */
async function similaritySearch(query, companyId, topK = 3) {
  const index = getPineconeIndex();
  if (!index) return []; // pgvector search is handled by retrievalService

  const startTime = Date.now();
  try {
    const queryEmbedding = await generateEmbedding(query);
    const sparseValues = generateSparseVector(query);
    
    const results = await index.query({
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
    console.error('Error performing similarity search:', error.message);
    return []; // Graceful degradation
  }
}

module.exports = {
  generateEmbedding,
  generateSparseVector,
  upsertVector,
  similaritySearch
};
