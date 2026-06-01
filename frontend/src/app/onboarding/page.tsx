'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { apiRequest } from '@/lib/api';
import {
  Brain, Building2, MapPin, Users, Globe, Briefcase,
  ArrowRight, ArrowLeft, Loader2, Sparkles, Check,
  Calendar, Rocket, Target, Lightbulb, TrendingUp,
  Zap, Search, Workflow, BarChart3, User, Award, Heart,
} from 'lucide-react';

const INDUSTRIES = [
  'AI', 'Technology', 'SaaS', 'E-Commerce', 'FinTech', 'HealthTech',
  'EdTech', 'Real Estate', 'Hospitality', 'Manufacturing', 'Consulting',
  'Marketing & Advertising', 'Media & Entertainment',
  'Logistics & Supply Chain', 'Food & Beverage', 'Retail',
  'Financial Services', 'Legal', 'Healthcare', 'Energy',
  'Construction', 'Agriculture', 'Other',
];

const COMPANY_SIZES = [
  '1-5 (Startup)', '6-20 (Small)', '21-50 (Growing)',
  '51-200 (Mid-size)', '201-500 (Large)', '500+ (Enterprise)',
];

const COMPANY_STAGES = [
  { id: 'idea', label: '💡 Idea Stage', desc: 'Concept phase, validating the problem' },
  { id: 'mvp', label: '🛠️ Building MVP', desc: 'Developing the minimum viable product' },
  { id: 'launched', label: '🚀 Launched', desc: 'Live with customers, early traction' },
  { id: 'growing', label: '📈 Growing & Scaling', desc: 'Revenue-generating, expanding team' },
];

const BUSINESS_MODELS = [
  'B2B SaaS', 'B2C', 'B2B + B2C', 'Marketplace',
  'E-Commerce / DTC', 'Agency / Services', 'Enterprise',
  'Non-Profit', 'Other',
];

// ─── Personal interview options (build a complete user profile) ───
const USER_POSITIONS = [
  'Founder / CEO', 'Co-Founder', 'CTO / Engineering Lead', 'Product Lead',
  'Marketing Lead', 'Sales Lead', 'Operations', 'Finance', 'Designer', 'Other',
];

const EXPERIENCE_LEVELS = [
  { id: 'new', label: 'Just starting out', desc: 'First venture / early career' },
  { id: '1-3', label: '1–3 years', desc: 'Some operating experience' },
  { id: '3-7', label: '3–7 years', desc: 'Solid track record' },
  { id: '7-15', label: '7–15 years', desc: 'Senior / experienced operator' },
  { id: '15+', label: '15+ years', desc: 'Veteran / repeat founder' },
];

const INTEREST_AREAS = [
  'Product', 'Engineering', 'Growth & Marketing', 'Sales', 'Fundraising',
  'Operations', 'Design / UX', 'Data & Analytics', 'People & Culture', 'Strategy', 'Finance',
];

const WORK_STYLES = [
  { id: 'strategist', label: '🧭 Big-picture strategist', desc: 'Vision, direction, and the why' },
  { id: 'builder', label: '🛠️ Hands-on builder', desc: 'Ships fast, learns by doing' },
  { id: 'data', label: '📊 Data-driven', desc: 'Decisions grounded in numbers' },
  { id: 'people', label: '🤝 People-first', desc: 'Leads through team and relationships' },
  { id: 'scrappy', label: '⚡ Fast & scrappy', desc: 'Bias to action, comfortable with ambiguity' },
  { id: 'methodical', label: '🔍 Methodical & detailed', desc: 'Thorough, organized, precise' },
];

// Determines which roadmap template populates the company's roadmap.
const ROADMAP_TYPES = [
  { id: 'vc', label: '📈 VC Track', desc: 'Raising venture capital — Pre-Seed → Seed → Series A/B/C → IPO' },
  { id: 'bootstrapped', label: '💪 Bootstrapped Growth', desc: 'Self-funded, profit-first — revenue and runway milestones, no raise' },
  { id: 'agency', label: '🤝 Agency / Services', desc: 'Client services — utilization, retainers, and team capacity milestones' },
  { id: 'nonprofit', label: '🌍 Non-Profit', desc: 'Mission-driven — programs, grants, donors, and impact milestones' },
];

type OnboardingType = 'new_company' | 'existing_company' | null;

interface FormData {
  company_name: string;
  industry: string[];
  description: string;
  website: string;
  founded_year: string;
  linkedin_url: string;
  x_url: string;
  instagram_url: string;
  tiktok_url: string;
  // New company fields
  company_stage: string;
  roadmap_type: string;
  mission_vision: string;
  target_customer: string;
  competitors: string;
  business_model: string;
  // Existing company fields
  location: string;
  employee_count: string;
  current_tools: string;
  pain_points: string;
  team_size: string;
}

interface DiscoveryQA {
  questions: string[];
  categories: string[];
  answers: string[];
}

interface OnboardingQuestion {
  question: string;
  category: string;
  choices: string[];
}

