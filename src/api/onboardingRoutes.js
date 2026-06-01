const express = require('express');
const supabase = require('../models/supabaseClient');
const { generateEmbedding } = require('../services/embeddingService');
const { v4: uuidv4 } = require('uuid');
const { groq } = require('../services/llmService');
const { generateUniqueJoinCode } = require('../utils/joinCode');

const router = express.Router();

/**
 * Synthesise a short professional summary for a user profile and (re)embed it into
 * the company's Brain memory. Replaces any prior user_profile chunk for this user so
 * edits don't accumulate stale copies. Used by both onboarding completion and the
 * Settings profile editor. Best-effort — never throws.
 */
async function synthesizeAndEmbedUserProfile({ userId, companyId, companyName, email, userProfile }) {
  if (!userProfile || typeof userProfile !== 'object' || !companyId) return;
  try {
    const interests = Array.isArray(userProfile.interests) ? userProfile.interests.join(', ') : '';
    const profileFacts = [
      userProfile.full_name ? `Name: ${userProfile.full_name}` : null,
      userProfile.position ? `Role at ${companyName || 'the company'}: ${userProfile.position}` : null,
      userProfile.experience ? `Experience: ${userProfile.experience}` : null,
      userProfile.background ? `Background: ${userProfile.background}` : null,
      userProfile.work_style ? `Work style: ${userProfile.work_style}` : null,
      interests ? `Interests: ${interests}` : null,
      userProfile.bio ? `Notes: ${userProfile.bio}` : null,
    ].filter(Boolean).join('\n');

    let summary = profileFacts;
    try {
      const resp = await groq.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [{
          role: 'system',
          content: `Write a concise 2-3 sentence professional profile of this team member at ${companyName || 'the company'}, describing who they are, their role, experience, how they like to work, and what they care about. Write in third person. Be specific, no fluff.\n\n${profileFacts}`,
        }],
        temperature: 0.4,
      });
      summary = resp.choices?.[0]?.message?.content?.trim() || profileFacts;
    } catch (synthErr) {
      console.warn('[UserProfile] Synthesis failed, storing raw facts:', synthErr.message);
    }

    // Persist the synthesised summary back onto the profile row.
    await supabase.from('user_profiles')
      .update({ profile_summary: summary, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    // Replace any prior profile chunk for this user, then embed the fresh one.
    await supabase.from('document_chunks')
      .delete()
      .eq('tenant_id', companyId)
      .eq('source_type', 'user_profile')
      .eq('source_id', userId);

    const memoryText = `Team Member Profile — ${userProfile.full_name || email}\n${summary}\n\n${profileFacts}`;
    const embedding = await generateEmbedding(memoryText);
    await supabase.from('document_chunks').insert([{
      id: uuidv4(),
      tenant_id: companyId,
      content: memoryText,
      embedding: JSON.stringify(embedding),
      source_type: 'user_profile',
      source_id: userId,
      source_title: `${userProfile.full_name || 'Team Member'} — Profile`,
      metadata: {
        user_id: userId,
        full_name: userProfile.full_name || null,
        position: userProfile.position || null,
      },
    }]);
    console.log(`[UserProfile] Synthesised + embedded profile for ${userProfile.full_name || email}`);
    return summary;
  } catch (upErr) {
    console.error('[UserProfile] Synthesis/embed failed:', upErr.message);
  }
}

/**
 * GET /api/onboarding/status
 * Check if the current user has completed onboarding.
 */
