import React from 'react';
import { Terminal, LayoutDashboard, Bot, Wrench, Plug2, Settings, ShieldCheck } from 'lucide-react';

const navItems = [
  { id: 'chat', label: 'Neural Link', icon: Terminal },
  { id: 'dashboard', label: 'System Overview', icon: LayoutDashboard },
  { id: 'agents', label: 'Soft Agents', icon: Bot },
  { id: 'tools', label: 'Registry', icon: Wrench },
  { id: 'integrations', label: 'Adapters', icon: Plug2 },
  { id: 'settings', label: 'Configuration', icon: Settings },
];

export default function Sidebar({ activeView, setActiveView }) {
  return (
    <aside className="w-64 shrink-0 flex flex-col border-r border-border-subtle bg-abyss">
      {/* System Status Brief */}
      <div className="p-5 border-b border-border-subtle flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-success animate-pulse shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-text-main truncate">Core Systems Online</p>
          <p className="text-[10px] text-text-dim font-mono mt-0.5">Latency: 4ms</p>
        </div>
        <ShieldCheck size={14} className="text-success shrink-0" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = activeView === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 cursor-pointer
                ${isActive 
                  ? 'bg-primary-dim text-primary border border-primary/20 shadow-[inset_2px_0_0_#00f2ff]' 
                  : 'text-text-muted hover:bg-surface hover:text-text-main border border-transparent'}
              `}
            >
              <Icon size={16} />
              <span className="font-medium tracking-wide">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* User Info / Identity Placeholder */}
      <div className="p-4 border-t border-border-subtle bg-surface">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-secondary-dim border border-secondary/20 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-secondary">A</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-main truncate">Admin</p>
            <p className="text-[10px] text-text-muted font-mono uppercase truncate">HQ_EXEC</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
