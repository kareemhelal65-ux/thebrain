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
            companyId,
            req.user.id
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

/**
 * GET /api/memory/health
 * Memory Health Dashboard data (v3 §7.7 Week 7)
 * Returns: integration coverage, last sync times, document counts, feedback signal count
 */
router.get('/health', async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const tenantId = req.user.company_id;

        // 1. Document counts by source type
        const { data: docsByType, error: docsErr } = await supabase
            .from('document_chunks')
            .select('source_type')
            .eq('tenant_id', tenantId);

        const typeCounts = {};
        let totalChunks = 0;
        if (!docsErr && docsByType) {
            totalChunks = docsByType.length;
            docsByType.forEach(d => {
                const t = d.source_type || 'unknown';
                typeCounts[t] = (typeCounts[t] || 0) + 1;
            });
        }

        // 2. Total brain_documents
        const { data: brainDocs } = await supabase
            .from('brain_documents')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', tenantId);

        // 3. Integration last sync times
        const { data: integrations } = await supabase
            .from('integration_credentials')
            .select('provider, last_synced_at, status')
            .eq('company_id', tenantId);

        const integrationStatus = (integrations || []).map(i => ({
            provider: i.provider,
            last_synced: i.last_synced_at,
            status: i.status || 'unknown'
        }));

        // 4. Meeting count
        const { data: meetings } = await supabase
            .from('meetings')
            .select('id', { count: 'exact', head: true })
            .eq('company_id', tenantId);

        // 5. Feedback signals count (if table exists)
        let feedbackCount = 0;
        try {
            const { data: feedbackData } = await supabase
                .from('feedback_events')
                .select('id', { count: 'exact', head: true })
                .eq('tenant_id', tenantId);
            feedbackCount = feedbackData?.length ?? 0;
        } catch (e) {
            // Table may not exist yet
        }

        // 6. Last ingestion time
        const { data: lastIngestion } = await supabase
            .from('document_chunks')
            .select('created_at')
            .eq('tenant_id', tenantId)
            .order('created_at', { ascending: false })
            .limit(1);

        res.json({
            total_chunks: totalChunks,
            total_documents: brainDocs?.length ?? 0,
            total_meetings: meetings?.length ?? 0,
            chunks_by_type: typeCounts,
            integrations: integrationStatus,
            feedback_signals: feedbackCount,
            last_ingestion: lastIngestion?.[0]?.created_at || null,
            health_score: calculateHealthScore(totalChunks, integrationStatus, feedbackCount),
        });
    } catch (error) {
        console.error('[MemoryHealth] Error:', error.message);
        next(error);
    }
});

/**
 * Calculate a simple memory health score (0-100)
 * Based on: data volume, integration freshness, feedback signals
 */
function calculateHealthScore(totalChunks, integrations, feedbackCount) {
    let score = 0;

    // Data volume (up to 40 points)
    if (totalChunks > 100) score += 40;
    else if (totalChunks > 50) score += 30;
    else if (totalChunks > 10) score += 20;
    else if (totalChunks > 0) score += 10;

    // Active integrations (up to 30 points)
    const activeIntegrations = integrations.filter(i => i.status === 'active' || i.last_synced).length;
    score += Math.min(activeIntegrations * 10, 30);

    // Feedback signals (up to 20 points) — more signals = better learning data
    if (feedbackCount >= 50) score += 20;
    else if (feedbackCount >= 20) score += 15;
    else if (feedbackCount >= 5) score += 10;
    else if (feedbackCount > 0) score += 5;

    // Integration freshness (up to 10 points)
    const now = Date.now();
    const freshIntegrations = integrations.filter(i => {
        if (!i.last_synced) return false;
        const hoursSincSync = (now - new Date(i.last_synced).getTime()) / (1000 * 60 * 60);
        return hoursSincSync < 24;
    }).length;
    if (freshIntegrations > 0) score += 10;

    return Math.min(score, 100);
}

module.exports = router;
