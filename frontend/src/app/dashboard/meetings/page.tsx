'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../layout';
import { apiRequest } from '@/lib/api';
import {
  Calendar, Clock, Users, ChevronRight, Upload,
  Loader2, Search, Filter, CheckCircle2, Circle,
  AlertCircle, RefreshCw, FileAudio, Mic, Square,
  FileText, Globe, Lightbulb, Sparkles, X, Save, Trash2,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import AgentQuickActions from '../_components/AgentQuickActions';

interface Meeting {
  id: string;
  title: string;
  source_type: string;
  meeting_date: string;
  duration_minutes: number | null;
  participants: Array<{ name: string; email?: string }>;
  raw_transcript?: string | null;
  insights: {
    summary?: string;
    decisions?: Array<{ decision: string; context?: string }>;
    action_items?: Array<{ task: string; assignee: string; deadline?: string; priority?: string }>;
    key_topics?: string[];
    speaker_segments?: Array<{ speaker: string; text: string }>;
    language?: string;
  } | null;
  vector_indexed: boolean;
}

// Map common ISO/Whisper language codes & names to a friendly display label.
const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English', english: 'English', es: 'Spanish', spanish: 'Spanish',
  fr: 'French', french: 'French', de: 'German', german: 'German',
  ar: 'Arabic', arabic: 'Arabic', pt: 'Portuguese', portuguese: 'Portuguese',
  it: 'Italian', italian: 'Italian', nl: 'Dutch', dutch: 'Dutch',
  hi: 'Hindi', hindi: 'Hindi', zh: 'Chinese', chinese: 'Chinese',
  ja: 'Japanese', japanese: 'Japanese', ko: 'Korean', korean: 'Korean',
  ru: 'Russian', russian: 'Russian', tr: 'Turkish', turkish: 'Turkish',
};
const formatLanguage = (lang?: string) => {
  if (!lang) return null;
  const key = lang.toLowerCase().trim();
  return LANGUAGE_LABELS[key] || (lang.charAt(0).toUpperCase() + lang.slice(1));
};

const recordMenuItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: '10px', textAlign: 'left',
  padding: '10px 12px', borderRadius: 'var(--radius-md)', border: 'none',
  background: 'transparent', cursor: 'pointer', width: '100%',
};

