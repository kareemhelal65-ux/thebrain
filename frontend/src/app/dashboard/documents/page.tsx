'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../layout';
import { FileText, Upload, Loader2, File, Trash2, CheckCircle, FileDown } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import ExportDialog from '@/components/ExportDialog';

export default function DocumentsPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [files, setFiles] = useState<Array<{ name: string; status: string; chunks?: number }>>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [allDocuments, setAllDocuments] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({});
  const [exportDoc, setExportDoc] = useState<any | null>(null);

  const handleDownload = async (doc: any) => {
    if (downloadingIds[doc.id]) return;
    setDownloadingIds(prev => ({ ...prev, [doc.id]: true }));
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const activeToken = session?.access_token || token;

      if (!activeToken) {
        throw new Error('Authentication token not found. Please log in again.');
      }

      const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}${doc.file_path}`;
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
      const link = document.createElement('a');
      link.href = downloadUrl;

      const ext = doc.document_type || 'md';
      const cleanTitle = doc.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      link.setAttribute('download', `${cleanTitle}.${ext}`);

      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      console.error('Download error:', err);
      alert(err.message || 'Failed to download file.');
    } finally {
      setDownloadingIds(prev => ({ ...prev, [doc.id]: false }));
    }
  };

  // Load existing documents
  const loadDocuments = async () => {
    try {
      const data = await apiRequest('/api/documents', {}, token!);
      if (data.documents) {
        setAllDocuments(data.documents);
      }
    } catch (err) {
      console.error('Failed to load documents', err);
    }
  };

  // Load pending drafts
  const loadDrafts = async () => {
    try {
      const data = await apiRequest('/api/documents/drafts', {}, token!);
      if (data.drafts) {
        setDrafts(data.drafts);
      }
    } catch (err) {
      console.error('Failed to load drafts', err);
    }
  };

  // Initial load

  useEffect(() => {
    if (token) {
      loadDocuments();
      loadDrafts();
    }
  }, [token]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;
    try {
      await apiRequest(`/api/documents/${id}`, {
        method: 'DELETE'
      }, token!);
      setAllDocuments(prev => prev.filter(doc => doc.id !== id));
    } catch (err) {
      console.error('Failed to delete document', err);
      alert('Failed to delete document.');
    }
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    for (const file of Array.from(fileList)) {
      const entry = { name: file.name, status: 'uploading' };
      setFiles(prev => [...prev, entry]);
      setUploading(true);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/memory/ingest`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData,
        });

        const data = await res.json();
        setFiles(prev =>
          prev.map(f =>
            f.name === file.name
              ? { ...f, status: 'done', chunks: data.chunksProcessed }
              : f
          )
        );
        loadDocuments(); // Reload documents list
      } catch {
        setFiles(prev =>
          prev.map(f =>
            f.name === file.name ? { ...f, status: 'error' } : f
          )
        );
      }
    }
    setUploading(false);
  };

  return (
    <div style={{ padding: '32px', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <h1 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '8px' }}>Documents & Memory</h1>
      <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '32px' }}>
        Upload or generate documents here. The Brain will index them into your company&apos;s memory for instant search and chat.
      </p>

      {/* Upload zone */}
      <div
        className="glass-card"
        style={{
          padding: '48px',
          textAlign: 'center',
          cursor: 'pointer',
          border: '2px dashed var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          transition: 'border-color 0.2s ease',
          marginBottom: '32px',
          flexShrink: 0
        }}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); (e.currentTarget).style.borderColor = 'var(--accent-primary)'; }}
        onDragLeave={e => { (e.currentTarget).style.borderColor = 'var(--border-default)'; }}
        onDrop={e => {
          e.preventDefault();
          (e.currentTarget).style.borderColor = 'var(--border-default)';
          handleUpload(e.dataTransfer.files);
        }}
      >
        <Upload size={40} style={{ color: 'var(--accent-secondary)', margin: '0 auto 16px' }} />
        <p style={{ fontSize: '16px', fontWeight: 600, marginBottom: '6px' }}>
          Drop files here or click to upload
        </p>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          PDF, DOCX, PPTX, CSV, TXT, MD, JSON — up to 10MB
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.pptx,.csv,.txt,.md,.json"
          style={{ display: 'none' }}
          onChange={e => handleUpload(e.target.files)}
        />
      </div>

      {/* Upload Progress */}
      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '32px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '8px' }}>Recent Uploads</h3>
          {files.map((file, i) => (
            <div key={i} className="glass-card" style={{
              display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px',
            }}>
              <File size={18} style={{ color: 'var(--accent-cyan)', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '13px', fontWeight: 600 }}>{file.name}</p>
                <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  {file.status === 'uploading' ? 'Processing...' :
                   file.status === 'done' ? `${file.chunks} chunks indexed` :
                   'Failed'}
                </p>
              </div>
              {file.status === 'uploading' && <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />}
              {file.status === 'done' && <CheckCircle size={16} style={{ color: 'var(--accent-emerald)' }} />}
              {file.status === 'error' && <span className="badge badge-danger">Error</span>}
            </div>
          ))}
        </div>
      )}

      {/* Side-by-Side Content Columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'flex-start' }}>
        {/* Left Column: Pending Drafts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <FileText size={18} style={{ color: 'var(--accent-amber)' }} />
            Pending Drafts for Review
            {drafts.length > 0 && (
              <span className="badge badge-warning" style={{ fontSize: '11px', padding: '2px 8px' }}>
                {drafts.length}
              </span>
            )}
          </h3>
          
          {drafts.length === 0 ? (
            <div className="glass-card" style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              <CheckCircle size={28} style={{ color: 'var(--accent-emerald)', margin: '0 auto 12px', opacity: 0.8 }} />
              <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>All Caught Up!</p>
              <p>No document drafts are currently pending review.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {drafts.map((draft: any) => (
                <div 
                  key={draft.id} 
                  className="glass-card animate-pulse-glow" 
                  style={{ 
                    display: 'flex', 
                    flexDirection: 'column',
                    gap: '12px',
                    padding: '16px',
                    borderColor: 'rgba(251, 191, 36, 0.3)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <FileText size={18} style={{ color: 'var(--accent-amber)', flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{draft.title}</div>
                        <span className="badge badge-info" style={{ fontSize: '10px', padding: '1px 6px', flexShrink: 0 }}>
                          {draft.format.toUpperCase()}
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Requested: {new Date(draft.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.2)', padding: '8px 12px', borderRadius: 'var(--radius-sm)' }}>
                    {draft.summary_of_changes || 'AI Generated Draft'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button 
                      onClick={() => router.push(`/dashboard/documents/drafts/${draft.id}`)} 
                      className="btn-primary" 
                      style={{ 
                        padding: '8px 14px', 
                        fontSize: '12px',
                        width: '100%',
                        background: 'linear-gradient(135deg, var(--accent-amber), #d97706)',
                        border: 'none'
                      }}
                    >
                      Review Draft
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Brain Documents */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
            <FileText size={18} style={{ color: 'var(--accent-primary)' }} />
            Brain Documents
            {allDocuments.length > 0 && (
              <span className="badge badge-info" style={{ fontSize: '11px', padding: '2px 8px', background: 'rgba(99,102,241,0.2)', color: 'var(--accent-cyan)' }}>
                {allDocuments.length}
              </span>
            )}
          </h3>

          {allDocuments.length === 0 ? (
            <div className="glass-card" style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              <File size={28} style={{ color: 'var(--text-muted)', margin: '0 auto 12px', opacity: 0.5 }} />
              <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>No Documents</p>
              <p>No documents are indexed in the Brain memory yet.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {allDocuments.map((doc: any) => (
                <div key={doc.id} className="glass-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                    <FileText size={18} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        Type: {doc.document_type.toUpperCase()} • Added: {new Date(doc.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {doc.file_path && doc.file_path.startsWith('/uploads') && (
                        <button 
                          onClick={() => handleDownload(doc)} 
                          disabled={downloadingIds[doc.id]}
                          className="btn-ghost" 
                          style={{ padding: '6px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px' }}
                        >
                          {downloadingIds[doc.id] ? (
                            <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
                          ) : (
                            'Download'
                          )}
                        </button>
                      )}
                      <button 
                        onClick={() => setExportDoc(doc)} 
                        className="btn-ghost"
                        style={{ padding: '6px 8px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--accent-primary)' }}
                      >
                        <FileDown size={12} />
                        Export
                      </button>
                      <button onClick={() => handleDelete(doc.id)} className="btn-ghost" style={{ color: 'var(--danger)', padding: '6px' }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Export Dialog */}
      {exportDoc && token && (
        <ExportDialog
          isOpen={!!exportDoc}
          onClose={() => setExportDoc(null)}
          title={exportDoc.title}
          content={exportDoc.content || 'Document content not available for preview. Export to generate the file.'}
          token={token}
        />
      )}
    </div>
  );
}
