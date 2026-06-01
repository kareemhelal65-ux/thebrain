'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../layout';
import {
  Loader2, Bell, Clock, AlertTriangle, Link2, FileText,
  Check, X, RefreshCw, Sparkles, AlertCircle, Calendar,
  Users, Zap, Eye, EyeOff
} from 'lucide-react';

interface Suggestion {
  id: string;
  tenant_id: string;
  user_id: string | null;
  category: string;
  title: string;
  description: string;
  priority: string;
  source_entity_type: string | null;
  source_entity_id: string | null;
  metadata: any;
  is_dismissed: boolean;
  is_viewed: boolean;
  created_at: string;
}

const CATEGORY_CONFIG: Record<string, { label: string; icon: any; color: string; bgColor: string }> = {
  overdue_task: {
    label: 'Overdue',
    icon: AlertTriangle,
    color: '#ef4444',
    bgColor: 'rgba(239, 68, 68, 0.1)'
  },
  upcoming_deadline: {
    label: 'Deadline',
    icon: Clock,
    color: '#f59e0b',
    bgColor: 'rgba(245, 158, 11, 0.1)'
  },
  cross_doc_connection: {
    label: 'Connection',
    icon: Link2,
    color: '#818cf8',
    bgColor: 'rgba(129, 140, 248, 0.1)'
  },
  decision_gap: {
    label: 'Decision Gap',
    icon: AlertCircle,
    color: '#34d399',
    bgColor: 'rgba(52, 211, 153, 0.1)'
  },
  scheduled_action: {
    label: 'Scheduled',
    icon: Calendar,
    color: '#60a5fa',
    bgColor: 'rgba(96, 165, 250, 0.1)'
  },
  new_document: {
    label: 'New Doc',
    icon: FileText,
    color: '#34d399',
    bgColor: 'rgba(52, 211, 153, 0.1)'
  }
};

const PRIORITY_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#6b7280'
};

