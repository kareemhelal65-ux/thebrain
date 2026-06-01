import React from 'react';
import { Bot, Plus, Activity } from 'lucide-react';

export default function AgentsView() {
  const agents = [
    { id: 1, name: 'Support Bot', status: 'active', role: 'Customer Service' },
    { id: 2, name: 'Data Analyst', status: 'idle', role: 'Internal Ops' },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-main">Soft Agents</h1>
          <p className="text-sm text-text-muted mt-1">Manage sub-instances with restricted routes.</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-dim text-primary border border-primary/20 hover:bg-primary/20 transition-colors">
          <Plus size={16} />
          <span className="text-sm font-medium">New Agent</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {agents.map(agent => (
          <div key={agent.id} className="glass-panel p-5 rounded-xl hover:border-primary/30 transition-colors group">
            <div className="flex justify-between items-start mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-secondary-dim flex items-center justify-center border border-secondary/20 group-hover:shadow-[0_0_15px_rgba(139,92,246,0.3)] transition-all">
                  <Bot size={20} className="text-secondary" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-text-main">{agent.name}</h3>
                  <p className="text-[11px] font-mono text-text-muted uppercase tracking-wider">{agent.role}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-abyss border border-border-subtle">
                <div className={`w-1.5 h-1.5 rounded-full ${agent.status === 'active' ? 'bg-success animate-pulse' : 'bg-text-dim'}`}></div>
                <span className={`text-[10px] font-mono uppercase ${agent.status === 'active' ? 'text-success' : 'text-text-dim'}`}>
                  {agent.status}
                </span>
              </div>
            </div>
            
            <div className="h-px w-full bg-border-subtle my-4" />
            
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-text-muted font-mono uppercase flex items-center gap-1">
                <Activity size={10} /> 0 active sessions
              </span>
              <button className="text-xs font-medium text-text-main hover:text-primary transition-colors">
                Configure →
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
