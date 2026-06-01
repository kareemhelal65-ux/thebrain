'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../layout';
import { apiRequest } from '@/lib/api';
import { Settings, Link, CheckCircle, XCircle, ExternalLink, Loader2, User, Save, Check, Cpu, Zap, AlertCircle } from 'lucide-react';

const LLM_PROVIDER_OPTIONS = [
  { id: 'openai', label: 'OpenAI', modelHint: 'e.g. gpt-4o, gpt-4.1' },
  { id: 'anthropic', label: 'Anthropic (Claude)', modelHint: 'e.g. claude-sonnet-4' },
  { id: 'openrouter', label: 'OpenRouter', modelHint: 'e.g. anthropic/claude-sonnet-4' },
  { id: 'gemini', label: 'Google Gemini', modelHint: 'e.g. gemini-2.5-pro' },
  { id: 'agentrouter', label: 'Agent Router (custom URL)', modelHint: 'model id from your gateway' },
];

const availableIntegrations = [
  { id: 'google workspace', name: 'Google Workspace', desc: 'Meet, Drive, Calendar', icon: '🔵', canConnect: true },
  { id: 'slack', name: 'Slack', desc: 'Messages & channels', icon: '💬', canConnect: true },
  { id: 'discord', name: 'Discord', desc: 'Community feedback', icon: '👾', canConnect: true },
  { id: 'groq llm', name: 'Groq LLM', desc: 'Llama 3.3 70B', icon: '🧠', canConnect: false },
  { id: 'supabase', name: 'Supabase', desc: 'Database & auth', icon: '⚡', canConnect: false },
];

// Personal-interview option sets (kept in sync with the onboarding wizard).
const EXPERIENCE_OPTIONS = ['Just starting out', '1–3 years', '3–7 years', '7–15 years', '15+ years'];
const WORK_STYLE_OPTIONS = ['🧭 Big-picture strategist', '🛠️ Hands-on builder', '📊 Data-driven', '🤝 People-first', '⚡ Fast & scrappy', '🔍 Methodical & detailed'];
const INTEREST_OPTIONS = ['Product', 'Engineering', 'Growth & Marketing', 'Sales', 'Fundraising', 'Operations', 'Design / UX', 'Data & Analytics', 'People & Culture', 'Strategy', 'Finance'];

const EMPTY_PROFILE = {
  full_name: '', position: '', experience: '', background: '',
  work_style: '', interests: [] as string[], bio: '',
};

