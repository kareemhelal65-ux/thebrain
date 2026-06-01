const fs = require('fs');
const supabase = require('../models/supabaseClient');
const { parseFile } = require('./ingestionService');
const { groq, safeJsonParse } = require('./llmService');

/**
 * Parses a candidate's CV file, runs an LLM assessment of fit relative to company profile,
 * and saves the candidate record.
 */
async function evaluateCandidateCV(filePath, originalName, mimeType, companyId) {
  try {
    // 1. Parse CV file to text
    const cvText = await parseFile(filePath, originalName, mimeType);
    if (!cvText || cvText.trim() === '') {
      throw new Error('Extracted CV text is empty');
    }

    // 2. Fetch company context
    const { data: company, error: compErr } = await supabase
      .from('companies')
      .select('*')
      .eq('id', companyId)
      .single();
    if (compErr || !company) {
      throw new Error(compErr?.message || 'Company not found');
    }

    // 3. Ask LLM to evaluate the CV against company context
    const prompt = `You are an expert recruitment coordinator and talent acquisition partner.
Analyze the candidate's CV/Resume text against the company profile context.

=== COMPANY PROFILE ===
Name: ${company.name || 'Unknown'}
Industry: ${company.industry || 'Unknown'}
About: ${company.description || 'Unknown'}
Stage: ${company.company_stage || 'Unknown'}
Mission/Vision: ${company.mission_vision || 'Unknown'}
Target Customer: ${company.target_customer || 'Unknown'}

=== CANDIDATE CV TEXT ===
${cvText.substring(0, 25000)}

Extract the candidate's personal details and evaluate their fit for this company.
Provide:
- name: Full name of candidate (extract from CV, default to original filename like "${originalName.split('.')[0]}" if not found)
- email: Candidate's email address (extract from CV, default null if not found)
- role_applied: Suggested or applied role based on their CV background (e.g. "Fullstack Engineer" or "Marketing Manager")
- fit_score: An integer score from 1 to 10 evaluating how well they fit this company's stage, industry, and mission
- impact_verdict: A 2-3 sentence summary explaining their potential impact, fit, and why they received this score. Be objective and specific.
- skills: A JSON list of 3-8 key skills extracted from their resume that are relevant to this company.

Return STRICT JSON only:
{
  "name": "string",
  "email": "string" or null,
  "role_applied": "string",
  "fit_score": number,
  "impact_verdict": "string",
  "skills": ["string", ...]
}`;

    const response = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const parsedResult = safeJsonParse(response.choices[0].message.content, {});

    // 4. Save to public.candidates table
    const { data: candidate, error: insertErr } = await supabase
      .from('candidates')
      .insert([{
        company_id: companyId,
        name: parsedResult.name || originalName.split('.')[0],
        email: parsedResult.email || null,
        role_applied: parsedResult.role_applied || 'Candidate',
        cv_text: cvText,
        fit_score: parsedResult.fit_score || 5,
        impact_verdict: parsedResult.impact_verdict || 'CV parsed but evaluation failed.',
        skills: parsedResult.skills || []
      }])
      .select()
      .single();

    if (insertErr) throw insertErr;

    // 5. Clean up local temp file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return candidate;
  } catch (err) {
    // Ensure cleanup of temp file on failure
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    console.error('[CandidateService] CV evaluation failed:', err.message);
    throw err;
  }
}

/**
 * Runs an LLM evaluation on a company member based on their onboarding user profile.
 * Saves the evaluation results and returns them.
 */
async function evaluateMember(companyId, userId) {
  try {
    // 1. Fetch user profile
    const { data: profile, error: profErr } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (profErr) throw profErr;

    // 2. Fetch company context
    const { data: company } = await supabase
      .from('companies')
      .select('name, industry, description')
      .eq('id', companyId)
      .single();

    // Default return if no profile is completed yet
    if (!profile) {
      return {
        user_id: userId,
        company_id: companyId,
        ai_strength: 'Profile not completed yet. AI evaluation will run once onboarding interview is finished.',
        performance_score: 5,
        evaluation_notes: 'Encourage team member to finish onboarding.'
      };
    }

    // 3. Call LLM to evaluate the profile
    const prompt = `You are an expert HR strategist and AI organizational psychologist.
Analyze the company team member's profile and company context to generate an AI evaluation of their strengths and capability.

=== COMPANY DETAILS ===
Name: ${company?.name || 'Unknown'}
Industry: ${company?.industry || 'Unknown'}
About: ${company?.description || 'Unknown'}

=== TEAM MEMBER PROFILE ===
Name: ${profile.full_name || 'Teammate'}
Role: ${profile.position || 'Unknown'}
Background: ${profile.background || 'None specified'}
Experience: ${profile.experience || 'None specified'}
Work Style: ${profile.work_style || 'None specified'}
Interests: ${Array.isArray(profile.interests) ? profile.interests.join(', ') : 'None specified'}
Bio: ${profile.bio || 'None specified'}

Generate their AI evaluation.
Provide:
- ai_strength: A 1-2 sentence description of their primary strengths, key capabilities, and work style in this startup.
- performance_score: An integer from 1 to 10 reflecting their overall capability and alignment with the startup's needs.
- evaluation_notes: Short operational advice/tips on how to best collaborate with them or support their growth.

Return STRICT JSON only:
{
  "ai_strength": "string",
  "performance_score": number,
  "evaluation_notes": "string"
}`;

    const response = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const result = safeJsonParse(response.choices[0].message.content, {});

    // 4. Save/Upsert to public.member_evaluations
    const row = {
      user_id: userId,
      company_id: companyId,
      ai_strength: result.ai_strength || 'Strengths analysis failed.',
      performance_score: result.performance_score || 5,
      evaluation_notes: result.evaluation_notes || 'No evaluation notes.',
      updated_at: new Date().toISOString()
    };

    const { data: evaluation, error: evalErr } = await supabase
      .from('member_evaluations')
      .upsert([row], { onConflict: 'user_id' })
      .select()
      .single();

    if (evalErr) throw evalErr;
    return evaluation;
  } catch (err) {
    console.error('[CandidateService] Member evaluation failed:', err.message);
    // Return a fallback evaluation object so UI doesn't crash
    return {
      user_id: userId,
      company_id: companyId,
      ai_strength: 'Error generating evaluation.',
      performance_score: 5,
      evaluation_notes: err.message
    };
  }
}

module.exports = {
  evaluateCandidateCV,
  evaluateMember
};
