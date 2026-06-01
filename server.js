require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const errorHandler = require('./src/middleware/errorHandler');
const { checkRole, auditLogScopeFilter } = require('./src/middleware/rbacMiddleware');
const { logAIAction } = require('./src/services/auditService');
const supabase = require('./src/models/supabaseClient');
const authMiddleware = require('./src/middleware/authMiddleware');
const { initErrorTracker, getSentryRequestHandler, getSentryErrorHandler } = require('./src/services/errorTracker');
const memoryRoutes = require('./src/api/memoryRoutes');
const meetingRoutes = require('./src/api/meetingRoutes');
const orchestrationRoutes = require('./src/api/orchestrationRoutes');
const brainRoutes = require('./src/api/brainRoutes');
const dashboardRoutes = require('./src/api/dashboardRoutes');
const authRoutes = require('./src/api/authRoutes');
const integrationRoutes = require('./src/api/integrationRoutes');
const onboardingRoutes = require('./src/api/onboardingRoutes');
const webhookRoutes = require('./src/api/webhookRoutes');
const { router: notificationRoutes } = require('./src/api/notificationRoutes');
const { router: documentRoutes, generateFile } = require('./src/api/documentRoutes');
const researchRoutes = require('./src/api/researchRoutes');
const agentRoutes = require('./src/api/agentRoutes');
const approvalRoutes = require('./src/api/approvalRoutes');
const roadmapRoutes = require('./src/api/roadmapRoutes');
const feedbackRoutes = require('./src/api/feedbackRoutes');
const settingsRoutes = require('./src/api/settingsRoutes');
const departmentRoutes = require('./src/api/departmentRoutes');
const { approveAutomation, rejectAutomation } = require('./src/services/proactivityService');
const { startScheduler } = require('./src/services/proactivityScheduler');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Startup Validation ───
// Validate critical environment variables on boot
if (!process.env.MASTER_ENCRYPTION_KEY) {
  console.warn('[WARN] MASTER_ENCRYPTION_KEY is not set. Credential encryption/decryption will fail.');
  console.warn('[WARN] Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

// ─── Initialize Error Tracker (Sentry) ───
initErrorTracker();

// ─── Middleware ───
app.use(getSentryRequestHandler()); // Sentry request handler must be the first middleware
app.use((req, res, next) => {
  console.log(`[Backend REQ] ${req.method} ${req.originalUrl}`);
  next();
});
app.use(cors({
  origin: [
    'http://localhost:3000',  // Next.js dev
    'http://localhost:5173',  // Vite dev
    'https://thebrain-aios.vercel.app', // Vercel landing page
    process.env.FRONTEND_URL || 'http://localhost:3000',
  ],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve generated document files securely
// Note: express.static is not used here to enforce strict multi-tenant isolation.
// All files under /uploads are served through the authenticated route below.

// ─── Public Routes (no auth required) ───
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'The Brain OS Backend is operational.',
    version: '3.0.0-demo',
    subsystems: {
      nervousSystem: 'active',
      sentinel: 'active',
      registry: 'active',
      meetingEngine: 'active',
      brainQuery: 'active',
      pgvector: process.env.VECTOR_STORE === 'supabase' ? 'active' : 'pinecone',
    }
  });
});

// Auth routes (login/logout/signup — must be before authMiddleware)
app.use('/api/auth', authRoutes);

// ─── Apply Auth Middleware to all remaining routes ───
app.use(authMiddleware);

// Secure uploads route with tenant boundary check and on-the-fly regeneration
app.get('/uploads/:filename', async (req, res, next) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, 'uploads', filename);
    const dbFilePath = `/uploads/${filename}`;

    // Check if it's a tenant-prefixed temporary file (e.g. exports or conversions)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    const match = filename.match(uuidRegex);
    if (match) {
      const companyIdInFile = match[0];
      if (companyIdInFile.toLowerCase() === req.user.company_id.toLowerCase()) {
        if (fs.existsSync(filePath)) {
          return res.sendFile(filePath);
        } else {
          return res.status(404).json({ error: 'Not Found', message: 'The requested temporary file does not exist.' });
        }
      } else {
        console.warn(`[Uploads] Unauthorized temporary file access attempt to ${filename} by company ${req.user.company_id}`);
        return res.status(403).json({ error: 'Forbidden', message: 'You do not have permission to access this file.' });
      }
    }

    // Find the document record in database to verify tenant ownership
    const { data: doc, error } = await supabase
      .from('brain_documents')
      .select('*')
      .eq('file_path', dbFilePath)
      .single();

    if (error || !doc) {
      console.warn(`[Uploads] File ${dbFilePath} not found in database`);
      return res.status(404).json({ error: 'Not Found', message: 'The requested file does not exist.' });
    }

    // Enforce tenant boundary check
    if (doc.company_id !== req.user.company_id) {
      console.warn(`[Uploads] Unauthorized access attempt to ${dbFilePath} by company ${req.user.company_id}`);
      return res.status(403).json({ error: 'Forbidden', message: 'You do not have permission to access this file.' });
    }

    // If file is missing from disk, regenerate it on the fly
    if (!fs.existsSync(filePath)) {
      console.log(`[Uploads] Regenerating missing file: ${filePath}`);
      const uploadsDir = path.dirname(filePath);
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      await generateFile(doc.title, doc.content, doc.document_type, filePath);
    }

    // Serve the file securely
    res.sendFile(filePath);
  } catch (err) {
    console.error('[Uploads] Error serving file:', err);
    next(err);
  }
});

