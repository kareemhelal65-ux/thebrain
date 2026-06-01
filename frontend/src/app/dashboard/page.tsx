'use client';

import { useState, useEffect, Fragment } from 'react';
import { useAuth } from './layout';
import { apiRequest } from '@/lib/api';
import {
  Brain, Calendar, FileText, Hash, TrendingUp,
  Zap, Clock, ChevronRight, Sparkles, RefreshCw,
  MessageSquare, Users, Activity, Settings, ArrowUpRight,
  Check, Loader2, Plus, ChevronUp, ChevronDown, CheckSquare, X,
  Mail, Square, ListChecks, Wand2, AlertCircle, CircleDot
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import SourceViewer from '@/components/SourceViewer';

interface DashboardStats {
  meetings: number;
  documents: number;
  slackMessages: number;
  brainQueries: number;
  lastSync: string | null;
}

interface WidgetConfig {
  id: string;
  name: string;
  visible: boolean;
}

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'stats', name: 'Quick Stats', visible: true },
  { id: 'quickActions', name: 'Quick Actions', visible: true },
  { id: 'actions', name: 'Recent Action Items', visible: true },
  { id: 'proposedAutomations', name: 'Proposed Automations', visible: true },
  { id: 'meetings', name: 'Recent Meetings', visible: true },
  { id: 'askBrain', name: 'Ask The Brain (Mini-Chat)', visible: true },
  { id: 'documents', name: 'Recent Documents', visible: true },
  { id: 'decisions', name: 'Recent Decisions', visible: true },
  { id: 'drafts', name: 'Pending Drafts', visible: true },
  { id: 'memory', name: 'Memory Health', visible: true }
];