export default function MeetingsPage() {
  const { token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('id');

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // ─── In-browser recording ───
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [recProcessing, setRecProcessing] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [recordMenuOpen, setRecordMenuOpen] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const tracksRef = useRef<MediaStreamTrack[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordModeRef = useRef<'meeting' | 'brainstorm'>('meeting');

  // ─── Ephemeral brainstorm (not saved until the user presses "Store to Brain") ───
  const [brainstorm, setBrainstorm] = useState<{ transcript: string; language?: string | null; insights: any; title: string } | null>(null);
  const [brainstormStoring, setBrainstormStoring] = useState(false);

  // ─── Detail view: commit-to-Brain + send-to-agents ───
  const [committing, setCommitting] = useState(false);
  const [agentTasks, setAgentTasks] = useState<Array<{ agent_type: string; agent_label: string; task: string }>>([]);
  const [sendingToAgents, setSendingToAgents] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [deletingMeeting, setDeletingMeeting] = useState(false);

  useEffect(() => {
    if (token) loadMeetings();
  }, [token, highlightId]);

  // Stop everything and free devices/the audio graph.
  const cleanupRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    tracksRef.current.forEach(t => { try { t.stop(); } catch {} });
    tracksRef.current = [];
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch {} audioCtxRef.current = null; }
  };

  useEffect(() => () => cleanupRecording(), []); // cleanup on unmount

  // When a meeting is opened, reset agent-task state and (if it's already in the Brain
  // and has action items) load the agent-actionable tasks.
  useEffect(() => {
    setSendResult(null);
    setAgentTasks([]);
    if (selectedMeeting?.id && selectedMeeting.vector_indexed && (selectedMeeting.insights?.action_items?.length || 0) > 0) {
      loadAgentTasks(selectedMeeting.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMeeting?.id]);

  const pickMimeType = () => {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const c of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  };

  const startRecording = async (captureTab = false, mode: 'meeting' | 'brainstorm' = 'meeting') => {
    setRecError(null);
    setRecordMenuOpen(false);
    recordModeRef.current = mode;
    if (mode === 'brainstorm') setBrainstorm(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRecError('Recording is not supported in this browser.');
      return;
    }
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const dest = ctx.createMediaStreamDestination();

      // Always capture the microphone — this alone covers in-person meetings.
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getTracks().forEach(t => tracksRef.current.push(t));
      ctx.createMediaStreamSource(mic).connect(dest);

      // For ONLINE meetings, also capture the meeting/tab audio (Zoom/Meet in another
      // tab). The browser shows a picker; if the user cancels we record mic-only.
      if (captureTab) {
        try {
          const display = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: true });
          display.getTracks().forEach((t: MediaStreamTrack) => tracksRef.current.push(t));
          if (display.getAudioTracks().length > 0) {
            ctx.createMediaStreamSource(display).connect(dest);
          } else {
            setRecError('No tab audio was shared — recording your mic only. Tip: tick "Share tab audio" in the picker.');
          }
          // We don't need the video — stop it so no "sharing" UI lingers.
          display.getVideoTracks().forEach((t: MediaStreamTrack) => t.stop());
        } catch {
          /* user declined tab/system audio — proceed mic-only */
        }
      }

      const mimeType = pickMimeType();
      const mr = new MediaRecorder(dest.stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        cleanupRecording();
        if (recordModeRef.current === 'brainstorm') transcribeBrainstorm(blob);
        else uploadRecording(blob);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
      setRecordSeconds(0);
      timerRef.current = setInterval(() => setRecordSeconds(s => s + 1), 1000);
    } catch (err: any) {
      console.error('Failed to start recording:', err);
      setRecError(err?.name === 'NotAllowedError' ? 'Microphone permission denied.' : 'Could not start recording.');
      cleanupRecording();
    }
  };

  const stopRecording = () => {
    setRecording(false);
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') {
      mr.stop(); // triggers onstop → uploadRecording
    }
  };

  const uploadRecording = async (blob: Blob) => {
    if (!blob || blob.size === 0) { setRecError('Recording was empty.'); return; }
    setRecProcessing(true);
    try {
      const ext = (blob.type.includes('ogg')) ? 'ogg' : (blob.type.includes('mp4') ? 'm4a' : 'webm');
      const stamp = new Date().toLocaleString();
      const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: blob.type || 'audio/webm' });
      const formData = new FormData();
      formData.append('audio', file);
      formData.append('title', `Recorded Meeting — ${stamp}`);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/meetings/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json().catch(() => ({}));
      await loadMeetings();
      if (data?.meeting_id) {
        // Select the freshly processed meeting once the list reloads.
        setTimeout(() => {
          setMeetings(prev => {
            const found = prev.find(m => m.id === data.meeting_id);
            if (found) setSelectedMeeting(found);
            return prev;
          });
        }, 0);
      }
    } catch (err) {
      console.error('Recording upload failed:', err);
      setRecError('Could not process the recording.');
    } finally {
      setRecProcessing(false);
    }
  };

  // Brainstorm: transcribe + analyze WITHOUT saving. Result shown ephemerally.
  const transcribeBrainstorm = async (blob: Blob) => {
    if (!blob || blob.size === 0) { setRecError('Recording was empty.'); return; }
    setRecProcessing(true);
    try {
      const ext = (blob.type.includes('ogg')) ? 'ogg' : (blob.type.includes('mp4') ? 'm4a' : 'webm');
      const file = new File([blob], `brainstorm-${Date.now()}.${ext}`, { type: blob.type || 'audio/webm' });
      const formData = new FormData();
      formData.append('audio', file);
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/meetings/transcribe`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error('Transcription failed');
      const data = await res.json();
      setBrainstorm({
        transcript: data.transcript || '',
        language: data.language || null,
        insights: data.insights || {},
        title: `Brainstorm — ${new Date().toLocaleString()}`,
      });
    } catch (err) {
      console.error('Brainstorm transcription failed:', err);
      setRecError('Could not process the brainstorm.');
    } finally {
      setRecProcessing(false);
    }
  };

  const storeBrainstorm = async () => {
    if (!brainstorm) return;
    setBrainstormStoring(true);
    try {
      const data = await apiRequest('/api/meetings/store', {
        method: 'POST',
        body: JSON.stringify({
          title: brainstorm.title,
          transcript: brainstorm.transcript,
          language: brainstorm.language,
          insights: brainstorm.insights,
          source_type: 'brainstorm',
        }),
      }, token!);
      setBrainstorm(null);
      await loadMeetings();
      if (data?.meeting_id) {
        setTimeout(() => {
          setMeetings(prev => {
            const found = prev.find(m => m.id === data.meeting_id);
            if (found) setSelectedMeeting(found);
            return prev;
          });
        }, 0);
      }
    } catch (err) {
      console.error('Store brainstorm failed:', err);
      setRecError('Could not store the brainstorm.');
    } finally {
      setBrainstormStoring(false);
    }
  };

  const discardBrainstorm = () => setBrainstorm(null);

  const commitToBrain = async (meetingId: string) => {
    setCommitting(true);
    try {
      const data = await apiRequest(`/api/meetings/${meetingId}/commit-to-brain`, { method: 'POST' }, token!);
      setAgentTasks(data.agent_tasks || []);
      // Reflect "in Brain" in the UI.
      setSelectedMeeting(prev => prev && prev.id === meetingId ? { ...prev, vector_indexed: true } : prev);
      setMeetings(prev => prev.map(m => m.id === meetingId ? { ...m, vector_indexed: true } : m));
    } catch (err) {
      console.error('Commit to brain failed', err);
      alert('Could not store this to the Brain. Please try again.');
    } finally {
      setCommitting(false);
    }
  };

  const loadAgentTasks = async (meetingId: string) => {
    try {
      const data = await apiRequest(`/api/meetings/${meetingId}/agent-tasks`, {}, token!);
      setAgentTasks(data.agent_tasks || []);
    } catch { setAgentTasks([]); }
  };

  const deleteMeeting = async (meetingId: string) => {
    if (!window.confirm('Delete this brainstorm session? This cannot be undone.')) return;
    setDeletingMeeting(true);
    try {
      await apiRequest(`/api/meetings/${meetingId}`, { method: 'DELETE' }, token!);
      setMeetings(prev => prev.filter(m => m.id !== meetingId));
      setSelectedMeeting(null);
    } catch (err) {
      console.error('Delete meeting failed', err);
      alert('Could not delete this session. Please try again.');
    } finally {
      setDeletingMeeting(false);
    }
  };

  const sendToAgents = async (meetingId: string) => {
    setSendingToAgents(true);
    setSendResult(null);
    try {
      const data = await apiRequest(`/api/meetings/${meetingId}/send-to-agents`, { method: 'POST' }, token!);
      setSendResult(data.message || `Sent to ${(data.launched || []).length} agent(s).`);
    } catch (err) {
      console.error('Send to agents failed', err);
      setSendResult('Could not send to agents. Please try again.');
    } finally {
      setSendingToAgents(false);
    }
  };

  const fmtTimer = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const loadMeetings = async () => {
    try {
      const data = await apiRequest('/api/meetings', {}, token!);
      const loadedMeetings = data.meetings || [];
      setMeetings(loadedMeetings);

      if (highlightId) {
        const found = loadedMeetings.find((m: Meeting) => m.id === highlightId);
        if (found) {
          setSelectedMeeting(found);
        }
      }
    } catch (err) {
      console.warn('Failed to load meetings:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiRequest('/api/meetings/sync', { method: 'POST' }, token!);
      await loadMeetings();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('audio', uploadFile);
      formData.append('title', uploadFile.name);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/meetings/upload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      setUploadFile(null);
      await loadMeetings();
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  const filteredMeetings = meetings.filter(m =>
    m.title?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'var(--accent-rose)';
      case 'medium': return 'var(--accent-amber)';
      case 'low': return 'var(--accent-emerald)';
      default: return 'var(--text-muted)';
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }`}</style>
      {/* Meeting list */}
      <div style={{
        width: selectedMeeting ? '380px' : '100%',
        borderRight: selectedMeeting ? '1px solid var(--border-subtle)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.25s ease',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: 800 }}>Meetings</h1>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleSync} disabled={syncing || recording} className="btn-ghost" style={{ fontSize: '12px', padding: '6px 12px' }}>
                <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                Sync
              </button>
              {recording ? (
                <button
                  onClick={stopRecording}
                  className="btn-primary"
                  style={{ fontSize: '12px', padding: '6px 12px', background: 'var(--accent-rose)', borderColor: 'var(--accent-rose)' }}
                >
                  <Square size={12} fill="currentColor" /> Stop · {fmtTimer(recordSeconds)}
                </button>
              ) : (
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setRecordMenuOpen(o => !o)}
                    disabled={recProcessing}
                    className="btn-ghost"
                    style={{ fontSize: '12px', padding: '6px 12px' }}
                    title="Record a meeting"
                  >
                    {recProcessing ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />}
                    {recProcessing ? 'Processing…' : 'Record'}
                  </button>
                  {recordMenuOpen && !recProcessing && (
                    <>
                      {/* click-away backdrop */}
                      <div onClick={() => setRecordMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                      <div className="glass-card" style={{
                        position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 41,
                        width: '260px', padding: '6px', display: 'flex', flexDirection: 'column', gap: '2px',
                        boxShadow: '0 8px 28px rgba(0,0,0,0.28)',
                      }}>
                        <button onClick={() => startRecording(false)} style={recordMenuItemStyle}>
                          <Mic size={15} style={{ color: 'var(--accent-cyan)', flexShrink: 0, marginTop: '2px' }} />
                          <span>
                            <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>In-person meeting</span>
                            <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)' }}>Records your microphone only</span>
                          </span>
                        </button>
                        <button onClick={() => startRecording(true)} style={recordMenuItemStyle}>
                          <Users size={15} style={{ color: 'var(--accent-primary)', flexShrink: 0, marginTop: '2px' }} />
                          <span>
                            <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Online meeting</span>
                            <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)' }}>Mic + a shared tab's audio (Zoom/Meet)</span>
                          </span>
                        </button>
                        <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '4px 6px' }} />
                        <button onClick={() => startRecording(false, 'brainstorm')} style={recordMenuItemStyle}>
                          <Lightbulb size={15} style={{ color: 'var(--accent-amber)', flexShrink: 0, marginTop: '2px' }} />
                          <span>
                            <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Brainstorm (private)</span>
                            <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)' }}>Think out loud — nothing is saved until you Store it</span>
                          </span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              <label className="btn-primary" style={{ fontSize: '12px', padding: '6px 12px', cursor: recording ? 'not-allowed' : 'pointer', opacity: recording ? 0.5 : 1 }}>
                <Upload size={12} />
                Upload
                <input
                  type="file"
                  accept="audio/*"
                  disabled={recording}
                  style={{ display: 'none' }}
                  onChange={e => {
                    setUploadFile(e.target.files?.[0] || null);
                  }}
                />
              </label>
            </div>
          </div>

          {/* Recording / processing status */}
          {(recording || recProcessing) && (
            <div className="glass-card" style={{ padding: '10px 14px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              {recording ? (
                <>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-rose)', animation: 'pulse 1.2s ease-in-out infinite', flexShrink: 0 }} />
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>Recording… {fmtTimer(recordSeconds)}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Mic + any shared tab audio</span>
                </>
              ) : (
                <>
                  <Loader2 size={14} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
                  <span style={{ fontSize: '13px' }}>Transcribing & extracting decisions/actions…</span>
                </>
              )}
            </div>
          )}
          {recError && (
            <div style={{ padding: '8px 12px', marginBottom: '12px', fontSize: '12px', color: 'var(--accent-rose)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertCircle size={12} /> {recError}
            </div>
          )}

          {/* Upload preview */}
          {uploadFile && (
            <div className="glass-card" style={{ padding: '12px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <FileAudio size={16} style={{ color: 'var(--accent-cyan)' }} />
              <span style={{ flex: 1, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {uploadFile.name}
              </span>
              <button onClick={handleUpload} disabled={uploading} className="btn-primary" style={{ fontSize: '11px', padding: '4px 10px' }}>
                {uploading ? <Loader2 size={12} className="animate-spin" /> : 'Process'}
              </button>
              <button onClick={() => setUploadFile(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px' }}>
                ×
              </button>
            </div>
          )}

          {/* Search */}
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search meetings..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="input-field"
              style={{ paddingLeft: '36px', fontSize: '13px' }}
            />
          </div>
        </div>

        {/* Meeting agent actions + upcoming meetings */}
        <div style={{ padding: '8px 8px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <AgentQuickActions
            token={token}
            title="Meeting agent"
            actions={[
              { agentType: 'meeting', recipeId: 'meeting_brief', label: 'Upcoming Meeting Brief', description: 'Prepare a briefing/agenda for an upcoming meeting from Brain context.' },
              { agentType: 'meeting', recipeId: 'follow_up_emails', label: 'Follow-up Emails', description: 'Draft post-meeting follow-up emails for stakeholders.' },
            ]}
          />
          {(() => {
            const now = Date.now();
            const upcoming = meetings
              .filter(m => new Date(m.meeting_date).getTime() > now)
              .sort((a, b) => new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime());
            return (
              <div className="glass-card" style={{ padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Calendar size={14} style={{ color: 'var(--accent-cyan)' }} />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>Upcoming meetings</span>
                </div>
                {upcoming.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    No upcoming meetings. Connect / sync your calendar to see what&apos;s ahead.
                  </p>
                ) : (
                  upcoming.slice(0, 5).map(m => (
                    <button
                      key={m.id}
                      onClick={() => setSelectedMeeting(m)}
                      style={{
                        width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
                        cursor: 'pointer', padding: '6px 0', display: 'flex', flexDirection: 'column', gap: 2,
                      }}
                    >
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.title || 'Untitled Meeting'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--accent-cyan)' }}>
                        {new Date(m.meeting_date).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </button>
                  ))
                )}
              </div>
            );
          })()}
        </div>

        {/* Meeting list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent-primary)', margin: '0 auto' }} />
            </div>
          ) : filteredMeetings.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <Calendar size={40} style={{ color: 'var(--text-muted)', margin: '0 auto 16px' }} />
              <p style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px' }}>No meetings found</p>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Sync your Google Meet or upload an audio recording.
              </p>
            </div>
          ) : (
            filteredMeetings.map((meeting) => (
              <button
                key={meeting.id}
                onClick={() => setSelectedMeeting(meeting)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '14px 16px',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: selectedMeeting?.id === meeting.id ? 'rgba(99,102,241,0.1)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '2px',
                }}
                onMouseEnter={e => {
                  if (selectedMeeting?.id !== meeting.id) (e.currentTarget).style.background = 'var(--bg-tertiary)';
                }}
                onMouseLeave={e => {
                  if (selectedMeeting?.id !== meeting.id) (e.currentTarget).style.background = 'transparent';
                }}
              >
                <div style={{
                  width: '36px', height: '36px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(34,211,238,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Calendar size={16} style={{ color: 'var(--accent-cyan)' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>
                    {meeting.title || 'Untitled Meeting'}
                  </p>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {new Date(meeting.meeting_date).toLocaleDateString()} · {meeting.source_type}
                  </p>
                </div>
                {meeting.insights?.action_items && meeting.insights.action_items.length > 0 && (
                  <span className="badge badge-warning" style={{ fontSize: '10px' }}>
                    {meeting.insights.action_items.length}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Meeting detail */}
      {selectedMeeting && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }} className="animate-fade-in">
          <div style={{ maxWidth: '700px' }}>
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span className={`badge badge-info`}>
                  {selectedMeeting.source_type}
                </span>
                {selectedMeeting.source_type === 'brainstorm' && (
                  <button
                    onClick={() => deleteMeeting(selectedMeeting.id)}
                    disabled={deletingMeeting}
                    className="btn-ghost"
                    title="Delete this brainstorm session"
                    style={{ fontSize: '11px', padding: '5px 10px', color: 'var(--accent-rose)' }}
                  >
                    {deletingMeeting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete
                  </button>
                )}
              </div>
              <h2 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '8px', letterSpacing: '-0.02em' }}>
                {selectedMeeting.title}
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: 'var(--text-muted)', fontSize: '13px' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={12} />
                  {new Date(selectedMeeting.meeting_date).toLocaleString()}
                </span>
                {selectedMeeting.duration_minutes && (
                  <span>{selectedMeeting.duration_minutes} min</span>
                )}
                {selectedMeeting.participants?.length > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Users size={12} />
                    {selectedMeeting.participants.length} participants
                  </span>
                )}
                {formatLanguage(selectedMeeting.insights?.language) && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Globe size={12} />
                    {formatLanguage(selectedMeeting.insights?.language)}
                  </span>
                )}
                {selectedMeeting.source_type === 'brainstorm' && (
                  <span className="badge" style={{ fontSize: '10px', background: 'rgba(245,158,11,0.15)', color: 'var(--accent-amber)' }}>
                    {selectedMeeting.vector_indexed ? 'In Brain' : 'Not in Brain'}
                  </span>
                )}
              </div>
            </div>

            {/* ─── Brainstorm → Brain + Send-to-agents actions ─── */}
            {(selectedMeeting.source_type === 'brainstorm' || agentTasks.length > 0) && (
              <div className="glass-card" style={{ padding: '16px 20px', marginBottom: '16px', border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.05)' }}>
                {selectedMeeting.source_type === 'brainstorm' && !selectedMeeting.vector_indexed && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <Lightbulb size={16} style={{ color: 'var(--accent-amber)', flexShrink: 0, marginTop: '2px' }} />
                      <div>
                        <p style={{ fontSize: '13px', fontWeight: 700 }}>This brainstorm isn't in the Brain yet</p>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Add it to index the transcript and register its decisions & tasks, then hand tasks to your agents.</p>
                      </div>
                    </div>
                    <button onClick={() => commitToBrain(selectedMeeting.id)} disabled={committing} className="btn-primary" style={{ fontSize: '12px', padding: '8px 14px', whiteSpace: 'nowrap' }}>
                      {committing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Store in the Brain
                    </button>
                  </div>
                )}

                {agentTasks.length > 0 && (
                  <div style={{ marginTop: (selectedMeeting.source_type === 'brainstorm' && !selectedMeeting.vector_indexed) ? '14px' : 0, paddingTop: (selectedMeeting.source_type === 'brainstorm' && !selectedMeeting.vector_indexed) ? '14px' : 0, borderTop: (selectedMeeting.source_type === 'brainstorm' && !selectedMeeting.vector_indexed) ? '1px solid rgba(245,158,11,0.2)' : 'none' }}>
                    <p style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Sparkles size={13} style={{ color: 'var(--accent-primary)' }} /> {agentTasks.length} task{agentTasks.length > 1 ? 's' : ''} an agent can take on
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                      {agentTasks.slice(0, 10).map((t, i) => (
                        <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                          <span className="badge badge-info" style={{ fontSize: '10px', whiteSpace: 'nowrap', flexShrink: 0 }}>{t.agent_label.replace(' Agent', '')}</span>
                          <span>{t.task}</span>
                        </div>
                      ))}
                    </div>
                    {sendResult ? (
                      <p style={{ fontSize: '12px', color: 'var(--accent-emerald)', display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
                        <CheckCircle2 size={13} /> {sendResult} — track them in the Chat tab.
                      </p>
                    ) : (
                      <button onClick={() => sendToAgents(selectedMeeting.id)} disabled={sendingToAgents} className="btn-primary" style={{ fontSize: '12px', padding: '8px 14px' }}>
                        {sendingToAgents ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />} Send to agents
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Summary */}
            {selectedMeeting.insights?.summary && (
              <div className="glass-card" style={{ padding: '20px', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  📝 Summary
                </h3>
                <p style={{ fontSize: '14px', lineHeight: 1.65, color: 'var(--text-secondary)' }}>
                  {selectedMeeting.insights.summary}
                </p>
              </div>
            )}

            {/* Decisions */}
            {selectedMeeting.insights?.decisions && selectedMeeting.insights.decisions.length > 0 && (
              <div className="glass-card" style={{ padding: '20px', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px' }}>
                  ✅ Decisions ({selectedMeeting.insights.decisions.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {selectedMeeting.insights.decisions.map((d, i) => (
                    <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                      <CheckCircle2 size={14} style={{ color: 'var(--accent-emerald)', marginTop: '3px', flexShrink: 0 }} />
                      <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                        {d.decision}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action items */}
            {selectedMeeting.insights?.action_items && selectedMeeting.insights.action_items.length > 0 && (
              <div className="glass-card" style={{ padding: '20px', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px' }}>
                  🎯 Action Items ({selectedMeeting.insights.action_items.length})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {selectedMeeting.insights.action_items.map((item, i) => (
                    <div key={i} style={{
                      display: 'flex', gap: '10px', alignItems: 'flex-start',
                      padding: '10px',
                      background: 'var(--bg-tertiary)',
                      borderRadius: 'var(--radius-sm)',
                      borderLeft: `3px solid ${getPriorityColor(item.priority || 'medium')}`,
                    }}>
                      <Circle size={14} style={{ color: 'var(--text-muted)', marginTop: '2px', flexShrink: 0 }} />
                      <div>
                        <p style={{ fontSize: '13px', fontWeight: 600 }}>{item.task}</p>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                          <span className="badge badge-info">{item.assignee}</span>
                          {item.deadline && item.deadline !== 'Not specified' && (
                            <span className="badge badge-warning">{item.deadline}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Key topics */}
            {selectedMeeting.insights?.key_topics && selectedMeeting.insights.key_topics.length > 0 && (
              <div className="glass-card" style={{ padding: '20px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px' }}>
                  🏷️ Key Topics
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {selectedMeeting.insights.key_topics.map((topic, i) => (
                    <span key={i} className="badge badge-info">{topic}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Transcript */}
            {(selectedMeeting.insights?.speaker_segments?.length || selectedMeeting.raw_transcript) && (
              <div className="glass-card" style={{ padding: '20px', marginTop: '16px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={14} /> Transcript
                </h3>
                <div style={{ maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
                  {selectedMeeting.insights?.speaker_segments && selectedMeeting.insights.speaker_segments.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {selectedMeeting.insights.speaker_segments.map((seg, i) => (
                        <div key={i}>
                          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-cyan)' }}>{seg.speaker || 'Speaker'}</span>
                          <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)', margin: '2px 0 0' }}>{seg.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: '13px', lineHeight: 1.7, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                      {selectedMeeting.raw_transcript}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Brainstorm review modal (ephemeral — nothing saved until "Store") ─── */}
      {brainstorm && (
        <div onClick={discardBrainstorm} style={{
          position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
        }}>
          <div onClick={e => e.stopPropagation()} className="glass-card" style={{
            width: 'min(720px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Lightbulb size={18} style={{ color: 'var(--accent-amber)' }} />
                <div>
                  <h2 style={{ fontSize: '16px', fontWeight: 700 }}>Brainstorm</h2>
                  <span style={{ fontSize: '11px', color: 'var(--accent-amber)', fontWeight: 600 }}>● Review, then save to Meetings (you can add it to the Brain later)</span>
                </div>
              </div>
              <button onClick={discardBrainstorm} className="btn-ghost" style={{ padding: '6px' }}><X size={16} /></button>
            </div>

            {/* Body */}
            <div style={{ padding: '18px 22px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {brainstorm.insights?.summary && (
                <div>
                  <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}><Sparkles size={13} /> Key ideas</h3>
                  <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)', margin: 0 }}>{brainstorm.insights.summary}</p>
                </div>
              )}
              {Array.isArray(brainstorm.insights?.decisions) && brainstorm.insights.decisions.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>✅ Decisions / conclusions</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {brainstorm.insights.decisions.map((d: any, i: number) => (
                      <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        <CheckCircle2 size={14} style={{ color: 'var(--accent-emerald)', flexShrink: 0, marginTop: '2px' }} />
                        <span>{d.decision || d.text || String(d)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {Array.isArray(brainstorm.insights?.action_items) && brainstorm.insights.action_items.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px' }}>🎯 Action items</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {brainstorm.insights.action_items.map((a: any, i: number) => (
                      <div key={i} style={{ display: 'flex', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                        <Circle size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: '2px' }} />
                        <span>{a.task || String(a)}{a.assignee && a.assignee !== 'Unassigned' ? ` — ${a.assignee}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {Array.isArray(brainstorm.insights?.key_topics) && brainstorm.insights.key_topics.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {brainstorm.insights.key_topics.map((t: string, i: number) => <span key={i} className="badge badge-info">{t}</span>)}
                </div>
              )}

              <div>
                <h3 style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FileText size={13} /> Transcript
                  {formatLanguage(brainstorm.language || brainstorm.insights?.language) && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                      <Globe size={11} /> {formatLanguage(brainstorm.language || brainstorm.insights?.language)}
                    </span>
                  )}
                </h3>
                <div style={{ maxHeight: '220px', overflowY: 'auto', fontSize: '12.5px', lineHeight: 1.6, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', padding: '12px' }}>
                  {brainstorm.transcript || 'No speech detected.'}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={discardBrainstorm} disabled={brainstormStoring} className="btn-ghost" style={{ fontSize: '13px', padding: '9px 16px', color: 'var(--accent-rose)' }}>
                <Trash2 size={14} /> Discard
              </button>
              <button onClick={storeBrainstorm} disabled={brainstormStoring} className="btn-primary" style={{ fontSize: '13px', padding: '9px 18px' }}>
                {brainstormStoring ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {brainstormStoring ? 'Saving…' : 'Save brainstorm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
