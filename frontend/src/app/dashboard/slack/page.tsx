'use client';

import { Hash } from 'lucide-react';

export default function SlackPage() {
  return (
    <div style={{ padding: '32px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '8px' }}>Slack Integration</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '32px' }}>
        Connect Slack to ingest messages into The Brain&apos;s memory.
      </p>
      <div className="glass-card" style={{ padding: '48px', textAlign: 'center' }}>
        <Hash size={40} style={{ color: 'var(--accent-emerald)', margin: '0 auto 16px' }} />
        <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '8px' }}>Connect Slack Workspace</h2>
        <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px' }}>
          The Brain ingests the last 7 days of messages from all accessible channels.
        </p>
        <button className="btn-primary">Connect Slack</button>
      </div>
    </div>
  );
}
