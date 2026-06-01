'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../../layout';
import { apiRequest } from '@/lib/api';
import {
  Loader2, RefreshCw, Sparkles, Check, X, Send, Zap, FileText,
  TrendingUp, ShoppingCart, Brain, Calendar, AlertTriangle, Plug,
  ChevronRight, Clock, CornerDownRight, MessageSquare, ExternalLink,
  Plus, Trash2,
} from 'lucide-react';

interface Widget { id: string; title: string; dataSource: string; }
interface Recipe { id: string; label: string; icon?: string; description?: string; output_type?: string; render?: string; }
interface SetupQuestion { id: string; question: string; choices: string[]; }
interface Proposals { automations: any[]; suggestions: any[]; }
interface Overview {
  department: string;
  label: string;
  subtitle: string;
  relevance: 'primary' | 'secondary' | 'dormant';
  widgets: Widget[];
  recipes: Recipe[];
  setupQuestions: SetupQuestion[];
  setupAnswers: Record<string, any>;
  setup_complete: boolean;
  proposals: Proposals;
  deliverables: any[];
  stats: Record<string, any>;
}

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

/**
 * The backend returns raw `agent_outputs` rows (columns: content, title, summary,
 * output_type, status='pending_approval'|'approved'|'rejected'|'discarded', ...).
 * The workspace UI expects: output_data (the previewable content), output_summary
 * (display title), and a normalized status where 'pending_approval' → 'pending'.
 */
function normalizeApproval(a: any) {
  if (!a) return a;
  const rawStatus = a.status;
  const status =
    rawStatus === 'pending_approval' || rawStatus === 'awaiting_plan_approval'
      ? 'pending'
      : rawStatus;
  return {
    ...a,
    rawStatus,
    output_data: a.content ?? a.output_data ?? {},
    output_summary: a.title || a.summary || a.output_summary || (a.output_type || '').replace(/_/g, ' '),
    status,
  };
}