// ─── Vault Routes ───

// Log an AI Action (Internal use)
app.post('/api/vault/log', async (req, res, next) => {
  try {
    // Only authenticated users can log actions
    if (!req.user) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const { toolUsed, inputData, reasoningPath } = req.body;
    
    const log = await logAIAction({
      companyId: req.user.company_id,
      userId: req.user.id,
      toolUsed,
      inputData,
      reasoningPath
    });

    res.status(201).json({ message: 'Log created', log });
  } catch (error) {
    next(error);
  }
});

// Fetch Audit Logs (RBAC protected)
// 'Admin' sees all company logs, 'Employee' sees only their own
app.get('/api/vault/logs', checkRole(['Admin', 'Manager', 'Employee']), auditLogScopeFilter, async (req, res, next) => {
  try {
    // req.auditScope contains the filters determined by the RBAC middleware
    let query = supabase.from('audit_logs').select('*');
    
    // Apply filters safely
    for (const [key, value] of Object.entries(req.auditScope)) {
        query = query.eq(key, value);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    res.status(200).json({ logs: data });
  } catch (error) {
    next(error);
  }
});

// ─── API Routes ───

// Brain Query Routes (The Core — RAG endpoint)
app.use('/api/brain', brainRoutes);

// Onboarding
app.use('/api/onboarding', onboardingRoutes);

// Dashboard Stats
app.use('/api/dashboard', dashboardRoutes);

// Memory Routes (Ingest and Buffer)
app.use('/api/memory', memoryRoutes);

// Meeting Routes (Webhooks and Upload)
app.use('/api/meetings', meetingRoutes);

// Brain Orchestration Routes (The Nervous System)
app.use('/api/orchestrator', orchestrationRoutes);

// Integrations (Google Workspace, Slack, etc.)
app.use('/api/integrations', integrationRoutes);

// Webhooks (Continuous sync)
app.use('/api/webhooks', webhookRoutes);

// Notifications (SSE)
app.use('/api/notifications', notificationRoutes);

// Research Routes (Web Intelligence Engine)
app.use('/api/research', researchRoutes);

// Agent Execution Routes (Multi-Agent System)
app.use('/api/agents', agentRoutes);

// Approval Routes (Agent Output Approval Workflow)
app.use('/api/approvals', approvalRoutes);

// Roadmap Routes (Dynamic Per-Company Roadmap)
app.use('/api/roadmap', roadmapRoutes);

// Feedback Signal Collection (v3 Self-Learning Loop)
app.use('/api/feedback', feedbackRoutes);
app.use('/api/settings', settingsRoutes);

// Department Dashboard Routes (Phase D — department pages + dynamic setup)
app.use('/api/departments', departmentRoutes);

// Agent Outputs Approval List (convenience alias)
app.get('/api/agent-outputs/approvals', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { getPendingApprovals } = require('./src/services/approvalService');
    const approvals = await getPendingApprovals(req.user.company_id);
    res.json({ approvals });
  } catch (error) {
    next(error);
  }
});