export default function SettingsPage() {
  const { token } = useAuth();
  const [statuses, setStatuses] = useState<Record<string, boolean>>({
    'groq llm': true,
    'supabase': true,
  });
  const [loading, setLoading] = useState<string | null>(null);

  // ─── Personal profile (from the onboarding interview) ───
  const [profile, setProfile] = useState({ ...EMPTY_PROFILE });
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileSummary, setProfileSummary] = useState<string | null>(null);

  // ─── Agent chat model (separate from Groq, used for agent chat/work) ───
  const [llm, setLlm] = useState({ provider: '', model: '', base_url: '', api_key: '' });
  const [llmHasKey, setLlmHasKey] = useState(false);
  const [llmActive, setLlmActive] = useState(true);
  const [llmLoading, setLlmLoading] = useState(true);
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmSaved, setLlmSaved] = useState(false);
  const [llmTest, setLlmTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'fail'; msg?: string }>({ state: 'idle' });

  useEffect(() => {
    if (token) { loadStatuses(); loadProfile(); loadLlmConfig(); }
  }, [token]);

  const loadProfile = async () => {
    setProfileLoading(true);
    try {
      const data = await apiRequest('/api/onboarding/user-profile', {}, token!);
      const p = data?.profile;
      if (p) {
        setProfile({
          full_name: p.full_name || '',
          position: p.position || '',
          experience: p.experience || '',
          background: p.background || '',
          work_style: p.work_style || '',
          interests: Array.isArray(p.interests) ? p.interests : [],
          bio: p.bio || '',
        });
        setProfileSummary(p.profile_summary || null);
      }
    } catch (err) {
      console.error('Failed to load profile', err);
    } finally {
      setProfileLoading(false);
    }
  };

  const updateProfile = (field: string, value: any) =>
    setProfile(prev => ({ ...prev, [field]: value }));

  const toggleInterest = (area: string) =>
    setProfile(prev => ({
      ...prev,
      interests: prev.interests.includes(area)
        ? prev.interests.filter(i => i !== area)
        : [...prev.interests, area],
    }));

  const saveProfile = async () => {
    setProfileSaving(true);
    setProfileSaved(false);
    try {
      const data = await apiRequest('/api/onboarding/user-profile', {
        method: 'PUT',
        body: JSON.stringify({ user_profile: profile }),
      }, token!);
      if (data?.profile_summary) setProfileSummary(data.profile_summary);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch (err) {
      console.error('Failed to save profile', err);
      alert('Could not save your profile. Please try again.');
    } finally {
      setProfileSaving(false);
    }
  };

  const loadLlmConfig = async () => {
    setLlmLoading(true);
    try {
      const data = await apiRequest('/api/settings/llm-config', {}, token!);
      const c = data?.config;
      if (c) {
        setLlm({ provider: c.provider || '', model: c.model || '', base_url: c.base_url || '', api_key: '' });
        setLlmHasKey(!!c.has_key);
        setLlmActive(c.is_active !== false);
      }
    } catch (err) {
      console.error('Failed to load model config', err);
    } finally {
      setLlmLoading(false);
    }
  };

  const saveLlm = async () => {
    setLlmSaving(true); setLlmSaved(false); setLlmTest({ state: 'idle' });
    try {
      const body: any = { provider: llm.provider, model: llm.model, base_url: llm.base_url, is_active: llmActive };
      if (llm.api_key.trim()) body.api_key = llm.api_key.trim();
      await apiRequest('/api/settings/llm-config', { method: 'PUT', body: JSON.stringify(body) }, token!);
      if (llm.api_key.trim()) setLlmHasKey(true);
      setLlm(p => ({ ...p, api_key: '' }));
      setLlmSaved(true); setTimeout(() => setLlmSaved(false), 2500);
    } catch (err) {
      alert('Could not save the model configuration. Please try again.');
    } finally {
      setLlmSaving(false);
    }
  };

  const testLlm = async () => {
    setLlmTest({ state: 'testing' });
    try {
      const body: any = { provider: llm.provider, model: llm.model, base_url: llm.base_url };
      if (llm.api_key.trim()) body.api_key = llm.api_key.trim();
      const data = await apiRequest('/api/settings/llm-config/test', { method: 'POST', body: JSON.stringify(body) }, token!);
      setLlmTest(data.ok ? { state: 'ok', msg: data.sample } : { state: 'fail', msg: data.error });
    } catch (err: any) {
      setLlmTest({ state: 'fail', msg: err?.message || 'Test failed.' });
    }
  };

  const loadStatuses = async () => {
    try {
      const data = await apiRequest('/api/integrations/status', {}, token!);
      if (data.integrations) {
        const newStatuses = { ...statuses };
        for (const [key, val] of Object.entries(data.integrations)) {
          newStatuses[key] = (val as any).connected;
        }
        setStatuses(newStatuses);
      }
    } catch (err) {
      console.error('Failed to load integration status', err);
    }
  };

  const handleConnect = async (id: string) => {
    setLoading(id);
    try {
      // Simulate OAuth flow delay
      await new Promise(r => setTimeout(r, 1500));
      await apiRequest(`/api/integrations/connect/${encodeURIComponent(id)}`, { method: 'POST' }, token!);
      await loadStatuses();
    } catch (err) {
      console.error(`Failed to connect ${id}`, err);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div style={{ padding: '32px', maxWidth: '700px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '8px' }}>Settings</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '32px' }}>
        Manage your integrations and workspace configuration.
      </p>

      {/* ─── Your Profile (personal interview) ─── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <User size={16} /> Your Profile
        </h2>
        <button
          onClick={() => { setProfile({ ...EMPTY_PROFILE }); setProfileSummary(null); }}
          className="btn-ghost"
          style={{ fontSize: '12px', padding: '6px 12px' }}
          title="Clear all answers and redo the interview from scratch"
        >
          Redo interview
        </button>
      </div>

      <div className="glass-card" style={{ padding: '20px', marginBottom: '32px' }}>
        {profileLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
            <Loader2 size={14} className="animate-spin" /> Loading your profile...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* AI summary */}
            {profileSummary && (
              <div style={{
                padding: '12px 14px', borderRadius: 'var(--radius-md)',
                background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.12)',
                fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5,
              }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>How The Brain sees you: </span>
                {profileSummary}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>Name</label>
                <input type="text" value={profile.full_name} onChange={e => updateProfile('full_name', e.target.value)}
                  placeholder="Your name" className="input-field" style={{ fontSize: '13px', padding: '10px 12px' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>Role / Position</label>
                <input type="text" value={profile.position} onChange={e => updateProfile('position', e.target.value)}
                  placeholder="e.g. Founder & CEO" className="input-field" style={{ fontSize: '13px', padding: '10px 12px' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>Experience</label>
                <select value={profile.experience} onChange={e => updateProfile('experience', e.target.value)}
                  className="input-field" style={{ fontSize: '13px', padding: '10px 12px' }}>
                  <option value="">Select...</option>
                  {EXPERIENCE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>Work style</label>
                <select value={profile.work_style} onChange={e => updateProfile('work_style', e.target.value)}
                  className="input-field" style={{ fontSize: '13px', padding: '10px 12px' }}>
                  <option value="">Select...</option>
                  {WORK_STYLE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>Interests</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {INTEREST_OPTIONS.map(area => {
                  const sel = profile.interests.includes(area);
                  return (
                    <button key={area} onClick={() => toggleInterest(area)} style={{
                      padding: '7px 14px', borderRadius: 'var(--radius-full)',
                      border: sel ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-default)',
                      background: sel ? 'rgba(99,102,241,0.12)' : 'var(--bg-tertiary)',
                      color: sel ? 'var(--accent-secondary)' : 'var(--text-secondary)',
                      fontSize: '12px', fontWeight: sel ? 600 : 400, cursor: 'pointer', transition: 'all 0.15s ease',
                    }}>
                      {sel && <Check size={11} style={{ marginRight: '4px' }} />}{area}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>Background</label>
              <input type="text" value={profile.background} onChange={e => updateProfile('background', e.target.value)}
                placeholder="e.g. ex-Google PM, 2nd-time founder" className="input-field" style={{ fontSize: '13px', padding: '10px 12px' }} />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>Anything else The Brain should know</label>
              <textarea value={profile.bio} onChange={e => updateProfile('bio', e.target.value)} rows={2}
                placeholder="How you like to work, strengths, what you focus on..." className="input-field"
                style={{ fontSize: '13px', padding: '10px 12px', resize: 'vertical', minHeight: '54px', fontFamily: 'inherit' }} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={saveProfile} disabled={profileSaving || !profile.full_name.trim()}
                className="btn-primary" style={{ fontSize: '13px', padding: '9px 18px' }}>
                {profileSaving ? <Loader2 size={14} className="animate-spin" /> : profileSaved ? <Check size={14} /> : <Save size={14} />}
                {profileSaving ? 'Saving...' : profileSaved ? 'Saved' : 'Save Profile'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ─── Agent Chat Model ─── */}
      <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Cpu size={16} style={{ color: 'var(--accent-primary)' }} /> Agent Chat Model
      </h2>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
        Choose the model your agents use for chatting, producing deliverables, and executing tasks.
        The rest of The Brain (search, transcription, classification) always runs on Groq.
        Leave this empty to use the built-in Groq model.
      </p>

      <div className="glass-card" style={{ padding: '20px', marginBottom: '32px' }}>
        {llmLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>Provider</label>
                <select
                  value={llm.provider}
                  onChange={e => { setLlm(p => ({ ...p, provider: e.target.value })); setLlmTest({ state: 'idle' }); }}
                  className="input-field" style={{ fontSize: '13px', padding: '10px 12px' }}
                >
                  <option value="">Groq (default)</option>
                  {LLM_PROVIDER_OPTIONS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>Model</label>
                <input
                  type="text" value={llm.model}
                  onChange={e => { setLlm(p => ({ ...p, model: e.target.value })); setLlmTest({ state: 'idle' }); }}
                  placeholder={LLM_PROVIDER_OPTIONS.find(p => p.id === llm.provider)?.modelHint || 'model name'}
                  className="input-field" style={{ fontSize: '13px', padding: '10px 12px' }}
                  disabled={!llm.provider}
                />
              </div>
            </div>

            {llm.provider === 'agentrouter' && (
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>Base URL (OpenAI-compatible)</label>
                <input
                  type="url" value={llm.base_url}
                  onChange={e => { setLlm(p => ({ ...p, base_url: e.target.value })); setLlmTest({ state: 'idle' }); }}
                  placeholder="https://your-gateway.example.com/v1"
                  className="input-field" style={{ fontSize: '13px', padding: '10px 12px' }}
                />
              </div>
            )}

            {llm.provider && (
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: 'var(--text-secondary)' }}>
                  API Key {llmHasKey && <span style={{ color: 'var(--accent-emerald)', fontWeight: 500 }}>· saved (leave blank to keep)</span>}
                </label>
                <input
                  type="password" value={llm.api_key}
                  onChange={e => { setLlm(p => ({ ...p, api_key: e.target.value })); setLlmTest({ state: 'idle' }); }}
                  placeholder={llmHasKey ? '••••••••••••  (stored securely)' : 'Paste your API key'}
                  className="input-field" style={{ fontSize: '13px', padding: '10px 12px' }}
                  autoComplete="off"
                />
              </div>
            )}

            {llm.provider && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <input type="checkbox" checked={llmActive} onChange={e => setLlmActive(e.target.checked)} />
                Use this model for agents (uncheck to temporarily fall back to Groq)
              </label>
            )}

            {/* Test result */}
            {llmTest.state === 'ok' && (
              <div style={{ fontSize: '12px', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle size={13} /> Connection works{llmTest.msg ? ` — model replied “${llmTest.msg}”` : ''}.
              </div>
            )}
            {llmTest.state === 'fail' && (
              <div style={{ fontSize: '12px', color: 'var(--accent-rose)', display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                <AlertCircle size={13} style={{ flexShrink: 0, marginTop: '1px' }} /> {llmTest.msg || 'Connection failed.'}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={testLlm}
                disabled={llmTest.state === 'testing' || !llm.provider || !llm.model || (!llmHasKey && !llm.api_key.trim())}
                className="btn-ghost" style={{ fontSize: '13px', padding: '9px 16px' }}
              >
                {llmTest.state === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                Test
              </button>
              <button
                onClick={saveLlm}
                disabled={llmSaving || (!!llm.provider && (!llm.model || (!llmHasKey && !llm.api_key.trim()) || (llm.provider === 'agentrouter' && !llm.base_url.trim())))}
                className="btn-primary" style={{ fontSize: '13px', padding: '9px 18px' }}
              >
                {llmSaving ? <Loader2 size={14} className="animate-spin" /> : llmSaved ? <Check size={14} /> : <Save size={14} />}
                {llmSaving ? 'Saving…' : llmSaved ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>Integrations</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '32px' }}>
        {availableIntegrations.map(int => {
          const isConnected = statuses[int.id];
          const isLoading = loading === int.id;

          return (
            <div key={int.id} className="glass-card" style={{
              display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 20px',
            }}>
              <span style={{ fontSize: '24px' }}>{int.icon}</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '14px', fontWeight: 600 }}>{int.name}</p>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{int.desc}</p>
              </div>
              {isConnected ? (
                <span className="badge badge-success"><CheckCircle size={10} /> Connected</span>
              ) : int.canConnect ? (
                <button
                  onClick={() => handleConnect(int.id)}
                  disabled={isLoading}
                  className="btn-ghost"
                  style={{ fontSize: '12px', padding: '6px 14px', width: '90px', justifyContent: 'center' }}
                >
                  {isLoading ? <Loader2 size={12} className="animate-spin" /> : <><Link size={12} /> Connect</>}
                </button>
              ) : (
                <span className="badge badge-default">System</span>
              )}
            </div>
          );
        })}
      </div>

      <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>Environment</h2>
      <div className="glass-card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Vector Store</span>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>Supabase pgvector (Free)</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>LLM Provider</span>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>Groq (Llama 3.3 70B)</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Embeddings</span>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>all-MiniLM-L6-v2 (Local)</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Hosting</span>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>Vercel + Railway</span>
        </div>
      </div>
    </div>
  );
}
