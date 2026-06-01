'use client';

import { useState, useEffect } from 'react';
import { X, Calendar, FileText, Hash, Mail, ArrowUpRight, Loader2, Shield, FolderSync, Info } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { createClient } from '@/lib/supabase';

interface SourceViewerProps {
  documentId: string | null;
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
}

interface BrainDocument {
  id: string;
  title: string;
  document_type: string;
  content: string;
  created_at: string;
  semantic_type: string | null;
  department: string | null;
  sub_type: string | null;
  file_path: string | null;
  metadata: any;
}

export default function SourceViewer({ documentId, isOpen, onClose, token }: SourceViewerProps) {
  const [document, setDocument] = useState<BrainDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = async () => {
    if (!document || !document.file_path) return;
    setIsDownloading(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const activeToken = session?.access_token || token;

      if (!activeToken) {
        throw new Error('Authentication token not found. Please log in again.');
      }

      const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}${document.file_path}`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${activeToken}`
        }
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Failed to download file: ${res.statusText}`);
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = downloadUrl;

      const ext = document.document_type || 'md';
      const cleanTitle = document.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      link.setAttribute('download', `${cleanTitle}.${ext}`);

      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      console.error('Download error:', err);
      alert(err.message || 'Failed to download file.');
    } finally {
      setIsDownloading(false);
    }
  };

  useEffect(() => {
    if (isOpen && documentId && token) {
      fetchDocument();
    } else {
      setDocument(null);
      setError(null);
    }
  }, [isOpen, documentId, token]);

  const fetchDocument = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest(`/api/documents/${documentId}`, {}, token!);
      if (data && data.document) {
        setDocument(data.document);
      } else {
        setError('Document not found');
      }
    } catch (err: any) {
      console.error('Failed to fetch document details:', err);
      setError(err.message || 'Failed to retrieve document details');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const getSourceIcon = (type: string) => {
    const cleanType = (type || '').toLowerCase();
    switch (cleanType) {
      case 'meeting':
        return <Calendar size={18} style={{ color: 'var(--accent-primary)' }} />;
      case 'slack':
        return <Hash size={18} style={{ color: 'var(--accent-cyan)' }} />;
      case 'email':
        return <Mail size={18} style={{ color: 'var(--accent-amber)' }} />;
      default:
        return <FileText size={18} style={{ color: 'var(--accent-secondary)' }} />;
    }
  };

  const getDepartmentColor = (dept: string) => {
    const cleanDept = (dept || '').toLowerCase();
    switch (cleanDept) {
      case 'product': return { bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.2)', text: '#a78bfa' };
      case 'finance': return { bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.2)', text: '#34d399' };
      case 'commercial': return { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.2)', text: '#fbbf24' };
      case 'hr': return { bg: 'rgba(236,72,153,0.12)', border: 'rgba(236,72,153,0.2)', text: '#f472b6' };
      case 'operations': return { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.2)', text: '#60a5fa' };
      default: return { bg: 'rgba(107,114,128,0.12)', border: 'rgba(107,114,128,0.2)', text: '#9ca3af' };
    }
  };

  const getSemanticTypeColor = (type: string) => {
    const cleanType = (type || '').toLowerCase();
    switch (cleanType) {
      case 'decision': return { bg: 'rgba(16,185,129,0.15)', text: 'var(--accent-emerald)' };
      case 'action_item': return { bg: 'rgba(99,102,241,0.15)', text: 'var(--accent-secondary)' };
      case 'discussion': return { bg: 'rgba(34,211,238,0.15)', text: 'var(--accent-cyan)' };
      default: return { bg: 'rgba(255,255,255,0.06)', text: 'var(--text-secondary)' };
    }
  };

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(5, 5, 8, 0.85)',
        backdropFilter: 'blur(10px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}
      className="animate-fade-in"
      onClick={onClose}
    >
      <div 
        style={{
          width: '100%',
          maxWidth: '750px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6), 0 0 0 1px var(--border-default)',
          overflow: 'hidden'
        }}
        className="glass-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border-default)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(255,255,255,0.01)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {document && getSourceIcon(document.document_type)}
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {loading ? 'Retrieving source...' : document ? document.title : 'Source details'}
              </h3>
              {document && (
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '8px', alignItems: 'center', marginTop: '2px' }}>
                  <span>Source Type: <strong style={{ textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{document.document_type}</strong></span>
                  <span>•</span>
                  <span>Ingested: <strong>{new Date(document.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong></span>
                </div>
              )}
            </div>
          </div>
          <button 
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '6px',
              borderRadius: 'var(--radius-sm)',
              transition: 'all 0.2s'
            }}
            className="hover-bg-secondary"
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {loading ? (
            <div style={{ padding: '60px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              <Loader2 size={32} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Retrieving complete audit records...</p>
            </div>
          ) : error ? (
            <div style={{ padding: '40px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <Info size={36} style={{ color: 'var(--accent-rose)' }} />
              <p style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Failed to Load Document</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', maxWidth: '300px' }}>{error}</p>
            </div>
          ) : document ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Taxonomy Bar */}
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                padding: '12px 16px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)'
              }}>
                {document.department && (
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: '4px',
                    textTransform: 'capitalize',
                    background: getDepartmentColor(document.department).bg,
                    border: `1px solid ${getDepartmentColor(document.department).border}`,
                    color: getDepartmentColor(document.department).text
                  }}>
                    Dept: {document.department}
                  </span>
                )}
                {document.semantic_type && (
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: '4px',
                    textTransform: 'capitalize',
                    background: getSemanticTypeColor(document.semantic_type).bg,
                    color: getSemanticTypeColor(document.semantic_type).text
                  }}>
                    Type: {document.semantic_type.replace('_', ' ')}
                  </span>
                )}
                {document.sub_type && (
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: '4px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: 'var(--text-secondary)'
                  }}>
                    Category: {document.sub_type.replace('_', ' ')}
                  </span>
                )}
              </div>

              {/* Text content preview */}
              <div>
                <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>
                  Document Transcription / Content
                </h4>
                <div style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '20px',
                  fontSize: '14px',
                  lineHeight: 1.6,
                  color: 'var(--text-primary)',
                  whiteSpace: 'pre-wrap',
                  maxHeight: '350px',
                  overflowY: 'auto',
                  fontFamily: 'inherit'
                }}>
                  {document.content || <em style={{ color: 'var(--text-muted)' }}>No content available.</em>}
                </div>
              </div>

              {/* File Info / Meta */}
              {document.metadata && Object.keys(document.metadata).length > 0 && (
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>
                    Ingestion Metadata
                  </h4>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: '12px',
                    fontSize: '12px'
                  }}>
                    {Object.entries(document.metadata).map(([key, val]) => {
                      if (typeof val === 'object') return null; // skip deeply nested metadata for simple display
                      return (
                        <div key={key} style={{
                          padding: '8px 12px',
                          background: 'rgba(255,255,255,0.01)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 'var(--radius-sm)'
                        }}>
                          <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize', display: 'block', marginBottom: '2px' }}>{key.replace('_', ' ')}</span>
                          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{String(val)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid var(--border-default)',
          background: 'rgba(255,255,255,0.01)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '12px'
        }}>
          <button 
            onClick={onClose}
            className="btn-ghost"
            style={{ padding: '8px 16px', fontSize: '13px' }}
          >
            Close
          </button>
          {document && document.file_path && (
            <button 
              onClick={handleDownload}
              disabled={isDownloading}
              className="btn-primary"
              style={{ padding: '8px 16px', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {isDownloading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Downloading...
                </>
              ) : (
                <>
                  View Original File
                  <ArrowUpRight size={14} />
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