// Documents Management & Drafts
app.use('/api/documents', documentRoutes);

// ─── Meetings List Endpoint ───
app.get('/api/meetings', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('meetings')
      .select('*')
      .eq('company_id', req.user.company_id)
      .order('meeting_date', { ascending: false });

    if (error) throw error;
    res.status(200).json({ meetings: data || [] });
  } catch (error) {
    next(error);
  }
});

// ─── Team Roster Endpoint ───
// Returns the company's join code (to invite others) and the member roster
// (name, position, role) built from public.users + user_profiles.
app.get('/api/team', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const companyId = req.user.company_id;
    if (!companyId) return res.status(400).json({ error: 'No company associated with this user.' });

    const { data: company } = await supabase
      .from('companies').select('name, join_code').eq('id', companyId).single();

    // Self-heal: ensure the company has a shareable join code (covers companies
    // created before join codes existed, the first time their team page loads).
    let joinCode = company?.join_code || null;
    if (!joinCode) {
      try {
        const { generateUniqueJoinCode } = require('./src/utils/joinCode');
        joinCode = await generateUniqueJoinCode(supabase);
        await supabase.from('companies').update({ join_code: joinCode }).eq('id', companyId);
      } catch (e) {
        console.warn('[Team] Failed to backfill join code:', e.message);
      }
    }

    const { data: members } = await supabase
      .from('users').select('id, role, department').eq('company_id', companyId);

    const ids = (members || []).map(m => m.id);
    let profileMap = {};
    if (ids.length) {
      const { data: profiles } = await supabase
        .from('user_profiles').select('*').in('user_id', ids);
      (profiles || []).forEach(p => { profileMap[p.user_id] = p; });
    }

    const roster = await Promise.all((members || []).map(async (m) => {
      let email = null;
      try {
        const { data } = await supabase.auth.admin.getUserById(m.id);
        email = data?.user?.email || null;
      } catch { /* best-effort */ }
      const p = profileMap[m.id] || {};
      return {
        user_id: m.id,
        email,
        role: m.role,
        department: m.department,
        full_name: p.full_name || null,
        position: p.position || null,
        experience: p.experience || null,
        work_style: p.work_style || null,
        interests: Array.isArray(p.interests) ? p.interests : [],
        is_you: m.id === req.user.id,
      };
    }));

    // Sort: you first, then named members, then the rest.
    roster.sort((a, b) => (b.is_you ? 1 : 0) - (a.is_you ? 1 : 0));

    res.json({
      company: { name: company?.name || null, join_code: joinCode },
      members: roster,
      your_role: req.user.role || null,
    });
  } catch (error) {
    next(error);
  }
});

