'use client';

import { useState } from 'react';
import { apiRequest } from '@/lib/api';
import { Zap, Loader2, Check, Sparkles } from 'lucide-react';

export interface QuickAction {
  agentType: string;
  recipeId: string;
  label: string;
  description?: string;
}

/**
 * A compact panel of agent capability buttons. Each launches an AGENT_RECIPES recipe
 * via /api/agents/launch-recipe; the produced deliverable flows through the normal
 * approval pipeline (reviewable in Chat → Deliverables). Used to surface agent
 * capabilities on their natural home tabs (Meetings, Roadmap) instead of the chat
 * workspace.
 */
export default function AgentQuickActions({
  token, title = 'Agent actions', actions, hint,
}: {
  token: string | null;
  title?: string;
  actions: QuickAction[];
  hint?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const launch = async (a: QuickAction) => {
    if (!token || busy) return;
    setBusy(a.recipeId);
    setError(null);
    try {
      await apiRequest('/api/agents/launch-recipe', {
        method: 'POST',
        body: JSON.stringify({ agentType: a.agentType, recipeId: a.recipeId }),
      }, token);
      setDone(a.recipeId);
      setTimeout(() => setDone(d => (d === a.recipeId ? null : d)), 6000);
    } catch (e: any) {
      setError(e.message || 'Failed to launch');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="glass-card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sparkles size={14} style={{ color: 'var(--accent-primary)' }} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>{title}</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {actions.map(a => {
          const isBusy = busy === a.recipeId;
          const isDone = done === a.recipeId;
          return (
            <button
              key={a.recipeId}
              onClick={() => launch(a)}
              disabled={isBusy}
              title={a.description}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {isBusy ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                : isDone ? <Check size={13} style={{ color: '#10b981' }} />
                  : <Zap size={13} />}
              {isDone ? 'Launched' : a.label}
            </button>
          );
        })}
      </div>
      {error && <p style={{ fontSize: 11.5, color: 'var(--accent-rose, #f43f5e)' }}>{error}</p>}
      {done && <p style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{hint || 'Launched — review it in Chat → Deliverables.'}</p>}
    </div>
  );
}