export default function DashboardPage() {
  const { user, token } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>({
    meetings: 0, documents: 0, slackMessages: 0, brainQueries: 0, lastSync: null,
  });
  const [syncing, setSyncing] = useState(false);
  const [recentMeetings, setRecentMeetings] = useState<Array<{
    id: string; title: string; meeting_date: string; source_type: string;
    insights?: { summary?: string; action_items?: Array<{ task: string; assignee: string }> };
  }>>([]);

  const [recentDocuments, setRecentDocuments] = useState<any[]>([]);
  const [recentDecisions, setRecentDecisions] = useState<any[]>([]);
  const [pendingDrafts, setPendingDrafts] = useState<any[]>([]);
  const [sourcesList, setSourcesList] = useState<any[]>([]);

  // Action Items state
  const [actionItems, setActionItems] = useState<any[]>([]);

  // Proposed Automations state
  const [proposedAutomations, setProposedAutomations] = useState<any[]>([]);
  const [selectedEmailAutomation, setSelectedEmailAutomation] = useState<any | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

  // Mini-Ask State
  const [askInput, setAskInput] = useState('');
  const [askResponse, setAskResponse] = useState('');
  const [askLoading, setAskLoading] = useState(false);

  // Widget customizer states
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Source Viewer Modal State
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [isSourceOpen, setIsSourceOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('dashboard_widgets_config_v3');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === DEFAULT_WIDGETS.length) {
          const ids = parsed.map(w => w.id);
          const allPresent = DEFAULT_WIDGETS.every(dw => ids.includes(dw.id));
          if (allPresent) {
            setWidgets(parsed);
          }
        }
      } catch (e) {
        console.error('Error parsing saved widgets config:', e);
      }
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    if (selectedEmailAutomation) {
      setEmailTo(selectedEmailAutomation.action_payload?.to || '');
      setEmailSubject(selectedEmailAutomation.action_payload?.subject || '');
      setEmailBody(selectedEmailAutomation.action_payload?.body || '');
    }
  }, [selectedEmailAutomation]);

  useEffect(() => {
    if (token) loadDashboardData();
  }, [token]);

  const saveWidgetsConfig = (newWidgets: WidgetConfig[]) => {
    setWidgets(newWidgets);
    localStorage.setItem('dashboard_widgets_config_v3', JSON.stringify(newWidgets));
  };

  const toggleWidgetVisibility = (id: string) => {
    const updated = widgets.map(w => w.id === id ? { ...w, visible: !w.visible } : w);
    saveWidgetsConfig(updated);
  };

  const moveWidget = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= widgets.length) return;
    const updated = [...widgets];
    const temp = updated[index];
    updated[index] = updated[newIndex];
    updated[newIndex] = temp;
    saveWidgetsConfig(updated);
  };

  const restoreDefaults = () => {
    saveWidgetsConfig(DEFAULT_WIDGETS);
  };

  const loadDashboardData = async () => {
    try {
      const data = await apiRequest('/api/dashboard/stats', {}, token!);
      setStats(data.stats);
      setRecentMeetings(data.recentMeetings || []);
    } catch (err) {
      console.warn('Dashboard stats not available:', err);
    }

    try {
      const docData = await apiRequest('/api/documents', {}, token!);
      setRecentDocuments(docData.documents || []);
    } catch (err) {
      console.warn('Recent documents not available:', err);
    }

    try {
      const decData = await apiRequest('/api/decisions', {}, token!);
      setRecentDecisions(decData.decisions || []);
    } catch (err) {
      console.warn('Recent decisions not available:', err);
    }

    try {
      const draftData = await apiRequest('/api/documents/drafts', {}, token!);
      setPendingDrafts(draftData.drafts || []);
    } catch (err) {
      console.warn('Pending drafts not available:', err);
    }

    try {
      const sourcesData = await apiRequest('/api/brain/sources', {}, token!);
      setSourcesList(sourcesData.sources || []);
    } catch (err) {
      console.warn('Sources not available:', err);
    }

    try {
      const actionsData = await apiRequest('/api/action_items', {}, token!);
      setActionItems((actionsData.action_items || []).filter((a: any) => a.status !== 'completed').slice(0, 6));
    } catch (err) {
      console.warn('Action items not available:', err);
    }

    try {
      const autoData = await apiRequest('/api/proactivity', {}, token!);
      setProposedAutomations((autoData.automations || []).filter((a: any) => a.status === 'pending').slice(0, 5));
    } catch (err) {
      console.warn('Proposed automations not available:', err);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await Promise.allSettled([
        apiRequest('/api/integrations/sync/google workspace', { method: 'POST' }, token!),
        apiRequest('/api/integrations/sync/slack', { method: 'POST' }, token!),
        apiRequest('/api/integrations/sync/discord', { method: 'POST' }, token!),
      ]);
      await loadDashboardData();
      alert('Data synced from connected integrations!');
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  const handleMiniAsk = async () => {
    if (!askInput.trim()) return;
    setAskLoading(true);
    setAskResponse('');
    try {
      const res = await apiRequest('/api/brain/query', {
        method: 'POST',
        body: JSON.stringify({ question: askInput })
      }, token!);
      setAskResponse(res.answer || 'No answer returned.');
    } catch (err: any) {
      setAskResponse(`Error: ${err.message}`);
    } finally {
      setAskLoading(false);
    }
  };

  // --- Action Items Handlers ---
  const toggleSubTaskStatus = async (itemId: string, subTaskId: string, currentSubStatus: string) => {
    const actionItem = actionItems.find(item => item.id === itemId);
    if (!actionItem || !actionItem.sub_tasks) return;

    const newSubStatus: 'open' | 'completed' = currentSubStatus === 'completed' ? 'open' : 'completed';
    const updatedSubTasks = actionItem.sub_tasks.map((st: any) =>
      st.id === subTaskId ? { ...st, status: newSubStatus } : st
    );

    const allCompleted = updatedSubTasks.every((st: any) => st.status === 'completed');
    const newParentStatus = allCompleted ? 'completed' : 'open';

    const originalSubTasks = actionItem.sub_tasks;
    const originalParentStatus = actionItem.status;

    setActionItems(prev =>
      prev.map(item =>
        item.id === itemId
          ? { ...item, status: newParentStatus, sub_tasks: updatedSubTasks }
          : item
      )
    );

    try {
      await apiRequest(`/api/action_items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ sub_tasks: updatedSubTasks })
      }, token!);
      if (allCompleted) {
        setTimeout(() => {
          setActionItems(prev => prev.filter(item => item.id !== itemId));
        }, 600);
      }
    } catch (err) {
      console.error('Failed to update sub-task status:', err);
      setActionItems(prev =>
        prev.map(item =>
          item.id === itemId
            ? { ...item, status: originalParentStatus, sub_tasks: originalSubTasks }
            : item
        )
      );
    }
  };

  // --- Proposed Automations Handlers ---
  const handleApproveAutomation = async (id: string) => {
    const targetAuto = proposedAutomations.find(item => item.id === id);
    if (targetAuto && targetAuto.type === 'email') {
      setSelectedEmailAutomation(targetAuto);
      setShowEmailModal(true);
      return;
    }

    try {
      setProposedAutomations(prev => prev.filter(item => item.id !== id));
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/proactivity/approve/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) throw new Error('Failed to approve automation');
    } catch (err: any) {
      console.error(err);
      try {
        const autoData = await apiRequest('/api/proactivity', {}, token!);
        setProposedAutomations((autoData.automations || []).filter((a: any) => a.status === 'pending').slice(0, 5));
      } catch (fetchErr) {
        console.error('Failed to re-fetch after error:', fetchErr);
      }
    }
  };

  const submitApprovedEmail = async () => {
    if (!selectedEmailAutomation) return;
    const id = selectedEmailAutomation.id;
    try {
      setProposedAutomations(prev => prev.filter(item => item.id !== id));
      setShowEmailModal(false);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/proactivity/approve/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          overrides: { to: emailTo, subject: emailSubject, body: emailBody }
        })
      });
      if (!res.ok) throw new Error('Failed to approve and send email');
    } catch (err: any) {
      console.error(err);
    } finally {
      setSelectedEmailAutomation(null);
    }
  };

  const handleDismissAutomation = async (id: string) => {
    try {
      setProposedAutomations(prev => prev.filter(item => item.id !== id));
      await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/proactivity/reject/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
    } catch (err: any) {
      console.error(err);
    }
  };

  const sourceCards = [
    { icon: Calendar, label: 'Meetings', count: stats.meetings, color: 'var(--accent-primary)', href: '/dashboard/meetings' },
    { icon: FileText, label: 'Documents', count: stats.documents, color: 'var(--accent-cyan)', href: '/dashboard/documents' },
    { icon: Hash, label: 'Slack Messages', count: stats.slackMessages, color: 'var(--accent-emerald)', href: '/dashboard/slack' },
    { icon: MessageSquare, label: 'Brain Queries', count: stats.brainQueries, color: 'var(--accent-amber)', href: '/dashboard/chat' },
  ];

  const quickActions = [
    { icon: Brain, label: 'Ask The Brain', desc: 'Query your company knowledge', onClick: () => router.push('/dashboard/chat') },
    { icon: Calendar, label: 'Sync Meetings', desc: 'Pull latest meeting transcripts', onClick: handleSync },
    { icon: FileText, label: 'Upload Document', desc: 'Add docs to company memory', onClick: () => router.push('/dashboard/documents') },
  ];

  const widgetHeader = (title: string, icon: any, color: string, action?: { label: string, onClick: () => void }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: '32px', height: '32px', borderRadius: '6px',
          background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          {icon}
        </div>
        <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{title}</h3>
      </div>
      {action && (
        <button onClick={action.onClick} className="btn-ghost" style={{ fontSize: '11px', padding: '4px 8px', color: 'var(--accent-secondary)', display: 'flex', alignItems: 'center', gap: '2px' }}>
          {action.label}
          <ArrowUpRight size={12} />
        </button>
      )}
    </div>
  );

  const renderStatsWidget = (widgetId: string) => (
    <div key={widgetId} className="glass-card animate-fade-in" style={{ padding: '20px', border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {widgetHeader('Quick Stats', <TrendingUp size={16} color="var(--accent-cyan)" />, 'var(--accent-cyan)')}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', flex: 1 }}>
        {sourceCards.map((card) => (
          <button
            key={card.label}
            onClick={() => router.push(card.href)}
            style={{
              padding: '16px',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s ease',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = card.color;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border-default)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <card.icon size={14} style={{ color: card.color }} />
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{card.label}</span>
            </div>
            <span style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)' }}>{card.count}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const renderQuickActionsWidget = (widgetId: string) => (
    <div key={widgetId} className="glass-card animate-fade-in" style={{ padding: '20px', border: '1px solid var(--border-default)', height: '100%' }}>
      {widgetHeader('Quick Actions', <Zap size={16} color="var(--accent-amber)" />, 'var(--accent-amber)')}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {quickActions.map((action) => (
          <button
            key={action.label}
            onClick={action.onClick}
            disabled={syncing && action.label === 'Sync Meetings'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '12px 14px',
              cursor: 'pointer',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              textAlign: 'left',
              transition: 'all 0.2s ease',
              width: '100%',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--accent-primary)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border-default)';
            }}
          >
            <div style={{
              width: '28px', height: '28px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(99,102,241,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <action.icon size={14} style={{ color: 'var(--accent-secondary)' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '13px', fontWeight: 600, margin: 0, color: 'var(--text-primary)' }}>{action.label}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{action.desc}</p>
            </div>
            <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />
          </button>
        ))}
      </div>
    </div>
  );

  const renderMeetingsWidget = (widgetId: string) => (
    <div key={widgetId} className="glass-card animate-fade-in" style={{ padding: '20px', border: '1px solid var(--border-default)', height: '100%' }}>
      {widgetHeader('Recent Meetings', <Calendar size={16} color="var(--accent-cyan)" />, 'var(--accent-cyan)', { label: 'All Meetings', onClick: () => router.push('/dashboard/meetings') })}
      {recentMeetings.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          No recent meetings.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {recentMeetings.slice(0, 3).map((meeting) => (
            <button
              key={meeting.id}
              onClick={() => router.push(`/dashboard/meetings/${meeting.id}`)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 12px',
                cursor: 'pointer',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                textAlign: 'left',
                width: '100%',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
            >
              <div style={{
                width: '28px', height: '28px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(34,211,238,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Calendar size={14} style={{ color: 'var(--accent-cyan)' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: '13px', fontWeight: 600, margin: 0, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {meeting.title}
                </p>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {new Date(meeting.meeting_date).toLocaleDateString()}
                </span>
              </div>
              <span className="badge badge-info" style={{ fontSize: '10px' }}>{meeting.source_type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const renderAskBrainWidget = (widgetId: string) => (
    <div key={widgetId} className="glass-card animate-fade-in" style={{ padding: '20px', border: '1px solid var(--border-default)', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {widgetHeader('Ask The Brain', <Brain size={16} color="var(--accent-primary)" />, 'var(--accent-primary)', { label: 'Full Chat', onClick: () => router.push('/dashboard/chat') })}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
        <div style={{
          flex: 1, minHeight: '80px', maxHeight: '120px', overflowY: 'auto',
          background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)',
          padding: '12px', fontSize: '13px', color: askResponse ? 'var(--text-primary)' : 'var(--text-muted)',
          border: '1px solid var(--border-subtle)', lineHeight: 1.5, display: 'flex', flexDirection: 'column'
        }}>
          {askLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)' }}>
              <Loader2 size={14} className="animate-spin" /> Querying memory...
            </div>
          ) : askResponse ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{askResponse}</div>
          ) : (
            <div style={{ fontStyle: 'italic', margin: 'auto' }}>Ask a quick question about company files and meetings.</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={askInput}
            onChange={(e) => setAskInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleMiniAsk();
            }}
            placeholder="Ask something..."
            style={{
              flex: 1, padding: '8px 12px', background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)', fontSize: '13px', outline: 'none'
            }}
          />
          <button
            onClick={handleMiniAsk}
            disabled={askLoading || !askInput.trim()}
            className="btn-primary"
            style={{ padding: '8px 14px', fontSize: '13px' }}
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );

  const renderDocumentsWidget = (widgetId: string) => (
    <div key={widgetId} className="glass-card animate-fade-in" style={{ padding: '20px', border: '1px solid var(--border-default)', height: '100%' }}>
      {widgetHeader('Recent Documents', <FileText size={16} color="var(--accent-cyan)" />, 'var(--accent-cyan)', { label: 'All Documents', onClick: () => router.push('/dashboard/documents') })}
      {recentDocuments.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          No recent documents.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {recentDocuments.slice(0, 3).map((doc) => (
            <button
              key={doc.id}
              onClick={() => {
                setSelectedDocId(doc.id);
                setIsSourceOpen(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 12px',
                cursor: 'pointer',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                textAlign: 'left',
                width: '100%',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-primary)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-default)'}
            >
              <div style={{
                width: '28px', height: '28px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(34,211,238,0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <FileText size={14} style={{ color: 'var(--accent-cyan)' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: '13px', fontWeight: 600, margin: 0, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {doc.title}
                </p>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {doc.document_type} • {new Date(doc.created_at).toLocaleDateString()}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const renderDecisionsWidget = (widgetId: string) => (
    <div key={widgetId} className="glass-card animate-fade-in" style={{ padding: '20px', border: '1px solid var(--border-default)', height: '100%' }}>
      {widgetHeader('Recent Decisions', <CheckSquare size={16} color="var(--accent-emerald)" />, 'var(--accent-emerald)', { label: 'Decisions Log', onClick: () => router.push('/dashboard/decisions') })}
      {recentDecisions.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          No recent decisions.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {recentDecisions.slice(0, 3).map((dec) => (
            <div
              key={dec.id}
              style={{
                padding: '10px 12px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              <p style={{ fontSize: '13px', fontWeight: 500, margin: 0, color: 'var(--text-primary)', lineHeight: '1.4' }}>
                {dec.text}
              </p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                <span>By: {dec.made_by || 'Team'}</span>
                <span>{new Date(dec.date).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderDraftsWidget = (widgetId: string) => (
    <div key={widgetId} className="glass-card animate-fade-in" style={{ padding: '20px', border: '1px solid var(--border-default)', height: '100%' }}>
      {widgetHeader('Pending Drafts', <FileText size={16} color="var(--accent-amber)" />, 'var(--accent-amber)')}
      {pendingDrafts.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          No pending drafts.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {pendingDrafts.slice(0, 3).map((draft) => (
            <div
              key={draft.id}
              style={{
                padding: '10px 12px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-default)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px'
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontSize: '13px', fontWeight: 600, margin: 0, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {draft.title}
                </p>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Format: {draft.format?.toUpperCase()} • {new Date(draft.created_at).toLocaleDateString()}
                </span>
              </div>
              <button
                onClick={() => router.push(`/dashboard/documents/drafts/${draft.id}`)}
                className="btn-ghost"
                style={{ fontSize: '11px', padding: '4px 8px', color: 'var(--accent-secondary)' }}
              >
                Review
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderMemoryWidget = (widgetId: string) => {
    const score = sourcesList.length > 5 ? 98 : sourcesList.length > 0 ? 60 : 10;
    const statusColor = score > 90 ? 'var(--accent-emerald)' : score > 50 ? 'var(--accent-cyan)' : 'var(--accent-amber)';
    const statusLabel = score > 90 ? 'Robust' : score > 50 ? 'Growing' : 'Weak';

    return (
      <div key={widgetId} className="glass-card animate-fade-in" style={{ padding: '20px', border: '1px solid var(--border-default)', height: '100%' }}>
        {widgetHeader('Memory Health', <Activity size={16} color={statusColor} />, statusColor, { label: 'Go to Health', onClick: () => router.push('/dashboard/memory') })}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              <span>Knowledge Base Health</span>
              <span style={{ fontWeight: 700, color: statusColor }}>{score}% ({statusLabel})</span>
            </div>
            <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: `${score}%`, height: '100%', background: `linear-gradient(90deg, var(--accent-primary), ${statusColor})`, borderRadius: '3px' }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--bg-tertiary)', padding: '12px', borderRadius: 'var(--radius-md)', fontSize: '13px' }}>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', marginBottom: '2px' }}>Total Indexed Sources</div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '16px' }}>{sourcesList.length} sources</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', marginBottom: '2px' }}>Vibe Check</div>
              <div style={{ fontWeight: 700, color: 'var(--accent-cyan)', fontSize: '16px' }}>Indexed</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const sourceIcon = (source: string) => {
    switch (source?.toLowerCase()) {
      case 'email': return <Mail size={12} style={{ color: '#3b82f6' }} />;
      case 'slack': return <Hash size={12} style={{ color: 'var(--accent-emerald)' }} />;
      case 'meeting': case 'meetings': return <Calendar size={12} style={{ color: 'var(--accent-cyan)' }} />;
      case 'document': case 'docs': return <FileText size={12} style={{ color: 'var(--accent-amber)' }} />;
      default: return <CircleDot size={12} style={{ color: 'var(--text-muted)' }} />;
    }
  };

  const renderActionsWidget = (widgetId: string) => (
    <div key={widgetId} className="glass-card animate-fade-in" style={{ padding: '20px', border: '1px solid var(--border-default)', height: '100%' }}>
      {widgetHeader('Recent Action Items', <ListChecks size={16} color="var(--accent-primary)" />, 'var(--accent-primary)', { label: 'All Actions', onClick: () => router.push('/dashboard/decisions?tab=actions') })}
      {actionItems.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          <CheckSquare size={24} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
          <p style={{ margin: 0 }}>No pending action items detected.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {actionItems.slice(0, 4).map((item) => {
            const completedCount = (item.sub_tasks || []).filter((st: any) => st.status === 'completed').length;
            const totalCount = (item.sub_tasks || []).length;
            const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
            return (
              <div
                key={item.id}
                style={{
                  padding: '12px 14px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  transition: 'all 0.2s ease',
                }}
              >
                {/* Task header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{
                    width: '22px', height: '22px', borderRadius: '4px',
                    background: progress === 100 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, marginTop: '1px'
                  }}>
                    {progress === 100
                      ? <Check size={12} style={{ color: 'var(--accent-emerald)' }} />
                      : <Square size={12} style={{ color: 'var(--accent-secondary)' }} />
                    }
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontSize: '13px', fontWeight: 600, margin: 0, color: 'var(--text-primary)',
                      lineHeight: '1.4',
                      textDecoration: progress === 100 ? 'line-through' : 'none',
                      opacity: progress === 100 ? 0.6 : 1
                    }}>
                      {item.task}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                      {item.source_type && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '3px',
                          fontSize: '10px', color: 'var(--text-muted)',
                          background: 'rgba(255,255,255,0.04)', padding: '2px 6px',
                          borderRadius: '4px', border: '1px solid rgba(255,255,255,0.04)'
                        }}>
                          {sourceIcon(item.source_type)}
                          {item.source_type}
                        </span>
                      )}
                      {item.assignee && (
                        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                          → {item.assignee}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sub-tasks checklist */}
                {totalCount > 0 && (
                  <div style={{ paddingLeft: '32px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {/* Progress bar */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <div style={{ flex: 1, height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{
                          width: `${progress}%`, height: '100%',
                          background: progress === 100
                            ? 'var(--accent-emerald)'
                            : 'linear-gradient(90deg, var(--accent-primary), var(--accent-cyan))',
                          borderRadius: '2px',
                          transition: 'width 0.3s ease'
                        }} />
                      </div>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                        {completedCount}/{totalCount}
                      </span>
                    </div>
                    {item.sub_tasks.slice(0, 4).map((st: any) => (
                      <button
                        key={st.id}
                        onClick={() => toggleSubTaskStatus(item.id, st.id, st.status)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '8px',
                          padding: '4px 6px', background: 'none', border: 'none',
                          cursor: 'pointer', textAlign: 'left', borderRadius: '4px',
                          transition: 'background 0.15s ease'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'none'}
                      >
                        <div style={{
                          width: '16px', height: '16px', borderRadius: '3px',
                          border: st.status === 'completed' ? 'none' : '1.5px solid rgba(255,255,255,0.2)',
                          background: st.status === 'completed' ? 'var(--accent-emerald)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0, transition: 'all 0.2s ease'
                        }}>
                          {st.status === 'completed' && <Check size={10} style={{ color: '#fff' }} />}
                        </div>
                        <span style={{
                          fontSize: '12px',
                          color: st.status === 'completed' ? 'var(--text-muted)' : 'var(--text-secondary)',
                          textDecoration: st.status === 'completed' ? 'line-through' : 'none',
                          transition: 'all 0.2s ease'
                        }}>
                          {st.text}
                        </span>
                      </button>
                    ))}
                    {item.sub_tasks.length > 4 && (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', paddingLeft: '24px' }}>
                        +{item.sub_tasks.length - 4} more...
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const automationTypeConfig: Record<string, { icon: any; color: string; label: string }> = {
    email: { icon: <Mail size={14} style={{ color: '#3b82f6' }} />, color: '#3b82f6', label: 'Email Draft' },
    slack: { icon: <Hash size={14} style={{ color: 'var(--accent-emerald)' }} />, color: 'var(--accent-emerald)', label: 'Slack Action' },
    meeting: { icon: <Calendar size={14} style={{ color: 'var(--accent-cyan)' }} />, color: 'var(--accent-cyan)', label: 'Meeting Sync' },
    document: { icon: <FileText size={14} style={{ color: 'var(--accent-amber)' }} />, color: 'var(--accent-amber)', label: 'Document' },
    reminder: { icon: <AlertCircle size={14} style={{ color: '#f59e0b' }} />, color: '#f59e0b', label: 'Reminder' },
  };

  const renderProposedAutomationsWidget = (widgetId: string) => (
    <div key={widgetId} className="glass-card animate-fade-in" style={{ padding: '20px', border: '1px solid var(--border-default)', height: '100%' }}>
      {widgetHeader('Proposed Automations', <Wand2 size={16} color="var(--accent-cyan)" />, 'var(--accent-cyan)')}
      {proposedAutomations.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          <Wand2 size={24} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
          <p style={{ margin: 0 }}>No proposed automations right now.</p>
          <p style={{ margin: '4px 0 0', fontSize: '11px', opacity: 0.7 }}>The Brain will suggest automations when it detects repetitive patterns.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {proposedAutomations.slice(0, 4).map((auto) => {
            const config = automationTypeConfig[auto.type] || { icon: <Sparkles size={14} style={{ color: 'var(--accent-secondary)' }} />, color: 'var(--accent-secondary)', label: auto.type || 'Automation' };
            return (
              <div
                key={auto.id}
                style={{
                  padding: '12px 14px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{
                    width: '30px', height: '30px', borderRadius: '6px',
                    background: `${config.color}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, marginTop: '1px'
                  }}>
                    {config.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '13px', fontWeight: 600, margin: 0, color: 'var(--text-primary)', lineHeight: '1.4' }}>
                      {auto.description}
                    </p>
                    {auto.brain_documents && (
                      <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '3px 0 0', lineHeight: '1.4' }}>
                        Source: {auto.brain_documents.title}
                      </p>
                    )}
                    <span style={{
                      display: 'inline-block', marginTop: '5px',
                      fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
                      background: `${config.color}12`, color: config.color,
                      border: `1px solid ${config.color}25`, fontWeight: 600
                    }}>
                      {config.label}
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '8px' }}>
                  <button
                    onClick={() => handleDismissAutomation(auto.id)}
                    className="btn-ghost"
                    style={{ fontSize: '11px', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-muted)' }}
                  >
                    <X size={12} />
                    Dismiss
                  </button>
                  <button
                    onClick={() => handleApproveAutomation(auto.id)}
                    style={{
                      fontSize: '11px', padding: '5px 14px', display: 'flex', alignItems: 'center', gap: '4px',
                      background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
                      color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)'; }}
                  >
                    <Check size={12} />
                    Approve
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const activeWidgets = widgets.filter(w => w.visible);

  return (
    <div style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div className="animate-fade-in" style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: 800, letterSpacing: '-0.02em' }}>
            Welcome back, <span className="gradient-text">{user?.user_metadata?.full_name || user?.email?.split('@')[0]}</span>
          </h1>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', position: 'relative' }}>
            <button
              onClick={() => setShowCustomizer(!showCustomizer)}
              className="btn-ghost"
              style={{ fontSize: '13px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Settings size={14} />
              Customize
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="btn-ghost"
              style={{ fontSize: '13px', padding: '8px 16px' }}
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>


          </div>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '15px' }}>
          {stats.lastSync
            ? `Last synced ${new Date(stats.lastSync).toLocaleString()}`
            : 'Connect your integrations to start building The Brain\'s memory.'}
        </p>
      </div>

      {/* Grid of Widgets */}
      {isLoaded && activeWidgets.length > 0 ? (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(450px, 1fr))',
          gap: '24px',
          marginTop: '16px'
        }}>
          {widgets.filter(w => w.visible).map((widget) => {
            const renderContent = () => {
              switch (widget.id) {
                case 'stats':
                  return renderStatsWidget(widget.id);
                case 'quickActions':
                  return renderQuickActionsWidget(widget.id);
                case 'meetings':
                  return renderMeetingsWidget(widget.id);
                case 'askBrain':
                  return renderAskBrainWidget(widget.id);
                case 'documents':
                  return renderDocumentsWidget(widget.id);
                case 'decisions':
                  return renderDecisionsWidget(widget.id);
                case 'drafts':
                  return renderDraftsWidget(widget.id);
                case 'actions':
                  return renderActionsWidget(widget.id);
                case 'proposedAutomations':
                  return renderProposedAutomationsWidget(widget.id);
                case 'memory':
                  return renderMemoryWidget(widget.id);
                default:
                  return null;
              }
            };
            return (
              <Fragment key={widget.id}>
                {renderContent()}
              </Fragment>
            );
          })}
        </div>
      ) : isLoaded ? (
        /* Empty State */
        <div className="glass-card animate-fade-in" style={{ padding: '60px 40px', textAlign: 'center', marginTop: '32px' }}>
          <Brain size={48} style={{ color: 'var(--text-muted)', margin: '0 auto 20px', opacity: 0.5 }} />
          <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Your Dashboard is Empty</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '20px', maxWidth: '400px', margin: '0 auto 24px' }}>
            You have disabled all widgets. Click customize below to choose what you want to see on your homepage.
          </p>
          <button onClick={restoreDefaults} className="btn-primary" style={{ margin: '0 auto' }}>
            Restore Default Widgets
          </button>
        </div>
      ) : null}

      {/* Customizer Drawer */}
      {showCustomizer && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            backdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
          onClick={() => setShowCustomizer(false)}
        >
          <style>{`
            @keyframes slideIn {
              from { transform: translateX(100%); }
              to { transform: translateX(0); }
            }
          `}</style>
          <div 
            style={{
              width: '100%',
              maxWidth: '400px',
              height: '100%',
              background: 'rgba(15, 23, 42, 0.95)',
              backdropFilter: 'blur(20px)',
              borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
              boxShadow: '-10px 0 30px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              padding: '32px 24px',
              gap: '24px',
              position: 'relative',
              animation: 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Settings size={18} style={{ color: 'var(--accent-secondary)' }} />
                <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>Customize Home Widgets</span>
              </div>
              <button 
                onClick={() => setShowCustomizer(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: '4px' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Summary Info */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(99, 102, 241, 0.06)', border: '1px solid rgba(99, 102, 241, 0.15)', padding: '12px 16px', borderRadius: '10px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Active Widgets</span>
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-secondary)' }}>
                {activeWidgets.length} / {widgets.length}
              </span>
            </div>

            {/* Scrollable List */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '4px' }}>
              {widgets.map((w, index) => {
                let WidgetIcon = Brain;
                let widgetDesc = "";
                switch (w.id) {
                  case 'stats':
                    WidgetIcon = TrendingUp;
                    widgetDesc = "Key workspace counts and statistics.";
                    break;
                  case 'quickActions':
                    WidgetIcon = Zap;
                    widgetDesc = "Shortcut triggers for core automation flows.";
                    break;
                  case 'meetings':
                    WidgetIcon = Calendar;
                    widgetDesc = "List of recent transcribed team syncs.";
                    break;
                  case 'askBrain':
                    WidgetIcon = MessageSquare;
                    widgetDesc = "Direct quick querying interface for database.";
                    break;
                  case 'documents':
                    WidgetIcon = FileText;
                    widgetDesc = "Recently uploaded or generated files.";
                    break;
                  case 'decisions':
                    WidgetIcon = CheckSquare;
                    widgetDesc = "List of recent extracted action items.";
                    break;
                  case 'drafts':
                    WidgetIcon = FileText;
                    widgetDesc = "Pending templates waiting for your approval.";
                    break;
                  case 'memory':
                    WidgetIcon = Activity;
                    widgetDesc = "Indexed source counts and system score.";
                    break;
                  case 'actions':
                    WidgetIcon = ListChecks;
                    widgetDesc = "Pending action items with sub-task checklists.";
                    break;
                  case 'proposedAutomations':
                    WidgetIcon = Wand2;
                    widgetDesc = "OS-suggested automations you can approve or dismiss.";
                    break;
                }

                return (
                  <div 
                    key={w.id} 
                    style={{ 
                      display: 'flex', 
                      flexDirection: 'column',
                      gap: '10px',
                      padding: '14px', 
                      background: w.visible ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.005)', 
                      border: '1px solid rgba(255, 255, 255, 0.04)', 
                      borderRadius: '12px',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <div style={{
                          width: '28px', height: '28px', borderRadius: '6px',
                          background: w.visible ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.2s ease'
                        }}>
                          <WidgetIcon size={14} style={{ color: w.visible ? 'var(--accent-secondary)' : 'var(--text-muted)' }} />
                        </div>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: w.visible ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {w.name}
                        </span>
                      </div>
                      
                      {/* Toggle Switch */}
                      <button
                        onClick={() => toggleWidgetVisibility(w.id)}
                        style={{
                          width: '38px',
                          height: '20px',
                          borderRadius: '10px',
                          background: w.visible ? 'var(--accent-secondary)' : 'rgba(255,255,255,0.08)',
                          border: 'none',
                          cursor: 'pointer',
                          position: 'relative',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          alignItems: 'center',
                          padding: '2px'
                        }}
                      >
                        <div style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '50%',
                          background: '#ffffff',
                          transition: 'transform 0.2s ease',
                          transform: w.visible ? 'translateX(18px)' : 'translateX(0)'
                        }} />
                      </button>
                    </div>

                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, paddingLeft: '38px', lineHeight: '1.4' }}>
                      {widgetDesc}
                    </p>

                    {/* Reordering Controls */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px', borderTop: '1px solid rgba(255, 255, 255, 0.03)', paddingTop: '8px', marginTop: '4px' }}>
                      <button
                        onClick={() => moveWidget(index, 'up')}
                        disabled={index === 0}
                        className="btn-ghost"
                        style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '2px', opacity: index === 0 ? 0.3 : 1 }}
                      >
                        <ChevronUp size={12} />
                        Move Up
                      </button>
                      <button
                        onClick={() => moveWidget(index, 'down')}
                        disabled={index === widgets.length - 1}
                        className="btn-ghost"
                        style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '2px', opacity: index === widgets.length - 1 ? 0.3 : 1 }}
                      >
                        <ChevronDown size={12} />
                        Move Down
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Reset Defaults */}
            <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '16px', display: 'flex', gap: '12px' }}>
              <button onClick={restoreDefaults} className="btn-ghost" style={{ flex: 1, padding: '10px', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <RefreshCw size={14} />
                Reset to Default
              </button>
              <button onClick={() => setShowCustomizer(false)} className="btn-primary" style={{ flex: 1, padding: '10px', fontSize: '13px' }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Review Modal for Proposed Automations */}
      {showEmailModal && selectedEmailAutomation && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '20px',
        }}>
          <div className="glass-card animate-fade-in" style={{
            width: '100%',
            maxWidth: '600px',
            padding: '28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
            background: 'rgba(15, 15, 20, 0.98)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(99, 102, 241, 0.15)',
          }}>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                <Mail size={20} style={{ color: '#3b82f6' }} />
                Review Email Draft
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                The Brain prepared this draft. Review and edit before sending.
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Recipient Email (To)
                </label>
                <input
                  type="email"
                  placeholder="recipient@example.com"
                  value={emailTo}
                  onChange={e => setEmailTo(e.target.value)}
                  className="input-field"
                  style={{ fontSize: '14px', padding: '10px 12px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Subject Line
                </label>
                <input
                  type="text"
                  placeholder="Subject"
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                  className="input-field"
                  style={{ fontSize: '14px', padding: '10px 12px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                  Email Body
                </label>
                <textarea
                  placeholder="Write email contents..."
                  value={emailBody}
                  onChange={e => setEmailBody(e.target.value)}
                  className="input-field"
                  rows={8}
                  style={{ fontSize: '14px', padding: '12px', resize: 'vertical', minHeight: '160px', fontFamily: 'inherit', lineHeight: '1.5' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
              <button
                onClick={() => {
                  setShowEmailModal(false);
                  setSelectedEmailAutomation(null);
                }}
                className="btn-ghost"
                style={{ padding: '10px 16px' }}
              >
                Cancel
              </button>
              <button
                onClick={submitApprovedEmail}
                className="btn-primary"
                style={{
                  padding: '10px 20px',
                  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}
              >
                <Mail size={16} /> Approve & Send
              </button>
            </div>
          </div>
        </div>
      )}

      <SourceViewer
        documentId={selectedDocId}
        isOpen={isSourceOpen}
        onClose={() => setIsSourceOpen(false)}
        token={token}
      />
    </div>
  );
}
