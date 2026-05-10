const { Pinecone } = require('@pinecone-database/pinecone');
const { generateEmbedding, generateSparseVector } = require('./embeddingService');
const { pipeline } = require('@xenova/transformers');

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});
const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX || 'the-brain-memory');

let reranker = null;

/**
 * Initialize the cross-encoder model for reranking.
 */
async function initReranker() {
  if (!reranker) {
    reranker = await pipeline('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2', {
      quantized: true,
    });
  }
}

/**
 * Compares the query against retrieved documents using a cross-encoder 
 * to score exact contextual relevance.
 * 
 * @param {string} userQuery 
 * @param {string[]} retrievedDocs 
 * @returns {Promise<string[]>} Top 5 reranked document chunks
 */
async function rerankResults(userQuery, retrievedDocs) {
  if (!retrievedDocs || retrievedDocs.length === 0) return [];
  
  await initReranker();
  
  // Format pairs for the cross-encoder: [[query, doc1], [query, doc2], ...]
  // Note: Xenova transformers expect the input differently depending on the model, 
  // but typically 'text-classification' for cross-encoders accepts `{ text: query, text_pair: doc }`
  const scoredDocs = [];
  
  for (const doc of retrievedDocs) {
    // Cross-encoder prediction
    const output = await reranker(userQuery, doc);
    // output usually looks like: [{ label: 'LABEL_0', score: 0.95 }]
    // For ms-marco, higher score = more relevant.
    scoredDocs.push({
      doc,
      score: output[0].score // Assumes a single score output or grabbing the primary score
    });
  }
  
  // Sort descending by score
  scoredDocs.sort((a, b) => b.score - a.score);
  
  // Return top 5
  return scoredDocs.slice(0, 5).map(item => item.doc);
}

/**
 * Hybrid Retriever: Uses both Dense and Sparse vectors to find the most relevant context.
 * Strict RLS Enforcement is applied at the vector level using the company_id filter.
 * 
 * @param {string} userQuery - The search query
 * @param {string} companyId - The target company ID for Zero-Trust boundary
 * @returns {Promise<string[]>} Top 5 reranked document chunks
 */
async function retrieveCompanyContext(userQuery, companyId) {
  try {
    // 1. Generate Vectors
    const denseVector = await generateEmbedding(userQuery);
    const sparseVector = generateSparseVector(userQuery);
    
    // 2. Query Pinecone with Hybrid Search and Strict RLS Enforcement
    const results = await pineconeIndex.query({
      vector: denseVector,
      sparseVector: sparseVector,
      topK: 20,
      includeMetadata: true,
      filter: {
        company_id: { "$eq": companyId }
      }
    });

    // 3. Extract chunks and rerank
    if (results.matches && results.matches.length > 0) {
      const docs = results.matches.map(match => match.metadata.text_chunk);
      return await rerankResults(userQuery, docs);
    }
    return [];
  } catch (error) {
    console.error('[RetrievalService] Error performing hybrid search:', error);
    throw new Error('Failed to retrieve company context');
  }
}

module.exports = {
  retrieveCompanyContext,
  rerankResults
};
