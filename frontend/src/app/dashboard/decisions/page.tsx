'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../layout';
import { apiRequest } from '@/lib/api';
import {
  CheckSquare, Square, ArrowUpRight, Calendar, FileText, Loader2, Search, RefreshCw,
  ListTodo, BookOpen, CheckCircle2, ChevronRight, Briefcase, Hash, Mail, MessageSquare,
  Sparkles, Bot, TrendingUp, Users, Megaphone, Pencil, Globe, Check, X, ThumbsUp,
  ThumbsDown, AlertCircle, Clock, ExternalLink, Zap, Map, FileDown
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import SourceViewer from '@/components/SourceViewer';
import ExportDialog from '@/components/ExportDialog';


// Helper to translate structured output into markdown for formatting exports
function convertOutputToMarkdown(title: string, summary: string, type: string, data: any): string {
  if (!data) return '';
  let markdown = `# ${title || 'Deliverable'}\n\n`;
  if (summary) {
    markdown += `> ${summary}\n\n`;
  }
  
  const formatValue = (val: any, indent = 0): string => {
    const spacing = ' '.repeat(indent);
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) {
      return val.map(item => {
        if (typeof item === 'object') {
          return `\n${spacing}- ${formatValue(item, indent + 2)}`;
        }
        return `\n${spacing}- ${item}`;
      }).join('');
    }
    if (typeof val === 'object') {
      let result = '';
      for (const [k, v] of Object.entries(val)) {
        const cleanKey = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        if (typeof v === 'object') {
          result += `\n${spacing}**${cleanKey}**:${formatValue(v, indent + 2)}`;
        } else {
          result += `\n${spacing}**${cleanKey}**: ${v}`;
        }
      }
      return result;
    }
    return String(val);
  };

  if (Array.isArray(data)) {
    markdown += data.map((item, idx) => {
      let itemStr = `## Item ${idx + 1}\n`;
      if (item && typeof item === 'object') {
        if (item.name || item.company || item.title) {
          itemStr = `## ${item.name || item.company || item.title}\n`;
        }
        for (const [k, v] of Object.entries(item)) {
          if (['name', 'company', 'title'].includes(k.toLowerCase())) continue;
          const cleanKey = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          if (typeof v === 'object') {
            itemStr += `**${cleanKey}**:\n${formatValue(v, 2)}\n\n`;
          } else {
            itemStr += `**${cleanKey}**: ${v}\n\n`;
          }
        }
      } else {
        itemStr += `${item}\n\n`;
      }
      return itemStr;
    }).join('\n');
  } else if (typeof data === 'object') {
    if (data.findings && typeof data.findings === 'string') {
      markdown += `${data.findings}\n\n`;
    }
    if (data.content && typeof data.content === 'string') {
      markdown += `${data.content}\n\n`;
    }
    
    for (const [key, value] of Object.entries(data)) {
      if (key === 'findings' || key === 'content' || key === 'logs' || key === 'researchNotes') continue;
      const cleanKey = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      markdown += `## ${cleanKey}\n`;
      if (typeof value === 'object') {
        markdown += `${formatValue(value)}\n\n`;
      } else {
        markdown += `${value}\n\n`;
      }
    }
  } else {
    markdown += String(data);
  }

  return markdown;
}


interface Decision {
  id: string;
  text: string;
  made_by: string | null;
  date: string | null;
  created_at: string;
  source_doc_id: string | null;
  roadmap_phase: string | null;
  roadmap_objective: string | null;
  brain_documents: {
    id: string;
    title: string;
    document_type: string;
  } | null;
}

interface ActionItem {
  id: string;
  task: string;
  assignee: string | null;
  assignee_user_id?: string | null;
  due_date: string | null;
  status: string;
  department: string | null;
  created_at: string;
  source_doc_id: string | null;
  decision_id?: string | null;
  sub_tasks?: { id: string; text: string; status: 'open' | 'completed' }[] | null;
  brain_documents: {
    id: string;
    title: string;
    document_type: string;
  } | null;
}

interface Approval {
  id: string;
  agent_execution_id: string;
  output_type: string;
  output_data: any;
  output_summary: string | null;
  status: 'pending' | 'approved' | 'rejected';
  feedback: string | null;
  reviewed_by: string | null;
  created_at: string;
  agent_executions?: {
    agent_label: string;
    agent_type: string;
    icon: string;
    color: string;
    output_summary: string | null;
  } | null;
}

interface Plan {
  id: string;
  title: string;
  document_type: string;
  department: string | null;
  semantic_type: string | null;
  sub_type: string | null;
  created_at: string;
}

interface TeamMember { user_id: string; full_name: string | null; email: string | null; position: string | null; is_you: boolean; }

