'use client';

import { useState } from 'react';
import {
  FileText, FileSpreadsheet, FileImage, FileDown,
  Loader2, X, Sparkles, Check, Download, ChevronRight,
  Eye, AlertTriangle
} from 'lucide-react';
import { apiRequest } from '@/lib/api';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: string;
  token: string;
}

interface FormatOption {
  id: 'pdf' | 'docx' | 'pptx' | 'csv' | 'html' | 'md';
  label: string;
  icon: React.ReactNode;
  description: string;
  color: string;
  bgColor: string;
}

const FORMATS: FormatOption[] = [
  {
    id: 'pdf',
    label: 'PDF Document',
    icon: <FileText size={22} />,
    description: 'Professional report with cover page, TOC, headers & footers',
    color: '#EF4444',
    bgColor: 'rgba(239, 68, 68, 0.1)',
  },
  {
    id: 'docx',
    label: 'Word Document',
    icon: <FileText size={22} />,
    description: 'Editable .docx with styles, tables, headers & page numbers',
    color: '#2563EB',
    bgColor: 'rgba(37, 99, 235, 0.1)',
  },
  {
    id: 'pptx',
    label: 'PowerPoint',
    icon: <FileImage size={22} />,
    description: 'Presentation with title slide, content slides, and closing',
    color: '#D97706',
    bgColor: 'rgba(217, 119, 6, 0.1)',
  },
  {
    id: 'csv',
    label: 'CSV Spreadsheet',
    icon: <FileSpreadsheet size={22} />,
    description: 'Structured data export with detected tables',
    color: '#10B981',
    bgColor: 'rgba(16, 185, 129, 0.1)',
  },
  {
    id: 'html',
    label: 'HTML Webpage',
    icon: <FileText size={22} />,
    description: 'Self-contained styled webpage you can open or print to PDF',
    color: '#0EA5E9',
    bgColor: 'rgba(14, 165, 233, 0.1)',
  },
  {
    id: 'md',
    label: 'Markdown',
    icon: <FileText size={22} />,
    description: 'Plain markdown for wikis, specs, and READMEs',
    color: '#64748B',
    bgColor: 'rgba(100, 116, 139, 0.1)',
  },
];