// ── Minimal Markdown renderer (no new deps) — headings, bold/code, lists, tables. ──
function mdInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0; let m: RegExpExecArray | null; let k = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<strong key={`${keyBase}-b${k++}`}>{m[1]}</strong>);
    else if (m[2] !== undefined) nodes.push(<code key={`${keyBase}-c${k++}`} style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 4px', borderRadius: 4, fontSize: '0.92em' }}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderMarkdown(md: string): React.ReactNode {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0; let key = 0;
  const splitRow = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    // Table (header row + separator row of dashes)
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      out.push(
        <div key={key++} style={{ overflowX: 'auto', margin: '8px 0' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
            <thead><tr>{header.map((h, hi) => <th key={hi} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--accent-primary)', whiteSpace: 'nowrap' }}>{mdInline(h, `th${hi}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', verticalAlign: 'top' }}>{mdInline(c, `td${ri}-${ci}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const sizes = [18, 16, 14, 13];
      out.push(<div key={key++} style={{ fontWeight: 800, fontSize: sizes[lvl - 1] || 13, margin: '10px 0 4px', color: 'var(--text-primary)' }}>{mdInline(h[2], `h${key}`)}</div>);
      i++; continue;
    }
    if (/^\s*([-*])\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*])\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      out.push(<ul key={key++} style={{ margin: '4px 0', paddingLeft: 20, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 2 }}>{items.map((it, ii) => <li key={ii}>{mdInline(it, `li${key}-${ii}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { out.push(<hr key={key++} style={{ border: 'none', borderTop: '1px solid var(--border-subtle)', margin: '10px 0' }} />); i++; continue; }
    if (line.trim() === '') { i++; continue; }
    out.push(<p key={key++} style={{ margin: '4px 0', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{mdInline(line, `p${key}`)}</p>);
    i++;
  }
  return <div>{out}</div>;
}

// ── Split a reply into text + fenced html/svg artifact blocks. ──
function splitFences(content: string): { type: 'text' | 'html' | 'svg'; body: string }[] {
  const segs: { type: 'text' | 'html' | 'svg'; body: string }[] = [];
  const regex = /```(html|svg)\s*\n?([\s\S]*?)```/gi;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    if (m.index > last) segs.push({ type: 'text', body: content.slice(last, m.index) });
    segs.push({ type: m[1].toLowerCase() === 'svg' ? 'svg' : 'html', body: m[2] });
    last = m.index + m[0].length;
  }
  if (last < content.length) segs.push({ type: 'text', body: content.slice(last) });
  return segs;
}

// Detect a complete/standalone HTML artifact in an agent reply.
function extractHtmlArtifact(content: string): string | null {
  const seg = splitFences(content).find(s => s.type === 'html');
  return seg ? seg.body : null;
}

function downloadHtml(html: string, name = 'deliverable.html') {
  const full = /<html[\s>]/i.test(html) ? html : `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  const blob = new Blob([full], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download a single visual asset's code as a real .svg or .html file. */
function downloadAsset(code: string, kind: string, name: string) {
  const isHtml = kind === 'html';
  const blob = new Blob([code], { type: isHtml ? 'text/html' : 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(name || 'asset').replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.${isHtml ? 'html' : 'svg'}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Render an agent reply as rich content: markdown text + live html/svg previews. */
function AgentRichContent({ content, onFullscreen }: { content: string; onFullscreen?: (html: string) => void }) {
  const segs = splitFences(content);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {segs.map((s, i) => {
        if (s.type === 'text') {
          return s.body.trim() ? <div key={i} style={{ fontSize: 13 }}>{renderMarkdown(s.body)}</div> : null;
        }
        if (s.type === 'svg') {
          return <div key={i} style={{ display: 'flex', justifyContent: 'center', padding: 8, background: 'white', borderRadius: 8, border: '1px solid var(--border-subtle)' }} dangerouslySetInnerHTML={{ __html: s.body }} />;
        }
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {onFullscreen && (
                <button onClick={() => onFullscreen(s.body)} className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}>
                  <ExternalLink size={11} /> Full screen
                </button>
              )}
              <button onClick={() => downloadHtml(s.body)} className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}>
                <FileText size={11} /> Download HTML
              </button>
            </div>
            <iframe srcDoc={s.body} sandbox="allow-scripts allow-popups" title={`artifact-${i}`}
              style={{ width: '100%', height: 480, border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'white' }} />
          </div>
        );
      })}
    </div>
  );
}

export default function DepartmentDashboard({ dept }: { dept: string }) {
  const { token } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconfiguring, setReconfiguring] = useState(false);
  const [strategy, setStrategy] = useState<any | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);

  // ── First-run wizard ──
  const [wizardAnswers, setWizardAnswers] = useState<Record<string, string[]>>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [savingSetup, setSavingSetup] = useState(false);

  // ── Sub-tabs & Workspace states ──
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'workspace' | 'chat'>('overview');
  const [approvals, setApprovals] = useState<any[]>([]);
  const [approvalHistory, setApprovalHistory] = useState<any[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<any | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [commentSection, setCommentSection] = useState<string | null>(null);
  const [rejectFeedback, setRejectFeedback] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [fullPreviewHtml, setFullPreviewHtml] = useState<string | null>(null);

  const loadApprovals = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!token) return;
    if (!opts.silent) setApprovalsLoading(true);
    try {
      const [pendingRes, historyRes] = await Promise.all([
        apiRequest('/api/approvals', {}, token).catch(() => ({ approvals: [] })),
        apiRequest('/api/approvals/history', {}, token).catch(() => ({ history: [] }))
      ]);

      const filteredPending = (pendingRes.approvals || [])
        .filter((app: any) => app.agent_executions?.agent_type === dept)
        .map(normalizeApproval);
      const filteredHistory = (historyRes.history || [])
        .filter((app: any) => app.agent_executions?.agent_type === dept)
        .map(normalizeApproval);

      setApprovals(filteredPending);
      setApprovalHistory(filteredHistory);

      // Keep the open deliverable in sync after a refresh/revision (its content/status may have changed).
      setSelectedApproval((cur: any) => {
        if (!cur) return cur;
        const fresh = [...filteredPending, ...filteredHistory].find((a: any) => a.id === cur.id);
        return fresh || cur;
      });
    } catch (err) {
      console.error('[Department] failed to load approvals:', err);
    } finally {
      if (!opts.silent) setApprovalsLoading(false);
    }
  }, [token, dept]);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  // While the Workspace tab is open, poll so freshly-produced/revised deliverables
  // appear live (recipe launches and revisions run asynchronously in the background).
  useEffect(() => {
    if (activeSubTab !== 'workspace' || !token) return;
    const interval = setInterval(() => loadApprovals({ silent: true }), 6000);
    return () => clearInterval(interval);
  }, [activeSubTab, token, loadApprovals]);

  const loadComments = useCallback(async (approvalId: string) => {
    if (!token || !approvalId) return;
    setCommentsLoading(true);
    try {
      const res = await apiRequest(`/api/approvals/${approvalId}/comments`, {}, token);
      setComments(res.comments || []);
    } catch (err) {
      console.error('Failed to load comments:', err);
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (selectedApproval) {
      loadComments(selectedApproval.id);
      setShowRejectInput(false);
      setRejectFeedback('');
      setCommentSection(null);
    } else {
      setComments([]);
    }
  }, [selectedApproval, loadComments]);

  const handleAddComment = async () => {
    if (!token || !selectedApproval || !newCommentText.trim()) return;
    setActionLoading('comment');
    try {
      await apiRequest(`/api/approvals/${selectedApproval.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: newCommentText.trim(), section_ref: commentSection }),
      }, token);
      setNewCommentText('');
      setCommentSection(null);
      await loadComments(selectedApproval.id);
    } catch (err: any) {
      alert(`Failed to add comment: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = async () => {
    if (!token || !selectedApproval) return;
    setActionLoading('approve');
    try {
      await apiRequest(`/api/approvals/${selectedApproval.id}/approve`, {
        method: 'POST',
      }, token);
      await loadApprovals();
      setSelectedApproval(null);
      load();
    } catch (err: any) {
      alert(`Approval failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!token || !selectedApproval) return;
    const feedback = rejectFeedback.trim() || 'Discarded — please start over with a different approach.';
    setActionLoading('reject');
    try {
      await apiRequest(`/api/approvals/${selectedApproval.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ feedback }),
      }, token);
      setRejectFeedback('');
      setShowRejectInput(false);
      await loadApprovals();
      setSelectedApproval(null);
      load();
    } catch (err: any) {
      alert(`Rejection failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  // Open a deliverable (from the overview list) in the Workspace tab. Uses the already
  // loaded approval/history row if present; otherwise fetches the full output (with
  // content) so the preview is never empty.
  const openDeliverable = async (d: any) => {
    setActiveSubTab('workspace');
    const matched = approvals.find((a: any) => a.id === d.id) || approvalHistory.find((a: any) => a.id === d.id);
    if (matched) { setSelectedApproval(matched); return; }
    try {
      const res = await apiRequest(`/api/approvals/${d.id}`, {}, token!);
      if (res.output) { setSelectedApproval(normalizeApproval(res.output)); return; }
    } catch (e) { console.error('Failed to fetch deliverable:', e); }
    // Last-resort fallback (no content available).
    setSelectedApproval(normalizeApproval({ ...d }));
  };

  const handleRequestRevision = async () => {
    if (!token || !selectedApproval) return;
    setActionLoading('revision');
    try {
      await apiRequest(`/api/approvals/${selectedApproval.id}/request-revision`, {
        method: 'POST'
      }, token);
      await loadApprovals();
      setSelectedApproval(null);
      load();
    } catch (err: any) {
      alert(`Revision request failed: ${err.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const renderOutputContent = (type: string, data: any, onSectionComment?: (ref: string) => void) => {
    if (!data || typeof data !== 'object') {
      return <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '13px' }}>{String(data)}</pre>;
    }

    if (Object.keys(data).length === 0) {
      return <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Empty content.</div>;
    }

    switch (type) {
      case 'web_artifact': {
        const html = typeof data.html === 'string' ? data.html : '';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Live preview (sandboxed)</span>
              <button onClick={() => setFullPreviewHtml(html)} className="btn-ghost" style={{ fontSize: '11px', padding: '4px 10px' }}>
                <ExternalLink size={11} /> Full screen
              </button>
            </div>
            <iframe
              srcDoc={html}
              sandbox="allow-scripts allow-popups"
              title="Agent web preview"
              style={{ width: '100%', height: '440px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'white' }}
            />
          </div>
        );
      }
      case 'asset_collection': {
        const assets = Array.isArray(data.assets) ? data.assets : [];
        if (assets.length === 0) return <div style={{ color: 'var(--text-muted)' }}>No assets.</div>;
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px' }}>
            {assets.map((a: any, i: number) => {
              const code = typeof a.code === 'string' ? a.code : '';
              const src = a.url || a.dataUri || '';
              let cell;
              if (code && a.kind === 'html') {
                cell = (
                  <iframe srcDoc={code} sandbox="allow-scripts" title={a.caption || `Asset ${i + 1}`}
                    style={{ width: '100%', height: '150px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: 'white' }} />
                );
              } else if (code) {
                cell = (
                  <div style={{ width: '100%', minHeight: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}
                    dangerouslySetInnerHTML={{ __html: code }} />
                );
              } else if (src) {
                cell = (
                  <img src={src} alt={a.caption || `Asset ${i + 1}`} loading="lazy"
                    style={{ width: '100%', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', display: 'block' }} />
                );
              } else {
                cell = (
                  <div style={{ width: '100%', height: '100px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>No asset</div>
                );
              }
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {cell}
                  {a.caption && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{a.caption}</span>}
                  {code && (
                    <button onClick={() => downloadAsset(code, a.kind, a.caption || `asset-${i + 1}`)} className="btn-ghost"
                      style={{ fontSize: 10.5, padding: '3px 8px', alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <FileText size={11} /> Download {a.kind === 'html' ? 'HTML' : 'SVG'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        );
      }
      case 'marketing_strategy':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13.5px' }}>
            {data.executiveSummary && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '0 0 4px 0', color: 'var(--accent-primary)' }}>Executive Summary</h5>
                <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{data.executiveSummary}</p>
              </div>
            )}
            {data.channels && Array.isArray(data.channels) && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '8px 0 6px 0', color: 'var(--accent-primary)' }}>Recommended Channels</h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {data.channels.map((ch: any, i: number) => (
                    <div key={i} style={{ padding: '10px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '12px' }}>
                        <span>{ch.name}</span>
                        <span style={{ color: 'var(--accent-cyan)' }}>{ch.budget || 'No Budget'} &middot; Priority: {ch.priority || 'Medium'}</span>
                      </div>
                      <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>{ch.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.timeline && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '8px 0 4px 0', color: 'var(--accent-primary)' }}>Timeline</h5>
                <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{data.timeline}</p>
              </div>
            )}
            {data.keyMetrics && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '8px 0 4px 0', color: 'var(--accent-primary)' }}>Key Metrics</h5>
                <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{data.keyMetrics}</p>
              </div>
            )}
            {data.recommendations && Array.isArray(data.recommendations) && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '8px 0 4px 0', color: 'var(--accent-primary)' }}>Recommendations</h5>
                <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)' }}>
                  {data.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
          </div>
        );

      case 'lead_list':
      case 'investor_list':
        const items = data.leads || data.investors || [];
        const isLeads = type === 'lead_list';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text-muted)' }}>
              Total Found: {data.totalFound || items.length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map((item: any, i: number) => (
                <div key={i} style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--accent-cyan)' }}>{item.name || item.firm || item.company || 'Unnamed'}</span>
                    {item.priority && (
                      <span style={{
                        padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 700,
                        background: item.priority === 'High' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                        color: item.priority === 'High' ? '#ef4444' : '#f59e0b'
                      }}>
                        {item.priority}
                      </span>
                    )}
                  </div>
                  {item.website && (
                    <a href={item.website.startsWith('http') ? item.website : `https://${item.website}`} target="_blank" rel="noopener noreferrer"
                       style={{ fontSize: '11px', color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '3px', textDecoration: 'none', marginBottom: '6px' }}>
                      {item.website} <ExternalLink size={10} />
                    </a>
                  )}
                  {isLeads ? (
                    <>
                      {item.reason && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}><strong>Why:</strong> {item.reason}</div>}
                      {item.notes && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}><strong>Notes:</strong> {item.notes}</div>}
                    </>
                  ) : (
                    <>
                      {item.checkSize && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><strong>Check Size:</strong> {item.checkSize}</div>}
                      {item.focus && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><strong>Focus:</strong> {item.focus}</div>}
                      {item.portfolio && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}><strong>Portfolio:</strong> {item.portfolio}</div>}
                      {item.approach && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}><strong>Outreach:</strong> {item.approach}</div>}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        );

      case 'competitor_analysis':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13.5px' }}>
            {data.competitors && Array.isArray(data.competitors) && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '0 0 6px 0', color: 'var(--accent-primary)' }}>Competitors</h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {data.competitors.map((comp: any, i: number) => (
                    <div key={i} style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontWeight: 700, marginBottom: '4px', color: 'var(--accent-cyan)' }}>{comp.name}</div>
                      {comp.website && <div style={{ fontSize: '11px', color: 'var(--accent-primary)', marginBottom: '6px' }}>{comp.website}</div>}
                      {comp.overview && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{comp.overview}</div>}
                      {comp.strengths && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}><strong>Strengths:</strong> {comp.strengths}</div>}
                      {comp.weaknesses && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}><strong>Weaknesses:</strong> {comp.weaknesses}</div>}
                      {comp.pricing && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}><strong>Pricing:</strong> {comp.pricing}</div>}
                      {comp.marketingStrategy && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}><strong>Marketing:</strong> {comp.marketingStrategy}</div>}
                      {comp.gap && <div style={{ fontSize: '12px', color: '#10b981', marginTop: '4px' }}><strong>Opportunity Gap:</strong> {comp.gap}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.marketPosition && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '8px 0 4px 0', color: 'var(--accent-primary)' }}>Market Position</h5>
                <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{data.marketPosition}</p>
              </div>
            )}
            {data.opportunities && Array.isArray(data.opportunities) && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '8px 0 4px 0', color: 'var(--accent-primary)' }}>Opportunities</h5>
                <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)' }}>
                  {data.opportunities.map((o: string, i: number) => <li key={i}>{o}</li>)}
                </ul>
              </div>
            )}
          </div>
        );

      case 'content_draft':
      case 'social_post':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {data.platform && <div style={{ fontWeight: 600, fontSize: '12px' }}>Platform: {data.platform}</div>}
            {data.posts && Array.isArray(data.posts) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {data.posts.map((post: any, i: number) => (
                  <div key={i} style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontWeight: 700, fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                      POST #{i + 1} {post.platform ? `(${post.platform})` : ''}
                    </div>
                    {post.hook && <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '6px' }}>"{post.hook}"</div>}
                    {post.body && <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', marginBottom: '8px', fontSize: '12.5px', lineHeight: 1.4 }}>{post.body}</div>}
                    {post.cta && <div style={{ fontSize: '12px', fontStyle: 'italic', color: 'var(--accent-cyan)' }}>CTA: {post.cta}</div>}
                    {post.hashtags && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{post.hashtags}</div>}
                  </div>
                ))}
              </div>
            )}
            {data.content && typeof data.content === 'string' && (
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', fontSize: '12.5px', lineHeight: 1.4 }}>
                {data.content}
              </div>
            )}
          </div>
        );

      case 'plan': {
        const steps = Array.isArray(data.steps) ? data.steps : [];
        const deliverables = Array.isArray(data.deliverables) ? data.deliverables : [];
        const assumptions = Array.isArray(data.assumptions) ? data.assumptions : [];
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-primary)', letterSpacing: '0.04em' }}>PROPOSED PLAN — approve or comment before execution</div>
            {data.objective && (
              <div><h5 style={{ fontWeight: 700, margin: '0 0 4px 0', fontSize: '13px', color: 'var(--accent-primary)' }}>Objective</h5><p style={{ margin: 0, color: 'var(--text-secondary)' }}>{data.objective}</p></div>
            )}
            {data.approach && (
              <div><h5 style={{ fontWeight: 700, margin: '0 0 4px 0', fontSize: '13px', color: 'var(--accent-primary)' }}>Approach</h5><p style={{ margin: 0, color: 'var(--text-secondary)' }}>{data.approach}</p></div>
            )}
            {deliverables.length > 0 && (
              <div><h5 style={{ fontWeight: 700, margin: '0 0 4px 0', fontSize: '13px', color: 'var(--accent-primary)' }}>Deliverables</h5>
                <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)' }}>
                  {deliverables.map((d: any, i: number) => <li key={i}>{typeof d === 'string' ? d : (d.title || JSON.stringify(d))}</li>)}
                </ul>
              </div>
            )}
            {steps.length > 0 && (
              <div><h5 style={{ fontWeight: 700, margin: '0 0 4px 0', fontSize: '13px', color: 'var(--accent-primary)' }}>Steps</h5>
                <ol style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {steps.map((s: any, i: number) => (
                    <li key={s.id || i}>
                      <strong>{s.title || s}</strong>{s.detail ? ` — ${s.detail}` : ''}
                      {onSectionComment && (
                        <button onClick={() => onSectionComment(`step ${s.id || i + 1}: ${s.title || ''}`.trim())} title="Comment on this step"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 0 0 6px', display: 'inline-flex', verticalAlign: 'middle' }}>
                          <MessageSquare size={11} />
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {assumptions.length > 0 && (
              <div><h5 style={{ fontWeight: 700, margin: '0 0 4px 0', fontSize: '13px', color: 'var(--accent-primary)' }}>Assumptions</h5>
                <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-muted)' }}>
                  {assumptions.map((a: any, i: number) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
          </div>
        );
      }
      case 'code_project': {
        const files = Array.isArray(data.files) ? data.files : [];
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.preview_url ? (
              <iframe src={data.preview_url} sandbox="allow-scripts allow-same-origin allow-popups" title="Project preview"
                style={{ width: '100%', height: '440px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'white' }} />
            ) : typeof data.html === 'string' ? (
              <iframe srcDoc={data.html} sandbox="allow-scripts allow-popups" title="Project preview"
                style={{ width: '100%', height: '440px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'white' }} />
            ) : null}
            {files.length > 0 && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>Files</div>
                <ul style={{ margin: 0, paddingLeft: '16px' }}>
                  {files.map((f: any, i: number) => <li key={i}>{typeof f === 'string' ? f : f.path}</li>)}
                </ul>
              </div>
            )}
          </div>
        );
      }

      case 'document':
      case 'markdown':
      case 'text': {
        const md = typeof data === 'string' ? data : (data.markdown || data.content || data.text || '');
        if (md && typeof md === 'string') {
          return <div style={{ fontSize: 13 }}>{renderMarkdown(md)}</div>;
        }
        return renderStructured(data, onSectionComment);
      }

      default:
        return renderStructured(data, onSectionComment);
    }
  };

  const renderStructured = (data: any, onSectionComment?: (ref: string) => void): any => {
    const labelize = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').replace(/^./, s => s.toUpperCase()).trim();
    const renderVal = (val: any): any => {
      if (val == null) return null;
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        return <p style={{ margin: 0, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', fontSize: '12.5px' }}>{String(val)}</p>;
      }
      if (Array.isArray(val)) {
        return (
          <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12.5px' }}>
            {val.map((item: any, idx: number) => (
              <li key={idx}>
                {(item && typeof item === 'object')
                  ? Object.entries(item).map(([k, v]: [string, any]) => (
                      <span key={k} style={{ display: 'block' }}><strong>{labelize(k)}:</strong> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                    ))
                  : String(item)}
              </li>
            ))}
          </ul>
        );
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '8px', fontSize: '12.5px' }}>
          {Object.entries(val).map(([k, v]: [string, any]) => (
            <div key={k} style={{ color: 'var(--text-secondary)' }}><strong>{labelize(k)}:</strong> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
          ))}
        </div>
      );
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {Object.entries(data).map(([key, val]: [string, any]) => {
          if (key === 'researchNotes' || key === 'generatedAt' || key === 'logs') return null;
          return (
            <div key={key}>
              <h5 style={{ fontWeight: 700, margin: '0 0 4px 0', fontSize: '13px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {labelize(key)}
                {onSectionComment && (
                  <button onClick={() => onSectionComment(labelize(key))} title={`Comment on ${labelize(key)}`}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'inline-flex' }}>
                    <MessageSquare size={11} />
                  </button>
                )}
              </h5>
              {renderVal(val)}
            </div>
          );
        })}
      </div>
    );
  };

  const load = useCallback(async (reconfigure = false) => {
    if (!token) return;
    try {
      const q = reconfigure ? '?reconfigure=true' : '';
      const data = await apiRequest(`/api/departments/${dept}/overview${q}`, {}, token);
      setOverview(data.overview);
    } catch (e) {
      console.error('[Department] overview load failed:', e);
    } finally {
      setLoading(false);
      setReconfiguring(false);
    }
  }, [token, dept]);

  useEffect(() => { load(); }, [load]);

  // Fetch the 7-week strategy if a strategy widget is present (Marketing).
  useEffect(() => {
    if (!token || !overview) return;
    if (overview.widgets.some(w => w.dataSource === 'strategy')) {
      apiRequest(`/api/departments/marketing/strategy`, {}, token)
        .then(d => setStrategy(d.strategy))
        .catch(() => {});
    }
  }, [token, overview]);

  const refreshStrategy = async () => {
    if (!token) return;
    setStrategyLoading(true);
    try {
      const d = await apiRequest(`/api/departments/marketing/strategy/refresh`, { method: 'POST' }, token);
      setStrategy(d.strategy);
    } catch (e) { console.error(e); }
    finally { setStrategyLoading(false); }
  };

  const toggleWizardChoice = (qid: string, choice: string) => {
    setWizardAnswers(prev => {
      const cur = prev[qid] || [];
      return { ...prev, [qid]: cur.includes(choice) ? cur.filter(c => c !== choice) : [...cur, choice] };
    });
  };

  const submitSetup = async () => {
    if (!token || !overview) return;
    setSavingSetup(true);
    try {
      const answers: Record<string, string> = {};
      for (const [qid, choices] of Object.entries(wizardAnswers)) {
        let finalChoices = [...choices];
        if (choices.includes('Other')) {
          finalChoices = finalChoices.filter(c => c !== 'Other');
          const customText = otherTexts[qid]?.trim();
          if (customText) {
            finalChoices.push(customText);
          }
        }
        if (finalChoices.length) {
          answers[qid] = finalChoices.join(', ');
        }
      }
      await apiRequest(`/api/departments/${dept}/setup`, {
        method: 'POST', body: JSON.stringify({ answers }),
      }, token);
      await load();
    } catch (e) { console.error(e); }
    finally { setSavingSetup(false); }
  };

  const reconfigure = async () => {
    setReconfiguring(true);
    await load(true);
  };

  // ── Proposals approve/dismiss (reuse existing proactivity endpoints) ──
  const approveAutomation = async (id: string) => {
    if (!token) return;
    setOverview(o => o ? { ...o, proposals: { ...o.proposals, automations: o.proposals.automations.filter(a => a.id !== id) } } : o);
    try { await apiRequest(`/api/proactivity/approve/${id}`, { method: 'POST' }, token); } catch (e) { console.error(e); }
  };
  const dismissAutomation = async (id: string) => {
    if (!token) return;
    setOverview(o => o ? { ...o, proposals: { ...o.proposals, automations: o.proposals.automations.filter(a => a.id !== id) } } : o);
    try { await apiRequest(`/api/proactivity/reject/${id}`, { method: 'POST' }, token); } catch (e) { console.error(e); }
  };
  const dismissSuggestion = async (id: string) => {
    if (!token) return;
    setOverview(o => o ? { ...o, proposals: { ...o.proposals, suggestions: o.proposals.suggestions.filter(s => s.id !== id) } } : o);
    try { await apiRequest(`/api/proactivity/suggestions/${id}`, { method: 'PATCH', body: JSON.stringify({ is_dismissed: true }) }, token); } catch (e) { console.error(e); }
  };

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={32} style={{ color: 'var(--accent-primary)', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  if (!overview) {
    return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Could not load this department.</div>;
  }

  // ── First-run wizard ──
  if (!overview.setup_complete && overview.setupQuestions.length > 0) {
    return (
      <div style={{ padding: '32px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Sparkles size={22} style={{ color: 'var(--accent-primary)' }} />
          <h1 style={{ fontSize: 24, fontWeight: 800 }}>Set up {overview.label}</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
          A few quick questions so the Brain can tailor this department to your company. You can pick more than one.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {overview.setupQuestions.map(q => (
            <div key={q.id} className="glass-card" style={{ padding: 18 }}>
              <p style={{ fontWeight: 600, marginBottom: 12 }}>{q.question}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[...q.choices, 'Other'].map(choice => {
                  const selected = (wizardAnswers[q.id] || []).includes(choice);
                  return (
                    <button key={choice} onClick={() => toggleWizardChoice(q.id, choice)} style={{
                      padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      background: selected ? 'rgba(99,102,241,0.15)' : 'var(--bg-tertiary)',
                      border: `1px solid ${selected ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                      color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      transition: 'all 0.15s ease',
                    }}>
                      <div style={{
                        width: '14px',
                        height: '14px',
                        borderRadius: '3px',
                        border: `1.5px solid ${selected ? 'var(--accent-primary)' : 'var(--text-muted)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: selected ? 'var(--accent-primary)' : 'transparent',
                        transition: 'all 0.15s ease',
                        flexShrink: 0,
                      }}>
                        {selected && <Check size={10} color="white" />}
                      </div>
                      <span>{choice}</span>
                    </button>
                  );
                })}
              </div>
              {(wizardAnswers[q.id] || []).includes('Other') && (
                <input
                  type="text"
                  placeholder="Type your own answer..."
                  value={otherTexts[q.id] || ''}
                  onChange={e => setOtherTexts(prev => ({ ...prev, [q.id]: e.target.value }))}
                  className="input-field"
                  style={{
                    marginTop: '12px',
                    fontSize: '13px',
                    padding: '10px 12px',
                    width: '100%',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-primary)'
                  }}
                  autoFocus
                />
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
          <button onClick={submitSetup} disabled={savingSetup} className="btn-primary" style={{ padding: '12px 24px' }}>
            {savingSetup ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={16} />}
            {savingSetup ? 'Configuring…' : 'Configure dashboard'}
          </button>
          <button onClick={() => load()} className="btn-ghost" style={{ padding: '12px 18px' }} disabled={savingSetup}>
            Skip for now
          </button>
        </div>
      </div>
    );
  }

  const dataWidgets = overview.widgets.filter(w => w.dataSource !== 'proposals');

  return (
    <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em' }}>{overview.label}</h1>
            <RelevanceBadge relevance={overview.relevance} />
          </div>
          <p style={{ color: 'var(--text-secondary)', marginTop: 4, fontSize: 14 }}>{overview.subtitle}</p>
        </div>
        <button onClick={reconfigure} disabled={reconfiguring} className="btn-ghost" style={{ padding: '8px 14px', fontSize: 13 }}>
          <RefreshCw size={14} style={reconfiguring ? { animation: 'spin 1s linear infinite' } : undefined} />
          {reconfiguring ? 'Reconfiguring…' : 'Reconfigure'}
        </button>
      </div>

      {/* Sub-tabs Navigation */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-default)', paddingBottom: '1px' }}>
        <button
          onClick={() => setActiveSubTab('overview')}
          style={{
            padding: '10px 16px',
            fontSize: '13px',
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            borderBottom: activeSubTab === 'overview' ? '2px solid var(--accent-primary)' : '2px solid transparent',
            color: activeSubTab === 'overview' ? 'var(--text-primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <TrendingUp size={15} />
          Dashboard
        </button>
        <button
          onClick={() => setActiveSubTab('workspace')}
          style={{
            padding: '10px 16px',
            fontSize: '13px',
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            borderBottom: activeSubTab === 'workspace' ? '2px solid var(--accent-primary)' : '2px solid transparent',
            color: activeSubTab === 'workspace' ? 'var(--text-primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Brain size={15} />
          Workspace
          {approvals.length > 0 && (
            <span style={{
              fontSize: '10px',
              background: '#f59e0b',
              color: '#000',
              padding: '1px 6px',
              borderRadius: '10px',
              fontWeight: 700
            }}>
              {approvals.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveSubTab('chat')}
          style={{
            padding: '10px 16px',
            fontSize: '13px',
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            borderBottom: activeSubTab === 'chat' ? '2px solid var(--accent-primary)' : '2px solid transparent',
            color: activeSubTab === 'chat' ? 'var(--text-primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <Sparkles size={15} />
          Agent Chat
        </button>
      </div>

      {/* activeSubTab === 'overview' */}
      {activeSubTab === 'overview' && (
        <>
          {/* Quick actions (recipes) */}
          {overview.recipes.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {overview.recipes.map(r => (
                <RecipeButton key={r.id} dept={dept} recipe={r} token={token} />
              ))}
            </div>
          )}

          {/* Widgets grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
            {dataWidgets.map(w => (
              <WidgetCard
                key={w.id}
                widget={w}
                stat={overview.stats?.[w.id]}
                strategy={w.dataSource === 'strategy' ? strategy : null}
                strategyLoading={strategyLoading}
                onRefreshStrategy={refreshStrategy}
              />
            ))}
            {dataWidgets.length === 0 && (
              <div className="glass-card" style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
                No widgets are relevant for this company yet. Connect an integration or add context to the Brain.
              </div>
            )}
          </div>

          {/* Two-column: proposals + deliverables */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            <ProposalsPanel
              proposals={overview.proposals}
              onApprove={approveAutomation}
              onDismiss={dismissAutomation}
              onDismissSuggestion={dismissSuggestion}
            />
            {/* Custom inline deliverables view with click-to-workspace functionality */}
            <div className="glass-card" style={{ padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={15} style={{ color: 'var(--accent-secondary)' }} />
                  <span style={{ fontWeight: 700, fontSize: 14 }}>Recent deliverables</span>
                </div>
                <button
                  onClick={() => setActiveSubTab('workspace')}
                  className="btn-ghost"
                  style={{ fontSize: '11px', padding: '2px 8px', color: 'var(--accent-primary)' }}
                >
                  View Workspace
                </button>
              </div>
              {(!overview.deliverables || overview.deliverables.length === 0) && (
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No deliverables yet. Use a quick action or the chat below.</p>
              )}
              {(overview.deliverables || []).map(d => (
                <div
                  key={d.id}
                  onClick={() => openDeliverable(d)}
                  style={{ padding: '9px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title || d.output_type}</p>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.output_type}{d.version > 1 ? ` · v${d.version}` : ''}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <StatusBadge status={d.status} />
                    <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* activeSubTab === 'workspace' */}
      {activeSubTab === 'workspace' && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, minHeight: '600px', alignItems: 'start' }}>
          {/* Left Column: list of deliverables */}
          <div className="glass-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, alignSelf: 'stretch', maxHeight: '750px', overflowY: 'auto' }}>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Brain size={16} style={{ color: 'var(--accent-primary)' }} />
                Workspace
              </h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Monitor and review deliverables from the {overview.label} agent.</p>
            </div>

            {/* Pending Section */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent-amber)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={12} />
                Pending Review ({approvals.length})
              </div>
              {approvalsLoading ? (
                <div style={{ padding: 12, display: 'flex', justifyContent: 'center' }}>
                  <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent-amber)' }} />
                </div>
              ) : approvals.length === 0 ? (
                <div style={{ padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', border: '1px dashed var(--border-subtle)', borderRadius: 6 }}>
                  No pending deliverables.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {approvals.map(app => {
                    const isSelected = selectedApproval?.id === app.id;
                    const dateStr = app.created_at ? new Date(app.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
                    return (
                      <div
                        key={app.id}
                        onClick={() => setSelectedApproval(app)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 8,
                          background: isSelected ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.01)',
                          border: `1px solid ${isSelected ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                            {app.output_summary || app.output_type.replace(/_/g, ' ')}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{dateStr}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                          <span style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                            {app.output_type.replace(/_/g, ' ')}
                          </span>
                          <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', fontWeight: 600 }}>
                            Pending
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* History Section */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={12} />
                Review History ({approvalHistory.length})
              </div>
              {approvalsLoading ? (
                <div style={{ padding: 12, display: 'flex', justifyContent: 'center' }}>
                  <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
                </div>
              ) : approvalHistory.length === 0 ? (
                <div style={{ padding: '12px 8px', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', border: '1px dashed var(--border-subtle)', borderRadius: 6 }}>
                  No historical items.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {approvalHistory.map(app => {
                    const isSelected = selectedApproval?.id === app.id;
                    const dateStr = app.created_at ? new Date(app.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
                    const isApproved = app.status === 'approved';
                    return (
                      <div
                        key={app.id}
                        onClick={() => setSelectedApproval(app)}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 8,
                          background: isSelected ? (isApproved ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)') : 'rgba(255,255,255,0.01)',
                          border: `1px solid ${isSelected ? (isApproved ? '#10b981' : '#ef4444') : 'var(--border-subtle)'}`,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                            {app.output_summary || app.output_type.replace(/_/g, ' ')}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{dateStr}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                          <span style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                            {app.output_type.replace(/_/g, ' ')}
                          </span>
                          <span style={{
                            fontSize: 9, padding: '1px 5px', borderRadius: 4,
                            background: isApproved ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                            color: isApproved ? '#10b981' : '#ef4444',
                            fontWeight: 600,
                            textTransform: 'capitalize'
                          }}>
                            {app.status}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: preview & actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {!selectedApproval ? (
              <div className="glass-card" style={{ padding: '80px 40px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: '500px' }}>
                <div style={{
                  width: '64px', height: '64px', borderRadius: '50%',
                  background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-primary)',
                  marginBottom: '20px'
                }}>
                  <Brain size={32} />
                </div>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>Select a Deliverable</h3>
                <p style={{ fontSize: '14px', color: 'var(--text-muted)', maxWidth: '400px', lineHeight: 1.5 }}>
                  Click on any agent output from the left list to preview documents/assets, post comments, request revision, approve or reject them.
                </p>
              </div>
            ) : (
              <div className="glass-card animate-fade-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Header info */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, borderBottom: '1px solid var(--border-subtle)', paddingBottom: '16px' }}>
                  <div>
                    <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', wordBreak: 'break-word' }}>
                      {selectedApproval.output_summary || selectedApproval.output_type.replace(/_/g, ' ')}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                      <span style={{ textTransform: 'capitalize' }}>Type: {selectedApproval.output_type.replace(/_/g, ' ')}</span>
                      <span>&middot;</span>
                      <span>Created: {new Date(selectedApproval.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                    <span style={{
                      fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: 6,
                      background: selectedApproval.status === 'pending' ? 'rgba(245,158,11,0.12)' : (selectedApproval.status === 'approved' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'),
                      color: selectedApproval.status === 'pending' ? '#f59e0b' : (selectedApproval.status === 'approved' ? '#10b981' : '#ef4444'),
                      border: `1px solid ${selectedApproval.status === 'pending' ? 'rgba(245,158,11,0.3)' : (selectedApproval.status === 'approved' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)')}`,
                      textTransform: 'capitalize'
                    }}>
                      {selectedApproval.status}
                    </span>
                  </div>
                </div>

                {/* Preview Content */}
                <div style={{
                  padding: 20, background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)', overflowX: 'auto', minHeight: '200px'
                }}>
                  {renderOutputContent(selectedApproval.output_type, selectedApproval.output_data, (ref) => {
                    setCommentSection(ref);
                    const el = document.getElementById('workspace-comment-box');
                    if (el) (el as HTMLTextAreaElement).focus();
                  })}
                </div>

                {/* Comment thread & review feed */}
                <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '20px' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MessageSquare size={14} style={{ color: 'var(--accent-secondary)' }} />
                    Collaboration Thread
                  </h4>

                  {/* Comment list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16, maxHeight: '250px', overflowY: 'auto', paddingRight: '4px' }}>
                    {commentsLoading ? (
                      <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
                        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
                      </div>
                    ) : comments.length === 0 ? (
                      <p style={{ fontSize: 12.5, color: 'var(--text-muted)', fontStyle: 'italic', margin: '4px 0' }}>No comments on this deliverable yet. Start the conversation below.</p>
                    ) : (
                      comments.map(c => {
                        const isAgent = c.is_agent || !c.user_id;
                        return (
                          <div
                            key={c.id}
                            style={{
                              alignSelf: isAgent ? 'flex-start' : 'flex-end',
                              maxWidth: '85%',
                              padding: '8px 12px',
                              borderRadius: 10,
                              background: isAgent ? 'var(--bg-tertiary)' : 'var(--accent-primary)',
                              border: isAgent ? '1px solid var(--border-subtle)' : 'none',
                              color: isAgent ? 'var(--text-primary)' : '#fff',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4
                            }}
                          >
                            {c.section_ref && (
                              <div style={{
                                fontSize: '10px',
                                textTransform: 'uppercase',
                                color: isAgent ? 'var(--accent-secondary)' : 'rgba(255,255,255,0.7)',
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4
                              }}>
                                <CornerDownRight size={10} />
                                {c.section_ref}
                              </div>
                            )}
                            <div style={{ fontSize: '12.5px', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{c.body}</div>
                            <div style={{
                              fontSize: '9.5px',
                              color: isAgent ? 'var(--text-muted)' : 'rgba(255,255,255,0.6)',
                              textAlign: 'right',
                              marginTop: 2
                            }}>
                              {isAgent ? 'Agent' : (c.users?.full_name || 'You')} &middot; {new Date(c.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Actions for Pending */}
                  {selectedApproval.status === 'pending' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {/* Comment input */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {commentSection && (
                          <div style={{
                            display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
                            fontSize: '11px', padding: '4px 8px', borderRadius: 4, background: 'rgba(99,102,241,0.1)',
                            border: '1px solid rgba(99,102,241,0.2)', color: 'var(--accent-secondary)'
                          }}>
                            <span>Commenting on: <strong>{commentSection}</strong></span>
                            <button onClick={() => setCommentSection(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}>
                              <X size={12} />
                            </button>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 8 }}>
                          <textarea
                            id="workspace-comment-box"
                            rows={2}
                            placeholder="Add a feedback comment or click the comment icon next to any step/section above..."
                            value={newCommentText}
                            onChange={e => setNewCommentText(e.target.value)}
                            className="input-field"
                            style={{ flex: 1, fontSize: 13, padding: '8px 12px', resize: 'vertical' }}
                            disabled={actionLoading !== null}
                          />
                          <button
                            onClick={handleAddComment}
                            disabled={actionLoading !== null || !newCommentText.trim()}
                            className="btn-primary"
                            style={{ padding: '0 16px', height: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          >
                            {actionLoading === 'comment' ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
                          </button>
                        </div>
                      </div>

                      {/* Approval action buttons */}
                      {!showRejectInput ? (
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                          <button
                            onClick={handleApprove}
                            disabled={actionLoading !== null}
                            className="btn-primary"
                            style={{
                              background: '#10b981', borderColor: '#10b981', color: '#fff',
                              padding: '10px 18px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6
                            }}
                          >
                            {actionLoading === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            Approve & Store
                          </button>
                          <button
                            onClick={handleRequestRevision}
                            disabled={actionLoading !== null || comments.length === 0}
                            title={comments.length === 0 ? 'Add a comment first — the agent revises against your comments' : 'Send your comments back to the agent to revise and re-propose'}
                            className="btn-primary"
                            style={{
                              background: '#f59e0b', borderColor: '#f59e0b', color: '#000',
                              padding: '10px 18px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
                              opacity: comments.length === 0 ? 0.5 : 1,
                            }}
                          >
                            {actionLoading === 'revision' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            Request Revision
                          </button>
                          <button
                            onClick={() => setShowRejectInput(true)}
                            disabled={actionLoading !== null}
                            className="btn-primary"
                            style={{
                              background: '#ef4444', borderColor: '#ef4444', color: '#fff',
                              padding: '10px 18px', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6
                            }}
                          >
                            <X size={14} />
                            Reject Completely
                          </button>
                        </div>
                      ) : (
                        <div style={{
                          padding: 16, background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.2)',
                          borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4
                        }}>
                          <label style={{ fontSize: '12.5px', fontWeight: 600, color: '#ef4444' }}>Reason for rejection (required):</label>
                          <textarea
                            rows={3}
                            placeholder="Please explain why this output is being rejected..."
                            value={rejectFeedback}
                            onChange={e => setRejectFeedback(e.target.value)}
                            className="input-field"
                            style={{ fontSize: 13, padding: '8px 12px', borderColor: 'rgba(239,68,68,0.3)' }}
                          />
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => { setShowRejectInput(false); setRejectFeedback(''); }}
                              className="btn-ghost"
                              style={{ padding: '6px 12px', fontSize: 12 }}
                              disabled={actionLoading !== null}
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleReject}
                              disabled={actionLoading !== null || !rejectFeedback.trim()}
                              className="btn-primary"
                              style={{ background: '#ef4444', borderColor: '#ef4444', color: '#fff', padding: '6px 14px', fontSize: 12 }}
                            >
                              {actionLoading === 'reject' ? <Loader2 size={12} className="animate-spin" /> : 'Confirm Rejection'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* activeSubTab === 'chat' */}
      {activeSubTab === 'chat' && (
        <div style={{ width: '100%', maxWidth: '900px', margin: '0 auto' }}>
          <EmbeddedAgentChat dept={dept} label={overview.label} subtitle={overview.subtitle} token={token} fullHeight={true} onSaved={() => { loadApprovals(); setActiveSubTab('workspace'); }} />
        </div>
      )}

      {/* Full screen preview modal */}
      {fullPreviewHtml !== null && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          zIndex: 9999, display: 'flex', flexDirection: 'column', padding: '24px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'white' }}>Full Screen Preview</h3>
            <button onClick={() => setFullPreviewHtml(null)} className="btn-ghost" style={{ padding: '8px 16px', color: 'white' }}>
              <X size={16} style={{ marginRight: '6px' }} /> Close
            </button>
          </div>
          <iframe
            srcDoc={fullPreviewHtml}
            sandbox="allow-scripts allow-popups"
            title="Full Screen web preview"
            style={{ width: '100%', flex: 1, border: 'none', borderRadius: '8px', background: 'white' }}
          />
        </div>
      )}
    </div>
  );
}

function RelevanceBadge({ relevance }: { relevance: string }) {
  const map: Record<string, { label: string; color: string }> = {
    primary: { label: 'Primary', color: '#10b981' },
    secondary: { label: 'Secondary', color: '#6366f1' },
    dormant: { label: 'Dormant', color: '#6b7280' },
  };
  const c = map[relevance] || map.secondary;
  return (
    <span style={{
      padding: '2px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
      borderRadius: 6, background: `${c.color}1a`, color: c.color, border: `1px solid ${c.color}40`,
    }}>{c.label}</span>
  );
}

function RecipeButton({ dept, recipe, token }: { dept: string; recipe: Recipe; token: string | null }) {
  const [launching, setLaunching] = useState(false);
  const [done, setDone] = useState(false);
  const launch = async () => {
    if (!token) return;
    setLaunching(true);
    try {
      // departments map 1:1 to agent types except 'people' → 'people'
      const agentType = dept;
      await apiRequest(`/api/agents/launch-recipe`, {
        method: 'POST', body: JSON.stringify({ agentType, recipeId: recipe.id }),
      }, token);
      setDone(true);
      setTimeout(() => setDone(false), 4000);
    } catch (e) { console.error(e); }
    finally { setLaunching(false); }
  };
  return (
    <button onClick={launch} disabled={launching} title={recipe.description} style={{
      padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
      background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)',
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      {launching ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : done ? <Check size={13} style={{ color: '#10b981' }} /> : <Zap size={13} />}
      {done ? 'Launched' : recipe.label}
    </button>
  );
}

function WidgetCard({ widget, stat, strategy, strategyLoading, onRefreshStrategy }: {
  widget: Widget; stat: any; strategy: any; strategyLoading: boolean; onRefreshStrategy: () => void;
}) {
  const isStrategy = widget.dataSource === 'strategy';
  const isIntegration = widget.dataSource?.startsWith('integration:');

  return (
    <div className="glass-card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, gridColumn: isStrategy ? '1 / -1' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isIntegration ? <ShoppingCart size={15} style={{ color: 'var(--accent-cyan)' }} /> :
            isStrategy ? <Calendar size={15} style={{ color: 'var(--accent-primary)' }} /> :
              <Brain size={15} style={{ color: 'var(--accent-secondary)' }} />}
          <span style={{ fontWeight: 700, fontSize: 14 }}>{widget.title}</span>
        </div>
        {isStrategy && (
          <button onClick={onRefreshStrategy} disabled={strategyLoading} className="btn-ghost" style={{ padding: '4px 8px', fontSize: 11 }}>
            <RefreshCw size={12} style={strategyLoading ? { animation: 'spin 1s linear infinite' } : undefined} /> Refresh
          </button>
        )}
      </div>

      {isStrategy ? <StrategyTimeline strategy={strategy} loading={strategyLoading} /> :
        isIntegration ? <IntegrationStat stat={stat} /> :
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Sourced from the Brain. Use the quick actions above or the chat below to generate this.
          </p>}
    </div>
  );
}

function IntegrationStat({ stat }: { stat: any }) {
  if (!stat || stat.status === 'not_connected') {
    return <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Not connected.</p>;
  }
  if (stat.status === 'connect') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12.5 }}>
        <Plug size={14} /> Connect {stat.provider} to see live stats.
      </div>
    );
  }
  if (stat.status === 'error') {
    return <p style={{ fontSize: 12.5, color: '#f59e0b' }}>Couldn’t reach the integration right now.</p>;
  }
  // status ok — render whatever metrics are present
  const rows: [string, any][] = [];
  if (stat.revenue !== undefined) rows.push(['Revenue', `${stat.revenue} ${stat.currency || ''}`]);
  if (stat.orders !== undefined) rows.push(['Orders', stat.orders]);
  if (stat.aov !== undefined) rows.push(['AOV', `${stat.aov} ${stat.currency || ''}`]);
  if (stat.volume !== undefined) rows.push(['Volume', `${stat.volume} ${stat.currency || ''}`]);
  if (stat.succeeded !== undefined) rows.push(['Succeeded', `${stat.succeeded}/${stat.transactions}`]);
  if (stat.balance) rows.push(['Balance', stat.balance]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {stat.window && <span style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{stat.window}</span>}
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)' }}>{k}</span>
          <span style={{ fontWeight: 700 }}>{v}</span>
        </div>
      ))}
      {Array.isArray(stat.topProducts) && stat.topProducts.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <span style={{ fontSize: 10.5, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Top products</span>
          {stat.topProducts.map((p: any) => (
            <div key={p.title} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{p.title}</span>
              <span style={{ fontWeight: 600 }}>{p.qty}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StrategyTimeline({ strategy, loading }: { strategy: any; loading: boolean }) {
  if (loading && !strategy) {
    return <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 13 }}><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Building strategy…</div>;
  }
  const weeks = strategy?.weeks || [];
  if (!weeks.length) return <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No strategy yet.</p>;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginTop: 4 }}>
      {weeks.map((w: any) => (
        <div key={w.week} style={{ padding: 12, borderRadius: 10, background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent-primary)', textTransform: 'uppercase' }}>Week {w.week}</span>
          </div>
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{w.focus}</p>
          {(w.objectives || []).length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {w.objectives.slice(0, 3).map((o: string, i: number) => <li key={i}>{o}</li>)}
            </ul>
          )}
          {(w.channels || []).length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {w.channels.slice(0, 4).map((c: string, i: number) => (
                <span key={i} style={{ fontSize: 9.5, padding: '2px 6px', borderRadius: 5, background: 'rgba(99,102,241,0.12)', color: 'var(--accent-secondary)' }}>{c}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ProposalsPanel({ proposals, onApprove, onDismiss, onDismissSuggestion }: {
  proposals: Proposals; onApprove: (id: string) => void; onDismiss: (id: string) => void; onDismissSuggestion: (id: string) => void;
}) {
  const autos = proposals?.automations || [];
  const suggs = proposals?.suggestions || [];
  return (
    <div className="glass-card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Zap size={15} style={{ color: '#f59e0b' }} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>Proactive proposals</span>
      </div>
      {autos.length === 0 && suggs.length === 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No proposals for this department yet.</p>
      )}
      {autos.map(a => (
        <div key={a.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <p style={{ fontSize: 13, marginBottom: 8 }}>{a.description}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onApprove(a.id)} className="btn-primary" style={{ padding: '4px 10px', fontSize: 11 }}><Check size={12} /> Approve</button>
            <button onClick={() => onDismiss(a.id)} className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }}><X size={12} /> Dismiss</button>
          </div>
        </div>
      ))}
      {suggs.map(s => (
        <div key={s.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 8 }}>
          <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</p>
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{s.description}</p>
          </div>
          <button onClick={() => onDismissSuggestion(s.id)} className="btn-ghost" style={{ padding: 4 }}><X size={12} /></button>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    approved: '#10b981', pending_approval: '#f59e0b', awaiting_plan_approval: '#6366f1', discarded: '#6b7280',
  };
  const color = map[status] || '#6b7280';
  return (
    <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: `${color}1a`, color, border: `1px solid ${color}40`, whiteSpace: 'nowrap', textTransform: 'capitalize' }}>
      {(status || '').replace(/_/g, ' ')}
    </span>
  );
}

interface ToolStep { name: string; status: string; durationMs?: number; error?: string; reason?: string; result?: any; }
interface ChatMsg { role: 'user' | 'assistant'; content: string; tools?: ToolStep[]; }

// Split an agent reply into reviewable deliverables: all SVG → one asset set, each
// HTML → a web artifact, and substantial prose (with headings, or when no artifacts) → a document.
interface DetectedDeliverable { outputType: 'asset_collection' | 'web_artifact' | 'document'; content: any; title: string; }
function detectDeliverables(content: string): DetectedDeliverable[] {
  const segs = splitFences(content);
  const svgs = segs.filter(s => s.type === 'svg').map(s => s.body);
  const htmls = segs.filter(s => s.type === 'html').map(s => s.body);
  const text = segs.filter(s => s.type === 'text').map(s => s.body).join('\n').trim();
  const out: DetectedDeliverable[] = [];
  if (svgs.length) out.push({ outputType: 'asset_collection', content: { assets: svgs.map((code, i) => ({ kind: 'svg', code, caption: `Concept ${i + 1}` })) }, title: svgs.length > 1 ? `${svgs.length} visual concepts` : 'Visual asset' });
  htmls.forEach((html, i) => out.push({ outputType: 'web_artifact', content: { html }, title: htmls.length > 1 ? `Web artifact ${i + 1}` : 'Web artifact' }));
  const titleFrom = (t: string) => {
    const h = (t.match(/^#{1,4}\s+(.+)$/m) || [])[1];
    const fl = (t.split('\n').find(l => l.trim()) || '').replace(/^#+\s*/, '').replace(/[*_`]/g, '');
    return (h || fl || 'Document').trim().slice(0, 80);
  };
  if (text && text.length > 120 && (out.length === 0 || /^#{1,4}\s/m.test(text))) {
    out.push({ outputType: 'document', content: text, title: titleFrom(text) });
  }
  return out;
}

/** Inline review bar for an agent reply that contains deliverable(s). */
function DeliverableReviewBar({ content, dept, token, onRevise }: { content: string; dept: string; token: string | null; onRevise: (msg: string) => void }) {
  const deliverables = useMemo(() => detectDeliverables(content), [content]);
  const [busy, setBusy] = useState<'store' | 'ws' | null>(null);
  const [stored, setStored] = useState(false);
  const [savedWs, setSavedWs] = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState('');
  if (deliverables.length === 0) return null;

  const create = async (store: boolean) => {
    if (!token || busy) return;
    setBusy(store ? 'store' : 'ws');
    try {
      await apiRequest(`/api/departments/${dept}/deliverables`, {
        method: 'POST',
        body: JSON.stringify({ deliverables: deliverables.map(d => ({ outputType: d.outputType, content: d.content, title: d.title })), store }),
      }, token);
      if (store) setStored(true); else setSavedWs(true);
    } catch (e: any) {
      alert(`Failed: ${e.message}. If this says "not found", restart the backend (node server.js).`);
    } finally {
      setBusy(null);
    }
  };

  const openComment = () => {
    setShowComment(true);
    const sel = (typeof window !== 'undefined' && window.getSelection) ? (window.getSelection()?.toString() || '').trim() : '';
    if (sel) setComment(c => c || `Regarding "${sel.slice(0, 220)}": `);
  };
  const submitRevise = () => {
    if (!comment.trim()) return;
    onRevise(`Please revise — ${comment.trim()}`);
    setShowComment(false); setComment('');
  };

  const n = deliverables.length;
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'rgba(99,102,241,0.04)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{n} draft{n > 1 ? 's' : ''} to review</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button onClick={() => create(true)} disabled={busy !== null || stored} className="btn-primary" style={{ fontSize: 11.5, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5, background: '#10b981', borderColor: '#10b981', color: '#fff' }}>
          {busy === 'store' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={12} />}{stored ? 'Stored in Brain' : 'Accept & store in Brain'}
        </button>
        <button onClick={() => create(false)} disabled={busy !== null || savedWs} className="btn-ghost" style={{ fontSize: 11.5, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
          {busy === 'ws' ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={12} />}{savedWs ? 'In Workspace' : 'Save to Workspace'}
        </button>
        <button onClick={openComment} className="btn-ghost" style={{ fontSize: 11.5, padding: '5px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
          <MessageSquare size={12} /> Comment / highlight
        </button>
      </div>
      {showComment && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
            placeholder='Comment on the whole draft — or highlight text above first, then click "Comment / highlight" to quote it.'
            className="input-field" style={{ fontSize: 12.5, padding: '8px 10px', resize: 'vertical' }} autoFocus />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submitRevise} disabled={!comment.trim()} className="btn-primary" style={{ fontSize: 11.5, padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 5 }}><Send size={12} /> Send to agent to revise</button>
            <button onClick={() => { setShowComment(false); setComment(''); }} className="btn-ghost" style={{ fontSize: 11.5, padding: '5px 10px' }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

const prettyToolName = (n: string) =>
  (n || '').replace(/^(web|research|document|fs)_/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

function EmbeddedAgentChat({ dept, label, subtitle, token, fullHeight = false, onSaved }: { dept: string; label: string; subtitle: string; token: string | null; fullHeight?: boolean; onSaved?: () => void }) {
  const agentName = `${label} Lead`;
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [openSteps, setOpenSteps] = useState<Record<number, boolean>>({});
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [savedIdx, setSavedIdx] = useState<Record<number, boolean>>({});
  const [fsHtml, setFsHtml] = useState<string | null>(null);
  // Agent clarifying-question picker (multi-select + Other)
  const [pendingChoices, setPendingChoices] = useState<string[] | null>(null);
  const [multiSelected, setMultiSelected] = useState<string[]>([]);
  const [otherChecked, setOtherChecked] = useState(false);
  const [otherText, setOtherText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Promote a chat reply into the Workspace as a reviewable deliverable.
  const deriveTitle = (text: string) => {
    const firstHeading = (text.match(/^#{1,4}\s+(.+)$/m) || [])[1];
    const firstLine = (text.split('\n').find(l => l.trim()) || '').replace(/^#+\s*/, '').replace(/[*_`]/g, '');
    return (firstHeading || firstLine || `${label} deliverable`).trim().slice(0, 90);
  };
  const saveToWorkspace = async (idx: number, content: string) => {
    if (!token || savingIdx !== null) return;
    setSavingIdx(idx);
    try {
      // If the reply contains a complete HTML artifact, save it as a previewable
      // web_artifact; otherwise save the markdown as a document.
      const html = extractHtmlArtifact(content);
      const body = html
        ? { title: deriveTitle(content), outputType: 'web_artifact', content: { html } }
        : { title: deriveTitle(content), content };
      await apiRequest(`/api/departments/${dept}/deliverables`, {
        method: 'POST',
        body: JSON.stringify(body),
      }, token);
      setSavedIdx(s => ({ ...s, [idx]: true }));
      onSaved?.();
    } catch (e: any) {
      alert(`Failed to save to Workspace: ${e.message}. If this says "not found", restart the backend (node server.js) so the new endpoint is live.`);
    } finally {
      setSavingIdx(null);
    }
  };

  const loadSessions = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiRequest(`/api/orchestrator/agent-chat/history/${encodeURIComponent(agentName)}`, {}, token);
      setSessions(data.sessions || []);
      return data.sessions || [];
    } catch (err) {
      console.error('Failed to load agent sessions:', err);
      return [];
    }
  }, [token, agentName]);

  const openSession = useCallback(async (id: string) => {
    if (!token) return;
    setSessionId(id);
    setOpenSteps({});
    setMessagesLoading(true);
    try {
      const data = await apiRequest(`/api/brain/chat/sessions/${id}/history`, {}, token);
      const mapped: ChatMsg[] = (data.messages || [])
        .filter((m: any) => m.role === 'user' || m.role === 'assistant')
        .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      setMessages(mapped);
    } catch (err) {
      console.error('Failed to load session messages:', err);
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, [token]);

  const newChat = () => {
    setSessionId(null);
    setMessages([]);
    setOpenSteps({});
    setInput('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!token) return;
    setSessions(prev => prev.filter(s => s.id !== id));
    if (sessionId === id) newChat();
    try { await apiRequest(`/api/brain/chat/sessions/${id}`, { method: 'DELETE' }, token); } catch (err) { console.error('Failed to delete session:', err); }
  };

  // On mount / agent change: load the session list and continue the most recent chat.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ss = await loadSessions();
      if (!cancelled && ss.length > 0) {
        openSession(ss[0].id);
      } else if (!cancelled) {
        setSessionId(null);
        setMessages([]);
      }
    })();
    return () => { cancelled = true; };
  }, [loadSessions, openSession]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const sessionTitle = (s: any) => {
    const raw = String(s.title || '').replace(new RegExp(`^Agent:\\s*${agentName}\\s*-\\s*`), '').trim();
    return raw || 'New conversation';
  };

  const resetChoicePicker = () => { setPendingChoices(null); setMultiSelected([]); setOtherChecked(false); setOtherText(''); };

  const toggleChoice = (choice: string) => {
    setMultiSelected(prev => prev.includes(choice) ? prev.filter(c => c !== choice) : [...prev, choice]);
  };

  const submitChoices = () => {
    const parts = [...multiSelected];
    if (otherChecked && otherText.trim()) parts.push(otherText.trim());
    const answer = parts.join(', ');
    if (!answer) return;
    resetChoicePicker();
    send(answer);
  };

  const send = async (textOverride?: string) => {
    const userMsg = (textOverride ?? input).trim();
    if (!userMsg || !token || sending) return;
    const wasNew = !sessionId;
    if (textOverride === undefined) setInput('');
    resetChoicePicker();
    setMessages(m => [...m, { role: 'user', content: userMsg }]);
    setSending(true);
    try {
      const systemPrompt = `You are the ${label} department lead for this company. ${subtitle} Help plan and produce ${label.toLowerCase()} deliverables grounded in the company's Brain context.

When you produce a SUBSTANTIAL deliverable (a report, list, research dossier, plan, or document), render the FINAL artifact as a COMPLETE, self-contained, beautifully styled HTML document inside a single \`\`\`html code block: inline CSS only, no external assets, a clean professional layout (clear headings, readable typography, styled tables, good spacing), and print-friendly so it can be saved as a PDF. Put a 1–2 sentence summary BEFORE the code block. For quick answers or back-and-forth conversation, just reply normally in markdown — only emit the HTML document when there's a real deliverable worth previewing.

You CAN and SHOULD produce SEVERAL deliverables in ONE reply when it helps (e.g. multiple logo concepts, a set of social posts, or several documents). Put EACH visual asset in its OWN fenced \`\`\`svg or \`\`\`html block, and separate distinct documents with clear "## " headings, so each can be reviewed and stored individually. Visual assets must be self-contained SVG (xmlns + viewBox, no external fonts/images/URLs), balanced, centered, legible at ~24px and monochrome-safe.

When you need to ask the user a clarifying question, ALWAYS use the ask_user_question tool and provide 2–5 concrete, selectable choices (the user can multi-select and also add their own "Other" answer). Never ask an open-ended question without choices.

When the user comments on a draft or highlights/quotes part of it, produce a REVISED version that addresses EXACTLY that feedback (keep the rest intact), again as the appropriate fenced artifact(s) so it can be re-reviewed.`;
      const data = await apiRequest(`/api/orchestrator/agent-chat`, {
        method: 'POST',
        body: JSON.stringify({ message: userMsg, sessionId, agentName, agentSystemPrompt: systemPrompt }),
      }, token);
      if (data.sessionId) setSessionId(data.sessionId);
      const reply = data.type === 'question' ? data.question : data.reply;
      const tools: ToolStep[] = Array.isArray(data.toolsUsed) ? data.toolsUsed : [];
      setMessages(m => [...m, { role: 'assistant', content: reply || '…', tools }]);
      // If the agent asked a question with choices, surface the multi-select picker.
      if (data.type === 'question' && Array.isArray(data.choices) && data.choices.length > 0) {
        setPendingChoices(data.choices);
        setMultiSelected([]); setOtherChecked(false); setOtherText('');
      }
      // A brand-new chat just created a session — surface it in the history list.
      if (wasNew) loadSessions();
    } catch (e: any) {
      setMessages(m => [...m, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setSending(false);
    }
  };

  const convoHeight = fullHeight ? 520 : 320;

  return (
    <div className="glass-card" style={{ padding: 0, display: 'flex', flexDirection: 'row', gap: 0, overflow: 'hidden' }}>
      {/* ─── History sidebar ─── */}
      <div style={{ width: 210, borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', flexShrink: 0, background: 'var(--bg-tertiary)' }}>
        <div style={{ padding: 12 }}>
          <button onClick={newChat} className="btn-primary" style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '8px 12px' }}>
            <Plus size={14} /> New chat
          </button>
        </div>
        <div style={{ padding: '0 8px 8px', overflowY: 'auto', flex: 1, maxHeight: convoHeight + 60 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', padding: '4px 6px 8px' }}>History</div>
          {sessions.length === 0 ? (
            <p style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '4px 6px' }}>No past chats yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {sessions.map(s => {
                const active = s.id === sessionId;
                return (
                  <div key={s.id} className="session-row" onClick={() => openSession(s.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '7px 8px', borderRadius: 6, cursor: 'pointer',
                    background: active ? 'rgba(99,102,241,0.12)' : 'transparent',
                    border: `1px solid ${active ? 'rgba(99,102,241,0.3)' : 'transparent'}`,
                  }}>
                    <MessageSquare size={12} style={{ opacity: 0.5, flexShrink: 0, color: active ? 'var(--accent-secondary)' : 'var(--text-muted)' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: active ? 600 : 500, color: active ? 'var(--text-primary)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {sessionTitle(s)}
                      </div>
                      {s.created_at && <div style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>{new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>}
                    </div>
                    <button onClick={(e) => deleteSession(s.id, e)} title="Delete chat" className="session-delete-btn" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-muted)', flexShrink: 0, display: 'flex' }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ─── Conversation ─── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: 18, gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sparkles size={15} style={{ color: 'var(--accent-primary)' }} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>{sessionId ? `Chatting with the ${label} agent` : `Ask the ${label} agent`}</span>
      </div>
      <div ref={scrollRef} style={{ height: convoHeight, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messagesLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 0', gap: 8, color: 'var(--text-muted)' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13 }}>Loading conversation…</span>
          </div>
        ) : messages.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            e.g. “Plan next quarter’s {label.toLowerCase()}” or “What should we focus on this month?”
          </p>
        )}
        {messages.map((m, i) => {
          const hasSteps = m.role === 'assistant' && Array.isArray(m.tools) && m.tools.length > 0;
          const open = !!openSteps[i];
          const hasArtifact = m.role === 'assistant' && /```(html|svg)/i.test(m.content);
          return (
            <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: hasArtifact ? '100%' : '85%', width: hasArtifact ? '100%' : undefined, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Collapsible "what the agent did / thought about" — above the reply */}
              {hasSteps && (
                <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'rgba(99,102,241,0.04)', overflow: 'hidden' }}>
                  <button
                    onClick={() => setOpenSteps(s => ({ ...s, [i]: !s[i] }))}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
                      background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 600,
                    }}
                  >
                    <ChevronRight size={13} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', flexShrink: 0 }} />
                    <Brain size={12} style={{ color: 'var(--accent-primary)' }} />
                    {open ? 'Hide' : 'Show'} thinking · {m.tools!.length} step{m.tools!.length === 1 ? '' : 's'}
                  </button>
                  {open && (
                    <div style={{ padding: '4px 10px 10px 28px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {m.tools!.map((t, ti) => {
                        const color = t.status === 'success' ? '#10b981' : t.status === 'failed' ? '#ef4444' : t.status === 'denied' ? '#f59e0b' : 'var(--text-muted)';
                        const detail = t.error || t.reason || '';
                        return (
                          <div key={ti} style={{ fontSize: 11.5, lineHeight: 1.4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{prettyToolName(t.name)}</span>
                              <span style={{ color, fontSize: 10, textTransform: 'capitalize' }}>{t.status}</span>
                              {typeof t.durationMs === 'number' && <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>· {(t.durationMs / 1000).toFixed(1)}s</span>}
                            </div>
                            {detail && <div style={{ color: 'var(--text-muted)', paddingLeft: 12, marginTop: 1 }}>{String(detail).slice(0, 160)}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              <div style={{
                padding: '9px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.5,
                whiteSpace: m.role === 'user' ? 'pre-wrap' : 'normal',
                background: m.role === 'user' ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
                border: m.role === 'user' ? 'none' : '1px solid var(--border-subtle)',
              }}>
                {m.role === 'assistant' ? <AgentRichContent content={m.content} onFullscreen={setFsHtml} /> : m.content}
              </div>
              {/* Inline draft review: accept & store to Brain, save to workspace, or comment/highlight → revise */}
              {m.role === 'assistant' && !m.content.startsWith('Error:') && (
                <DeliverableReviewBar content={m.content} dept={dept} token={token} onRevise={(msg) => send(msg)} />
              )}
            </div>
          );
        })}
        {sending && <div style={{ alignSelf: 'flex-start', color: 'var(--text-muted)', fontSize: 12 }}><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> thinking…</div>}
      </div>

      {/* Agent question — multi-select choices + Other */}
      {pendingChoices && !sending && (
        <div style={{ border: '1px solid var(--accent-primary)', borderRadius: 10, padding: 12, background: 'rgba(99,102,241,0.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--accent-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pick one or more</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {pendingChoices.map(choice => {
              const selected = multiSelected.includes(choice);
              return (
                <button key={choice} onClick={() => toggleChoice(choice)} style={{
                  padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: selected ? 'rgba(99,102,241,0.18)' : 'var(--bg-tertiary)',
                  border: `1px solid ${selected ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                  color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}>
                  {selected && <Check size={12} />}{choice}
                </button>
              );
            })}
            <button onClick={() => setOtherChecked(v => !v)} style={{
              padding: '7px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: otherChecked ? 'rgba(99,102,241,0.18)' : 'var(--bg-tertiary)',
              border: `1px solid ${otherChecked ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
              color: otherChecked ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}>
              {otherChecked && <Check size={12} />}Other
            </button>
          </div>
          {otherChecked && (
            <input
              value={otherText}
              onChange={e => setOtherText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitChoices(); } }}
              placeholder="Type your own answer…"
              className="input-field"
              style={{ fontSize: 13, padding: '8px 12px' }}
              autoFocus
            />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submitChoices} disabled={multiSelected.length === 0 && !(otherChecked && otherText.trim())} className="btn-primary" style={{ padding: '8px 16px', fontSize: 13 }}>
              <Send size={13} /> Submit answer
            </button>
            <button onClick={resetChoicePicker} className="btn-ghost" style={{ padding: '8px 14px', fontSize: 12.5 }}>Type instead</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={`Message the ${label} agent…`}
          className="input-field"
          style={{ flex: 1, fontSize: 13, padding: '10px 12px' }}
          disabled={sending}
        />
        <button onClick={() => send()} disabled={sending || !input.trim()} className="btn-primary" style={{ padding: '10px 16px' }}>
          <Send size={15} />
        </button>
      </div>
      </div>

      {/* Fullscreen artifact preview */}
      {fsHtml !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', flexDirection: 'column', padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>Deliverable preview</h3>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => downloadHtml(fsHtml)} className="btn-ghost" style={{ padding: '8px 14px', color: 'white' }}><FileText size={14} style={{ marginRight: 6 }} /> Download HTML</button>
              <button onClick={() => setFsHtml(null)} className="btn-ghost" style={{ padding: '8px 14px', color: 'white' }}><X size={16} style={{ marginRight: 6 }} /> Close</button>
            </div>
          </div>
          <iframe srcDoc={fsHtml} sandbox="allow-scripts allow-popups" title="Fullscreen artifact" style={{ width: '100%', flex: 1, border: 'none', borderRadius: 8, background: 'white' }} />
        </div>
      )}
    </div>
  );
}