export default function DecisionsPage() {
  const { token, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'decisions' | 'actions' | 'plans'>('decisions');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [showMyTasks, setShowMyTasks] = useState(false);
  const myUserId = user?.id || null;
  const teamMap = useMemo(() => {
    const m: Record<string, TeamMember> = {};
    teamMembers.forEach(t => { m[t.user_id] = t; });
    return m;
  }, [teamMembers]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  
  // Exporting state
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportTitle, setExportTitle] = useState('');
  const [exportContent, setExportContent] = useState('');

  const tabParam = searchParams.get('tab');

  useEffect(() => {
    if (tabParam === 'decisions' || tabParam === 'actions' || tabParam === 'plans') {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const getBadgeStyles = (type: string) => {
    switch ((type || '').toLowerCase()) {
      case 'meeting':
        return {
          background: 'rgba(99,102,241,0.08)',
          border: '1px solid rgba(99,102,241,0.2)',
          color: 'var(--accent-secondary)',
          hoverBackground: 'rgba(99,102,241,0.16)',
          hoverBorderColor: 'var(--accent-primary)'
        };
      case 'slack':
        return {
          background: 'rgba(34,211,238,0.08)',
          border: '1px solid rgba(34,211,238,0.2)',
          color: 'var(--accent-cyan)',
          hoverBackground: 'rgba(34,211,238,0.16)',
          hoverBorderColor: 'var(--accent-cyan)'
        };
      case 'email':
        return {
          background: 'rgba(251,191,36,0.08)',
          border: '1px solid rgba(251,191,36,0.2)',
          color: 'var(--accent-amber)',
          hoverBackground: 'rgba(251,191,36,0.16)',
          hoverBorderColor: 'var(--accent-amber)'
        };
      default:
        return {
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: 'var(--text-secondary)',
          hoverBackground: 'rgba(255,255,255,0.08)',
          hoverBorderColor: 'var(--text-primary)'
        };
    }
  };

  const getBadgeIcon = (type: string) => {
    switch ((type || '').toLowerCase()) {
      case 'meeting': return <Calendar size={12} style={{ flexShrink: 0 }} />;
      case 'slack': return <Hash size={12} style={{ flexShrink: 0 }} />;
      case 'email': return <Mail size={12} style={{ flexShrink: 0 }} />;
      default: return <FileText size={12} style={{ flexShrink: 0 }} />;
    }
  };

  const getPhaseConfig = (phase: string) => {
    switch ((phase || '').toLowerCase()) {
      case 'pre-seed':
        return { label: 'Pre-Seed', color: '#a855f7', bgColor: 'rgba(168,85,247,0.1)' };
      case 'seed':
        return { label: 'Seed', color: '#3b82f6', bgColor: 'rgba(59,130,246,0.1)' };
      case 'series-a':
        return { label: 'Series A', color: '#10b981', bgColor: 'rgba(16,185,129,0.1)' };
      case 'series-b':
        return { label: 'Series B', color: '#f59e0b', bgColor: 'rgba(245,158,11,0.1)' };
      case 'series-c':
        return { label: 'Series C', color: '#ec4899', bgColor: 'rgba(236,72,153,0.1)' };
      case 'ipo':
        return { label: 'IPO', color: '#6366f1', bgColor: 'rgba(99,102,241,0.1)' };
      default:
        return { label: phase, color: '#94a3b8', bgColor: 'rgba(148,163,184,0.1)' };
    }
  };

  useEffect(() => {
    if (token) loadData();
  }, [token]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [decRes, actRes, planRes, calRes, teamRes] = await Promise.all([
        apiRequest('/api/decisions', {}, token!).catch(err => ({ decisions: [] })),
        apiRequest('/api/action_items', {}, token!).catch(err => ({ action_items: [] })),
        apiRequest('/api/plans', {}, token!).catch(err => ({ plans: [] })),
        apiRequest('/api/calendar/events', {}, token!).catch(err => ({ events: [] })),
        apiRequest('/api/team', {}, token!).catch(() => ({ members: [] }))
      ]);
      setDecisions(decRes.decisions || []);
      setActionItems(actRes.action_items || []);
      setTeamMembers(teamRes.members || []);
      setPlans(planRes.plans || []);
      setCalendarEvents(calRes.events || []);
    } catch (err) {
      console.warn('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleActionItemStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'completed' ? 'open' : 'completed';
    const targetItem = actionItems.find(item => item.id === id);
    const updatedSubTasks = targetItem?.sub_tasks
      ? targetItem.sub_tasks.map(st => ({ ...st, status: newStatus as 'open' | 'completed' }))
      : null;

    // Optimistic UI update
    setActionItems(prev =>
      prev.map(item => 
        item.id === id 
          ? { 
              ...item, 
              status: newStatus,
              sub_tasks: updatedSubTasks || item.sub_tasks 
            } 
          : item
      )
    );
    try {
      await apiRequest(`/api/action_items/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      }, token!);
    } catch (err) {
      console.error('Failed to update action item status:', err);
      // Revert if error
      setActionItems(prev =>
        prev.map(item => 
          item.id === id 
            ? { 
                ...item, 
                status: currentStatus,
                sub_tasks: targetItem?.sub_tasks || item.sub_tasks 
              } 
            : item
        )
      );
    }
  };

  const toggleSubTaskStatus = async (itemId: string, subTaskId: string, currentSubStatus: string) => {
    const actionItem = actionItems.find(item => item.id === itemId);
    if (!actionItem || !actionItem.sub_tasks) return;

    const newSubStatus: 'open' | 'completed' = currentSubStatus === 'completed' ? 'open' : 'completed';
    const updatedSubTasks = actionItem.sub_tasks.map(st => 
      st.id === subTaskId ? { ...st, status: newSubStatus } : st
    );

    const allCompleted = updatedSubTasks.every(st => st.status === 'completed');
    const newParentStatus = allCompleted ? 'completed' : 'open';

    const originalSubTasks = actionItem.sub_tasks;
    const originalParentStatus = actionItem.status;

    // Optimistic UI update
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
        body: JSON.stringify({ 
          sub_tasks: updatedSubTasks 
        })
      }, token!);
    } catch (err) {
      console.error('Failed to update sub-task status:', err);
      // Revert if error
      setActionItems(prev =>
        prev.map(item => 
          item.id === itemId 
            ? { ...item, status: originalParentStatus, sub_tasks: originalSubTasks } 
            : item
        )
      );
    }
  };

  const filteredDecisions = decisions.filter(d =>
    d.text?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (d.made_by && d.made_by.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (d.brain_documents?.title && d.brain_documents.title.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const myTaskCount = actionItems.filter(a => myUserId && a.assignee_user_id === myUserId).length;
  const filteredActions = actionItems.filter(a => {
    const matchesSearch = a.task?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (a.assignee && a.assignee.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (a.brain_documents?.title && a.brain_documents.title.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesDept = departmentFilter === 'all' || a.department === departmentFilter;
    const matchesMine = !showMyTasks || (myUserId && a.assignee_user_id === myUserId);
    return matchesSearch && matchesDept && matchesMine;
  });

  const filteredPlans = plans.filter(p =>
    p.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.sub_type && p.sub_type.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (p.department && p.department.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredEvents = calendarEvents.filter(e =>
    e.summary?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    e.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (e.location && e.location.toLowerCase().includes(searchQuery.toLowerCase()))
  );


  const toggleExpandCard = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };


  const renderOutputPreview = (data: any, type: string): string => {
    if (!data) return '';
    if (typeof data === 'string') return data.substring(0, 300);

    switch (type) {
      case 'lead_list':
      case 'investor_list': {
        const items = data.leads || data.investors || [];
        if (items.length === 0) return JSON.stringify(data).substring(0, 300);
        return items.slice(0, 5).map((item: any, i: number) =>
          `${i + 1}. ${item.name || item.company || item.firm || 'Unnamed'}${item.reason ? ` — ${item.reason}` : ''}`
        ).join('\n') + (items.length > 5 ? `\n... and ${items.length - 5} more` : '');
      }
      case 'marketing_strategy':
        return data.executiveSummary || data.summary || (data.channels && Array.isArray(data.channels)
          ? `Channels: ${data.channels.map((c: any) => c.name).join(', ')}`
          : JSON.stringify(data).substring(0, 300));
      case 'competitor_analysis':
        if (data.competitors && Array.isArray(data.competitors)) {
          return data.competitors.slice(0, 3).map((c: any) =>
            `• ${c.name}${c.overview ? `: ${c.overview.substring(0, 100)}` : ''}`
          ).join('\n') + (data.competitors.length > 3 ? `\n... and ${data.competitors.length - 3} more` : '');
        }
        return data.summary || JSON.stringify(data).substring(0, 300);
      case 'content_draft':
      case 'social_post':
        if (data.posts && Array.isArray(data.posts)) {
          return data.posts.slice(0, 3).map((p: any, i: number) =>
            `Post ${i + 1}: ${p.hook || p.body?.substring(0, 100) || ''}`
          ).join('\n') + (data.posts.length > 3 ? `\n... and ${data.posts.length - 3} more` : '');
        }
        return data.content?.substring(0, 300) || JSON.stringify(data).substring(0, 300);
      case 'company_profile':
        return Object.entries(data).slice(0, 5).map(([k, v]) =>
          `${k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}: ${v}`
        ).join('\n') + (Object.keys(data).length > 5 ? '\n...' : '');
      case 'roadmap_proposal': {
        const objectives = data.objectives || [];
        if (objectives.length === 0) return 'No roadmap objectives proposed.';
        return objectives.slice(0, 3).map((obj: any) =>
          `• [${(obj.phase || '').toUpperCase()}] ${obj.label}${obj.children && obj.children.length > 0 ? ` (${obj.children.length} tasks)` : ''}`
        ).join('\n') + (objectives.length > 3 ? `\n... and ${objectives.length - 3} more` : '');
      }
      default:
        if (data.findings) return String(data.findings).substring(0, 300);
        if (data.summary) return String(data.summary).substring(0, 300);
        if (data.recommendations && Array.isArray(data.recommendations)) {
          return data.recommendations.slice(0, 5).map((r: string) => `• ${r}`).join('\n');
        }
        return JSON.stringify(data).substring(0, 300);
    }
  };

  const getOutputTypeConfig = (type: string) => {
    switch (type) {
      case 'marketing_strategy':
        return { icon: Megaphone, label: 'Marketing Strategy', color: '#f59e0b', bgColor: 'rgba(245,158,11,0.08)' };
      case 'lead_list':
        return { icon: Users, label: 'Lead List', color: '#3b82f6', bgColor: 'rgba(59,130,242,0.08)' };
      case 'investor_list':
        return { icon: TrendingUp, label: 'Investor List', color: '#ec4899', bgColor: 'rgba(236,72,153,0.08)' };
      case 'company_profile':
        return { icon: Globe, label: 'Company Profile', color: '#6366f1', bgColor: 'rgba(99,102,241,0.08)' };
      case 'content_draft':
        return { icon: Pencil, label: 'Content Draft', color: '#10b981', bgColor: 'rgba(16,185,129,0.08)' };
      case 'competitor_analysis':
        return { icon: Bot, label: 'Competitor Analysis', color: '#8b5cf6', bgColor: 'rgba(139,92,246,0.08)' };
      case 'roadmap_proposal':
        return { icon: Map, label: 'Roadmap Proposal', color: '#a855f7', bgColor: 'rgba(168,85,247,0.08)' };
      default:
        return { icon: FileText, label: type?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) || 'Output', color: '#6b7280', bgColor: 'rgba(107,114,128,0.08)' };
    }
  };

  return (
    <div style={{ padding: '32px', maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', height: '100%' }} className="animate-fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '4px' }} className="gradient-text">Decision Log</h1>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
            A central chronological ledger of every key decision, action item, and strategic plan extracted from company operations.
          </p>
        </div>
        <button onClick={loadData} disabled={loading} className="btn-ghost" style={{ padding: '8px 14px', fontSize: '12px' }}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} style={{ marginRight: '6px' }} />
          Reload
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-default)', paddingBottom: '1px', marginTop: '16px', marginBottom: '16px' }}>
        <button
          onClick={() => setActiveTab('decisions')}
          style={{
            padding: '12px 16px',
            fontSize: '14px',
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'decisions' ? '2px solid var(--accent-primary)' : '2px solid transparent',
            color: activeTab === 'decisions' ? 'var(--text-primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <CheckCircle2 size={16} />
          Decisions
          <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '10px', color: 'var(--text-secondary)' }}>
            {decisions.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('actions')}
          style={{
            padding: '12px 16px',
            fontSize: '14px',
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'actions' ? '2px solid var(--accent-primary)' : '2px solid transparent',
            color: activeTab === 'actions' ? 'var(--text-primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <ListTodo size={16} />
          Actions
          <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '10px', color: 'var(--text-secondary)' }}>
            {actionItems.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('plans')}
          style={{
            padding: '12px 16px',
            fontSize: '14px',
            fontWeight: 600,
            background: 'transparent',
            border: 'none',
            borderBottom: activeTab === 'plans' ? '2px solid var(--accent-primary)' : '2px solid transparent',
            color: activeTab === 'plans' ? 'var(--text-primary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <BookOpen size={16} />
          Plans
          <span style={{ fontSize: '11px', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: '10px', color: 'var(--text-secondary)' }}>
            {plans.length}
          </span>
        </button>
      </div>

      {/* Search Input */}
      <div style={{ position: 'relative', marginBottom: '24px' }}>
        <Search size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          type="text"
          placeholder={
            activeTab === 'decisions' 
              ? "Search decisions, deciders, or source documents..." 
              : activeTab === 'actions' 
                ? "Search action items, assignees, or source documents..." 
                : "Search plans, departments, or document titles..."
          }
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="input-field"
          style={{ paddingLeft: '40px', fontSize: '14px' }}
        />
      </div>

      {/* My-tasks filter (Actions tab only) */}
      {activeTab === 'actions' && myUserId && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', marginTop: '-8px' }}>
          <button
            onClick={() => setShowMyTasks(false)}
            className={showMyTasks ? 'btn-ghost' : 'btn-primary'}
            style={{ fontSize: '12px', padding: '6px 14px' }}
          >
            All tasks ({actionItems.length})
          </button>
          <button
            onClick={() => setShowMyTasks(true)}
            className={showMyTasks ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: '12px', padding: '6px 14px' }}
          >
            <Users size={12} /> Assigned to me ({myTaskCount})
          </button>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center' }}>
            <Loader2 size={32} className="animate-spin" style={{ color: 'var(--accent-primary)', margin: '0 auto' }} />
            <p style={{ marginTop: '16px', color: 'var(--text-secondary)', fontSize: '14px' }}>Loading central log...</p>
          </div>
        ) : (
          <>
            {/* DECISIONS TAB */}
            {activeTab === 'decisions' && (
              filteredDecisions.length === 0 ? (
                <div className="glass-card" style={{ padding: '60px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <CheckCircle2 size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
                  <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>No decisions found</h3>
                  <p style={{ fontSize: '14px', color: 'var(--text-muted)', maxWidth: '400px' }}>
                    {searchQuery ? 'Try adjusting your search terms.' : 'Decisions will automatically appear here once meetings or documents are ingested and analyzed by The Brain.'}
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {filteredDecisions.map((decision) => {
                    const isExpanded = expandedCards.has(decision.id);
                    const linkedActions = actionItems.filter(item => item.decision_id === decision.id);
                    const isMeeting = decision.brain_documents?.document_type === 'meeting';
                    const sourceTitle = decision.brain_documents?.title || 'Unknown Source';
                    const displaySourceTitle = sourceTitle.endsWith('.txt') 
                      ? sourceTitle.substring(0, sourceTitle.length - 4) 
                      : sourceTitle;

                    const roadmapPhaseLabels: Record<string, { label: string; color: string }> = {
                      'pre-seed': { label: 'Pre-Seed', color: '#8b5cf6' },
                      'seed': { label: 'Seed', color: '#f59e0b' },
                      'series-a': { label: 'Series A', color: '#3b82f6' },
                      'series-b': { label: 'Series B', color: '#10b981' },
                      'series-c': { label: 'Series C', color: '#ec4899' },
                      'ipo': { label: 'IPO', color: '#f43f5e' },
                    };
                    const phaseInfo = decision.roadmap_phase 
                      ? roadmapPhaseLabels[decision.roadmap_phase] 
                      : null;

                    return (
                      <div 
                        key={decision.id}
                        className="glass-card animate-fade-in"
                        style={{
                          border: isExpanded ? '1px solid rgba(99,102,241,0.3)' : '1px solid var(--border-default)',
                          borderRadius: '12px',
                          background: isExpanded ? 'rgba(99,102,241,0.02)' : 'rgba(255,255,255,0.01)',
                          transition: 'all 0.25s ease',
                          overflow: 'hidden'
                        }}
                      >
                        {/* Header Row */}
                        <div 
                          onClick={() => toggleExpandCard(decision.id)}
                          style={{
                            padding: '18px 24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            cursor: 'pointer',
                            userSelect: 'none',
                            gap: '16px'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1 }}>
                            <ChevronRight 
                              size={18} 
                              style={{ 
                                transform: isExpanded ? 'rotate(90deg)' : 'none', 
                                transition: 'transform 0.2s ease',
                                color: isExpanded ? 'var(--accent-primary)' : 'var(--text-muted)'
                              }} 
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                {decision.date ? new Date(decision.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date unspecified'}
                              </span>
                              <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                                {decision.text}
                              </h3>
                            </div>
                          </div>
                          
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                            {decision.made_by && (
                              <span className="badge badge-info" style={{ fontSize: '11px' }}>
                                {decision.made_by}
                              </span>
                            )}
                            
                            {decision.brain_documents && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedDocId(decision.source_doc_id);
                                  setIsSourceOpen(true);
                                }}
                                className="badge"
                                style={{
                                  background: getBadgeStyles(decision.brain_documents.document_type).background,
                                  border: getBadgeStyles(decision.brain_documents.document_type).border,
                                  color: getBadgeStyles(decision.brain_documents.document_type).color,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  cursor: 'pointer',
                                  padding: '3px 8px',
                                  fontSize: '11px'
                                }}
                              >
                                {getBadgeIcon(decision.brain_documents.document_type)}
                                <span style={{ maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {displaySourceTitle}
                                </span>
                              </button>
                            )}

                            {phaseInfo && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push(`/dashboard/roadmap`);
                                }}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  padding: '3px 8px',
                                  borderRadius: '6px',
                                  background: `${phaseInfo.color}10`,
                                  border: `1px solid ${phaseInfo.color}25`,
                                  color: phaseInfo.color,
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  cursor: 'pointer'
                                }}
                              >
                                <Map size={10} />
                                <span>{phaseInfo.label}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Collapsible Details */}
                        {isExpanded && (
                          <div 
                            style={{ 
                              padding: '0 24px 24px 24px', 
                              borderTop: '1px solid var(--border-subtle)', 
                              background: 'rgba(0,0,0,0.1)' 
                            }}
                          >
                            {/* Metadata list */}
                            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', padding: '16px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '13px' }}>
                              {decision.roadmap_objective && (
                                <div>
                                  <span style={{ color: 'var(--text-muted)', marginRight: '6px' }}>Objective:</span>
                                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{decision.roadmap_objective}</span>
                                </div>
                              )}
                              <div>
                                <span style={{ color: 'var(--text-muted)', marginRight: '6px' }}>Created:</span>
                                <span style={{ color: 'var(--text-secondary)' }}>{new Date(decision.created_at).toLocaleString()}</span>
                              </div>
                            </div>

                            {/* Linked actions */}
                            <div style={{ marginTop: '20px' }}>
                              <h4 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <ListTodo size={14} />
                                Linked Actions & Tasks ({linkedActions.length})
                              </h4>
                              
                              {linkedActions.length === 0 ? (
                                <p style={{ fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0' }}>
                                  No action items are directly linked to this decision.
                                </p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                  {linkedActions.map(action => {
                                    const isActionCompleted = action.status === 'completed';
                                    return (
                                      <div 
                                        key={action.id}
                                        style={{ 
                                          background: 'rgba(255,255,255,0.01)', 
                                          border: '1px solid var(--border-subtle)', 
                                          borderRadius: '8px', 
                                          padding: '12px 16px',
                                          opacity: isActionCompleted ? 0.7 : 1,
                                          transition: 'opacity 0.2s ease'
                                        }}
                                      >
                                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flex: 1 }}>
                                            <button 
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                toggleActionItemStatus(action.id, action.status);
                                              }}
                                              style={{
                                                background: 'none',
                                                border: 'none',
                                                padding: 0,
                                                cursor: 'pointer',
                                                color: isActionCompleted ? 'var(--accent-primary)' : 'var(--text-muted)',
                                                marginTop: '2px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center'
                                              }}
                                            >
                                              {isActionCompleted ? <CheckSquare size={16} /> : <Square size={16} />}
                                            </button>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                              <span style={{ 
                                                fontSize: '14px', 
                                                fontWeight: 500, 
                                                color: 'var(--text-primary)',
                                                textDecoration: isActionCompleted ? 'line-through' : 'none'
                                              }}>
                                                {action.task}
                                              </span>
                                              
                                              {/* Checklist items */}
                                              {action.sub_tasks && action.sub_tasks.length > 0 && (
                                                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '4px' }}>
                                                  {action.sub_tasks.map((sub: any) => {
                                                    const isSubCompleted = sub.status === 'completed';
                                                    return (
                                                      <div 
                                                        key={sub.id}
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          toggleSubTaskStatus(action.id, sub.id, sub.status);
                                                        }}
                                                        style={{ 
                                                          display: 'flex', 
                                                          alignItems: 'center', 
                                                          gap: '8px', 
                                                          fontSize: '12px', 
                                                          color: isSubCompleted ? 'var(--text-muted)' : 'var(--text-secondary)',
                                                          cursor: 'pointer',
                                                          textDecoration: isSubCompleted ? 'line-through' : 'none',
                                                          userSelect: 'none'
                                                        }}
                                                      >
                                                        {isSubCompleted ? (
                                                          <CheckSquare size={12} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                                                        ) : (
                                                          <Square size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                                        )}
                                                        <span>{sub.text}</span>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              )}
                                            </div>
                                          </div>

                                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                            {action.assignee && (
                                              <span className="badge badge-info" style={{ fontSize: '11px', padding: '2px 6px' }}>
                                                {action.assignee}
                                              </span>
                                            )}
                                            {action.due_date && (
                                              <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <Clock size={10} />
                                                {new Date(action.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {/* ACTIONS TAB */}
            {activeTab === 'actions' && (
              filteredActions.length === 0 ? (
                <div className="glass-card" style={{ padding: '60px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <ListTodo size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
                  <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>No action items found</h3>
                  <p style={{ fontSize: '14px', color: 'var(--text-muted)', maxWidth: '400px' }}>
                    {searchQuery ? 'Try adjusting your search terms.' : 'Action items will automatically appear here once meetings or documents are ingested and analyzed by The Brain.'}
                  </p>
                </div>
              ) : (
                <div className="glass-card" style={{ overflow: 'hidden' }}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-default)', background: 'rgba(255,255,255,0.02)' }}>
                          <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--text-primary)', width: '60px' }}>Status</th>
                          <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--text-primary)' }}>Task Description</th>
                          <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--text-primary)', width: '120px' }}>
                            <select
                              value={departmentFilter}
                              onChange={(e) => setDepartmentFilter(e.target.value)}
                              style={{
                                background: 'transparent',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: '6px',
                                color: 'var(--text-primary)',
                                fontSize: '12px',
                                fontWeight: 600,
                                padding: '4px 8px',
                                cursor: 'pointer',
                                outline: 'none'
                              }}
                            >
                              <option value="all">Dept ▾</option>
                              <option value="operations">Operations</option>
                              <option value="product">Product</option>
                              <option value="commercial">Commercial</option>
                              <option value="finance">Finance</option>
                              <option value="hr">HR</option>
                              <option value="general">General</option>
                            </select>
                          </th>
                          <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--text-primary)', width: '150px' }}>Assignee</th>
                          <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--text-primary)', width: '120px' }}>Due Date</th>
                          <th style={{ padding: '16px 20px', fontWeight: 600, color: 'var(--text-primary)', width: '220px' }}>Source</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredActions.map((action) => {
                          const isMeeting = action.brain_documents?.document_type === 'meeting';
                          const isCompleted = action.status === 'completed';
                          const sourceTitle = action.brain_documents?.title || 'Unknown Source';
                          const displaySourceTitle = sourceTitle.endsWith('.txt') 
                            ? sourceTitle.substring(0, sourceTitle.length - 4) 
                            : sourceTitle;

                          return (
                            <tr 
                              key={action.id} 
                              style={{ 
                                borderBottom: '1px solid var(--border-subtle)', 
                                transition: 'background 0.15s ease',
                                opacity: isCompleted ? 0.6 : 1
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                            >
                              <td style={{ padding: '16px 20px', textAlign: 'center', verticalAlign: 'middle' }}>
                                <button 
                                  onClick={() => toggleActionItemStatus(action.id, action.status)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    cursor: 'pointer',
                                    color: isCompleted ? 'var(--accent-primary)' : 'var(--text-muted)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'color 0.2s ease'
                                  }}
                                >
                                  {isCompleted ? <CheckSquare size={18} /> : <Square size={18} />}
                                </button>
                              </td>
                              <td style={{ 
                                padding: '16px 20px', 
                                color: 'var(--text-primary)', 
                                fontWeight: 500, 
                                lineHeight: 1.5
                              }}>
                                <div style={{ textDecoration: isCompleted ? 'line-through' : 'none' }}>
                                  {action.task}
                                </div>
                                {action.sub_tasks && action.sub_tasks.length > 0 && (
                                  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '4px' }}>
                                    {action.sub_tasks.map((sub: any) => {
                                      const isSubCompleted = sub.status === 'completed';
                                      return (
                                        <div 
                                          key={sub.id} 
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            toggleSubTaskStatus(action.id, sub.id, sub.status);
                                          }}
                                          style={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            gap: '8px', 
                                            fontSize: '12.5px', 
                                            color: isSubCompleted ? 'var(--text-muted)' : 'var(--text-secondary)',
                                            cursor: 'pointer',
                                            textDecoration: isSubCompleted ? 'line-through' : 'none',
                                            opacity: isCompleted ? 0.7 : 1,
                                            userSelect: 'none'
                                          }}
                                        >
                                          {isSubCompleted ? (
                                            <CheckSquare size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                                          ) : (
                                            <Square size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                                          )}
                                          <span>{sub.text}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                              <td style={{ padding: '16px 20px' }}>
                                {action.department ? (
                                  <span style={{
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    padding: '3px 8px',
                                    borderRadius: '4px',
                                    textTransform: 'capitalize',
                                    background: action.department === 'product' ? 'rgba(139,92,246,0.15)' :
                                      action.department === 'finance' ? 'rgba(16,185,129,0.15)' :
                                      action.department === 'commercial' ? 'rgba(245,158,11,0.15)' :
                                      action.department === 'hr' ? 'rgba(236,72,153,0.15)' :
                                      action.department === 'operations' ? 'rgba(59,130,246,0.15)' :
                                      'rgba(107,114,128,0.15)',
                                    color: action.department === 'product' ? '#a78bfa' :
                                      action.department === 'finance' ? '#34d399' :
                                      action.department === 'commercial' ? '#fbbf24' :
                                      action.department === 'hr' ? '#f472b6' :
                                      action.department === 'operations' ? '#60a5fa' :
                                      '#9ca3af'
                                  }}>
                                    {action.department}
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>—</span>
                                )}
                              </td>
                              <td style={{ padding: '16px 20px', color: 'var(--text-secondary)' }}>
                                {(() => {
                                  const member = action.assignee_user_id ? teamMap[action.assignee_user_id] : null;
                                  const isMine = !!action.assignee_user_id && action.assignee_user_id === myUserId;
                                  const displayName = member?.full_name || member?.email || action.assignee;
                                  if (displayName) {
                                    return (
                                      <span style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '7px',
                                        padding: '3px 10px 3px 3px', borderRadius: 'var(--radius-full)',
                                        background: isMine ? 'rgba(99,102,241,0.15)' : 'var(--bg-tertiary)',
                                        border: `1px solid ${isMine ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                                      }}>
                                        <span style={{
                                          width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                                          background: member ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))' : 'var(--bg-elevated)',
                                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                                          fontSize: '10px', fontWeight: 700, color: member ? 'white' : 'var(--text-muted)',
                                        }}>
                                          {String(displayName).charAt(0).toUpperCase()}
                                        </span>
                                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                          {displayName}{isMine ? ' (You)' : ''}
                                        </span>
                                      </span>
                                    );
                                  }
                                  return <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Unassigned</span>;
                                })()}
                              </td>
                              <td style={{ padding: '16px 20px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                {action.due_date ? new Date(action.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                              </td>
                              <td style={{ padding: '16px 20px' }}>
                                {action.brain_documents ? (
                                  <button
                                    onClick={() => {
                                      setSelectedDocId(action.source_doc_id);
                                      setIsSourceOpen(true);
                                    }}
                                    className="badge"
                                    style={{
                                      background: getBadgeStyles(action.brain_documents.document_type).background,
                                      border: getBadgeStyles(action.brain_documents.document_type).border,
                                      color: getBadgeStyles(action.brain_documents.document_type).color,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '6px',
                                      cursor: 'pointer',
                                      transition: 'all 0.2s ease',
                                      textAlign: 'left',
                                      padding: '4px 10px',
                                      textDecoration: 'none'
                                    }}
                                    onMouseEnter={e => {
                                      const s = getBadgeStyles(action.brain_documents!.document_type);
                                      e.currentTarget.style.background = s.hoverBackground;
                                      e.currentTarget.style.borderColor = s.hoverBorderColor;
                                    }}
                                    onMouseLeave={e => {
                                      const s = getBadgeStyles(action.brain_documents!.document_type);
                                      e.currentTarget.style.background = s.background;
                                      e.currentTarget.style.borderColor = s.border.replace('1px solid ', '');
                                    }}
                                  >
                                    {getBadgeIcon(action.brain_documents.document_type)}
                                    <span style={{ 
                                      maxWidth: '140px', 
                                      overflow: 'hidden', 
                                      textOverflow: 'ellipsis', 
                                      whiteSpace: 'nowrap' 
                                    }}>
                                      {displaySourceTitle}
                                    </span>
                                    <ArrowUpRight size={12} style={{ opacity: 0.8, flexShrink: 0 }} />
                                  </button>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            )}

            {/* PLANS TAB */}
            {activeTab === 'plans' && (
              (filteredPlans.length === 0 && filteredEvents.length === 0) ? (
                <div className="glass-card" style={{ padding: '60px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <BookOpen size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
                  <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '6px' }}>No strategic plans or briefings found</h3>
                  <p style={{ fontSize: '14px', color: 'var(--text-muted)', maxWidth: '400px' }}>
                    {searchQuery ? 'Try adjusting your search terms.' : 'Strategic plans, roadmaps, and calendar sync briefings will automatically appear here once connected.'}
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                  {/* Google Calendar Section */}
                  {filteredEvents.length > 0 && (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                        <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Calendar size={18} style={{ color: 'var(--accent-secondary)' }} />
                          Upcoming Calendar Briefings
                        </h2>
                        <span style={{ fontSize: '11px', background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', padding: '2px 8px', borderRadius: '12px', fontWeight: 500 }}>
                          Live Calendar Sync Active
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
                        {filteredEvents.map(event => (
                          <div
                            key={event.id}
                            className="glass-card animate-fade-in"
                            style={{
                              padding: '20px',
                              border: '1px solid var(--border-default)',
                              borderLeft: '4px solid #10b981',
                              borderRadius: '8px',
                              background: 'rgba(255,255,255,0.01)',
                              backdropFilter: 'blur(10px)',
                              transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.borderColor = 'rgba(16,185,129,0.4)';
                              e.currentTarget.style.boxShadow = '0 4px 20px rgba(16,185,129,0.08)';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.borderColor = 'var(--border-default)';
                              e.currentTarget.style.boxShadow = 'none';
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                              <div style={{ flex: 1, minWidth: '250px' }}>
                                <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
                                  {event.summary}
                                </h3>
                                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '12px' }}>
                                  {event.description || 'No description provided.'}
                                </p>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                                  {event.location && (
                                    <span style={{
                                      fontSize: '11px',
                                      padding: '2px 8px',
                                      borderRadius: '4px',
                                      background: 'rgba(59,130,246,0.1)',
                                      color: '#60a5fa',
                                      border: '1px solid rgba(59,130,246,0.2)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '4px'
                                    }}>
                                      📍 {event.location}
                                    </span>
                                  )}
                                  {event.htmlLink && (
                                    <a
                                      href={event.htmlLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{
                                        fontSize: '11px',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        background: 'rgba(16,185,129,0.1)',
                                        color: '#34d399',
                                        border: '1px solid rgba(16,185,129,0.2)',
                                        textDecoration: 'none',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                      }}
                                    >
                                      🔗 Join Event <ArrowUpRight size={10} />
                                    </a>
                                  )}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right', minWidth: '150px' }}>
                                <div style={{
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  color: 'var(--accent-secondary)',
                                  background: 'rgba(99,102,241,0.08)',
                                  padding: '4px 10px',
                                  borderRadius: '6px',
                                  display: 'inline-block',
                                  marginBottom: '8px'
                                }}>
                                  {new Date(event.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                                </div>
                                <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 500 }}>
                                  {new Date(event.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} - {new Date(event.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                </div>
                                {event.attendees && event.attendees.length > 0 && (
                                  <div style={{ marginTop: '12px', display: 'flex', justifyContent: 'flex-end', gap: '4px', flexWrap: 'wrap' }}>
                                    {event.attendees.map((attendee: any, i: number) => (
                                      <span 
                                        key={i} 
                                        title={`${attendee.email} (${attendee.responseStatus})`}
                                        style={{
                                          fontSize: '10px',
                                          padding: '2px 6px',
                                          borderRadius: '10px',
                                          background: attendee.responseStatus === 'accepted' ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
                                          color: attendee.responseStatus === 'accepted' ? '#34d399' : 'var(--text-muted)',
                                          border: attendee.responseStatus === 'accepted' ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.1)',
                                        }}
                                      >
                                        {attendee.email.split('@')[0]}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Strategic Documents Section */}
                  {filteredPlans.length > 0 && (
                    <div>
                      <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                        <BookOpen size={18} style={{ color: 'var(--accent-secondary)' }} />
                        Strategic Documents & Plans
                      </h2>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
                        {filteredPlans.map((plan) => (
                          <div 
                            key={plan.id}
                            className="glass-card animate-fade-in"
                            style={{ 
                              padding: '20px', 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'space-between',
                              border: '1px solid var(--border-default)',
                              transition: 'all 0.2s ease',
                              cursor: 'pointer'
                            }}
                            onClick={() => router.push(`/dashboard/documents`)}
                            onMouseEnter={e => {
                              e.currentTarget.style.borderColor = 'rgba(99,102,241,0.4)';
                              e.currentTarget.style.boxShadow = '0 4px 20px rgba(99,102,241,0.08)';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.borderColor = 'var(--border-default)';
                              e.currentTarget.style.boxShadow = 'none';
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                              <div style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '8px',
                                background: 'rgba(99,102,241,0.1)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--accent-primary)'
                              }}>
                                <Briefcase size={20} />
                              </div>
                              <div>
                                <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                                  {plan.title}
                                </h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  {plan.department && (
                                    <span className="badge badge-info" style={{ fontSize: '11px', textTransform: 'capitalize' }}>
                                      {plan.department}
                                    </span>
                                  )}
                                  {plan.sub_type && (
                                    <span style={{
                                      fontSize: '11px',
                                      padding: '2px 8px',
                                      borderRadius: '4px',
                                      background: 'rgba(255,255,255,0.04)',
                                      border: '1px solid rgba(255,255,255,0.08)',
                                      color: 'var(--text-secondary)',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.05em'
                                    }}>
                                      {plan.sub_type.replace('_', ' ')}
                                    </span>
                                  )}
                                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                    Ingested {new Date(plan.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-secondary)' }}>
                              <span style={{ fontSize: '13px', fontWeight: 500 }}>View Document</span>
                              <ChevronRight size={16} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            )}
          </>
        )}
      </div>


      <SourceViewer
        documentId={selectedDocId}
        isOpen={isSourceOpen}
        onClose={() => setIsSourceOpen(false)}
        token={token}
      />

      {isExportOpen && token && (
        <ExportDialog
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          title={exportTitle}
          content={exportContent}
          token={token}
        />
      )}
    </div>
  );
}
