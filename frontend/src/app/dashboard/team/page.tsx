'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../layout';
import { apiRequest } from '@/lib/api';
import {
  Users, Loader2, Shield, Copy, Check, KeyRound, Briefcase,
  UploadCloud, Trash2, RefreshCw, FileText, Sparkles
} from 'lucide-react';

interface Member {
  user_id: string;
  email: string | null;
  role: string | null;
  department: string | null;
  full_name: string | null;
  position: string | null;
  experience: string | null;
  work_style: string | null;
  interests: string[];
  is_you: boolean;
}

interface Evaluation {
  user_id: string;
  company_id: string;
  ai_strength: string | null;
  performance_score: number | null;
  evaluation_notes: string | null;
  updated_at: string | null;
}

interface Candidate {
  id: string;
  company_id: string;
  name: string | null;
  email: string | null;
  role_applied: string | null;
  fit_score: number | null;
  impact_verdict: string | null;
  skills: string[] | null;
  created_at: string;
}

export default function TeamPage() {
  const { token } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [yourRole, setYourRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const isAdmin = yourRole === 'Admin';

  // D3 States
  const [evaluations, setEvaluations] = useState<Record<string, Evaluation>>({});
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [uploadingCandidate, setUploadingCandidate] = useState(false);
  const [refreshingMember, setRefreshingMember] = useState<Record<string, boolean>>({});
  const candidateFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (token) {
      load();
      loadEvaluations();
      loadCandidates();
    }
  }, [token]);

  const load = async () => {
    try {
      const data = await apiRequest('/api/team', {}, token!);
      setMembers(data.members || []);
      setJoinCode(data.company?.join_code || null);
      setCompanyName(data.company?.name || null);
      setYourRole(data.your_role || null);
    } catch (err) {
      console.error('Failed to load team', err);
    } finally {
      setLoading(false);
    }
  };

  const loadEvaluations = async () => {
    try {
      const data = await apiRequest('/api/team/evaluations', {}, token!);
      const evalMap: Record<string, Evaluation> = {};
      if (data.evaluations) {
        data.evaluations.forEach((e: Evaluation) => {
          evalMap[e.user_id] = e;
        });
      }
      setEvaluations(evalMap);
    } catch (err) {
      console.error('Failed to load team evaluations', err);
    }
  };

  const loadCandidates = async () => {
    setLoadingCandidates(true);
    try {
      const data = await apiRequest('/api/team/candidates', {}, token!);
      setCandidates(data.candidates || []);
    } catch (err) {
      console.error('Failed to load candidates', err);
    } finally {
      setLoadingCandidates(false);
    }
  };

  const refreshEvaluation = async (userId: string) => {
    setRefreshingMember(prev => ({ ...prev, [userId]: true }));
    try {
      const data = await apiRequest(`/api/team/evaluations/${userId}/refresh`, {
        method: 'POST'
      }, token!);
      if (data.evaluation) {
        setEvaluations(prev => ({ ...prev, [userId]: data.evaluation }));
      }
    } catch (err) {
      console.error('Failed to refresh evaluation', err);
      alert('Could not update AI evaluation. Please try again.');
    } finally {
      setRefreshingMember(prev => ({ ...prev, [userId]: false }));
    }
  };

  const handleCandidateUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    setUploadingCandidate(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/team/candidates/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        throw new Error('Upload failed');
      }

      const data = await res.json();
      if (data.candidate) {
        setCandidates(prev => [data.candidate, ...prev]);
      }
    } catch (err) {
      console.error('Candidate upload failed', err);
      alert('Failed to process and evaluate candidate CV.');
    } finally {
      setUploadingCandidate(false);
    }
  };

  const deleteCandidate = async (candidateId: string) => {
    if (!confirm('Are you sure you want to remove this candidate?')) return;
    try {
      await apiRequest(`/api/team/candidates/${candidateId}`, {
        method: 'DELETE'
      }, token!);
      setCandidates(prev => prev.filter(c => c.id !== candidateId));
    } catch (err) {
      console.error('Failed to delete candidate', err);
      alert('Could not delete candidate.');
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 8) return { bg: 'rgba(52,211,153,0.12)', text: 'var(--accent-emerald)', border: 'rgba(52,211,153,0.2)' };
    if (score >= 5) return { bg: 'rgba(251,191,36,0.12)', text: 'var(--accent-amber)', border: 'rgba(251,191,36,0.2)' };
    return { bg: 'rgba(244,63,94,0.12)', text: 'var(--accent-rose)', border: 'rgba(244,63,94,0.2)' };
  };

  const changeRole = async (userId: string, role: string) => {
    setSavingRole(userId);
    setRoleError(null);
    // optimistic update
    setMembers(prev => prev.map(m => (m.user_id === userId ? { ...m, role } : m)));
    try {
      await apiRequest(`/api/team/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      }, token!);
    } catch (err: any) {
      setRoleError(err?.message || 'Could not update role.');
      await load(); // revert to server truth
    } finally {
      setSavingRole(null);
    }
  };

  const copyCode = async () => {
    if (!joinCode) return;
    try {
      await navigator.clipboard.writeText(joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard may be blocked */ }
  };

  const roleBadge = (role: string | null, isYou: boolean) => {
    const r = (role || 'Member');
    const cls = r === 'Admin' ? 'badge-success' : r === 'Manager' ? 'badge-info' : 'badge-default';
    return <span className={`badge ${cls}`}><Shield size={10} /> {r}{isYou ? ' · You' : ''}</span>;
  };

  const initials = (m: Member) =>
    (m.full_name || m.email || '?').trim().charAt(0).toUpperCase();

  return (
    <div style={{ padding: '32px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '8px' }}>Team & Talent</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '28px' }}>
        Manage your current team members and evaluate prospective candidates. The Brain analyzes onboarding data for team members and parsed CVs for candidates to evaluate organizational fit.
      </p>

      {/* Invite via join code */}
      <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <KeyRound size={16} style={{ color: 'var(--accent-primary)' }} />
          Your company join code
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Share this code. Teammates pick <strong>“Joining your team’s company”</strong> on the
          welcome screen and enter it to join {companyName || 'your company'}.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            flex: 1, padding: '14px 18px', borderRadius: 'var(--radius-md)',
            background: 'var(--bg-tertiary)', border: '1px dashed var(--border-default)',
            fontSize: '26px', fontWeight: 800, letterSpacing: '0.22em', textAlign: 'center',
            color: 'var(--text-primary)',
          }}>
            {loading ? <Loader2 size={20} className="animate-spin" /> : (joinCode || '——————')}
          </div>
          <button onClick={copyCode} disabled={!joinCode} className="btn-primary" style={{ padding: '12px 18px', whiteSpace: 'nowrap' }}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Roster */}
      <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Users size={16} style={{ color: 'var(--accent-primary)' }} />
        Members {members.length > 0 && <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>({members.length})</span>}
      </h3>

      {loading ? (
        <div style={{ padding: '24px', textAlign: 'center' }}>
          <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent-primary)', margin: '0 auto' }} />
        </div>
      ) : members.length === 0 ? (
        <div className="glass-card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          No members yet. Share your code above to bring your team in.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {members.map(m => (
            <div key={m.user_id} className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'stretch' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: 'var(--radius-full)', flexShrink: 0,
                  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '15px', fontWeight: 700, color: 'white',
                }}>
                  {initials(m)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '14px', fontWeight: 600 }}>
                    {m.full_name || m.email || 'Unnamed member'}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
                    {m.position && (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Briefcase size={11} /> {m.position}
                      </span>
                    )}
                    {m.email && m.full_name && (
                      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{m.email}</span>
                    )}
                    {m.department && m.department !== 'general' && (
                      <span className="badge badge-default" style={{ fontSize: '10px', textTransform: 'capitalize' }}>{m.department}</span>
                    )}
                  </div>
                </div>
                {isAdmin ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {savingRole === m.user_id && <Loader2 size={12} className="animate-spin" style={{ color: 'var(--text-muted)' }} />}
                    <select
                      value={m.role || 'Employee'}
                      onChange={e => changeRole(m.user_id, e.target.value)}
                      disabled={savingRole === m.user_id}
                      style={{
                        background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                        borderRadius: '6px', color: 'var(--text-primary)', fontSize: '12px',
                        fontWeight: 600, padding: '6px 10px', cursor: 'pointer', outline: 'none',
                      }}
                    >
                      <option value="Admin">Admin</option>
                      <option value="Manager">Manager</option>
                      <option value="Employee">Employee</option>
                    </select>
                  </div>
                ) : (
                  roleBadge(m.role, m.is_you)
                )}
              </div>

              {/* AI Insights block */}
              {evaluations[m.user_id] && (
                <div style={{
                  marginTop: '6px',
                  padding: '14px 16px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '13px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                      <Sparkles size={14} />
                      AI Strengths Analysis
                    </div>
                    <button
                      onClick={() => refreshEvaluation(m.user_id)}
                      disabled={refreshingMember[m.user_id]}
                      style={{
                        background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', outline: 'none'
                      }}
                    >
                      <RefreshCw size={12} className={refreshingMember[m.user_id] ? 'animate-spin' : ''} />
                      {refreshingMember[m.user_id] ? 'Re-evaluating...' : 'Refresh'}
                    </button>
                  </div>
                  
                  <p style={{ color: 'var(--text-primary)', margin: 0, fontStyle: 'italic', lineHeight: '1.4' }}>
                    &ldquo;{evaluations[m.user_id].ai_strength}&rdquo;
                  </p>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)' }}>Capability Score:</span>
                    <div style={{ flex: 1, height: '6px', background: 'var(--bg-tertiary)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{
                        width: `${(evaluations[m.user_id].performance_score || 5) * 10}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-cyan))',
                      }} />
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {evaluations[m.user_id].performance_score || 5}/10
                    </span>
                  </div>

                  {evaluations[m.user_id].evaluation_notes && (
                    <div style={{
                      marginTop: '2px',
                      paddingTop: '8px',
                      borderTop: '1px solid rgba(255,255,255,0.05)',
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      lineHeight: '1.4'
                    }}>
                      <strong>Growth & Collaboration:</strong> {evaluations[m.user_id].evaluation_notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {roleError && (
        <p style={{ fontSize: '12px', color: 'var(--accent-rose)', marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Shield size={12} /> {roleError}
        </p>
      )}

      {/* Divider */}
      <hr style={{ border: 'none', height: '1px', background: 'var(--border-default)', margin: '36px 0 28px' }} />

      {/* Candidates Section */}
      <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <UploadCloud size={16} style={{ color: 'var(--accent-cyan)' }} />
        Candidates & Talent Pipeline
      </h3>
      <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
        Upload prospective candidate resumes/CVs. The AI will parse details, identify skills, score organizational fit, and provide an impact verdict.
      </p>

      {/* CV Upload Dropzone */}
      <div
        className="glass-card"
        style={{
          padding: '32px 24px',
          textAlign: 'center',
          cursor: 'pointer',
          border: '2px dashed var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          transition: 'all 0.2s ease',
          marginBottom: '24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px'
        }}
        onClick={() => candidateFileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent-cyan)'; }}
        onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border-default)'; }}
        onDrop={e => {
          e.preventDefault();
          e.currentTarget.style.borderColor = 'var(--border-default)';
          handleCandidateUpload(e.dataTransfer.files);
        }}
      >
        <UploadCloud size={32} style={{ color: 'var(--accent-cyan)' }} />
        <p style={{ fontSize: '14px', fontWeight: 600, margin: 0 }}>
          Drop candidate CV here or click to upload
        </p>
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0 }}>
          PDF, DOCX, TXT, MD — up to 10MB
        </p>
        <input
          ref={candidateFileInputRef}
          type="file"
          accept=".pdf,.docx,.doc,.txt,.md"
          style={{ display: 'none' }}
          onChange={e => handleCandidateUpload(e.target.files)}
        />
      </div>

      {/* Uploading Candidate Loader */}
      {uploadingCandidate && (
        <div className="glass-card" style={{
          padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
          marginBottom: '24px', border: '1px solid var(--border-active)'
        }}>
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--accent-cyan)' }} />
          <div style={{ fontSize: '13px' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Evaluating Candidate...</span>
            <p style={{ color: 'var(--text-muted)', margin: '2px 0 0', fontSize: '11px' }}>
              Parsing resume text and scoring alignment with company context.
            </p>
          </div>
        </div>
      )}

      {/* Candidate List */}
      {loadingCandidates ? (
        <div style={{ padding: '24px', textAlign: 'center' }}>
          <Loader2 size={22} className="animate-spin" style={{ color: 'var(--accent-cyan)', margin: '0 auto' }} />
        </div>
      ) : candidates.length === 0 ? (
        <div className="glass-card" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          No candidates evaluated yet. Upload a CV above to start candidate pipeline tracking.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {candidates.map(c => {
            const colors = getScoreColor(c.fit_score || 5);
            return (
              <div key={c.id} className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <h4 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{c.name || 'Unknown Candidate'}</h4>
                      <span className="badge badge-default" style={{ fontSize: '11px', fontWeight: 600, textTransform: 'capitalize' }}>
                        {c.role_applied || 'Candidate'}
                      </span>
                    </div>
                    {c.email && (
                      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', marginBottom: 0 }}>
                        {c.email}
                      </p>
                    )}
                  </div>

                  <div style={{
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: colors.bg,
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                    fontSize: '12px',
                    fontWeight: 800,
                    textAlign: 'center',
                    flexShrink: 0
                  }}>
                    Fit Score: {c.fit_score}/10
                  </div>
                </div>

                {c.impact_verdict && (
                  <div style={{
                    padding: '10px 14px',
                    background: 'rgba(0, 0, 0, 0.15)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '12.5px',
                    lineHeight: '1.45',
                    color: 'var(--text-primary)'
                  }}>
                    <strong>AI Fit Verdict:</strong> {c.impact_verdict}
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', flex: 1 }}>
                    {Array.isArray(c.skills) && c.skills.map((skill, index) => (
                      <span key={index} className="badge badge-default" style={{
                        fontSize: '10px',
                        background: 'rgba(99,102,241,0.06)',
                        color: 'var(--text-accent)',
                        borderColor: 'rgba(99,102,241,0.12)',
                        padding: '3px 8px'
                      }}>
                        {skill}
                      </span>
                    ))}
                  </div>

                  <button
                    onClick={() => deleteCandidate(c.id)}
                    className="btn-ghost"
                    style={{ color: 'var(--accent-rose)', padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Trash2 size={12} />
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