export default function SuggestionsPage() {
  const { token } = useAuth();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<string | null>(null);

  const fetchSuggestions = useCallback(async () => {
    if (!token) return;
    try {
      const params = new URLSearchParams();
      if (filter) params.set('category', filter);
      if (priorityFilter) params.set('priority', priorityFilter);

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/proactivity/suggestions?${params}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error('Failed to fetch suggestions');
      const data = await res.json();
      setSuggestions(data.suggestions || []);
    } catch (err: any) {
      console.error('Failed to fetch suggestions:', err);
    } finally {
      setLoading(false);
    }
  }, [token, filter, priorityFilter]);

  useEffect(() => {
    fetchSuggestions();
  }, [fetchSuggestions]);

  // SSE subscription for real-time updates
  useEffect(() => {
    if (!token) return;
    const sseUrl = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/notifications/stream?token=${token}`;
    const eventSource = new EventSource(sseUrl);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'proactivity_scan') {
          // Re-fetch suggestions after a scan completes
          fetchSuggestions();
        }
      } catch {}
    };

    return () => eventSource.close();
  }, [token, fetchSuggestions]);

  const handleDismiss = async (id: string) => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/proactivity/suggestions/${id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ is_dismissed: true })
        }
      );
      if (res.ok) {
        setSuggestions(prev => prev.filter(s => s.id !== id));
      }
    } catch (err) {
      console.error('Failed to dismiss suggestion:', err);
    }
  };

  const handleMarkViewed = async (id: string) => {
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/proactivity/suggestions/${id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ is_viewed: true })
        }
      );
    } catch {}
  };

  const handleTriggerScan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/proactivity/suggestions/scan`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );
      if (!res.ok) throw new Error('Scan trigger failed');
      const data = await res.json();
      const newDocCount = data.result?.newDocuments?.suggestionCount || 0;
      const newDocText = newDocCount > 0 ? `, ${newDocCount} new document${newDocCount > 1 ? 's' : ''}` : '';
      setScanResult(`Scan complete — ${data.result?.overdue?.suggestionCount || 0} overdue, ${data.result?.crossDoc?.suggestionCount || 0} cross-doc connections${newDocText} found.`);
      // Re-fetch after short delay
      setTimeout(fetchSuggestions, 2000);
    } catch (err: any) {
      setScanResult(`Scan failed: ${err.message}`);
    } finally {
      setScanning(false);
    }
  };

  const categories = Object.keys(CATEGORY_CONFIG);
  const unviewedCount = suggestions.filter(s => !s.is_viewed).length;

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: '32px',
        gap: '24px',
        flexWrap: 'wrap'
      }}>
        <div>
          <h1 style={{
            fontSize: '28px',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            marginBottom: '8px',
            background: 'linear-gradient(135deg, #fff, #a5b4fc)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <Sparkles size={28} color="#a5b4fc" />
            Proactive Suggestions
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '15px', maxWidth: '600px' }}>
            The Brain autonomously monitors your company's data and surfaces actionable suggestions — overdue tasks, upcoming deadlines, cross-document connections, and decision gaps.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          {unviewedCount > 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              background: 'rgba(99, 102, 241, 0.15)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              borderRadius: 'var(--radius-full)',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--accent-secondary)'
            }}>
              <Eye size={14} />
              {unviewedCount} new
            </div>
          )}
          <button
            onClick={handleTriggerScan}
            disabled={scanning}
            className="btn-primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              fontSize: '14px',
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
              opacity: scanning ? 0.6 : 1
            }}
          >
            {scanning ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Zap size={16} />
            )}
            {scanning ? 'Scanning...' : 'Trigger Scan'}
          </button>
        </div>
      </div>

      {/* Scan result toast */}
      {scanResult && (
        <div style={{
          padding: '12px 20px',
          background: scanResult.includes('failed') ? 'rgba(239, 68, 68, 0.1)' : 'rgba(52, 211, 153, 0.1)',
          border: `1px solid ${scanResult.includes('failed') ? 'rgba(239, 68, 68, 0.2)' : 'rgba(52, 211, 153, 0.2)'}`,
          borderRadius: 'var(--radius-md)',
          marginBottom: '24px',
          fontSize: '13px',
          fontWeight: 500,
          color: scanResult.includes('failed') ? '#ef4444' : '#34d399',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {scanResult.includes('failed') ? <AlertCircle size={16} /> : <Check size={16} />}
          {scanResult}
          <button
            onClick={() => setScanResult(null)}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              padding: '2px'
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Filter chips */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '24px',
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '4px' }}>
          Category:
        </span>
        <button
          onClick={() => setFilter(null)}
          style={{
            padding: '6px 14px',
            fontSize: '12px',
            fontWeight: 600,
            background: !filter ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.05)',
            border: `1px solid ${!filter ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.08)'}`,
            borderRadius: 'var(--radius-full)',
            color: !filter ? 'var(--accent-secondary)' : 'var(--text-secondary)',
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          All
        </button>
        {categories.map(cat => {
          const config = CATEGORY_CONFIG[cat];
          return (
            <button
              key={cat}
              onClick={() => setFilter(filter === cat ? null : cat)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 600,
                background: filter === cat ? config.bgColor : 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${filter === cat ? config.color + '40' : 'rgba(255, 255, 255, 0.08)'}`,
                borderRadius: 'var(--radius-full)',
                color: filter === cat ? config.color : 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <config.icon size={12} />
              {config.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '80px' }}>
          <Loader2 size={32} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      ) : suggestions.length === 0 ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 40px',
          textAlign: 'center',
          background: 'rgba(15, 23, 42, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '16px'
        }}>
          <Sparkles size={48} style={{ opacity: 0.3, marginBottom: '20px', color: 'var(--text-muted)' }} />
          <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
            No Suggestions Yet
          </h3>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', maxWidth: '400px', lineHeight: 1.6 }}>
            The Brain scans your data periodically for overdue tasks, upcoming deadlines, and cross-document connections.
            Click <strong>"Trigger Scan"</strong> to run an immediate scan, or upload documents and hold meetings to generate more data.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {suggestions.map(suggestion => {
            const catConfig = CATEGORY_CONFIG[suggestion.category] || CATEGORY_CONFIG.overdue_task;
            const IconComponent = catConfig.icon;
            const priorityColor = PRIORITY_COLORS[suggestion.priority] || '#6b7280';

            return (
              <div
                key={suggestion.id}
                style={{
                  background: suggestion.is_viewed
                    ? 'rgba(15, 23, 42, 0.5)'
                    : 'rgba(15, 23, 42, 0.7)',
                  border: `1px solid ${
                    !suggestion.is_viewed
                      ? 'rgba(99, 102, 241, 0.15)'
                      : 'rgba(255, 255, 255, 0.05)'
                  }`,
                  borderRadius: 'var(--radius-lg)',
                  padding: '20px 24px',
                  display: 'flex',
                  gap: '16px',
                  alignItems: 'flex-start',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  overflow: 'hidden'
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = !suggestion.is_viewed
                    ? 'rgba(99, 102, 241, 0.3)'
                    : 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.background = 'rgba(30, 41, 59, 0.8)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = !suggestion.is_viewed
                    ? 'rgba(99, 102, 241, 0.15)'
                    : 'rgba(255, 255, 255, 0.05)';
                  e.currentTarget.style.background = suggestion.is_viewed
                    ? 'rgba(15, 23, 42, 0.5)'
                    : 'rgba(15, 23, 42, 0.7)';
                }}
              >
                {/* Priority indicator line */}
                <div style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: '3px',
                  background: `linear-gradient(to bottom, ${priorityColor}, ${priorityColor}88)`,
                  borderRadius: '0 2px 2px 0'
                }} />

                {/* Category Icon */}
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  background: catConfig.bgColor,
                  border: `1px solid ${catConfig.color}30`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: '2px'
                }}>
                  <IconComponent size={18} color={catConfig.color} />
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    marginBottom: '6px',
                    flexWrap: 'wrap'
                  }}>
                    {/* Category badge */}
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '3px 8px',
                      borderRadius: 'var(--radius-full)',
                      fontSize: '10px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      background: catConfig.bgColor,
                      color: catConfig.color,
                      border: `1px solid ${catConfig.color}30`
                    }}>
                      <IconComponent size={10} />
                      {catConfig.label}
                    </span>

                    {/* Priority badge */}
                    <span style={{
                      padding: '3px 8px',
                      borderRadius: 'var(--radius-full)',
                      fontSize: '10px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      background: `${priorityColor}15`,
                      color: priorityColor,
                      border: `1px solid ${priorityColor}30`
                    }}>
                      {suggestion.priority}
                    </span>

                    {/* Time ago */}
                    <span style={{
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      marginLeft: 'auto'
                    }}>
                      {getTimeAgo(suggestion.created_at)}
                    </span>
                  </div>

                  <h3 style={{
                    fontSize: '15px',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    marginBottom: '4px',
                    lineHeight: 1.4
                  }}>
                    {suggestion.title}
                  </h3>

                  <p style={{
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                    marginBottom: '12px'
                  }}>
                    {suggestion.description}
                  </p>

                  {/* Source & Metadata */}
                  {suggestion.source_entity_type && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '11px',
                      color: 'var(--text-muted)',
                      marginBottom: '12px'
                    }}>
                      <FileText size={12} />
                      <span>
                        Source: <strong>{suggestion.source_entity_type}</strong>
                        {suggestion.metadata?.source_doc_title && (
                          <> — {suggestion.metadata.source_doc_title}</>
                        )}
                        {suggestion.metadata?.assignee && (
                          <> · Assignee: {suggestion.metadata.assignee}</>
                        )}
                        {suggestion.metadata?.department && (
                          <> · Dept: {suggestion.metadata.department}</>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => {
                        handleMarkViewed(suggestion.id);
                        handleDismiss(suggestion.id);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '7px 14px',
                        background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        color: 'white',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                      onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.1)'; }}
                      onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
                    >
                      <Check size={14} />
                      Dismiss
                    </button>

                    {!suggestion.is_viewed && (
                      <button
                        onClick={() => handleMarkViewed(suggestion.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '7px 14px',
                          background: 'rgba(255, 255, 255, 0.06)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: 'var(--radius-md)',
                          color: 'var(--text-secondary)',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease'
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'; }}
                      >
                        <EyeOff size={14} />
                        Mark Read
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