// ─── Update a Member's Role (Admin only) ───
const VALID_ROLES = ['Admin', 'Manager', 'Employee'];
app.put('/api/team/:userId/role', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only admins can change roles.' });

    const { userId } = req.params;
    const role = String(req.body?.role || '');
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}.` });
    }

    // Target must be a member of the same company (tenant isolation).
    const { data: target } = await supabase
      .from('users').select('id, company_id, role').eq('id', userId).maybeSingle();
    if (!target || target.company_id !== req.user.company_id) {
      return res.status(404).json({ error: 'Member not found in your company.' });
    }

    // Guard: don't allow removing the last Admin (avoid locking the company out).
    if (target.role === 'Admin' && role !== 'Admin') {
      const { count } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', req.user.company_id)
        .eq('role', 'Admin');
      if ((count || 0) <= 1) {
        return res.status(400).json({ error: 'You cannot demote the only admin. Promote someone else to Admin first.' });
      }
    }

    await supabase.from('users').update({ role }).eq('id', userId);
    // Keep the JWT metadata in sync so the role takes effect on their next request.
    await supabase.auth.admin.updateUserById(userId, {
      app_metadata: { company_id: req.user.company_id, role },
    }).catch(e => console.warn('[Team] role JWT sync failed:', e.message));

    res.json({ success: true, user_id: userId, role });
  } catch (error) {
    next(error);
  }
});

// ─── Team Evaluations & Candidates (Phase D3) ───
app.get('/api/team/evaluations', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const companyId = req.user.company_id;
    if (!companyId) return res.status(400).json({ error: 'No company associated with this user.' });

    // 1. Get all members of the company
    const { data: members, error: membersErr } = await supabase
      .from('users')
      .select('id')
      .eq('company_id', companyId);
    if (membersErr) throw membersErr;

    // 2. Fetch existing evaluations
    const { data: evaluations, error: evalErr } = await supabase
      .from('member_evaluations')
      .select('*')
      .eq('company_id', companyId);
    if (evalErr) throw evalErr;

    const evalMap = {};
    (evaluations || []).forEach(e => {
      evalMap[e.user_id] = e;
    });

    const { evaluateMember } = require('./src/services/candidateService');

    // 3. For any member missing an evaluation, run evaluateMember
    const results = await Promise.all((members || []).map(async (m) => {
      if (evalMap[m.id]) {
        return evalMap[m.id];
      } else {
        console.log(`[Team evaluations] Lazy-evaluating member ${m.id}`);
        try {
          const newEval = await evaluateMember(companyId, m.id);
          return newEval;
        } catch (err) {
          console.error(`[Team evaluations] Failed to evaluate member ${m.id}:`, err);
          return {
            user_id: m.id,
            company_id: companyId,
            ai_strength: 'Evaluation failed or not completed.',
            performance_score: 5,
            evaluation_notes: 'Could not generate evaluation at this time.'
          };
        }
      }
    }));

    res.json({ evaluations: results });
  } catch (error) {
    next(error);
  }
});

app.post('/api/team/evaluations/:userId/refresh', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const companyId = req.user.company_id;
    const { userId } = req.params;

    // Verify member belongs to same company
    const { data: target } = await supabase
      .from('users')
      .select('id, company_id')
      .eq('id', userId)
      .maybeSingle();

    if (!target || target.company_id !== companyId) {
      return res.status(404).json({ error: 'Member not found in your company.' });
    }

    const { evaluateMember } = require('./src/services/candidateService');
    const newEval = await evaluateMember(companyId, userId);
    res.json({ evaluation: newEval });
  } catch (error) {
    next(error);
  }
});

app.post('/api/team/candidates/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const companyId = req.user.company_id;
    if (!companyId) return res.status(400).json({ error: 'No company associated with this user.' });

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const { evaluateCandidateCV } = require('./src/services/candidateService');
    const candidate = await evaluateCandidateCV(
      req.file.path,
      req.file.originalname,
      req.file.mimetype,
      companyId
    );

    res.json({ success: true, candidate });
  } catch (error) {
    next(error);
  }
});

app.get('/api/team/candidates', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const companyId = req.user.company_id;
    if (!companyId) return res.status(400).json({ error: 'No company associated with this user.' });

    const { data: candidates, error } = await supabase
      .from('candidates')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ candidates: candidates || [] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/team/candidates/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const companyId = req.user.company_id;
    const { id } = req.params;

    const { error } = await supabase
      .from('candidates')
      .delete()
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ─── Decisions List Endpoint ───
app.get('/api/decisions', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('decisions')
      .select(`
        id,
        text,
        made_by,
        date,
        created_at,
        source_doc_id,
        roadmap_phase,
        roadmap_objective,
        brain_documents(id, title, document_type)
      `)
      .eq('tenant_id', req.user.company_id)
      .order('date', { ascending: false, nullsFirst: false });

    if (error) throw error;
    res.status(200).json({ decisions: data || [] });
  } catch (error) {
    next(error);
  }
});

// ─── Decisions Enrichment Endpoint ───
// Retroactively tag existing decisions with roadmap phase/objective suggestions
app.post('/api/decisions/enrich', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only admins can trigger enrichment' });

    // Fetch untagged decisions
    const { data: untagged, error: fetchError } = await supabase
      .from('decisions')
      .select('id, text, source_doc_id, created_at')
      .eq('tenant_id', req.user.company_id)
      .is('roadmap_phase', null)
      .order('created_at', { ascending: false })
      .limit(50);

    if (fetchError) throw fetchError;
    if (!untagged || untagged.length === 0) {
      return res.json({ enriched: 0, message: 'All decisions already have roadmap tags.' });
    }

    // Use LLM to batch-tag decisions with roadmap phases
    const { callLLMWithTools } = require('./src/services/llmService');
    const decisionsText = untagged.map(d => `ID: ${d.id}\nDecision: ${d.text}`).join('\n\n---\n\n');
    
    const prompt = `You are a roadmap analyst. Tag each of the following business decisions with the most relevant roadmap phase and objective.

