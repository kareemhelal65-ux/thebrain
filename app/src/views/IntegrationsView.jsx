import React from 'react';
import { Plug2, CheckCircle2, AlertCircle } from 'lucide-react';

export default function IntegrationsView() {
  const adapters = [
    { name: 'Shopify', status: 'connected', type: 'Commerce' },
    { name: 'Paymob', status: 'connected', type: 'Finance' },
    { name: 'Slack', status: 'disconnected', type: 'Comms' },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text-main">Universal Adapters</h1>
        <p className="text-sm text-text-muted mt-1">Manage connected services and provider credentials.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {adapters.map((adapter, i) => (
          <div key={i} className="glass-panel p-4 rounded-xl flex items-center justify-between group hover:border-primary/20 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-abyss flex items-center justify-center border border-border-subtle group-hover:border-primary/30">
                <Plug2 size={14} className="text-text-muted group-hover:text-primary transition-colors" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text-main">{adapter.name}</h3>
                <p className="text-[10px] text-text-muted font-mono uppercase">{adapter.type}</p>
              </div>
            </div>
            {adapter.status === 'connected' ? (
              <CheckCircle2 size={16} className="text-success" />
            ) : (
              <AlertCircle size={16} className="text-warning" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
