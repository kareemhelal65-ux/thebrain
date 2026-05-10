const express = require('express');
const multer = require('multer');
const { processDocument } = require('../services/ingestionService');
const supabase = require('../models/supabaseClient');

const router = express.Router();

// Multer setup for temporary file storage
const upload = multer({ dest: 'uploads/' });

// Ingest Document Route
router.post('/ingest', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Using mockAuth from server.js which provides req.user
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const companyId = req.user.company_id;
        const result = await processDocument(
            req.file.path, 
            req.file.originalname, 
            req.file.mimetype, 
            companyId
        );

        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
});

// Buffer Conversation Summary Route
router.post('/buffer', async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { sessionId, summary } = req.body;
        if (!sessionId || !summary) {
            return res.status(400).json({ error: 'Missing sessionId or summary' });
        }

        const { data, error } = await supabase
            .from('conversation_memory')
            .insert([
                {
                    company_id: req.user.company_id,
                    user_id: req.user.id,
                    session_id: sessionId,
                    summary: summary
                }
            ]);

        if (error) throw error;

        res.status(201).json({ message: 'Summary buffered successfully' });
    } catch (error) {
        next(error);
    }
});

// Fetch Conversation Summaries Route
router.get('/buffer/:sessionId', async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { sessionId } = req.params;

        const { data, error } = await supabase
            .from('conversation_memory')
            .select('summary, created_at')
            .eq('session_id', sessionId)
            .eq('company_id', req.user.company_id)
            .order('created_at', { ascending: false })
            .limit(5); // Fetch last 5 summaries

        if (error) throw error;

        res.status(200).json({ summaries: data });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