Roadmap phases and their objectives:
- pre-seed: Problem Validation, MVP Development, Initial Team & Operations
- seed: Product Launch & Traction, Go-to-Market Engine, Seed Fundraising
- series-a: Scale Product & Engineering, Revenue Growth, Series A Fundraising
- series-b: Market Expansion, Organizational Scaling, Revenue Milestones
- series-c: Market Leadership, Enterprise & Scale, IPO Readiness
- ipo: Pre-IPO Preparation, Public Company Infrastructure, Going Public

For each decision, return a JSON object with the decision ID as key, and the value as { "roadmap_phase": "phase" or null, "roadmap_objective": "objective" or null }.

Decisions:
${decisionsText}`;

    let enriched = 0;
    try {
      const result = await callLLMWithTools(
        [{ role: 'system', content: prompt }],
        []
      );
      
      if (result.content) {
        const parsed = JSON.parse(result.content);
        
        for (const [id, tags] of Object.entries(parsed)) {
          if (tags && (tags.roadmap_phase || tags.roadmap_objective)) {
            const { error: updateError } = await supabase
              .from('decisions')
              .update({
                roadmap_phase: tags.roadmap_phase || null,
                roadmap_objective: tags.roadmap_objective || null
              })
              .eq('id', id)
              .eq('tenant_id', req.user.company_id);
            
            if (!updateError) enriched++;
          }
        }
      }
    } catch (llmErr) {
      console.warn('[Decisions Enrich] LLM tagging failed:', llmErr.message);
    }

    res.json({ 
      enriched, 
      total_untagged: untagged.length,
      message: `Tagged ${enriched} of ${untagged.length} untagged decisions.`
    });
  } catch (error) {
    next(error);
  }
});

// ─── Action Items List Endpoint ───
app.get('/api/action_items', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('action_items')
      .select(`
        id,
        task,
        assignee,
        assignee_user_id,
        due_date,
        status,
        department,
        created_at,
        source_doc_id,
        decision_id,
        sub_tasks,
        brain_documents(id, title, document_type)
      `)
      .eq('tenant_id', req.user.company_id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json({ action_items: data || [] });
  } catch (error) {
    next(error);
  }
});

// ─── Update Action Item Endpoint (with Cascading Status) ───
app.patch('/api/action_items/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    let { status, sub_tasks } = req.body;

    // Fetch current action item
    const { data: currentItem, error: fetchError } = await supabase
      .from('action_items')
      .select('status, sub_tasks, tenant_id')
      .eq('id', id)
      .single();

    if (fetchError || !currentItem) {
      return res.status(404).json({ error: 'Action item not found' });
    }

    if (currentItem.tenant_id !== req.user.company_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    let finalStatus = status || currentItem.status;
    let finalSubTasks = sub_tasks || currentItem.sub_tasks || [];

    if (sub_tasks) {
      if (finalSubTasks.length > 0) {
        const allCompleted = finalSubTasks.every(st => st.status === 'completed');
        finalStatus = allCompleted ? 'completed' : 'open';
      }
    } else if (status) {
      finalSubTasks = finalSubTasks.map(st => ({
        ...st,
        status: status === 'completed' ? 'completed' : 'open'
      }));
    }

    const { data: updatedItem, error: updateError } = await supabase
      .from('action_items')
      .update({
        status: finalStatus,
        sub_tasks: finalSubTasks
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.status(200).json({ action_item: updatedItem });
  } catch (error) {
    next(error);
  }
});



// ─── Plans List Endpoint ───
app.get('/api/plans', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    // Retrieve documents that have sub_type = 'technical_plan' or 'roadmap' or contain 'plan' or 'roadmap' in title
    const { data, error } = await supabase
      .from('brain_documents')
      .select('id, title, document_type, department, semantic_type, sub_type, created_at')
      .eq('company_id', req.user.company_id)
      .or('sub_type.eq.technical_plan,sub_type.eq.roadmap,title.ilike.%plan%,title.ilike.%roadmap%')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json({ plans: data || [] });
  } catch (error) {
    next(error);
  }
});
// ─── Google Calendar Events Endpoint ───
app.get('/api/calendar/events', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const tenantId = req.user.company_id;

    // Check if OAuth credentials exist for google workspace
    const { data: creds, error: credsError } = await supabase
      .from('oauth_credentials')
      .select('access_token')
      .eq('tenant_id', tenantId)
      .in('provider', ['google', 'google workspace'])
      .maybeSingle();

    let events = [];
    let isMock = true;

    if (!credsError && creds && creds.access_token) {
      try {
        const { google } = require('googleapis');
        const auth = new google.auth.OAuth2();
        auth.setCredentials({ access_token: creds.access_token });
        const calendar = google.calendar({ version: 'v3', auth });
        
        // Fetch events for the next 7 days
        const timeMin = new Date().toISOString();
        const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        
        const { data } = await calendar.events.list({
          calendarId: 'primary',
          timeMin,
          timeMax,
          maxResults: 15,
          singleEvents: true,
          orderBy: 'startTime',
        });
        
        if (data.items) {
          events = data.items.map(item => ({
            id: item.id,
            summary: item.summary || 'Untitled Event',
            description: item.description || '',
            start: item.start?.dateTime || item.start?.date || '',
            end: item.end?.dateTime || item.end?.date || '',
            attendees: item.attendees?.map(a => ({ email: a.email, responseStatus: a.responseStatus })) || [],
            location: item.location || '',
            htmlLink: item.htmlLink || ''
          }));
          isMock = false;
        }
      } catch (calError) {
        console.warn('[Calendar API] Failed to fetch real google calendar events:', calError.message);
        // Fall back to mock events if the token is invalid/expired
      }
    }

    if (isMock) {
      // Return beautiful mock calendar events for the demo
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      const nextTuesday = new Date();
      nextTuesday.setDate(nextTuesday.getDate() + ((2 + 7 - nextTuesday.getDay()) % 7 || 7));
      const nextTuesdayStr = nextTuesday.toISOString().split('T')[0];
      const nextMonday = new Date();
      nextMonday.setDate(nextMonday.getDate() + ((1 + 7 - nextMonday.getDay()) % 7 || 7));
      const nextMondayStr = nextMonday.toISOString().split('T')[0];

      events = [
        {
          id: 'mock_event_1',
          summary: 'ACME Corp. Q3 Sync',
          description: 'Discuss Q3 plans, budget capping, and product roadmap alignment. Review database migrations.',
          start: `${nextTuesdayStr}T15:00:00+03:00`,
          end: `${nextTuesdayStr}T16:00:00+03:00`,
          attendees: [
            { email: 'kareem@acme.com', responseStatus: 'accepted' },
            { email: 'engineer@acme.com', responseStatus: 'needsAction' }
          ],
          location: 'Google Meet',
          htmlLink: 'https://meet.google.com/abc-defg-hij'
        },
        {
          id: 'mock_event_2',
          summary: 'Weekly Operations & HR Alignment',
          description: 'Review new health insurance policy rollouts and BambooHR completion status.',
          start: `${tomorrowStr}T10:00:00+03:00`,
          end: `${tomorrowStr}T11:00:00+03:00`,
          attendees: [
            { email: 'hr@company.com', responseStatus: 'accepted' }
          ],
          location: 'Zoom Meeting',
          htmlLink: 'https://zoom.us/j/123456789'
        },
        {
          id: 'mock_event_3',
          summary: 'Brain OS Architecture Sync',
          description: 'Weekly deep-dive on agent restructuring, Sentinel performance, and proactivity engine features.',
          start: `${nextMondayStr}T11:00:00+03:00`,
          end: `${nextMondayStr}T12:00:00+03:00`,
          attendees: [
            { email: 'cto@company.com', responseStatus: 'accepted' }
          ],
          location: 'Google Meet',
          htmlLink: 'https://meet.google.com/xyz-pdq-rst'
        }
      ];
    }

    res.status(200).json({ events, is_mock: isMock });
  } catch (error) {
    next(error);
  }
});

// ─── Contacts List Endpoint (CRM) ───
app.get('/api/contacts', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('contacts')
      .select(`
        id,
        name,
        contact_type,
        company_name,
        email,
        phone,
        notes,
        source_doc_id,
        created_at,
        brain_documents(id, title, document_type)
      `)
      .eq('tenant_id', req.user.company_id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json({ contacts: data || [] });
  } catch (error) {
    next(error);
  }
});

// ─── Create Contact Endpoint (CRM) ───
app.post('/api/contacts', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { name, contact_type, company_name, email, phone, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const { data, error } = await supabase
      .from('contacts')
      .insert([{
        tenant_id: req.user.company_id,
        name,
        contact_type: contact_type || 'client',
        company_name: company_name || null,
        email: email || null,
        phone: phone || null,
        notes: notes || null
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ contact: data });
  } catch (error) {
    next(error);
  }
});

// ─── Update Contact Endpoint (CRM) ───
app.patch('/api/contacts/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const updates = {};
    const allowedFields = ['name', 'contact_type', 'company_name', 'email', 'phone', 'notes'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('contacts')
      .update(updates)
      .eq('id', req.params.id)
      .eq('tenant_id', req.user.company_id)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json({ contact: data });
  } catch (error) {
    next(error);
  }
});

// ─── Proactivity Engine Endpoints ───
app.get('/api/proactivity', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('proposed_automations')
      .select(`
        id,
        tenant_id,
        type,
        description,
        action_payload,
        status,
        created_at,
        source_doc_id,
        is_recurring,
        brain_documents(id, title, document_type)
      `)
      .eq('tenant_id', req.user.company_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.status(200).json({ automations: data || [] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/proactivity/approve/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { overrides } = req.body;
    const result = await approveAutomation(req.params.id, req.user, overrides);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/proactivity/reject/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const result = await rejectAutomation(req.params.id, req.user);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// ─── Proactive Suggestions Endpoints ───
app.get('/api/proactivity/suggestions', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { category, priority, include_dismissed } = req.query;
    let query = supabase
      .from('proactive_suggestions')
      .select('*')
      .eq('tenant_id', req.user.company_id)
      .order('created_at', { ascending: false })
      .limit(30);

    if (!include_dismissed || include_dismissed !== 'true') {
      query = query.eq('is_dismissed', false);
    }
    if (category) {
      query = query.eq('category', category);
    }
    if (priority) {
      query = query.eq('priority', priority);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ suggestions: data || [] });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/proactivity/suggestions/:id', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const updates = {};

    if (req.body.is_dismissed !== undefined) updates.is_dismissed = req.body.is_dismissed;
    if (req.body.is_viewed !== undefined) updates.is_viewed = req.body.is_viewed;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update. Use is_dismissed or is_viewed.' });
    }

    const { data, error } = await supabase
      .from('proactive_suggestions')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', req.user.company_id)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json({ suggestion: data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/proactivity/suggestions/scan', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only admins can trigger scans' });

    const { scanCompany } = require('./src/services/proactivityScheduler');
    const result = await scanCompany(req.user.company_id);
    res.status(200).json({ message: 'Scan triggered', result });
  } catch (error) {
    next(error);
  }
});

// ─── Central Error Handling ───
app.use(getSentryErrorHandler()); // Sentry error handler must be before custom errorHandler
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║   The Brain AIOS — Demo Build v3.0                ║`);
  console.log(`║   Server running on port ${PORT}                      ║`);
  console.log(`║   Vector Store: ${(process.env.VECTOR_STORE || 'supabase').padEnd(31)}║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);

  // ─── Start Proactivity Scheduler ───
  startScheduler();

  // ─── Pre-load local embedding pipeline to eliminate first-request lag ───
  try {
    const { generateEmbedding } = require('./src/services/embeddingService');
    generateEmbedding('preload')
      .then(() => console.log('[Embeddings] Pre-loading complete.'))
      .catch(err => console.warn('[Embeddings] Pre-loading failed:', err.message));
  } catch (err) {
    console.warn('[Embeddings] Failed to initiate pre-loading:', err.message);
  }
});

// ─── Graceful Shutdown ───
process.on('SIGTERM', () => {
  console.log('\n[SIGTERM] Shutting down gracefully...');
  const { stopScheduler } = require('./src/services/proactivityScheduler');
  stopScheduler();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n[SIGINT] Shutting down gracefully...');
  const { stopScheduler } = require('./src/services/proactivityScheduler');
  stopScheduler();
  process.exit(0);
});