const CATEGORY_ICONS: Record<string, string> = {
  business_model: '💰',
  market_growth: '📊',
  challenges: '🎯',
  bottlenecks: '🔧',
  data_knowledge: '📚',
  automation_goals: '🤖',
  general: '💬',
};

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetchingQuestions, setFetchingQuestions] = useState(false);
  const [onboardingType, setOnboardingType] = useState<OnboardingType>(null);
  const [discoveryQuestions, setDiscoveryQuestions] = useState<OnboardingQuestion[]>([]);
  const [currentQAIndex, setCurrentQAIndex] = useState(0);
  const [selectedChoices, setSelectedChoices] = useState<string[][]>([[], [], []]);
  const [otherInputs, setOtherInputs] = useState<string[]>(['', '', '']);

  // ─── Join-an-existing-company flow ───
  const [joinMode, setJoinMode] = useState(false);
  const [joinStep, setJoinStep] = useState<0 | 1>(0); // 0 = enter code, 1 = personal interview
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinedCompany, setJoinedCompany] = useState<{ id: string; name: string } | null>(null);
  const [joinVerifying, setJoinVerifying] = useState(false);
  const [joinSaving, setJoinSaving] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const [form, setForm] = useState<FormData>({
    company_name: '',
    industry: [],
    description: '',
    website: '',
    founded_year: '',
    linkedin_url: '',
    x_url: '',
    instagram_url: '',
    tiktok_url: '',
    // New company
    company_stage: '',
    roadmap_type: '',
    mission_vision: '',
    target_customer: '',
    competitors: '',
    business_model: '',
    // Existing company
    location: '',
    employee_count: '',
    current_tools: '',
    pain_points: '',
    team_size: '',
  });

  // ─── Personal interview / user profile ───
  const [userProfile, setUserProfile] = useState({
    full_name: '',
    position: '',
    position_other: '',
    experience: '',
    background: '',
    work_style: '',
    interests: [] as string[],
    bio: '',
  });

  const updateProfile = useCallback((field: string, value: any) => {
    setUserProfile(prev => ({ ...prev, [field]: value }));
  }, []);

  const toggleInterest = useCallback((area: string) => {
    setUserProfile(prev => ({
      ...prev,
      interests: prev.interests.includes(area)
        ? prev.interests.filter(i => i !== area)
        : [...prev.interests, area],
    }));
  }, []);

  const updateField = useCallback((field: keyof FormData, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const toggleIndustry = useCallback((ind: string) => {
    setForm(prev => {
      const current = prev.industry;
      if (current.includes(ind)) {
        return { ...prev, industry: current.filter(i => i !== ind) };
      }
      return { ...prev, industry: [...current, ind] };
    });
  }, []);

  const selectOnboardingType = (type: OnboardingType) => {
    setOnboardingType(type);
    setStep(1);
  };

  // ─── Navigation ───
  const handleNext = async () => {
    if (step === 1) {
      // After basic info, go to path-specific step
      setStep(2);
    } else if (step === 2) {
      // After path-specific info, generate AI questions
      if (discoveryQuestions.length > 0 && (selectedChoices.some(arr => arr.length > 0) || otherInputs.some(t => t.trim()))) {
        setStep(3);
        setCurrentQAIndex(0);
        return;
      }
      setStep(3);
      setCurrentQAIndex(0);
      setFetchingQuestions(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('Not authenticated');

        const requestBody: any = {
          company_name: form.company_name,
          industry: form.industry,
          description: form.description,
          website: form.website,
          onboarding_type: onboardingType,
        };

        // Add path-specific context for smarter questions
        if (onboardingType === 'new_company') {
          requestBody.company_stage = form.company_stage;
          requestBody.mission_vision = form.mission_vision;
          requestBody.target_customer = form.target_customer;
          requestBody.team_size = form.team_size;
        } else {
          requestBody.location = form.location;
          requestBody.employee_count = form.employee_count;
          requestBody.current_tools = form.current_tools;
          requestBody.pain_points = form.pain_points;
          requestBody.team_size = form.team_size;
        }

        const res = await apiRequest('/api/onboarding/generate-questions', {
          method: 'POST',
          body: JSON.stringify(requestBody),
        }, token);

        console.log('[Onboarding] Raw API response:', res);
        if (res && res.success && Array.isArray(res.questions) && res.questions.length > 0) {
          const formattedQuestions = res.questions.map((q: any) => {
            let questionText = '';
            let categoryText = 'general';
            let choicesList: string[] = [];

            if (q && typeof q === 'object') {
              // Extract question text safely from any potential field
              if (typeof q.question === 'string') {
                questionText = q.question.trim();
              } else if (typeof q.text === 'string') {
                questionText = q.text.trim();
              } else if (q.question && typeof q.question === 'object' && typeof q.question.text === 'string') {
                questionText = q.question.text.trim();
              } else {
                questionText = String(q.question || q.text || q.title || q.desc || '').trim();
              }

              // Extract category safely
              categoryText = String(q.category || 'general').trim();

              // Extract choices safely from any potential array/string field
              const rawChoices = q.choices || q.options || q.answers || [];
              if (Array.isArray(rawChoices)) {
                choicesList = rawChoices.map((c: any) => String(c || '').trim()).filter(Boolean);
              } else if (typeof rawChoices === 'string') {
                choicesList = rawChoices.split(',').map((c: string) => c.trim()).filter(Boolean);
              }
            } else if (typeof q === 'string') {
              questionText = q.trim();
            } else {
              questionText = String(q || '').trim();
            }

            // Exclude "Other" from LLM-generated choices since the frontend UI adds it automatically
            choicesList = choicesList.filter(c => c.toLowerCase() !== 'other');

            // Fallback choices if empty or invalid
            if (choicesList.length === 0) {
              if (categoryText === 'business_model') {
                choicesList = ["SaaS / Subscription", "Transactional / Marketplace", "Direct Sales / Services"];
              } else if (categoryText === 'market_growth') {
                choicesList = ["B2B Mid-Market / Enterprise", "Consumers (B2C)", "SMBs & Startups"];
              } else if (categoryText === 'challenges') {
                choicesList = ["Product / MVP development", "Customer acquisition", "Fundraising / Runway"];
              } else if (categoryText === 'bottlenecks') {
                choicesList = ["Information silos / lack of context", "Too many meetings / manual follow-ups", "Manual spreadsheet workflows"];
              } else if (categoryText === 'data_knowledge') {
                choicesList = ["Google Drive / cloud storage", "Notion / company wiki", "Meeting transcripts & notes"];
              } else if (categoryText === 'automation_goals') {
                choicesList = ["Automating administrative work", "Smarter meeting summaries", "Real-time KPI & financial tracking"];
              } else {
                choicesList = ["Product development", "Sales & traction", "Marketing & outreach"];
              }
            }

            return {
              question: questionText,
              category: categoryText,
              choices: choicesList
            };
          }).filter((q: any) => q.question !== '' && q.choices.length > 0);

          console.log('[Onboarding] Formatted questions:', formattedQuestions);
          if (formattedQuestions.length > 0) {
            setDiscoveryQuestions(formattedQuestions);
            setSelectedChoices(new Array(formattedQuestions.length).fill([]).map(() => []));
            setOtherInputs(new Array(formattedQuestions.length).fill(''));
          } else {
            throw new Error('All questions empty');
          }
        } else {
          throw new Error('No questions or success false');
        }
      } catch (err) {
        console.error('Failed to generate discovery questions:', err);
        const fallbacks: Record<string, OnboardingQuestion[]> = {
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
        const fb = fallbacks[onboardingType || 'new_company'];
        setDiscoveryQuestions(fb);
        setSelectedChoices([[], [], []]);
        setOtherInputs(['', '', '']);
      } finally {
        setFetchingQuestions(false);
      }
    } else if (step === 3) {
      if (currentQAIndex < discoveryQuestions.length - 1) {
        setCurrentQAIndex(prev => prev + 1);
      } else {
        setStep(4); // Personal interview step
      }
    } else {
      // Step 4 (interview) → 5 (social) → 6 (launch)
      setStep(s => s + 1);
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const discovery_qa = discoveryQuestions.map((q, idx) => {
        const choices = selectedChoices[idx] || [];
        const otherVal = otherInputs[idx]?.trim();
        const answersList = [...choices.filter(c => c !== 'Other')];
        if (choices.includes('Other') && otherVal) {
          answersList.push(otherVal);
        }
        return {
          question: q.question,
          answer: answersList.join(', ') || 'No answer provided'
        };
      });

      const resolvedPosition = userProfile.position === 'Other'
        ? (userProfile.position_other.trim() || 'Other')
        : userProfile.position;

      await apiRequest('/api/onboarding/complete', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          onboarding_type: onboardingType,
          discovery_qa,
          user_profile: {
            full_name: userProfile.full_name.trim(),
            position: resolvedPosition,
            experience: userProfile.experience,
            background: userProfile.background.trim(),
            work_style: userProfile.work_style,
            interests: userProfile.interests,
            bio: userProfile.bio.trim(),
          },
        }),
      }, token);

      router.push('/dashboard');
    } catch (err) {
      console.error('Onboarding failed:', err);
      alert('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };



  // ─── Join an existing company ───
  const verifyJoinCode = async () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) { setJoinError('Enter the code your team shared with you.'); return; }
    setJoinVerifying(true);
    setJoinError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');
      const res = await apiRequest('/api/onboarding/join', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }, token);
      if (res?.success && res.company) {
        setJoinedCompany(res.company);
        setJoinStep(1);
      } else {
        setJoinError(res?.error || 'That code did not match any company.');
      }
    } catch (err: any) {
      setJoinError(err?.message?.includes('404') ? 'That code does not match any company.' : 'Could not verify the code. Please try again.');
    } finally {
      setJoinVerifying(false);
    }
  };

  const completeJoin = async () => {
    setJoinSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Not authenticated');
      const resolvedPosition = userProfile.position === 'Other'
        ? (userProfile.position_other.trim() || 'Other')
        : userProfile.position;
      await apiRequest('/api/onboarding/user-profile', {
        method: 'PUT',
        body: JSON.stringify({
          user_profile: {
            full_name: userProfile.full_name.trim(),
            position: resolvedPosition,
            experience: userProfile.experience,
            background: userProfile.background.trim(),
            work_style: userProfile.work_style,
            interests: userProfile.interests,
            bio: userProfile.bio.trim(),
          },
        }),
      }, token);
      router.push('/dashboard');
    } catch (err) {
      console.error('Join completion failed:', err);
      alert('Something went wrong saving your profile. Please try again.');
    } finally {
      setJoinSaving(false);
    }
  };

  // ─── Step Definitions ───
  const isNewCompany = onboardingType === 'new_company';
  const totalSteps = 7; // choice(0) + basics + path + discovery + interview + social + launch
  const progress = ((step + 1) / totalSteps) * 100;

  // ─── Render Current Step ───
  const renderStep = () => {
    // Join-an-existing-company flow (separate from the new/existing-company wizard)
    if (joinMode) {
      return (
        <div className="animate-fade-in" style={{ width: '100%', maxWidth: '560px', padding: '40px' }}>
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <div style={{
              width: '56px', height: '56px', borderRadius: 'var(--radius-lg)',
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px',
            }}>
              <Users size={28} color="white" />
            </div>
            <h1 style={{ fontSize: '26px', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '6px' }}>
              {joinStep === 0 ? 'Join your team' : `Welcome to ${joinedCompany?.name || 'the team'}`}
            </h1>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)', maxWidth: '420px', margin: '0 auto', lineHeight: 1.6 }}>
              {joinStep === 0
                ? 'Enter the company code your founder or teammate shared with you.'
                : 'Quick personal interview so The Brain knows your role and can assign you the right work.'}
            </p>
          </div>

          <div className="glass-card" style={{ padding: '28px', marginBottom: '20px' }}>
            {joinStep === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Company code</label>
                <input
                  type="text"
                  placeholder="e.g. 7QK2M9"
                  value={joinCodeInput}
                  onChange={e => { setJoinCodeInput(e.target.value.toUpperCase()); setJoinError(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') verifyJoinCode(); }}
                  className="input-field"
                  autoFocus
                  maxLength={12}
                  style={{ fontSize: '20px', padding: '14px 16px', letterSpacing: '0.18em', textAlign: 'center', fontWeight: 700, textTransform: 'uppercase' }}
                />
                {joinError && (
                  <p style={{ fontSize: '12px', color: 'var(--accent-rose)', margin: 0 }}>{joinError}</p>
                )}
              </div>
            ) : (
              <InterviewFields userProfile={userProfile} updateProfile={updateProfile} toggleInterest={toggleInterest} />
            )}
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between' }}>
            <button
              onClick={() => {
                if (joinStep === 1) { setJoinStep(0); }
                else { setJoinMode(false); setJoinError(null); }
              }}
              className="btn-ghost"
              style={{ flex: 1, padding: '12px' }}
            >
              <ArrowLeft size={16} /> Back
            </button>
            {joinStep === 0 ? (
              <button onClick={verifyJoinCode} disabled={joinVerifying || !joinCodeInput.trim()} className="btn-primary" style={{ flex: 2, padding: '12px', fontSize: '15px' }}>
                {joinVerifying ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                {joinVerifying ? 'Verifying…' : 'Verify code'}
              </button>
            ) : (
              <button
                onClick={completeJoin}
                disabled={joinSaving || userProfile.full_name.trim() === '' || (userProfile.position === 'Other' && userProfile.position_other.trim() === '')}
                className="btn-primary"
                style={{ flex: 2, padding: '12px', fontSize: '15px' }}
              >
                {joinSaving ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                {joinSaving ? 'Joining…' : '🚀 Join & Continue'}
              </button>
            )}
          </div>
        </div>
      );
    }

    // Step 0: Choice Screen
    if (!onboardingType) {
      return (
        <div className="animate-fade-in" style={{ width: '100%', maxWidth: '720px', padding: '40px' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: 'var(--radius-lg)',
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px', boxShadow: '0 8px 32px rgba(99,102,241,0.2)',
            }}>
              <Brain size={32} color="white" />
            </div>
            <h1 style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '8px' }}>
              Welcome to <span className="gradient-text">The Brain</span>
            </h1>
            <p style={{ fontSize: '15px', color: 'var(--text-muted)', maxWidth: '480px', margin: '0 auto', lineHeight: 1.6 }}>
              Your AI Operating System for business. Let's get you set up — first, tell us about where you are.
            </p>
          </div>

          {/* Choice Cards */}
          <div style={{ display: 'flex', gap: '20px', marginBottom: '24px' }}>
            {/* New Company */}
            <button
              onClick={() => selectOnboardingType('new_company')}
              className="glass-card"
              style={{
                flex: 1, padding: '32px 24px', cursor: 'pointer',
                border: '1px solid var(--border-default)',
                transition: 'all 0.25s ease', textAlign: 'left',
                position: 'relative', overflow: 'hidden',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--accent-primary)';
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = '0 12px 40px rgba(99,102,241,0.15)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border-default)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {/* Ambient glow */}
              <div style={{
                position: 'absolute', top: '-40%', right: '-30%',
                width: '200px', height: '200px', borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)',
                pointerEvents: 'none',
              }} />
              <div style={{
                width: '48px', height: '48px', borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(6,182,212,0.15))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: '16px',
              }}>
                <Rocket size={24} style={{ color: 'var(--accent-cyan)' }} />
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>
                Starting a New Company
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '16px' }}>
                Building something new from scratch. The Brain will help you shape your strategy, 
                track decisions, and scale from day one.
              </p>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                fontSize: '12px', fontWeight: 600, color: 'var(--accent-primary)',
              }}>
                Start fresh <ArrowRight size={14} />
              </div>
            </button>

            {/* Existing Company */}
            <button
              onClick={() => selectOnboardingType('existing_company')}
              className="glass-card"
              style={{
                flex: 1, padding: '32px 24px', cursor: 'pointer',
                border: '1px solid var(--border-default)',
                transition: 'all 0.25s ease', textAlign: 'left',
                position: 'relative', overflow: 'hidden',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--accent-secondary)';
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = '0 12px 40px rgba(52,211,153,0.15)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border-default)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{
                position: 'absolute', top: '-40%', right: '-30%',
                width: '200px', height: '200px', borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(52,211,153,0.08) 0%, transparent 70%)',
                pointerEvents: 'none',
              }} />
              <div style={{
                width: '48px', height: '48px', borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, rgba(52,211,153,0.15), rgba(99,102,241,0.15))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: '16px',
              }}>
                <Building2 size={24} style={{ color: 'var(--accent-secondary)' }} />
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>
                I Have an Existing Company
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '16px' }}>
                Already running a business. The Brain will connect to your operations, 
                ingest your knowledge base, and supercharge your team.
              </p>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                fontSize: '12px', fontWeight: 600, color: 'var(--accent-secondary)',
              }}>
                Connect business <ArrowRight size={14} />
              </div>
            </button>
          </div>

          {/* Join an existing company (co-founders / employees) */}
          <button
            onClick={() => { setJoinMode(true); setJoinStep(0); setJoinError(null); }}
            className="glass-card"
            style={{
              width: '100%', padding: '18px 22px', cursor: 'pointer',
              border: '1px solid var(--border-default)', transition: 'all 0.2s ease',
              textAlign: 'left', display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
          >
            <div style={{
              width: '44px', height: '44px', borderRadius: 'var(--radius-md)', flexShrink: 0,
              background: 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(6,182,212,0.15))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Users size={22} style={{ color: 'var(--accent-primary)' }} />
            </div>
            <div style={{ flex: 1 }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '2px' }}>Joining your team's company</h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                A co-founder or colleague already set up The Brain? Enter your company code to join them.
              </p>
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--accent-primary)', whiteSpace: 'nowrap' }}>
              Enter code <ArrowRight size={14} />
            </span>
          </button>

          {/* Skip option (if coming back) */}
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={() => router.push('/dashboard')}
              className="btn-ghost"
              style={{ fontSize: '13px', padding: '8px 16px', color: 'var(--text-muted)' }}
            >
              I'll configure this later → Go to Dashboard
            </button>
          </div>
        </div>
      );
    }

    // Rest of steps — shared wrapper
    const stepConfigs = [
      // Step 1: Company Name & Industry (shared)
      {
        title: 'Tell us about your company',
        subtitle: `The Brain needs to know who it's working for.`,
        content: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                Company Name *
              </label>
              <input
                type="text"
                placeholder="e.g. Acme Inc."
                value={form.company_name}
                onChange={e => updateField('company_name', e.target.value)}
                className="input-field"
                autoFocus
                style={{ fontSize: '16px', padding: '14px 16px' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                Industry *
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {INDUSTRIES.map(ind => {
                  const isSelected = form.industry.includes(ind);
                  return (
                    <button
                      key={ind}
                      onClick={() => toggleIndustry(ind)}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 'var(--radius-full)',
                        border: isSelected ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-default)',
                        background: isSelected ? 'rgba(99,102,241,0.12)' : 'var(--bg-tertiary)',
                        color: isSelected ? 'var(--accent-secondary)' : 'var(--text-secondary)',
                        fontSize: '13px',
                        fontWeight: isSelected ? 600 : 400,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {isSelected && <Check size={12} style={{ marginRight: '4px' }} />}
                      {ind}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                <Briefcase size={12} style={{ display: 'inline', marginRight: '4px' }} />
                What does your company do?
              </label>
              <textarea
                placeholder={isNewCompany
                  ? "e.g. We're building an AI-powered platform that helps small businesses automate their accounting..."
                  : "e.g. We provide enterprise cybersecurity solutions for financial institutions..."
                }
                value={form.description}
                onChange={e => updateField('description', e.target.value)}
                className="input-field"
                rows={2}
                style={{ fontSize: '14px', padding: '12px 14px', resize: 'vertical', minHeight: '60px', fontFamily: 'inherit' }}
              />
            </div>
          </div>
        ),
        valid: form.company_name.trim() !== '' && form.industry.length > 0,
      },

      // Step 2: Path-specific context
      ...(isNewCompany ? [{
        title: '🚀 Your Startup Profile',
        subtitle: 'Help The Brain understand your vision, market, and stage.',
        content: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Company Stage */}
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                <TrendingUp size={12} style={{ display: 'inline', marginRight: '4px' }} />
                What stage is your company at?
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {COMPANY_STAGES.map(s => (
                  <button
                    key={s.id}
                    onClick={() => updateField('company_stage', s.id)}
                    style={{
                      padding: '12px 16px',
                      borderRadius: 'var(--radius-md)',
                      border: form.company_stage === s.id ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-default)',
                      background: form.company_stage === s.id ? 'rgba(99,102,241,0.08)' : 'var(--bg-tertiary)',
                      color: form.company_stage === s.id ? 'var(--accent-secondary)' : 'var(--text-primary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>{s.label}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{s.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Roadmap Type */}
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                <TrendingUp size={12} style={{ display: 'inline', marginRight: '4px' }} />
                Which growth path best describes your plan?
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {ROADMAP_TYPES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => updateField('roadmap_type', t.id)}
                    style={{
                      padding: '12px 16px',
                      borderRadius: 'var(--radius-md)',
                      border: form.roadmap_type === t.id ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-default)',
                      background: form.roadmap_type === t.id ? 'rgba(99,102,241,0.08)' : 'var(--bg-tertiary)',
                      color: form.roadmap_type === t.id ? 'var(--accent-secondary)' : 'var(--text-primary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>{t.label}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Mission & Vision */}
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                <Target size={12} style={{ display: 'inline', marginRight: '4px' }} />
                What's your mission or vision in one sentence?
              </label>
              <input
                type="text"
                placeholder="e.g. Democratize access to AI-powered business intelligence for every startup"
                value={form.mission_vision}
                onChange={e => updateField('mission_vision', e.target.value)}
                className="input-field"
                style={{ fontSize: '14px', padding: '12px 14px' }}
              />
            </div>

            {/* Target Customer */}
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                <Users size={12} style={{ display: 'inline', marginRight: '4px' }} />
                Who is your ideal customer or target audience?
              </label>
              <input
                type="text"
                placeholder="e.g. Small business owners with 5-50 employees who hate spreadsheets"
                value={form.target_customer}
                onChange={e => updateField('target_customer', e.target.value)}
                className="input-field"
                style={{ fontSize: '14px', padding: '12px 14px' }}
              />
            </div>

            {/* Business Model */}
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                <BarChart3 size={12} style={{ display: 'inline', marginRight: '4px' }} />
                Business Model
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {BUSINESS_MODELS.map(m => (
                  <button
                    key={m}
                    onClick={() => updateField('business_model', m)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: 'var(--radius-full)',
                      border: form.business_model === m ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-default)',
                      background: form.business_model === m ? 'rgba(99,102,241,0.12)' : 'var(--bg-tertiary)',
                      color: form.business_model === m ? 'var(--accent-secondary)' : 'var(--text-secondary)',
                      fontSize: '13px',
                      fontWeight: form.business_model === m ? 600 : 400,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {form.business_model === m && <Check size={12} style={{ marginRight: '4px' }} />}
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Competitors & Team */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Main Competitors
                </label>
                <input
                  type="text"
                  placeholder="e.g. Company X, Company Y"
                  value={form.competitors}
                  onChange={e => updateField('competitors', e.target.value)}
                  className="input-field"
                  style={{ fontSize: '13px', padding: '12px 14px' }}
                />
              </div>
              <div style={{ width: '140px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Team Size
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={form.team_size}
                  onChange={e => updateField('team_size', e.target.value)}
                  className="input-field"
                  style={{ fontSize: '13px', padding: '12px 14px' }}
                  min={0}
                />
              </div>
            </div>
          </div>
        ),
        valid: true,
      }] : [{
        title: '🏢 Your Business Profile',
        subtitle: 'Help The Brain understand your operations and pain points.',
        content: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Location & Size row */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  <MapPin size={12} style={{ display: 'inline', marginRight: '4px' }} />
                  Headquarters Location
                </label>
                <input
                  type="text"
                  placeholder="e.g. Cairo, Egypt"
                  value={form.location}
                  onChange={e => updateField('location', e.target.value)}
                  className="input-field"
                  style={{ fontSize: '14px', padding: '12px 14px' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  <Users size={12} style={{ display: 'inline', marginRight: '4px' }} />
                  Number of Employees
                </label>
                <select
                  value={form.employee_count}
                  onChange={e => updateField('employee_count', e.target.value)}
                  className="input-field"
                  style={{ fontSize: '14px', padding: '12px 14px' }}
                >
                  <option value="">Select size...</option>
                  {COMPANY_SIZES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Current Tools / Software Stack */}
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                <Zap size={12} style={{ display: 'inline', marginRight: '4px' }} />
                What software and tools does your company currently use?
              </label>
              <textarea
                placeholder="e.g. Slack for communication, Notion for docs, HubSpot for CRM, QuickBooks for accounting, Jira for project management..."
                value={form.current_tools}
                onChange={e => updateField('current_tools', e.target.value)}
                className="input-field"
                rows={2}
                style={{ fontSize: '14px', padding: '12px 14px', resize: 'vertical', minHeight: '60px', fontFamily: 'inherit' }}
              />
            </div>

            {/* Pain Points */}
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                <Search size={12} style={{ display: 'inline', marginRight: '4px' }} />
                What are your biggest operational challenges or pain points?
              </label>
              <textarea
                placeholder="e.g. Too many meetings with no follow-up, hard to find past decisions, onboarding new employees takes weeks, siloed data across departments..."
                value={form.pain_points}
                onChange={e => updateField('pain_points', e.target.value)}
                className="input-field"
                rows={2}
                style={{ fontSize: '14px', padding: '12px 14px', resize: 'vertical', minHeight: '60px', fontFamily: 'inherit' }}
              />
            </div>

            {/* Roadmap Type */}
            <div>
              <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>
                <TrendingUp size={12} style={{ display: 'inline', marginRight: '4px' }} />
                Which growth path best describes your plan?
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {ROADMAP_TYPES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => updateField('roadmap_type', t.id)}
                    style={{
                      padding: '12px 16px',
                      borderRadius: 'var(--radius-md)',
                      border: form.roadmap_type === t.id ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-default)',
                      background: form.roadmap_type === t.id ? 'rgba(99,102,241,0.08)' : 'var(--bg-tertiary)',
                      color: form.roadmap_type === t.id ? 'var(--accent-secondary)' : 'var(--text-primary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>{t.label}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{t.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Website & Founded row */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  <Globe size={12} style={{ display: 'inline', marginRight: '4px' }} />
                  Website
                </label>
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={form.website}
                  onChange={e => updateField('website', e.target.value)}
                  className="input-field"
                  style={{ fontSize: '14px', padding: '12px 14px' }}
                />
              </div>
              <div style={{ width: '140px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  <Calendar size={12} style={{ display: 'inline', marginRight: '4px' }} />
                  Founded Year
                </label>
                <input
                  type="number"
                  placeholder="2020"
                  value={form.founded_year}
                  onChange={e => updateField('founded_year', e.target.value)}
                  className="input-field"
                  style={{ fontSize: '13px', padding: '12px 14px' }}
                  min={1900}
                  max={2030}
                />
              </div>
            </div>
          </div>
        ),
        valid: true,
      }]),

      // Step 3: AI Discovery Questions (both paths)
      {
        title: fetchingQuestions
          ? '🧠 The Brain is thinking...'
          : isNewCompany ? '🚀 Smart Discovery for Your Startup' : '🏢 Smart Discovery for Your Business',
        subtitle: fetchingQuestions
          ? 'Analyzing your profile and generating personalized questions...'
          : 'The Brain has generated these questions based on what you shared. Your answers help us tailor everything.',
        content: fetchingQuestions ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            minHeight: '280px', gap: '20px',
          }}>
            {/* Animated brain pulse */}
            <div style={{ position: 'relative' }}>
              <div style={{
                width: '64px', height: '64px', borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: 'pulse 2s ease-in-out infinite',
              }}>
                <Brain size={32} color="white" />
              </div>
              <div style={{
                position: 'absolute', top: '-8px', left: '-8px', right: '-8px', bottom: '-8px',
                borderRadius: '50%',
                border: '2px solid var(--accent-primary)',
                opacity: 0.3,
                animation: 'ping 2s ease-in-out infinite',
              }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                Crafting Your Discovery Questions
              </p>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                {isNewCompany
                  ? `Analyzing ${form.company_name}'s startup profile, stage, and market...`
                  : `Analyzing ${form.company_name}'s operations, stack, and challenges...`
                }
              </p>
            </div>
          </div>
        ) : discoveryQuestions.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px'
            }}>
              <span style={{ fontSize: '20px' }}>
                {CATEGORY_ICONS[discoveryQuestions[currentQAIndex]?.category || ''] || '💬'}
              </span>
              <span style={{
                fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4
              }}>
                Question {currentQAIndex + 1}: {discoveryQuestions[currentQAIndex]?.question || ''}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {(Array.isArray(discoveryQuestions[currentQAIndex]?.choices) ? [...discoveryQuestions[currentQAIndex].choices, 'Other'] : ['Other']).map((choice, cIdx) => {
                const isSelected = selectedChoices[currentQAIndex]?.includes(choice);
                return (
                  <div key={choice} style={{ display: 'flex', flexDirection: 'column' }}>
                    <button
                      onClick={() => {
                        setSelectedChoices(prev => {
                          const newSel = [...prev];
                          const currentSel = newSel[currentQAIndex] || [];
                          if (currentSel.includes(choice)) {
                            newSel[currentQAIndex] = currentSel.filter(c => c !== choice);
                          } else {
                            newSel[currentQAIndex] = [...currentSel, choice];
                          }
                          return newSel;
                        });
                      }}
                      style={{
                        padding: '12px 16px',
                        borderRadius: 'var(--radius-md)',
                        border: isSelected ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-default)',
                        background: isSelected ? 'rgba(99,102,241,0.12)' : 'var(--bg-tertiary)',
                        color: isSelected ? 'var(--accent-secondary)' : 'var(--text-primary)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                      }}
                    >
                      <div style={{
                        width: '18px',
                        height: '18px',
                        borderRadius: '4px',
                        border: '2px solid ' + (isSelected ? 'var(--accent-primary)' : 'var(--text-muted)'),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: isSelected ? 'var(--accent-primary)' : 'transparent',
                        transition: 'all 0.15s ease'
                      }}>
                        {isSelected && <Check size={12} color="white" />}
                      </div>
                      <span style={{ fontSize: '14px', fontWeight: 500 }}>{choice}</span>
                    </button>
                    
                    {choice === 'Other' && isSelected && (
                      <input
                        type="text"
                        placeholder="Type your own answer..."
                        value={otherInputs[currentQAIndex] || ''}
                        onChange={e => {
                          const newOther = [...otherInputs];
                          newOther[currentQAIndex] = e.target.value;
                          setOtherInputs(newOther);
                        }}
                        className="input-field animate-fade-in"
                        style={{
                          marginTop: '10px',
                          fontSize: '14px',
                          padding: '10px 12px',
                          width: '100%',
                          background: 'var(--bg-tertiary)',
                          border: '1px solid var(--border-default)',
                          borderRadius: 'var(--radius-md)',
                          color: 'var(--text-primary)'
                        }}
                        autoFocus
                      />
                    )}
                  </div>
                );
              })}
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: '10px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Question {currentQAIndex + 1} of {discoveryQuestions.length}
              </span>
            </div>
          </div>
        ) : null,
        valid: !fetchingQuestions && discoveryQuestions.length > 0 && 
               ((selectedChoices[currentQAIndex] || []).length > 0) &&
               (!selectedChoices[currentQAIndex]?.includes('Other') || otherInputs[currentQAIndex]?.trim() !== ''),
      },

      // Step 4: Personal Interview → builds a complete user profile
      {
        title: '👤 Tell Us About You',
        subtitle: 'A quick personal interview so The Brain knows who it is working with and tailors everything to you.',
        content: (
          <InterviewFields userProfile={userProfile} updateProfile={updateProfile} toggleInterest={toggleInterest} />
        ),
        valid: userProfile.full_name.trim() !== ''
          && (userProfile.position !== 'Other' || userProfile.position_other.trim() !== ''),
      },

      // Step 5: Social & Web Presence (Optional, compact)
      {
        title: '🌐 Social & Web Presence (Optional)',
        subtitle: 'Connect your online profiles so The Brain can research your brand and market.',
        content: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                  Website
                </label>
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={form.website}
                  onChange={e => updateField('website', e.target.value)}
                  className="input-field"
                  style={{ fontSize: '13px', padding: '10px 12px' }}
                />
              </div>
              <div style={{ width: '120px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                  Founded
                </label>
                <input
                  type="number"
                  placeholder="2024"
                  value={form.founded_year}
                  onChange={e => updateField('founded_year', e.target.value)}
                  className="input-field"
                  style={{ fontSize: '13px', padding: '10px 12px' }}
                  min={1900}
                  max={2030}
                />
              </div>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                LinkedIn Company URL
              </label>
              <input
                type="url"
                placeholder="https://linkedin.com/company/example"
                value={form.linkedin_url}
                onChange={e => updateField('linkedin_url', e.target.value)}
                className="input-field"
                style={{ fontSize: '13px', padding: '10px 12px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                  X (Twitter) URL
                </label>
                <input
                  type="url"
                  placeholder="https://x.com/example"
                  value={form.x_url}
                  onChange={e => updateField('x_url', e.target.value)}
                  className="input-field"
                  style={{ fontSize: '13px', padding: '10px 12px' }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                  Instagram URL
                </label>
                <input
                  type="url"
                  placeholder="https://instagram.com/example"
                  value={form.instagram_url}
                  onChange={e => updateField('instagram_url', e.target.value)}
                  className="input-field"
                  style={{ fontSize: '13px', padding: '10px 12px' }}
                />
              </div>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                TikTok URL
              </label>
              <input
                type="url"
                placeholder="https://tiktok.com/@example"
                value={form.tiktok_url}
                onChange={e => updateField('tiktok_url', e.target.value)}
                className="input-field"
                style={{ fontSize: '13px', padding: '10px 12px' }}
              />
            </div>
          </div>
        ),
        valid: true,
      },

      // Step 5: Launch / Complete
      {
        title: '🎉 Ready to Launch',
        subtitle: 'Everything looks great. The Brain is ready to power your business.',
        content: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Summary card */}
            <div style={{
              padding: '20px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-default)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Brain size={20} color="white" />
                </div>
                <div>
                  <p style={{ fontSize: '16px', fontWeight: 700 }}>{form.company_name}</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {isNewCompany ? '🚀 New Company / Startup' : '🏢 Existing Company'} · {form.industry.slice(0, 3).join(', ')}{form.industry.length > 3 ? '...' : ''}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Who you are (personal interview) */}
                {userProfile.full_name.trim() && (
                  <SummaryRow icon={<User size={14} />} label="You" value={
                    [userProfile.full_name.trim(),
                     userProfile.position === 'Other' ? userProfile.position_other.trim() : userProfile.position]
                      .filter(Boolean).join(' · ')
                  } />
                )}
                {/* Roadmap path (both onboarding types) */}
                {form.roadmap_type && (
                  <SummaryRow icon={<TrendingUp size={14} />} label="Roadmap" value={
                    ROADMAP_TYPES.find(t => t.id === form.roadmap_type)?.label || form.roadmap_type
                  } />
                )}
                {/* Path-specific summary */}
                {isNewCompany ? (
                  <>
                    {form.company_stage && (
                      <SummaryRow icon={<TrendingUp size={14} />} label="Stage" value={
                        COMPANY_STAGES.find(s => s.id === form.company_stage)?.label || form.company_stage
                      } />
                    )}
                    {form.mission_vision && (
                      <SummaryRow icon={<Target size={14} />} label="Mission" value={form.mission_vision} />
                    )}
                    {form.target_customer && (
                      <SummaryRow icon={<Users size={14} />} label="Target" value={form.target_customer} />
                    )}
                  </>
                ) : (
                  <>
                    {form.location && (
                      <SummaryRow icon={<MapPin size={14} />} label="Location" value={form.location} />
                    )}
                    {form.employee_count && (
                      <SummaryRow icon={<Users size={14} />} label="Size" value={form.employee_count} />
                    )}
                    {form.pain_points && (
                      <SummaryRow icon={<Search size={14} />} label="Challenges" value={form.pain_points} />
                    )}
                  </>
                )}

                {/* Discovery Q&A count */}
                {discoveryQuestions.length > 0 && selectedChoices.some(choices => choices.length > 0) && (
                  <SummaryRow
                    icon={<Lightbulb size={14} />}
                    label="Discovery"
                    value={`${selectedChoices.filter((choices, idx) => choices.length > 0 && (!choices.includes('Other') || otherInputs[idx]?.trim() !== '')).length}/${discoveryQuestions.length} questions answered`}
                  />
                )}
              </div>
            </div>

            {/* What happens next */}
            <div style={{
              padding: '16px 20px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(99,102,241,0.06)',
              border: '1px solid rgba(99,102,241,0.12)',
            }}>
              <p style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                ✨ What happens next?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {[
                  'The Brain ingests your company profile into its memory',
                  'Your dashboard is personalized for your business',
                  '10 specialist agents launch automatically — Finance, People, HR, Investment, CRM, Marketing, Sales, Product, Roadmap, and Meeting',
                  'Each agent asks you initial questions, then runs research and analysis in parallel',
                  'Start a conversation — ask anything about your company, decisions, or strategy',
                  'Review agent findings and approve outputs in the Decisions tab',
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--accent-primary)', flexShrink: 0 }}>→</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ),
        valid: true,
      },
    ];

    const currentStep = stepConfigs[step - 1];

    return (
      <div style={{ width: '100%', maxWidth: '640px', padding: '40px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }} className="animate-fade-in">
          <div style={{
            width: '48px', height: '48px', borderRadius: 'var(--radius-lg)',
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 12px',
          }}>
            <Brain size={24} color="white" />
          </div>

          {/* Path indicator */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '4px 12px', borderRadius: 'var(--radius-full)',
            background: isNewCompany ? 'rgba(99,102,241,0.08)' : 'rgba(52,211,153,0.08)',
            border: '1px solid ' + (isNewCompany ? 'rgba(99,102,241,0.15)' : 'rgba(52,211,153,0.15)'),
            fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)',
            marginBottom: '8px',
          }}>
            {isNewCompany ? '🚀 Starting New Company' : '🏢 Existing Company'}
            <button
              onClick={() => { setOnboardingType(null); setStep(0); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: '12px', padding: '0 2px',
              }}
              title="Change path"
            >
              ✕
            </button>
          </div>

          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Step {step} of {totalSteps - 1} {step === 3 ? `(Question ${currentQAIndex + 1}/3)` : ''}
          </p>
        </div>

        {/* Progress bar */}
        <div style={{
          width: '100%', height: '3px',
          background: 'var(--bg-tertiary)',
          borderRadius: 'var(--radius-full)',
          marginBottom: '28px',
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${progress}%`,
            height: '100%',
            background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-cyan))',
            borderRadius: 'var(--radius-full)',
            transition: 'width 0.4s ease',
          }} />
        </div>

        {/* Step content */}
        <div className="glass-card animate-fade-in" style={{ padding: '28px', marginBottom: '20px' }} key={step}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '6px', letterSpacing: '-0.01em' }}>
            {currentStep.title}
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '20px' }}>
            {currentStep.subtitle}
          </p>
          {currentStep.content}
        </div>

        {/* Navigation */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between' }}>
          <button
            onClick={() => {
              if (step === 3 && currentQAIndex > 0) {
                setCurrentQAIndex(prev => prev - 1);
              } else if (step === 1) {
                setOnboardingType(null);
                setStep(0);
              } else {
                setStep(s => s - 1);
              }
            }}
            className="btn-ghost"
            style={{ flex: 1, padding: '12px' }}
          >
            <ArrowLeft size={16} /> Back
          </button>

          {(step - 1) === stepConfigs.length - 1 ? (
            <button
              onClick={handleComplete}
              disabled={loading || !currentStep.valid}
              className="btn-primary"
              style={{ flex: 2, padding: '12px', fontSize: '15px' }}
            >
              {loading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Sparkles size={18} />
              )}
              {loading ? 'Setting up The Brain...' : '🚀 Launch The Brain'}
            </button>
          ) : (
            <button
              onClick={handleNext}
              disabled={!currentStep.valid || fetchingQuestions}
              className="btn-primary"
              style={{ flex: 2, padding: '12px', fontSize: '15px' }}
            >
              {fetchingQuestions ? (
                <Loader2 size={18} className="animate-spin" />
              ) : null}
              {step === 2 
                ? (fetchingQuestions ? 'Generating...' : 'Generate Questions →') 
                : (step === 3 && currentQAIndex < discoveryQuestions.length - 1 ? 'Next Question →' : 'Continue →')}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Ambient glow */}
      <div style={{
        position: 'absolute', top: '-20%', right: '-10%',
        width: '500px', height: '500px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '-20%', left: '-10%',
        width: '400px', height: '400px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(6,182,212,0.04) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.9; }
        }
        @keyframes ping {
          0% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.15); opacity: 0.1; }
          100% { transform: scale(1.2); opacity: 0; }
        }
      `}</style>

      {renderStep()}
    </div>
  );
}

// ─── Helper Component ───
function SummaryRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px' }}>
      <span style={{ color: 'var(--accent-primary)', flexShrink: 0, marginTop: '1px' }}>
        {icon}
      </span>
      <span style={{ color: 'var(--text-muted)', flexShrink: 0, width: '80px' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

// ─── Personal Interview fields (shared by the wizard step and the join flow) ───
interface InterviewFieldsProps {
  userProfile: { full_name: string; position: string; position_other: string; experience: string; background: string; work_style: string; interests: string[]; bio: string };
  updateProfile: (field: string, value: any) => void;
  toggleInterest: (area: string) => void;
}
function InterviewFields({ userProfile, updateProfile, toggleInterest }: InterviewFieldsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Name */}
      <div>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
          <User size={12} style={{ display: 'inline', marginRight: '4px' }} />
          What's your name?
        </label>
        <input
          type="text"
          placeholder="e.g. Kareem Helal"
          value={userProfile.full_name}
          onChange={e => updateProfile('full_name', e.target.value)}
          className="input-field"
          style={{ fontSize: '14px', padding: '12px 14px' }}
          autoFocus
        />
      </div>

      {/* Position */}
      <div>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>
          <Briefcase size={12} style={{ display: 'inline', marginRight: '4px' }} />
          What's your role in the company?
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {USER_POSITIONS.map(p => (
            <button
              key={p}
              onClick={() => updateProfile('position', p)}
              style={{
                padding: '8px 16px', borderRadius: 'var(--radius-full)',
                border: userProfile.position === p ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-default)',
                background: userProfile.position === p ? 'rgba(99,102,241,0.12)' : 'var(--bg-tertiary)',
                color: userProfile.position === p ? 'var(--accent-secondary)' : 'var(--text-secondary)',
                fontSize: '13px', fontWeight: userProfile.position === p ? 600 : 400,
                cursor: 'pointer', transition: 'all 0.15s ease',
              }}
            >
              {userProfile.position === p && <Check size={12} style={{ marginRight: '4px' }} />}
              {p}
            </button>
          ))}
        </div>
        {userProfile.position === 'Other' && (
          <input
            type="text"
            placeholder="Your role / title..."
            value={userProfile.position_other}
            onChange={e => updateProfile('position_other', e.target.value)}
            className="input-field animate-fade-in"
            style={{ fontSize: '14px', padding: '10px 12px', marginTop: '10px' }}
            autoFocus
          />
        )}
      </div>

      {/* Experience */}
      <div>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>
          <Award size={12} style={{ display: 'inline', marginRight: '4px' }} />
          How much experience do you have?
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {EXPERIENCE_LEVELS.map(e => (
            <button
              key={e.id}
              onClick={() => updateProfile('experience', e.label)}
              style={{
                padding: '12px 16px', borderRadius: 'var(--radius-md)',
                border: userProfile.experience === e.label ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-default)',
                background: userProfile.experience === e.label ? 'rgba(99,102,241,0.08)' : 'var(--bg-tertiary)',
                color: userProfile.experience === e.label ? 'var(--accent-secondary)' : 'var(--text-primary)',
                cursor: 'pointer', transition: 'all 0.15s ease', textAlign: 'left',
                display: 'flex', flexDirection: 'column', gap: '2px',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: '14px' }}>{e.label}</span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{e.desc}</span>
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Optional: a line about your background (e.g. ex-Google PM, 2nd-time founder)"
          value={userProfile.background}
          onChange={e => updateProfile('background', e.target.value)}
          className="input-field"
          style={{ fontSize: '13px', padding: '10px 12px', marginTop: '10px' }}
        />
      </div>

      {/* Interests */}
      <div>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>
          <Heart size={12} style={{ display: 'inline', marginRight: '4px' }} />
          What are you most interested in? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(pick any)</span>
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {INTEREST_AREAS.map(area => {
            const sel = userProfile.interests.includes(area);
            return (
              <button
                key={area}
                onClick={() => toggleInterest(area)}
                style={{
                  padding: '8px 16px', borderRadius: 'var(--radius-full)',
                  border: sel ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-default)',
                  background: sel ? 'rgba(99,102,241,0.12)' : 'var(--bg-tertiary)',
                  color: sel ? 'var(--accent-secondary)' : 'var(--text-secondary)',
                  fontSize: '13px', fontWeight: sel ? 600 : 400,
                  cursor: 'pointer', transition: 'all 0.15s ease',
                }}
              >
                {sel && <Check size={12} style={{ marginRight: '4px' }} />}
                {area}
              </button>
            );
          })}
        </div>
      </div>

      {/* Work style */}
      <div>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>
          <Workflow size={12} style={{ display: 'inline', marginRight: '4px' }} />
          How would you describe the way you work?
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {WORK_STYLES.map(w => (
            <button
              key={w.id}
              onClick={() => updateProfile('work_style', w.label)}
              style={{
                padding: '12px 16px', borderRadius: 'var(--radius-md)',
                border: userProfile.work_style === w.label ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-default)',
                background: userProfile.work_style === w.label ? 'rgba(99,102,241,0.08)' : 'var(--bg-tertiary)',
                color: userProfile.work_style === w.label ? 'var(--accent-secondary)' : 'var(--text-primary)',
                cursor: 'pointer', transition: 'all 0.15s ease', textAlign: 'left',
                display: 'flex', flexDirection: 'column', gap: '2px',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: '14px' }}>{w.label}</span>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{w.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Bio / anything else */}
      <div>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
          <Sparkles size={12} style={{ display: 'inline', marginRight: '4px' }} />
          Anything else The Brain should know about you? <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
        </label>
        <textarea
          placeholder="e.g. I prefer concise, direct answers; I focus on growth and fundraising; I'm strongest at product but weakest at finance..."
          value={userProfile.bio}
          onChange={e => updateProfile('bio', e.target.value)}
          className="input-field"
          rows={2}
          style={{ fontSize: '14px', padding: '12px 14px', resize: 'vertical', minHeight: '60px', fontFamily: 'inherit' }}
        />
      </div>
    </div>
  );
}
