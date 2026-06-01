'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../layout';
import { apiRequest } from '@/lib/api';
import { createClient } from '@/lib/supabase';
import ExportDialog from '@/components/ExportDialog';
import {
  ArrowLeft, FileText, Check, X, MessageSquare, Send, Copy, Sparkles,
  Loader2, Download, CheckCircle, RefreshCw, AlertTriangle, FileDown
} from 'lucide-react';

interface Comment {
  sender: 'user' | 'ai';
  message: string;
  timestamp: string;
}

export default function DraftReviewerPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const { token } = useAuth();

  const [draft, setDraft] = useState<any>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [loading, setLoading] = useState(true);
  const [isCommenting, setIsCommenting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [copied, setCopied] = useState(false);
  
  // Direct manual editing states
  const [isDirectEditing, setIsDirectEditing] = useState(false);
  
  // AI processing phase tracking
  const [commentPhase, setCommentPhase] = useState<'idle' | 'searching' | 'revising'>('idle');
  const commentPhaseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  // Export dialog state
  const [showExport, setShowExport] = useState(false);

  // Faithful in-OS preview (rendered HTML from the backend, format-aware)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const loadPreview = async () => {
    try {
      const res = await apiRequest(`/api/documents/drafts/${id}/preview`, {}, token!);
      setPreviewHtml(res.html || null);
    } catch {
      setPreviewHtml(null);
    }
  };

  const commentsEndRef = useRef<HTMLDivElement>(null);

  const loadDraft = async () => {
    try {
      const res = await apiRequest(`/api/documents/drafts/${id}`, {}, token!);
      setDraft(res.draft);
      setEditTitle(res.draft.title || '');
      setEditContent(res.draft.content || '');
      
      if (res.draft.user_comments) {
        try {
          const parsed = JSON.parse(res.draft.user_comments);
          if (Array.isArray(parsed)) {
            setComments(parsed);
          } else {
            setComments([{ sender: 'user', message: res.draft.user_comments, timestamp: res.draft.updated_at }]);
          }
        } catch {
          setComments([{ sender: 'user', message: res.draft.user_comments, timestamp: res.draft.updated_at }]);
        }
      } else {
        setComments([]);
      }
    } catch (err) {
      console.error('Failed to load draft:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token && id) {
      loadDraft();
    }
  }, [token, id]);

  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments]);

  // Refresh the rendered preview whenever the draft content/format changes.
  useEffect(() => {
    if (token && id && draft && !isDirectEditing) loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id, draft?.content, draft?.format, isDirectEditing]);

  // Cleanup the comment phase interval on unmount
  useEffect(() => {
    return () => {
      if (commentPhaseTimerRef.current) {
        clearInterval(commentPhaseTimerRef.current);
      }
    };
  }, []);

  const handleSaveDirectEdit = async () => {
    if (!editTitle.trim() || !editContent.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const res = await apiRequest(`/api/documents/drafts/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: editTitle,
          content: editContent
        })
      }, token!);
      
      if (res.success && res.draft) {
        setDraft(res.draft);
        setEditTitle(res.draft.title);
        setEditContent(res.draft.content);
        setIsDirectEditing(false);
      }
    } catch (err: any) {
      alert(`Failed to save changes: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendComment = async () => {
    if (!commentText.trim() || isCommenting) return;
    setIsCommenting(true);
    setCommentPhase('searching');
    
    // Add optimistic user comment
    const newComment: Comment = {
      sender: 'user',
      message: commentText.trim(),
      timestamp: new Date().toISOString()
    };
    setComments(prev => [...prev, newComment]);
    
    const textToSend = commentText.trim();
    setCommentText('');

    // Cycle through phase messages while waiting
    let phaseIndex = 0;
    const phaseMessages = ['searching', 'revising'] as const;
    commentPhaseTimerRef.current = setInterval(() => {
      phaseIndex = (phaseIndex + 1) % phaseMessages.length;
      setCommentPhase(phaseMessages[phaseIndex]);
    }, 4000);

    try {
      const res = await apiRequest(`/api/documents/drafts/${id}/comment`, {
        method: 'POST',
        body: JSON.stringify({ comment: textToSend })
      }, token!);
      
      setDraft(res.draft);
      setEditTitle(res.draft.title || '');
      setEditContent(res.draft.content || '');
      if (res.draft.user_comments) {
        try {
          const parsed = JSON.parse(res.draft.user_comments);
          if (Array.isArray(parsed)) {
            setComments(parsed);
          }
        } catch {
          // Keep comments
        }
      }
      
      // Show tools used if available (for debugging/transparency)
      if (res.toolsUsed && res.toolsUsed.length > 0) {
        const brainSearches = res.toolsUsed.filter((t: any) => t.name === 'brain_search');
        if (brainSearches.length > 0) {
          console.log(`[DraftReview] AI searched the Brain ${brainSearches.length} time(s) to fulfill your request`);
        }
      }
    } catch (err: any) {
      alert(`Failed to revise draft: ${err.message}`);
      // Remove optimistic comment on error
      setComments(prev => prev.slice(0, -1));
      setCommentText(textToSend);
    } finally {
      if (commentPhaseTimerRef.current) {
        clearInterval(commentPhaseTimerRef.current);
        commentPhaseTimerRef.current = null;
      }
      setCommentPhase('idle');
      setIsCommenting(false);
    }
  };

  const handleApprove = async () => {
    if (isApproving) return;
    setIsApproving(true);
    try {
      const res = await apiRequest(`/api/documents/drafts/${id}/approve`, {
        method: 'POST'
      }, token!);
      
      // Trigger download programmatically
      if (res.downloadUrl) {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        const activeToken = session?.access_token || token;

        if (!activeToken) {
          throw new Error('Authentication token not found. Please log in again.');
        }

        const url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}${res.downloadUrl}`;
        const downloadRes = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${activeToken}`
          }
        });

        if (!downloadRes.ok) {
          const errData = await downloadRes.json().catch(() => ({}));
          throw new Error(errData.message || `Failed to download file: ${downloadRes.statusText}`);
        }

        const blob = await downloadRes.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.setAttribute('download', `${draft.title}.${draft.format}`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(downloadUrl);
      }
      
      router.push('/dashboard/documents');
    } catch (err: any) {
      alert(`Failed to approve draft: ${err.message}`);
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!confirm('Are you sure you want to reject this draft?') || isRejecting) return;
    setIsRejecting(true);
    try {
      await apiRequest(`/api/documents/drafts/${id}/reject`, {
        method: 'POST'
      }, token!);
      router.push('/dashboard/documents');
    } catch (err: any) {
      alert(`Failed to reject draft: ${err.message}`);
    } finally {
      setIsRejecting(false);
    }
  };

  const handleCopy = () => {
    if (!draft) return;
    navigator.clipboard.writeText(draft.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
        <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Loading draft details...</span>
      </div>
    );
  }

  if (!draft) {
    return (
      <div style={{ display: 'flex', flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px', padding: '32px', textAlign: 'center' }}>
        <AlertTriangle size={48} style={{ color: 'var(--accent-rose)' }} />
        <h3 style={{ fontSize: '18px', fontWeight: 700 }}>Draft Not Found</h3>
        <p style={{ fontSize: '14px', color: 'var(--text-secondary)', maxWidth: '400px' }}>
          This draft could not be retrieved, or you do not have permission to view it.
        </p>
        <button onClick={() => router.push('/dashboard/documents')} className="btn-ghost" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <ArrowLeft size={16} /> Back to Documents
        </button>
      </div>
    );
  }

  const isPending = draft.status === 'pending';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      
      {/* Top Navbar */}
      <div style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button 
            onClick={() => router.push('/dashboard/documents')}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              padding: '6px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: 'var(--radius-sm)'
            }}
            className="hover-bg-tertiary"
          >
            <ArrowLeft size={20} />
          </button>
          
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileText size={18} style={{ color: 'var(--accent-primary)' }} />
              <h1 style={{ fontSize: '16px', fontWeight: 800 }}>{draft.title}</h1>
              <span className={`badge ${draft.format === 'pdf' ? 'badge-danger' : draft.format === 'docx' ? 'badge-info' : 'badge-warning'}`} style={{ fontSize: '10px', padding: '1px 6px' }}>
                {draft.format.toUpperCase()}
              </span>
              <span className={`badge ${
                draft.status === 'approved' ? 'badge-success' : 
                draft.status === 'rejected' ? 'badge-danger' : 
                'badge-warning'
              }`} style={{ fontSize: '10px', padding: '1px 6px' }}>
                {draft.status.toUpperCase()}
              </span>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Created: {new Date(draft.created_at).toLocaleString()}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        {isPending && (
          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              onClick={() => setShowExport(true)}
              className="btn-ghost"
              style={{ borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)', padding: '8px 16px', fontSize: '13px' }}
            >
              <FileDown size={14} />
              Export Draft
            </button>
            <button 
              onClick={handleReject}
              disabled={isRejecting || isApproving}
              className="btn-ghost"
              style={{ borderColor: 'var(--accent-rose)', color: 'var(--accent-rose)', padding: '8px 16px', fontSize: '13px' }}
            >
              {isRejecting ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
              Reject Draft
            </button>
            <button 
              onClick={handleApprove}
              disabled={isRejecting || isApproving}
              className="btn-primary"
              style={{ padding: '8px 16px', fontSize: '13px' }}
            >
              {isApproving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Approve & Ingest
            </button>
          </div>
        )}
        
        {/* Export Button for approved/rejected drafts (view-only) */}
        {!isPending && (
          <div style={{ display: 'flex', gap: '10px' }}>
            <button 
              onClick={() => setShowExport(true)}
              className="btn-ghost"
              style={{ borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)', padding: '8px 16px', fontSize: '13px' }}
            >
              <FileDown size={14} />
              Export as {draft.format?.toUpperCase() || 'PDF'}
            </button>
          </div>
        )}
      </div>

      {/* Main Split Layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        
        {/* Left Pane - Document Content Preview */}
        <div style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '400px' }}>
            
            {/* Preview Toolbar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 20px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'rgba(255, 255, 255, 0.01)',
              borderTopLeftRadius: 'var(--radius-lg)',
              borderTopRightRadius: 'var(--radius-lg)'
            }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {isDirectEditing ? 'Editing Draft Content' : 'Draft Preview'}
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                {isPending && (
                  <button 
                    onClick={() => {
                      setIsDirectEditing(!isDirectEditing);
                      setEditTitle(draft.title || '');
                      setEditContent(draft.content || '');
                    }}
                    className="btn-ghost"
                    style={{ padding: '4px 10px', fontSize: '12px', height: '28px', color: isDirectEditing ? 'var(--accent-primary)' : 'inherit' }}
                  >
                    {isDirectEditing ? 'Cancel Edit' : 'Direct Edit'}
                  </button>
                )}
                <button 
                  onClick={handleCopy}
                  className="btn-ghost"
                  style={{ padding: '4px 10px', fontSize: '12px', height: '28px' }}
                >
                  {copied ? <CheckCircle size={12} style={{ color: 'var(--accent-emerald)' }} /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy Contents'}
                </button>
              </div>
            </div>

            {/* Document Body */}
            <div style={{ flex: 1, padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {isDirectEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                      Document Title
                    </label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      className="input-field"
                      style={{ fontSize: '14px', padding: '10px 12px', width: '100%', background: 'var(--bg-tertiary)' }}
                    />
                  </div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '6px', color: 'var(--text-secondary)' }}>
                      Document Content
                    </label>
                    <textarea
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      className="input-field"
                      style={{
                        flex: 1,
                        fontSize: '14px',
                        padding: '12px',
                        width: '100%',
                        minHeight: '280px',
                        background: 'var(--bg-tertiary)',
                        fontFamily: 'inherit',
                        lineHeight: '1.6',
                        resize: 'vertical'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '10px' }}>
                    <button
                      onClick={() => setIsDirectEditing(false)}
                      className="btn-ghost"
                      style={{ padding: '8px 16px', fontSize: '13px' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveDirectEdit}
                      disabled={isSaving}
                      className="btn-primary"
                      style={{ padding: '8px 16px', fontSize: '13px', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))' }}
                    >
                      {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      Save Changes
                    </button>
                  </div>
                </div>
              ) : (
                previewHtml ? (
                  <iframe
                    srcDoc={previewHtml}
                    sandbox="allow-scripts allow-popups"
                    title="Document preview"
                    style={{ width: '100%', height: '100%', minHeight: 520, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'white' }}
                  />
                ) : (
                  <div
                    className="chat-content"
                    style={{
                      fontSize: '15px',
                      lineHeight: 1.7,
                      color: 'var(--text-primary)',
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'inherit'
                    }}
                  >
                    {draft.content}
                  </div>
                )
              )}
            </div>

          </div>
        </div>

        {/* Right Pane - Activity Log, Revisions, & Comments */}
        <div style={{
          width: '420px',
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0
        }}>
          
          {/* Section Header */}
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageSquare size={16} style={{ color: 'var(--accent-primary)' }} />
              Revision Activity & Comments
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
              Add feedback to trigger LLM rewrites on the draft content.
            </p>
          </div>

          {/* Activity Logs / Comments Thread */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* Initial Change Summary */}
            {draft.summary_of_changes && (
              <div style={{
                background: 'rgba(99, 102, 241, 0.05)',
                border: '1px solid rgba(99, 102, 241, 0.15)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: 'var(--accent-secondary)', marginBottom: '4px' }}>
                  <Sparkles size={13} />
                  INITIAL DRAFT CREATED
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                  {draft.summary_of_changes}
                </div>
              </div>
            )}

            {/* Comment Log */}
            {comments.map((c, index) => {
              const isAI = c.sender === 'ai';
              return (
                <div 
                  key={index}
                  className="animate-slide-up"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignSelf: isAI ? 'flex-start' : 'flex-end',
                    maxWidth: '85%',
                    background: isAI ? 'var(--bg-tertiary)' : 'var(--bg-elevated)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 14px',
                    boxShadow: 'var(--shadow-sm)',
                    borderColor: isAI ? 'rgba(99, 102, 241, 0.15)' : 'var(--border-default)'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '6px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: isAI ? 'var(--accent-secondary)' : 'var(--text-accent)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {isAI ? <Sparkles size={10} /> : null}
                      {isAI ? 'Assistant Revision' : 'Kareem Helal'}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>
                    {c.message}
                  </div>
                </div>
              );
            })}

            {isCommenting && (
              <div style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
                color: 'var(--text-muted)',
                fontSize: '12px',
                background: 'rgba(99, 102, 241, 0.04)',
                border: '1px solid rgba(99, 102, 241, 0.12)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 14px',
                maxWidth: '100%'
              }}>
                <div style={{ position: 'relative', width: '16px', height: '16px', flexShrink: 0, marginTop: '1px' }}>
                  <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                  <span style={{ fontWeight: 600, color: 'var(--accent-secondary)', fontSize: '11px' }}>
                    THE BRAIN IS PROCESSING
                  </span>
                  <span style={{ color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                    {commentPhase === 'searching'
                      ? 'Searching your knowledge base for relevant context, documents, and data to fulfill your request...'
                      : 'Analyzing your feedback and revising the document content...'
                    }
                  </span>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
                    <div style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      background: commentPhase === 'searching' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                      transition: 'all 0.4s'
                    }} />
                    <div style={{
                      width: '6px', height: '6px', borderRadius: '50%',
                      background: commentPhase === 'searching' ? 'var(--bg-secondary)' : 'var(--accent-cyan)',
                      transition: 'all 0.4s'
                    }} />
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '4px' }}>
                      {commentPhase === 'searching' ? 'Gathering context' : 'Revising content'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={commentsEndRef} />
          </div>

          {/* Comment Input Footer */}
          {isPending ? (
            <div style={{ padding: '20px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', flexShrink: 0 }}>
              <div style={{ position: 'relative', display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendComment();
                    }
                  }}
                  placeholder="Ask the AI to change or rewrite the draft..."
                  disabled={isCommenting}
                  style={{
                    flex: 1,
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px 48px 12px 14px',
                    fontSize: '13px',
                    color: 'var(--text-primary)',
                    outline: 'none',
                    transition: 'border-color 0.2s'
                  }}
                  onFocus={(e) => e.target.style.borderColor = 'var(--accent-primary)'}
                  onBlur={(e) => e.target.style.borderColor = 'var(--border-default)'}
                />
                <button
                  onClick={handleSendComment}
                  disabled={!commentText.trim() || isCommenting}
                  style={{
                    position: 'absolute',
                    right: '8px',
                    top: '8px',
                    width: '32px',
                    height: '32px',
                    borderRadius: 'var(--radius-sm)',
                    background: commentText.trim() && !isCommenting ? 'var(--text-primary)' : 'var(--bg-secondary)',
                    color: commentText.trim() && !isCommenting ? 'var(--bg-primary)' : 'var(--text-muted)',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: commentText.trim() && !isCommenting ? 'pointer' : 'not-allowed',
                    transition: 'all 0.2s'
                  }}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          ) : (
            <div style={{ padding: '24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-primary)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px', flexShrink: 0 }}>
              This draft is {draft.status} and cannot be edited.
            </div>
          )}

        </div>

      </div>

      {/* Export Dialog */}
      {showExport && draft && token && (
        <ExportDialog
          isOpen={showExport}
          onClose={() => setShowExport(false)}
          title={draft.title}
          content={draft.content}
          token={token}
        />
      )}

    </div>
  );
}
