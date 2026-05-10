const { OpenAI } = require('openai');
const LanguageDetect = require('languagedetect');
const { upsertVector, generateEmbedding, generateSparseVector } = require('./embeddingService');
const fs = require('fs');
const path = require('path');
const os = require('os');
const csvParser = require('csv-parser');
const { Readable } = require('stream');

const lngDetector = new LanguageDetect();

const groq = new OpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.LLAMA_API_KEY
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || process.env.LLAMA_API_KEY
});

/**
 * Helper to translate non-English text to business English using LLM
 */
async function translateTextWithLLM(text) {
    const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
            { role: 'system', content: 'Translate this text to business English. Do not summarize or alter formatting.' },
            { role: 'user', content: text }
        ],
        temperature: 0.1
    });
    return response.choices[0].message.content;
}

/**
 * Helper to detect language
 */
function detectLanguage(text) {
    const results = lngDetector.detect(text, 1);
    if (results.length > 0) {
        return results[0][0]; // e.g., 'english', 'spanish'
    }
    return 'unknown';
}

/**
 * Smart Translator for structured data (JSON/CSV)
 * Recursively translates strings > 3 words
 */
async function smartTranslateObject(obj) {
    for (const key in obj) {
        if (typeof obj[key] === 'string') {
            const wordCount = obj[key].split(/\s+/).length;
            if (wordCount > 3) {
                const lang = detectLanguage(obj[key]);
                if (lang !== 'english' && lang !== 'unknown') {
                    obj[key] = await translateTextWithLLM(obj[key]);
                }
            }
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            await smartTranslateObject(obj[key]);
        }
    }
    return obj;
}

/**
 * Omni-Modal Ingestion Gateway
 * Routes incoming data by MIME type, normalizes to English, and saves to vector DB
 * 
 * @param {Buffer} fileBuffer 
 * @param {string} mimeType 
 * @param {Object} metadata 
 */
async function processIncomingData(fileBuffer, mimeType, metadata = {}) {
    // CRUCIAL B2B SECURITY: Early validation of metadata
    if (!metadata.company_id || !metadata.source_type) {
        throw new Error('SECURITY VIOLATION: Ingestion rejected. company_id and source_type are required metadata fields.');
    }

    let englishText = '';
    let sourceLanguage = 'unknown';

    if (mimeType.startsWith('audio/')) {
        // --- 1. Audio Pipeline ---
        // Save buffer to temp file for OpenAI SDK
        const tempFilePath = path.join(os.tmpdir(), `audio_${Date.now()}.mp3`);
        fs.writeFileSync(tempFilePath, fileBuffer);
        
        try {
            // Uses the translate task natively to output English
            const response = await openai.audio.translations.create({
                file: fs.createReadStream(tempFilePath),
                model: 'whisper-1'
            });
            englishText = response.text;
            sourceLanguage = 'audio_native_translated'; 
        } finally {
            fs.unlinkSync(tempFilePath);
        }
        
    } else if (mimeType === 'text/plain' || mimeType === 'application/pdf') {
        // --- 2. Text & Email Pipeline ---
        let rawText = '';
        
        if (mimeType === 'application/pdf') {
            const pdfParse = require('pdf-parse');
            const pdfData = await pdfParse(fileBuffer);
            rawText = pdfData.text;
        } else {
            rawText = fileBuffer.toString('utf8');
        }

        sourceLanguage = detectLanguage(rawText);
        
        if (sourceLanguage !== 'english' && sourceLanguage !== 'unknown') {
            englishText = await translateTextWithLLM(rawText);
        } else {
            englishText = rawText;
        }
        
    } else if (mimeType === 'application/json' || mimeType === 'text/csv') {
        // --- 3. Structured Data Pipeline ---
        if (mimeType === 'application/json') {
            let jsonObj = JSON.parse(fileBuffer.toString('utf8'));
            jsonObj = await smartTranslateObject(jsonObj);
            englishText = JSON.stringify(jsonObj, null, 2);
        } else if (mimeType === 'text/csv') {
            const results = [];
            const stream = Readable.from(fileBuffer.toString('utf8'));
            await new Promise((resolve, reject) => {
                stream.pipe(csvParser())
                    .on('data', (data) => results.push(data))
                    .on('end', resolve)
                    .on('error', reject);
            });
            
            const translatedResults = [];
            for (const row of results) {
                translatedResults.push(await smartTranslateObject(row));
            }
            englishText = JSON.stringify(translatedResults, null, 2);
        }
        sourceLanguage = 'structured_mixed';
    } else {
        throw new Error(`Unsupported MIME type: ${mimeType}`);
    }

    // --- 4. Data Normalization & Storage ---
    metadata.source_language = sourceLanguage;
    metadata.normalized = true;
    
    // Generate vectors for Hybrid Search
    const embedding = await generateEmbedding(englishText);
    const sparseVector = generateSparseVector(englishText);
    const id = require('uuid').v4();
    
    // Save to Vector Database (Pinecone) using Dense + Sparse vectors
    await upsertVector(id, embedding, sparseVector, {
        ...metadata,
        text_chunk: englishText
    });
    
    return { id, englishText, sourceLanguage, metadata };
}

module.exports = {
    processIncomingData
};