router.get('/status', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const companyId = req.user.company_id;
    if (!companyId) {
      return res.json({ onboarded: false, company: null });
    }

    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();

    res.json({
      onboarded: company?.onboarding_complete || false,
      company,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/onboarding/generate-questions
 * Generate custom discovery questions based on the company's profile input.
 * Now supports onboarding_type: 'new_company' or 'existing_company'.
 */
router.post('/generate-questions', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const {
      company_name,
      industry,
      description,
      website,
      linkedin_url,
      x_url,
      instagram_url,
      tiktok_url,
      onboarding_type,       // 'new_company' | 'existing_company'
      company_stage,          // For new companies: stage of the startup
      mission_vision,         // For new companies: core vision
      target_customer,        // For new companies: ideal customer
      current_tools,          // For existing companies: current software stack
      pain_points,            // For existing companies: operational challenges
      team_size               // General
    } = req.body;

    if (!company_name) {
      return res.status(400).json({ error: 'Company name is required to generate questions.' });
    }

    const industryStr = Array.isArray(industry) ? industry.join(', ') : (industry || 'General');
    const type = onboarding_type === 'existing_company' ? 'existing_company' : 'new_company';

    // ─── Two different AI personas based on onboarding type ───
    const prompts = {
      new_company: `You are a world-class startup advisor and venture consultant helping a founder onboard their NEW company into "The Brain" — an AI Operating System for businesses.

Your mission is to ask deeply insightful, non-generic discovery questions that help The Brain understand the startup's foundation so it can provide maximum value from day one.

Company Details:
- Name: ${company_name}
- Industry: ${industryStr}
- Stage: ${company_stage || 'Not specified'}
- Mission/Vision: ${mission_vision || 'Not specified'}
- Target Customer: ${target_customer || 'Not specified'}
- Team Size: ${team_size || 'Not specified'}
- Description: ${description || 'Not specified'}
- Website: ${website || 'Not specified'}
- Social: LinkedIn: ${linkedin_url || 'N/A'}, X: ${x_url || 'N/A'}

Based on the company details above, generate exactly 3 highly specific, non-generic discovery questions. Each question must be tailored to this specific startup — do NOT use generic templates.

Focus areas for new companies:
1. BUSINESS MODEL & REVENUE — How do they plan to monetize? What's the pricing strategy? Are they pre-revenue or generating?
2. MARKET FIT & GROWTH — What's their customer acquisition strategy? What channels will they use? How do they validate demand?
3. IMMEDIATE CHALLENGES — What's the #1 blocker right now? What do they need most: product iteration, customer discovery, fundraising, hiring, or go-to-market?

Each question must include exactly 3 specific, context-relevant choice options for the user to select from (do not generate generic options like "Yes", "No", "Not sure"). Do NOT include a fourth "Other" option in the choices (the system adds it automatically).

Return your response as JSON:
{
  "questions": [
    {
      "question": "Question 1 text — focused on business model/revenue, specific to their industry",
      "category": "business_model",
      "choices": ["Specific choice option A", "Specific choice option B", "Specific choice option C"]
    },
    {
      "question": "Question 2 text — focused on market/growth, referencing their target customer",
      "category": "market_growth",
      "choices": ["Specific choice option A", "Specific choice option B", "Specific choice option C"]
    },
    {
      "question": "Question 3 text — focused on immediate needs and challenges, stage-appropriate",
      "category": "challenges",
      "choices": ["Specific choice option A", "Specific choice option B", "Specific choice option C"]
    }
  ]
}`,
      existing_company: `You are a world-class business operations consultant helping onboard an EXISTING company into "The Brain" — an AI Operating System for businesses.

Your mission is to ask deeply insightful operational discovery questions that help The Brain understand the company's current workflows, pain points, and integration needs so it can transform their operations.

Company Details:
- Name: ${company_name}
- Industry: ${industryStr}
- Description: ${description || 'Not specified'}
- Website: ${website || 'Not specified'}
- Current Tools/Software Stack: ${current_tools || 'Not specified'}
- Pain Points: ${pain_points || 'Not specified'}
- Team Size: ${team_size || 'Not specified'}
- Social: LinkedIn: ${linkedin_url || 'N/A'}, X: ${x_url || 'N/A'}

Based on the company details above, generate exactly 3 highly specific, non-generic discovery questions. Each question must be tailored to this specific company's industry and context — do NOT use generic templates.

Focus areas for existing companies:
1. OPERATIONAL BOTTLENECKS — What specific processes are causing friction, costing time/money, or causing errors in their daily operations?
2. DATA & KNOWLEDGE — What data sources, documents, institutional knowledge, or SOPs does the company have that The Brain should ingest and connect?
3. AUTOMATION & INTEGRATION GOALS — What specific outcomes do they want from The Brain? Which departments would benefit most from AI-powered automation?

Each question must include exactly 3 specific, context-relevant choice options for the user to select from (do not generate generic options like "Yes", "No", "Not sure"). Do NOT include a fourth "Other" option in the choices (the system adds it automatically).

Return your response as JSON:
{
  "questions": [
    {
      "question": "Question 1 text — focused on operational bottlenecks, referencing their industry/tools",
      "category": "bottlenecks",
      "choices": ["Specific choice option A", "Specific choice option B", "Specific choice option C"]
    },
    {
      "question": "Question 2 text — focused on data/knowledge sources, tailored to their company type",
      "category": "data_knowledge",
      "choices": ["Specific choice option A", "Specific choice option B", "Specific choice option C"]
    },
    {
      "question": "Question 3 text — focused on automation goals and desired outcomes",
      "category": "automation_goals",
      "choices": ["Specific choice option A", "Specific choice option B", "Specific choice option C"]
    }
  ]
}`
    };

    const prompt = prompts[type];

    const response = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    console.log('[Onboarding Questions] Generated questions successfully:', JSON.stringify(parsed.questions, null, 2));
    res.json({
      success: true,
      onboarding_type: type,
      questions: parsed.questions || []
    });
  } catch (error) {
    console.error('[Onboarding Questions] Generation failed:', error.message);
    // Smart fallbacks based on onboarding_type
    const type = req.body?.onboarding_type === 'existing_company' ? 'existing_company' : 'new_company';
    const fallbacks = {
      new_company: [
        { question: "What's your business model and how do you plan to generate revenue?", category: "business_model", choices: ["Direct SaaS Subscriptions", "Usage-Based Billing / APIs", "Service / Consulting Fees"] },
        { question: "Who is your ideal customer and what's your strategy to reach them?", category: "market_growth", choices: ["B2B Mid-Market / Enterprise", "Individual consumers (B2C)", "Small Businesses & Startups"] },
        { question: "What is the single biggest challenge you're facing right now?", category: "challenges", choices: ["Product & MVP development", "Acquiring first users/customers", "Fundraising & Capital Runway"] }
      ],
      existing_company: [
        { question: "What are the biggest operational bottlenecks in your daily workflows?", category: "bottlenecks", choices: ["Siloed information / Hard to find details", "Too many status meetings", "Manual data entry & copy-pasting"] },
        { question: "What data sources, documents, or knowledge does your company have that should be connected?", category: "data_knowledge", choices: ["Shared drives (Google Drive/OneDrive)", "Wiki / Knowledge base (Notion/Confluence)", "Meeting recordings & transcripts"] },
        { question: "What specific outcomes are you hoping to achieve with an AI operating system?", category: "automation_goals", choices: ["Automating repetitive admin work", "Improving team communications & alignment", "Gaining real-time financial / metrics insight"] }
      ]
    };
    res.json({
      success: false,
      onboarding_type: type,
      questions: fallbacks[type]
    });
  }
});

/**
 * POST /api/onboarding/complete
 * Save company info, mark onboarding complete, and store in Brain memory.
 */
router.post('/complete', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const {
      company_name,
      industry,
      location,
      employee_count,
      description,
      website,
      founded_year,
      linkedin_url,
      x_url,
      instagram_url,
      tiktok_url,
      discovery_qa,
      onboarding_type,         // 'new_company' | 'existing_company'
      company_stage,            // 'idea' | 'mvp' | 'launched' | 'growing'
      roadmap_type,             // 'vc' | 'bootstrapped' | 'agency' | 'nonprofit'
      mission_vision,
      target_customer,
      competitors,
      current_tools,
      pain_points,
      user_profile          // { full_name, position, experience, background, work_style, interests[], bio }
    } = req.body;

    if (!company_name || !industry || (Array.isArray(industry) && industry.length === 0)) {
      return res.status(400).json({ error: 'Company name and industry are required.' });
    }

    const industryStr = Array.isArray(industry) ? industry.join(', ') : industry;
    const type = onboarding_type === 'existing_company' ? 'existing_company' : 'new_company';

    let companyId = req.user.company_id;

    // Build the update/insert payload — new company fields included for both paths
    const companyPayload = {
      name: company_name,
      industry: industryStr,
      location,
      employee_count,
      description,
      website,
      founded_year: founded_year ? parseInt(founded_year) : null,
      linkedin_url: linkedin_url || null,
      x_url: x_url || null,
      instagram_url: instagram_url || null,
      tiktok_url: tiktok_url || null,
      onboarding_complete: true,
      onboarding_type: type,
      // New company specific fields
      company_stage: company_stage || null,
      roadmap_type: roadmap_type || null,
      mission_vision: mission_vision || null,
      target_customer: target_customer || null,
      competitors: competitors || null,
      // Existing company specific fields (stored in metadata or description)
      current_tools: current_tools || null,
      pain_points: pain_points || null,
    };

    if (companyId) {
      // Update existing company
      const { error } = await supabase
        .from('companies')
        .update(companyPayload)
        .eq('id', companyId);

      if (error) throw error;
    } else {
      // Create new company
      const { data: newCompany, error } = await supabase
        .from('companies')
        .insert([companyPayload])
        .select()
        .single();

      if (error) throw error;
      companyId = newCompany.id;

      // Update user metadata with company_id
      await supabase.auth.admin.updateUserById(req.user.id, {
        app_metadata: { company_id: companyId, role: 'Admin' }
      });
    }

    // ─── Ensure the company has a shareable join code (for co-founders/employees) ───
    try {
      const { data: existingCo } = await supabase
        .from('companies').select('join_code').eq('id', companyId).single();
      if (!existingCo?.join_code) {
        const code = await generateUniqueJoinCode(supabase);
        await supabase.from('companies').update({ join_code: code }).eq('id', companyId);
      }
    } catch (codeErr) {
      console.warn('[Onboarding] Failed to ensure join code:', codeErr.message);
    }

    // ─── Save the personal-interview user profile (best-effort, non-fatal) ───
    if (user_profile && typeof user_profile === 'object') {
      try {
        const interests = Array.isArray(user_profile.interests) ? user_profile.interests : [];
        await supabase
          .from('user_profiles')
          .upsert({
            user_id: req.user.id,
            company_id: companyId,
            full_name: user_profile.full_name || null,
            position: user_profile.position || null,
            experience: user_profile.experience || null,
            background: user_profile.background || null,
            work_style: user_profile.work_style || null,
            interests,
            bio: user_profile.bio || null,
            raw_answers: user_profile,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
        console.log(`[Onboarding] Saved user profile for ${user_profile.full_name || req.user.email}`);
      } catch (profErr) {
        console.error('[Onboarding] Failed to save user profile:', profErr.message);
      }
    }

    // Append Q&A context to Brain memory chunk
    let qaStr = '';
    if (Array.isArray(discovery_qa) && discovery_qa.length > 0) {
      qaStr = '\n\n--- Company Discovery Q&A ---\n' +
        discovery_qa.map(item => `Q: ${item.question}\nA: ${item.answer}`).join('\n\n');
    }

    // ─── Store company profile in The Brain's memory ───
    const profileLines = [
      `Company Name: ${company_name}`,
      `Industry: ${industryStr}`,
      `Onboarding Type: ${type === 'new_company' ? 'New Company / Startup' : 'Existing Company'}`,
      location ? `Headquarters: ${location}` : null,
      employee_count ? `Company Size: ${employee_count} employees` : null,
      description ? `About: ${description}` : null,
      website ? `Website: ${website}` : null,
      founded_year ? `Founded: ${founded_year}` : null,
      linkedin_url ? `LinkedIn Profile: ${linkedin_url}` : null,
      x_url ? `X Profile: ${x_url}` : null,
      instagram_url ? `Instagram Profile: ${instagram_url}` : null,
      tiktok_url ? `TikTok Profile: ${tiktok_url}` : null,
    ];

    // Add onboarding-type-specific fields
    if (type === 'new_company') {
      profileLines.push(company_stage ? `Company Stage: ${company_stage}` : null);
      profileLines.push(mission_vision ? `Mission & Vision: ${mission_vision}` : null);
      profileLines.push(target_customer ? `Target Customer: ${target_customer}` : null);
      profileLines.push(competitors ? `Competitors: ${competitors}` : null);
    } else {
      profileLines.push(current_tools ? `Current Tools/Stack: ${current_tools}` : null);
      profileLines.push(pain_points ? `Pain Points: ${pain_points}` : null);
    }

    const companyProfile = profileLines.filter(Boolean).join('\n') + qaStr;

    try {
      const embedding = await generateEmbedding(companyProfile);
      await supabase.from('document_chunks').insert([{
        id: uuidv4(),
        tenant_id: companyId,
        content: companyProfile,
        embedding: JSON.stringify(embedding),
        source_type: 'company_profile',
        source_id: companyId,
        source_title: `${company_name} — Company Profile`,
        metadata: {
          company_name,
          industry: industryStr,
          location,
          employee_count,
        }
      }]);
      console.log(`[Onboarding] Company profile embedded for "${company_name}"`);
    } catch (embedError) {
      console.error('[Onboarding] Failed to embed company profile:', embedError.message);
      // Non-fatal — onboarding still completes
    }

    // ─── TRIGGER POST-ONBOARDING ACTIONS (async, non-blocking) ───
    // Fire and forget — these run in the background
    setImmediate(async () => {
      try {
        // 0. Synthesise + embed the personal user profile into Brain memory so every
        //    agent and the Brain chat can personalise to who this user is.
        if (user_profile && typeof user_profile === 'object') {
          await synthesizeAndEmbedUserProfile({
            userId: req.user.id,
            companyId,
            companyName: company_name,
            email: req.user.email,
            userProfile: user_profile,
          });
        }

        // 1. Trigger company research scan (website + social media)
        const { triggerCompanyResearch } = require('../services/companyResearchService');
        await triggerCompanyResearch(companyId);
        console.log(`[Onboarding] Company research scan completed for "${company_name}"`);

        // 2. Auto-launch all 10 agents (Finance, People, HR, Investment, CRM, Marketing, Sales, Product, Roadmap, Meeting)
        //    Each agent asks initial questions and starts working in parallel
        const { launchStartupAgents } = require('../services/agentOrchestrator');
        const agentIds = await launchStartupAgents({
          companyId,
          companyProfile: companyPayload,
          user: req.user,
        });
        console.log(`[Onboarding] Launched ${agentIds.length} startup agents for "${company_name}"`);
      } catch (postErr) {
        console.error('[Onboarding] Post-onboarding actions failed:', postErr.message);
        // Non-fatal — onboarding already completed successfully
      }
    });

    res.json({
      success: true,
      company_id: companyId,
      message: `Welcome aboard, ${company_name}! The Brain is ready.`,
      agentLaunched: true,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/onboarding/user-profile
 * Return the current user's personal profile (from the onboarding interview).
 */
router.get('/user-profile', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', req.user.id)
      .maybeSingle();
    res.json({ profile: profile || null });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /api/onboarding/user-profile
 * Create or update the current user's personal profile (Settings editor / redo interview).
 * Re-synthesises the summary and re-embeds it into Brain memory.
 */
router.put('/user-profile', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const companyId = req.user.company_id;
    if (!companyId) return res.status(400).json({ error: 'No company associated with this user.' });

    const up = req.body?.user_profile || req.body || {};
    const interests = Array.isArray(up.interests) ? up.interests : [];

    const { error: upsertErr } = await supabase
      .from('user_profiles')
      .upsert({
        user_id: req.user.id,
        company_id: companyId,
        full_name: up.full_name || null,
        position: up.position || null,
        experience: up.experience || null,
        background: up.background || null,
        work_style: up.work_style || null,
        interests,
        bio: up.bio || null,
        raw_answers: up,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (upsertErr) throw upsertErr;

    // Look up the company name for nicer synthesis context.
    let companyName = null;
    try {
      const { data: company } = await supabase.from('companies').select('name').eq('id', companyId).single();
      companyName = company?.name || null;
    } catch { /* non-fatal */ }

    const summary = await synthesizeAndEmbedUserProfile({
      userId: req.user.id,
      companyId,
      companyName,
      email: req.user.email,
      userProfile: { ...up, interests },
    });

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', req.user.id)
      .maybeSingle();

    res.json({ success: true, profile: profile || null, profile_summary: summary || profile?.profile_summary || null });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/onboarding/join
 * Join an existing company using its shareable code (co-founders / employees).
 * Switches the current user into that company; they then complete the personal interview.
 */
router.post('/join', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'A join code is required.' });

    const { data: company, error } = await supabase
      .from('companies')
      .select('id, name, join_code')
      .eq('join_code', code)
      .maybeSingle();

    if (error) throw error;
    if (!company) return res.status(404).json({ error: 'That code does not match any company. Double-check it with your team.' });

    // Move the user into the company (public.users + JWT metadata). Joiners are Employees.
    await supabase
      .from('users')
      .upsert({ id: req.user.id, company_id: company.id, role: 'Employee', department: 'general' }, { onConflict: 'id' });

    await supabase.auth.admin.updateUserById(req.user.id, {
      app_metadata: { company_id: company.id, role: 'Employee' },
    });

    res.json({ success: true, company: { id: company.id, name: company.name } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