export default function ExportDialog({ isOpen, onClose, title, content, token }: ExportDialogProps) {
  const [selectedFormat, setSelectedFormat] = useState<string>('pdf');
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [enhanceEnabled, setEnhanceEnabled] = useState(true);
  const [exportResult, setExportResult] = useState<{
    downloadUrl: string;
    format: string;
    metadata?: any;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleEnhance = async () => {
    setIsEnhancing(true);
    setError(null);
    setExportResult(null);
    if (!token) {
      setError('Authentication required for enhancement');
      setIsEnhancing(false);
      return;
    }
    try {
      const res = await apiRequest('/api/documents/enhance', {
        method: 'POST',
        body: JSON.stringify({ title, content, format: selectedFormat }),
      }, token);
      
      if (res.success) {
        setExportResult({
          downloadUrl: '', // preview mode — no file yet
          format: selectedFormat,
          metadata: res.enhanced?.metadata,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Enhancement failed');
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    setExportResult(null);
    if (!token) {
      setError('Authentication required for export');
      setIsExporting(false);
      return;
    }
    try {
      const res = await apiRequest('/api/documents/export', {
        method: 'POST',
        body: JSON.stringify({
          title,
          content,
          format: selectedFormat,
          enhance: enhanceEnabled,
        }),
      }, token);

      if (res.success && res.downloadUrl) {
        setExportResult({
          downloadUrl: res.downloadUrl,
          format: res.format,
          metadata: res.metadata,
        });

        // Trigger download with direct fetch (not apiRequest — we need the blob)
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
        const downloadRes = await fetch(`${baseUrl}${res.downloadUrl}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });

        if (downloadRes.ok) {
          const blob = await downloadRes.blob();
          const blobUrl = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.setAttribute('download', `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.${res.format}`);
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.URL.revokeObjectURL(blobUrl);
        }
      } else {
        setError('Export failed: no download URL returned');
      }
    } catch (err: any) {
      setError(err.message || 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  const selectedOption = FORMATS.find(f => f.id === selectedFormat);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="glass-card animate-slide-up"
        style={{
          width: '520px',
          maxHeight: '85vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-secondary)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <FileDown size={20} style={{ color: 'var(--accent-primary)' }} />
            <h2 style={{ fontSize: '16px', fontWeight: 700, margin: 0 }}>
              Export Document
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
            }}
            className="hover-bg-tertiary"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>

          {/* Document Info */}
          <div style={{
            padding: '12px 16px',
            background: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <FileText size={16} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title || 'Untitled Document'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {content.split(/\s+/).length} words • {content.split('\n').length} lines
              </div>
            </div>
          </div>

          {/* Format Selection */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '10px' }}>
              Choose Export Format
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {FORMATS.map(fmt => (                  <button
                  key={fmt.id}
                  onClick={() => { setSelectedFormat(fmt.id); setExportResult(null); setError(null); setIsEnhancing(false); }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: '8px',
                    padding: '14px',
                    borderRadius: 'var(--radius-md)',
                    border: `2px solid ${selectedFormat === fmt.id ? fmt.color : 'var(--border-default)'}`,
                    background: selectedFormat === fmt.id ? fmt.bgColor : 'var(--bg-primary)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  <div style={{ color: fmt.color }}>{fmt.icon}</div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {fmt.label}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: '1.3', marginTop: '2px' }}>
                      {fmt.description}
                    </div>
                  </div>
                  {selectedFormat === fmt.id && (
                    <div style={{
                      width: '18px', height: '18px', borderRadius: '50%',
                      background: fmt.color, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', position: 'absolute', right: '12px', top: '12px'
                    }}>
                      <Check size={11} color="white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Enhance Toggle */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px 16px',
            background: enhanceEnabled ? 'rgba(99, 102, 241, 0.05)' : 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${enhanceEnabled ? 'rgba(99, 102, 241, 0.2)' : 'var(--border-subtle)'}`,
            cursor: 'pointer',
          }}
            onClick={() => setEnhanceEnabled(!enhanceEnabled)}
          >
            <div style={{
              width: '36px', height: '20px', borderRadius: '10px',
              background: enhanceEnabled ? 'var(--accent-primary)' : 'var(--bg-secondary)',
              border: `1px solid ${enhanceEnabled ? 'var(--accent-primary)' : 'var(--border-default)'}`,
              position: 'relative', transition: 'all 0.2s', flexShrink: 0,
            }}>
              <div style={{
                width: '16px', height: '16px', borderRadius: '50%',
                background: 'white', position: 'absolute', top: '1px',
                left: enhanceEnabled ? '17px' : '1px',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={14} style={{ color: 'var(--accent-primary)' }} />
                AI-Enhance for {selectedOption?.label}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Optimizes content structure and formatting for maximum quality
              </div>
            </div>
          </div>

          {/* Preview / Metadata */}
          {exportResult?.metadata && (
            <div style={{
              padding: '14px 16px',
              background: 'rgba(16, 185, 129, 0.05)',
              border: '1px solid rgba(16, 185, 129, 0.15)',
              borderRadius: 'var(--radius-md)',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                <Check size={14} />
                Content Enhancement Complete
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <div>Sections: <strong>{exportResult.metadata.sections}</strong></div>
                <div>Word Count: <strong>{exportResult.metadata.wordCount}</strong></div>
                <div>Has Tables: <strong>{exportResult.metadata.hasTables ? 'Yes' : 'No'}</strong></div>
                <div>Quality: <strong style={{ color: exportResult.metadata.qualityScore >= 85 ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}>
                  {exportResult.metadata.qualityScore}/100
                </strong></div>
              </div>
            </div>
          )}

          {exportResult?.downloadUrl && (
            <div style={{
              padding: '12px 16px',
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}>
              <Download size={16} style={{ color: 'var(--accent-emerald)' }} />
              <span style={{ fontSize: '13px', color: 'var(--accent-emerald)', fontWeight: 600 }}>
                File exported successfully!
              </span>
            </div>
          )}

          {error && (
            <div style={{
              padding: '12px 16px',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}>
              <AlertTriangle size={16} style={{ color: 'var(--accent-rose)', flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: 'var(--accent-rose)' }}>{error}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '10px',
          background: 'var(--bg-secondary)',
        }}>
          <button
            onClick={onClose}
            className="btn-ghost"
            style={{ padding: '8px 16px', fontSize: '13px' }}
          >
            Cancel
          </button>
          {enhanceEnabled && !exportResult?.downloadUrl && (
            <button
              onClick={handleEnhance}
              disabled={isEnhancing}
              className="btn-ghost"
              style={{
                padding: '8px 16px', fontSize: '13px',
                borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)',
              }}
            >
              {isEnhancing ? (
                <><Loader2 size={14} className="animate-spin" /> Enhancing...</>
              ) : exportResult?.downloadUrl === '' ? (
                <><Eye size={14} /> Enhancement Previewed</>
              ) : (
                <><Sparkles size={14} /> Preview Enhancement</>
              )}
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="btn-primary"
            style={{
              padding: '8px 20px', fontSize: '13px',
              background: selectedOption?.color || 'var(--accent-primary)',
              border: 'none',
              opacity: isExporting ? 0.7 : 1,
            }}
          >
            {isExporting ? (
              <><Loader2 size={14} className="animate-spin" /> Exporting...</>
            ) : (
              <><Download size={14} /> Export {selectedOption?.label}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
