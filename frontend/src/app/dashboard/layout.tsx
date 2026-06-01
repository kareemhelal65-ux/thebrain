'use client';

import { useState, useEffect, createContext, useContext } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter, usePathname } from 'next/navigation';
import {
  Brain, MessageSquare, Calendar, FileText, Hash,
  Users, Settings, LogOut, ChevronLeft, ChevronRight,
  Loader2, RefreshCw, Activity, CheckSquare,
  Bell, Mail, Check, X, Sparkles, Zap,
  AlertTriangle, Clock, Link2, AlertCircle,
  Map, Megaphone, DollarSign, Target, Handshake,
  TrendingUp, Package, LayoutGrid,
} from 'lucide-react';

// Department nav metadata (icons + order). Relevance comes from the backend.
const DEPT_META: Record<string, { label: string; icon: any }> = {
  marketing: { label: 'Marketing', icon: Megaphone },
  finance: { label: 'Finance', icon: DollarSign },
  sales: { label: 'Sales', icon: Target },
  crm: { label: 'CRM', icon: Handshake },
  investment: { label: 'Investment', icon: TrendingUp },
  product: { label: 'Product / PM', icon: Package },
};
const DEPT_ORDER = ['marketing', 'finance', 'sales', 'crm', 'investment', 'product'];
import type { User } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const navItems = [
  { icon: Brain, label: 'Brain', href: '/dashboard', id: 'brain' },
  { icon: MessageSquare, label: 'Chat', href: '/dashboard/chat', id: 'chat' },
  { icon: Map, label: 'The Roadmap', href: '/dashboard/roadmap', id: 'roadmap' },
  { icon: Calendar, label: 'Meetings', href: '/dashboard/meetings', id: 'meetings' },
  { icon: FileText, label: 'Documents', href: '/dashboard/documents', id: 'documents' },
  { icon: CheckSquare, label: 'Decision Log', href: '/dashboard/decisions', id: 'decisions' },
  { icon: Hash, label: 'Slack', href: '/dashboard/slack', id: 'slack' },
  { icon: Sparkles, label: 'Suggestions', href: '/dashboard/suggestions', id: 'suggestions' },
  { icon: Users, label: 'Team', href: '/dashboard/team', id: 'team' },
  { icon: Activity, label: 'Memory Health', href: '/dashboard/memory', id: 'memory' },
  { icon: Settings, label: 'Settings', href: '/dashboard/settings', id: 'settings' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();

  useEffect(() => {
    const getSession = async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) {
        router.push('/');
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token || null;

      // Check onboarding status
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/onboarding/status`, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        const data = await res.json();
        if (!data.onboarded) {
          router.push('/onboarding');
          return;
        }
      } catch {
        // If check fails, continue to dashboard
      }

      setUser(authUser);
      setToken(accessToken);
      setLoading(false);
    };

    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) {
          router.push('/');
          return;
        }
        setUser(session.user);
        setToken(session.access_token);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, [router, supabase]);

  const [automations, setAutomations] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [deptRelevance, setDeptRelevance] = useState<Record<string, string>>({});

  // Fetch department relevance for the nav (primary emphasized, dormant de-emphasized).
  useEffect(() => {
    if (!token) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/departments`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => {
        const map: Record<string, string> = {};
        (d.departments || []).forEach((dep: any) => { map[dep.key] = dep.relevance; });
        setDeptRelevance(map);
      })
      .catch(() => {});
  }, [token]);

  const [notificationTab, setNotificationTab] = useState<'automations' | 'suggestions'>('automations');
  const [selectedEmailAutomation, setSelectedEmailAutomation] = useState<any | null>(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

  useEffect(() => {
    if (selectedEmailAutomation) {
      setEmailTo(selectedEmailAutomation.action_payload?.to || '');
      setEmailSubject(selectedEmailAutomation.action_payload?.subject || '');
      setEmailBody(selectedEmailAutomation.action_payload?.body || '');
    }
  }, [selectedEmailAutomation]);

  // Fetch automations AND suggestions, subscribe to SSE
  useEffect(() => {
    if (!token) return;

    const fetchAutomations = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/proactivity`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        setAutomations(data.automations || []);
      } catch (err) {
        console.error('Failed to fetch proposed automations:', err);
      }
    };

    const fetchSuggestions = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/proactivity/suggestions`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        setSuggestions(data.suggestions || []);
      } catch (err) {
        console.error('Failed to fetch suggestions:', err);
      }
    };

    fetchAutomations();
    fetchSuggestions();

    // Subscribe to SSE
    const sseUrl = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/notifications/stream?token=${token}`;
    const eventSource = new EventSource(sseUrl);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'proposed_automation') {
          setAutomations(prev => {
            if (prev.some(item => item.id === data.automation.id)) return prev;
            return [data.automation, ...prev];
          });
        }
        
        if (data.type === 'new_suggestion' && data.suggestion) {
          // Real-time push: add suggestion directly without re-fetch
          setSuggestions(prev => {
            if (prev.some(s => s.id === data.suggestion.id)) return prev;
            return [data.suggestion, ...prev];
          });
        }
        
        if (data.type === 'proactivity_scan') {
          // Fallback: re-fetch suggestions after a proactivity scan completes
          fetchSuggestions();
        }
      } catch (err) {
        console.error('Error parsing notification event:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn('SSE connection error, closing EventSource. Reconnecting via polling...', err);
      eventSource.close();
    };

    // Fallback polling every 10s
    const interval = setInterval(() => {
      fetchAutomations();
      fetchSuggestions();
    }, 10000);

    return () => {
      eventSource.close();
      clearInterval(interval);
    };
  }, [token]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!showNotifications) return;
    const handleOutsideClick = () => {
      setShowNotifications(false);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [showNotifications]);

  const handleApprove = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const targetAuto = automations.find(item => item.id === id);
    if (targetAuto && targetAuto.type === 'email') {
      setSelectedEmailAutomation(targetAuto);
      setShowEmailModal(true);
      setShowNotifications(false);
      return;
    }

    try {
      // Optimistic update
      setAutomations(prev => prev.filter(item => item.id !== id));
      
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/proactivity/approve/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) {
        throw new Error('Failed to approve automation');
      }
      
      const data = await res.json();
      alert(`Automation Approved: ${data.message || 'Executed successfully'}`);
    } catch (err: any) {
      console.error(err);
      alert(`Approval error: ${err.message}`);
      // Re-fetch to synchronize state
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/proactivity`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        setAutomations(data.automations || []);
      } catch (fetchErr) {
        console.error('Failed to re-fetch after error:', fetchErr);
      }
    }
  };

  const submitApprovedEmail = async () => {
    if (!selectedEmailAutomation) return;
    const id = selectedEmailAutomation.id;
    try {
      setAutomations(prev => prev.filter(item => item.id !== id));
      setShowEmailModal(false);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/proactivity/approve/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          overrides: {
            to: emailTo,
            subject: emailSubject,
            body: emailBody
          }
        })
      });
      if (!res.ok) {
        throw new Error('Failed to approve and send email');
      }
      const data = await res.json();
      alert(`Email sent: ${data.message || 'Successfully'}`);
    } catch (err: any) {
      console.error(err);
      alert(`Error sending email: ${err.message}`);
      // Re-fetch
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/proactivity`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        setAutomations(data.automations || []);
      } catch (fetchErr) {
        console.error('Failed to re-fetch after error:', fetchErr);
      }
    } finally {
      setSelectedEmailAutomation(null);
    }
  };

  const handleDismiss = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setAutomations(prev => prev.filter(item => item.id !== id));

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/proactivity/reject/${id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) {
        throw new Error('Failed to reject automation');
      }
    } catch (err: any) {
      console.error(err);
      alert(`Dismiss error: ${err.message}`);
    }
  };

  const dismissSuggestion = async (id: string) => {
    try {
      setSuggestions(prev => prev.filter(s => s.id !== id));
      await fetch(
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
    } catch (err) {
      console.error('Failed to dismiss suggestion:', err);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  if (loading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-primary)',
      }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={36} style={{ color: 'var(--accent-primary)', animation: 'spin 1s linear infinite' }} />
          <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>Loading The Brain...</p>
        </div>
      </div>
    );
  }

  const activeItem = navItems.find(item => {
    if (item.href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(item.href);
  });

  return (
    <AuthContext.Provider value={{ user, token, loading, signOut }}>
      <div style={{ display: 'flex', height: '100vh', background: 'var(--bg-primary)' }}>
        {/* Sidebar */}
        <aside style={{
          width: collapsed ? '68px' : '240px',
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.25s ease',
          overflow: 'hidden',
          flexShrink: 0,
        }}>
          {/* Logo */}
          <div style={{
            padding: collapsed ? '16px 14px' : '20px',
            display: 'flex',
            flexDirection: collapsed ? 'column' : 'row',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            gap: '12px',
            borderBottom: '1px solid var(--border-subtle)',
            position: 'relative',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Brain size={20} color="white" />
              </div>
              {!collapsed && (
                <span style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
                  The Brain
                </span>
              )}
            </div>

            {/* Notification Bell */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={(e) => { e.stopPropagation(); setShowNotifications(!showNotifications); }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: showNotifications ? 'var(--accent-secondary)' : 'var(--text-secondary)',
                  cursor: 'pointer',
                  padding: '6px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                  position: 'relative',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = 'var(--bg-tertiary)';
                  (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
                  (e.currentTarget as HTMLElement).style.color = showNotifications ? 'var(--accent-secondary)' : 'var(--text-secondary)';
                }}
              >
                <Bell size={18} />
                {(automations.length > 0 || suggestions.length > 0) && (
                  <span style={{
                    position: 'absolute',
                    top: '2px',
                    right: '2px',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: automations.length > 0 ? '#ef4444' : '#f59e0b',
                    boxShadow: automations.length > 0 ? '0 0 8px #ef4444' : '0 0 8px #f59e0b',
                  }} />
                )}
              </button>
            </div>
          </div>

          {/* Nav items */}
          <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto' }}>
            {navItems.map((item) => {
              const isActive = activeItem?.id === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => router.push(item.href)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: collapsed ? '10px 14px' : '10px 14px',
                    background: isActive ? 'rgba(99,102,241,0.1)' : 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    color: isActive ? 'var(--accent-secondary)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: isActive ? 600 : 500,
                    transition: 'all 0.15s ease',
                    textAlign: 'left',
                    width: '100%',
                  }}
                  onMouseEnter={e => {
                    if (!isActive) {
                      (e.target as HTMLElement).style.background = 'var(--bg-tertiary)';
                      (e.target as HTMLElement).style.color = 'var(--text-primary)';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      (e.target as HTMLElement).style.background = 'transparent';
                      (e.target as HTMLElement).style.color = 'var(--text-secondary)';
                    }
                  }}
                >
                  <item.icon size={18} style={{ flexShrink: 0 }} />
                  {!collapsed && <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>}
                </button>
              );
            })}

            {/* ─── Departments ─── */}
            {!collapsed && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '14px 14px 6px',
                fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}>
                <LayoutGrid size={12} /> Departments
              </div>
            )}
            {DEPT_ORDER
              .map(key => ({ key, relevance: deptRelevance[key] || 'secondary', ...DEPT_META[key] }))
              .sort((a, b) => {
                const rank: Record<string, number> = { primary: 0, secondary: 1, dormant: 2 };
                return (rank[a.relevance] ?? 1) - (rank[b.relevance] ?? 1);
              })
              .map(dep => {
                const href = `/dashboard/departments/${dep.key}`;
                const isActive = pathname.startsWith(href);
                const dormant = dep.relevance === 'dormant';
                return (
                  <button
                    key={dep.key}
                    onClick={() => router.push(href)}
                    title={dep.label + (dormant ? ' (not a focus for your company)' : '')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '9px 14px',
                      background: isActive ? 'rgba(99,102,241,0.1)' : 'transparent',
                      border: 'none', borderRadius: 'var(--radius-md)',
                      color: isActive ? 'var(--accent-secondary)' : 'var(--text-secondary)',
                      cursor: 'pointer', fontSize: 14, fontWeight: isActive ? 600 : 500,
                      transition: 'all 0.15s ease', textAlign: 'left', width: '100%',
                      opacity: dormant ? 0.45 : 1,
                    }}
                    onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = 'var(--bg-tertiary)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; } }}
                    onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'; } }}
                  >
                    <dep.icon size={18} style={{ flexShrink: 0 }} />
                    {!collapsed && (
                      <span style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {dep.label}
                        {dep.relevance === 'primary' && (
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
          </nav>

          {/* Bottom section */}
          <div style={{
            padding: '12px 8px',
            borderTop: '1px solid var(--border-subtle)',
          }}>
            {/* Collapse toggle */}
            <button
              onClick={() => setCollapsed(!collapsed)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 14px',
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '13px',
                width: '100%',
              }}
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              {!collapsed && 'Collapse'}
            </button>

            {/* User info */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 14px',
              marginTop: '4px',
            }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: 'var(--radius-full)',
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                fontSize: '13px',
                fontWeight: 700,
                color: 'white',
              }}>
                {user?.email?.charAt(0).toUpperCase()}
              </div>
              {!collapsed && (
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <p style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user?.user_metadata?.full_name || user?.email?.split('@')[0]}
                  </p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {user?.email}
                  </p>
                </div>
              )}
              {!collapsed && (
                <button
                  onClick={signOut}
                  title="Sign out"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '4px',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <LogOut size={16} />
                </button>
              )}
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main style={{
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {children}
        </main>

        {/* Floating Notification Dropdown */}
        {showNotifications && (
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              left: collapsed ? '78px' : '250px',
              top: '70px',
              width: '360px',
              maxHeight: '480px',
              background: 'rgba(15, 15, 20, 0.95)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 'var(--radius-lg, 12px)',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(99, 102, 241, 0.1)',
              zIndex: 9999,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              fontFamily: 'inherit',
            }}
          >
            {/* Header with tabs */}
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(255, 255, 255, 0.02)',
            }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setNotificationTab('suggestions')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: notificationTab === 'suggestions' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                    border: `1px solid ${notificationTab === 'suggestions' ? 'rgba(99, 102, 241, 0.25)' : 'transparent'}`,
                    borderRadius: 'var(--radius-md)',
                    color: notificationTab === 'suggestions' ? 'var(--accent-secondary)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Sparkles size={14} />
                  Insights
                  {suggestions.filter(s => !s.is_viewed).length > 0 && (
                    <span style={{
                      background: 'var(--accent-primary)',
                      color: 'white',
                      fontSize: '9px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: '8px',
                    }}>
                      {suggestions.filter(s => !s.is_viewed).length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setNotificationTab('automations')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    background: notificationTab === 'automations' ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                    border: `1px solid ${notificationTab === 'automations' ? 'rgba(99, 102, 241, 0.25)' : 'transparent'}`,
                    borderRadius: 'var(--radius-md)',
                    color: notificationTab === 'automations' ? 'var(--accent-secondary)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <Zap size={14} />
                  Automations
                  {automations.length > 0 && (
                    <span style={{
                      background: '#ef4444',
                      color: 'white',
                      fontSize: '9px',
                      fontWeight: 700,
                      padding: '1px 6px',
                      borderRadius: '8px',
                    }}>
                      {automations.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            <div style={{
              flex: 1,
              overflowY: 'auto',
              maxHeight: '380px',
            }}>
              {notificationTab === 'automations' && (
                automations.length === 0 ? (
                  <div style={{
                    padding: '30px 20px',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '13px',
                  }}>
                    No pending automations. Upload documents to trigger agent automations.
                  </div>
                ) : (
                  automations.map((auto) => {
                    let IconComponent = Mail;
                    let iconColor = '#3b82f6';
                    if (auto.type === 'slack') {
                      IconComponent = Hash;
                      iconColor = '#ec4899';
                    } else if (auto.type === 'calendar') {
                      IconComponent = Calendar;
                      iconColor = '#10b981';
                    } else if (auto.type === 'document') {
                      IconComponent = FileText;
                      iconColor = '#f59e0b';
                    }

                    return (
                      <div
                        key={auto.id}
                        style={{
                          padding: '14px 16px',
                          borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                          display: 'flex',
                          gap: '12px',
                          transition: 'background 0.2s ease',
                        }}
                        onMouseEnter={e => {
                          (e.currentTarget as HTMLElement).style.background = 'rgba(255, 255, 255, 0.03)';
                        }}
                        onMouseLeave={e => {
                          (e.currentTarget as HTMLElement).style.background = 'transparent';
                        }}
                      >
                        <div style={{
                          width: '32px', height: '32px', borderRadius: '8px',
                          background: `${iconColor}15`,
                          border: `1px solid ${iconColor}30`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                        }}>
                          <IconComponent size={16} color={iconColor} />
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{
                            fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)',
                            lineHeight: '1.4', margin: 0, wordBreak: 'break-word',
                          }}>
                            {auto.description}
                            {auto.is_recurring && (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', padding: '2px 6px',
                                borderRadius: '4px', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase',
                                background: 'linear-gradient(135deg, #059669, #10b981)', color: '#ffffff',
                                marginLeft: '6px', verticalAlign: 'middle',
                              }}>
                                Recurring
                              </span>
                            )}
                          </p>
                          
                          {auto.brain_documents && (
                            <span style={{
                              fontSize: '11px', color: 'var(--text-muted)', display: 'inline-block',
                              marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden',
                              textOverflow: 'ellipsis', maxWidth: '100%',
                            }}>
                              Source: {auto.brain_documents.title}
                            </span>
                          )}

                          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                            <button
                              onClick={(e) => handleApprove(auto.id, e)}
                              style={{
                                padding: '5px 10px', background: 'var(--accent-primary, #6366f1)',
                                border: 'none', borderRadius: '6px', color: 'white',
                                fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: '4px',
                                transition: 'all 0.15s ease',
                              }}
                              onMouseEnter={e => { (e.target as HTMLElement).style.filter = 'brightness(1.1)'; }}
                              onMouseLeave={e => { (e.target as HTMLElement).style.filter = 'none'; }}
                            >
                              <Check size={12} /> Approve
                            </button>
                            <button
                              onClick={(e) => handleDismiss(auto.id, e)}
                              style={{
                                padding: '5px 10px', background: 'rgba(255, 255, 255, 0.08)',
                                border: 'none', borderRadius: '6px', color: 'var(--text-secondary)',
                                fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: '4px',
                                transition: 'all 0.15s ease',
                              }}
                              onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(255, 255, 255, 0.12)'; }}
                              onMouseLeave={e => { (e.target as HTMLElement).style.background = 'rgba(255, 255, 255, 0.08)'; }}
                            >
                              <X size={12} /> Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )
              )}

              {notificationTab === 'suggestions' && (
                suggestions.filter(s => !s.is_dismissed).length === 0 ? (
                  <div style={{
                    padding: '30px 20px',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '13px',
                  }}>
                    No proactive insights yet. The Brain will surface suggestions as it scans your data.
                  </div>
                ) : (
                  suggestions.filter(s => !s.is_dismissed).slice(0, 10).map((suggestion) => {
                    const catConfig: Record<string, { label: string; icon: any; color: string }> = {
                      overdue_task: { label: 'Overdue', icon: AlertTriangle, color: '#ef4444' },
                      upcoming_deadline: { label: 'Deadline', icon: Clock, color: '#f59e0b' },
                      cross_doc_connection: { label: 'Connection', icon: Link2, color: '#818cf8' },
                      decision_gap: { label: 'Gap', icon: AlertCircle, color: '#34d399' },
                      scheduled_action: { label: 'Scheduled', icon: Calendar, color: '#60a5fa' },
                    };
                    const config = catConfig[suggestion.category] || catConfig.overdue_task;
                    const IconCmp = config.icon;

                    return (
                      <div
                        key={suggestion.id}
                        style={{
                          padding: '12px 16px',
                          borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                          display: 'flex',
                          gap: '10px',
                          background: !suggestion.is_viewed ? 'rgba(99, 102, 241, 0.04)' : 'transparent',
                          transition: 'background 0.2s ease',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255, 255, 255, 0.03)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = !suggestion.is_viewed ? 'rgba(99, 102, 241, 0.04)' : 'transparent'; }}
                      >
                        <div style={{
                          width: '28px', height: '28px', borderRadius: '6px',
                          background: `${config.color}15`,
                          border: `1px solid ${config.color}30`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0, marginTop: '2px',
                        }}>
                          <IconCmp size={13} color={config.color} />
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{
                            fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)',
                            lineHeight: '1.4', margin: '0 0 2px 0',
                          }}>
                            {suggestion.title}
                          </p>
                          <p style={{
                            fontSize: '11px', color: 'var(--text-muted)',
                            lineHeight: '1.5', margin: 0,
                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                          }}>
                            {suggestion.description}
                          </p>
                          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                            <span style={{
                              padding: '2px 6px', fontSize: '9px', fontWeight: 700,
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                              borderRadius: '4px', background: `${config.color}15`, color: config.color,
                              border: `1px solid ${config.color}30`,
                            }}>
                              {config.label}
                            </span>
                            <span style={{
                              padding: '2px 6px', fontSize: '9px', fontWeight: 700,
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                              borderRadius: '4px',
                              background: suggestion.priority === 'high' ? 'rgba(239,68,68,0.15)' :
                                suggestion.priority === 'medium' ? 'rgba(245,158,11,0.15)' : 'rgba(107,114,128,0.15)',
                              color: suggestion.priority === 'high' ? '#ef4444' :
                                suggestion.priority === 'medium' ? '#f59e0b' : '#6b7280',
                            }}>
                              {suggestion.priority}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            dismissSuggestion(suggestion.id);
                          }}
                          style={{
                            background: 'transparent', border: 'none', color: 'var(--text-muted)',
                            cursor: 'pointer', padding: '4px', borderRadius: '4px',
                            flexShrink: 0, opacity: 0.6,
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                          onMouseLeave={e => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.background = 'transparent'; }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })
                )
              )}

              {/* Footer with View All link */}
              <div style={{
                padding: '10px 16px',
                borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                textAlign: 'center',
              }}>
                <button
                  onClick={() => {
                    setShowNotifications(false);
                    if (notificationTab === 'suggestions') {
                      router.push('/dashboard/suggestions');
                    }
                  }}
                  style={{
                    background: 'transparent', border: 'none', color: 'var(--accent-secondary)',
                    fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                    padding: '4px 8px', borderRadius: '4px',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {notificationTab === 'suggestions' ? 'View All Insights →' : ''}
                </button>
              </div>
            </div>
          </div>
        )}
        
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
                  }}
                >
                  <Mail size={16} /> Approve & Send
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuthContext.Provider>
  );
}
