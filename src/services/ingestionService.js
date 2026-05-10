const fs = require('fs');
const pdfParse = require('pdf-parse');
const csv = require('csv-parser');
const mammoth = require('mammoth');
const { v4: uuidv4 } = require('uuid');
const { generateEmbedding, upsertVector } = require('./embeddingService');

// Basic text chunker
function chunkText(text, maxChars = 1000) {
    const chunks = [];
    let currentChunk = '';
    
    const sentences = text.split(/(?<=[.?!])\s+/);
    
    for (const sentence of sentences) {
        if ((currentChunk.length + sentence.length) > maxChars) {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = sentence + ' ';
        } else {
            currentChunk += sentence + ' ';
        }
    }
    
    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks;
}

async function parseFile(filePath, mimeType) {
    let text = '';
    
    if (mimeType === 'application/pdf') {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer);
        text = data.text;
    } else if (mimeType === 'text/csv') {
        const results = [];
        text = await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (data) => results.push(JSON.stringify(data)))
                .on('end', () => resolve(results.join('\n')))
                .on('error', reject);
        });
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mimeType === 'application/msword') {
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value;
    } else if (mimeType === 'application/json') {
        const data = fs.readFileSync(filePath, 'utf8');
        text = data; // Assuming it's a JSON structure that has text, could be improved.
    } else if (mimeType === 'text/plain') {
        text = fs.readFileSync(filePath, 'utf8');
    } else {
        throw new Error('Unsupported file type');
    }
    
    return text;
}

async function processDocument(filePath, originalName, mimeType, companyId) {
    try {
        // Parse the document
        const text = await parseFile(filePath, mimeType);
        
        if (!text || text.trim() === '') {
            throw new Error('Extracted text is empty');
        }

        // Chunk text
        const chunks = chunkText(text);

        // Embed and Upsert
        for (const chunk of chunks) {
            const vector = await generateEmbedding(chunk);
            const id = uuidv4();
            await upsertVector(id, vector, {
                company_id: companyId,
                document_name: originalName,
                text_chunk: chunk
            });
        }

        // Clean up the temp file
        fs.unlinkSync(filePath);

        return { message: 'Document ingested successfully', chunksProcessed: chunks.length };
    } catch (error) {
        console.error('Error processing document:', error);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        throw error;
    }
}

module.exports = {
    processDocument
};
