'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../layout';
import { apiRequest } from '@/lib/api';
import {
  Send, Brain, User, Loader2, Sparkles, FileText,
  Calendar, Hash, Copy, Check, Plus, MessageSquare, Lightbulb,
  ChevronDown, Mail, Globe, ExternalLink,
  Activity, CheckCircle2, XCircle,
  AlertCircle, Clock, ChevronLeft, X, RefreshCw,
  Bot, Zap, ZapOff, ThumbsUp, ThumbsDown, FileDown, Square, Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import SourceViewer from '@/components/SourceViewer';
import ExportDialog from '@/components/ExportDialog';

// ─── 11 AGENT DEFINITIONS (fallback when backend is unavailable) ───
const FALLBACK_AGENTS = [
  { id: 'finance',      name: 'Finance Agent',      emoji: '💰', color: '#10b981', role: 'Finance',     description: 'Financial analysis, MRR, expenses, runway, cap table' },
  { id: 'people',       name: 'People Agent',       emoji: '👥', color: '#8b5cf6', role: 'HR',          description: 'Hiring, onboarding, culture, performance reviews' },
  { id: 'hr',           name: 'HR Agent',           emoji: '📋', color: '#f43f5e', role: 'HR',          description: 'HR policies, compliance, benefits, payroll' },
  { id: 'investment',   name: 'Investment Agent',   emoji: '📈', color: '#f59e0b', role: 'Strategy',    description: 'VC pipeline, fundraising, investor research' },
  { id: 'crm',          name: 'CRM Agent',          emoji: '🤝', color: '#3b82f6', role: 'Commercial',  description: 'Relationships, clients, partners, deal tracking' },
  { id: 'marketing',    name: 'Marketing Agent',    emoji: '📢', color: '#ec4899', role: 'Marketing',   description: 'Campaigns, content, SEO, brand strategy' },
  { id: 'sales',        name: 'Sales Agent',        emoji: '💼', color: '#06b6d4', role: 'Commercial',  description: 'Pipeline, leads, outreach, revenue growth' },
  { id: 'product',      name: 'Product Agent',      emoji: '🎯', color: '#14b8a6', role: 'Product',     description: 'Sprints, requirements, backlog, PRDs' },
  { id: 'roadmap',      name: 'Roadmap Agent',      emoji: '🗺️', color: '#a855f7', role: 'Product',     description: 'Vision, milestones, strategy, market trends' },
  { id: 'meeting',      name: 'Meeting Agent',      emoji: '📅', color: '#6366f1', role: 'Operations',  description: 'Agendas, decisions, action items, scheduling' },
  { id: 'engineering',  name: 'Engineering Agent',  emoji: '🖥️', color: '#0ea5e9', role: 'Product',     description: 'Tech debt, architecture, build vs buy, feasibility' },
];

const AGENT_SYSTEM_PROMPTS: Record<string, string> = {
  finance: 'You are the Finance Agent — a proactive financial analyst. Analyze financial health, monitor MRR, review expenses, track cash flow, predict runway, manage cap table, and model dilution. Use web research tools to gather real-time financial data. When you need clarification, ask the user specific questions first. Format your answers with clear numbers and trends.',
  people: 'You are the People Agent — a talent catalyst. Manage hiring pipelines, onboarding, culture, performance reviews, and team engagement. Use web research to find market salary data and benchmark benefits. When you need clarification, ask the user specific questions first.',
  hr: 'You are the HR Agent — an HR operations and compliance specialist. Manage HR policies, employee records, benefits administration, payroll compliance, and labor law adherence. Use web research to find compliance requirements. When you need clarification, ask the user specific questions first.',
  investment: 'You are the Investment Agent — a fundraising intelligence officer. Manage the VC pipeline, track investor sentiment, prepare fundraising outreach, evaluate company readiness, and find matching investors. Use web research tools to research VCs. When you need clarification, ask the user specific questions first.',
  crm: 'You are the CRM Agent — a relationship intelligence engine. Manage all business relationships — clients, vendors, partners, and investors. Proactively research contacts using web tools. Track interaction history, deal status, and relationship health. When you need clarification, ask the user specific questions first.',
  marketing: 'You are the Marketing Agent — a data-driven strategist. Draft campaign copy, analyze market trends, plan content strategy, execute SEO, and monitor brand presence. Research the web before making recommendations. When you need clarification, ask the user specific questions first.',
  sales: 'You are the Sales Agent — an aggressive revenue driver. Own the full revenue pipeline from lead generation to deal closure. Use web research to find leads, research prospects, and gather competitive intel. When you need clarification, ask the user specific questions first.',
  product: 'You are the Product Management Agent — a product visionary with execution focus. Plan sprints, define requirements, manage the backlog, draft PRDs, and coordinate the team. Research market and competition on the web. When you need clarification, ask the user specific questions first.',
  roadmap: 'You are the Roadmap Agent — a strategic foresight engine. Maintain the long-term vision, plan milestones, track strategic goals, and align product direction. Research market trends and competitive moves. When you need clarification, ask the user specific questions first.',
  meeting: 'You are the Meeting Agent — a productivity multiplier. Manage the full meeting lifecycle — preparing agendas, extracting decisions and action items, sending follow-ups, and scheduling. When you need clarification, ask the user specific questions first.',
  engineering: 'You are the Engineering Agent — a pragmatic, opinionated CTO. Map technical debt, review architecture, run build-vs-buy analyses, and assess feature feasibility against the team\'s actual capacity. Take clear positions and justify them with engineering tradeoffs. Research vendors and tools on the web before recommending. When you need clarification, ask the user specific questions first.',
};

interface AgentState {
  status: 'active' | 'running' | 'awaiting_input' | 'awaiting_approval' | 'completed' | 'idle' | 'error' | 'failed' | 'stopped';
  run_id?: string;
  current_action: string;
  progress_pct: number;
  output_summary: string | null;
  error_message: string | null;
  last_completed: string | null;
  conversation_history: Array<{ role: string; content: string; timestamp: string }>;
  current_question: string | null;
  current_question_choices: string[] | null;
  output_data?: any;
  agent_outputs?: Array<{
    id: string;
    agent_execution_id: string;
    company_id: string;
    output_type: string;
    title: string;
    summary: string;
    content: any;
    status: 'pending_approval' | 'approved' | 'rejected';
    feedback?: string;
  }>;
}

interface PendingQuestion {
  question: string;
  choices: string[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{ id?: string; title: string; source_type: string; meeting_date?: string; excerpt?: string; score?: number }>;
  timestamp?: Date;
  loading?: boolean;
  agentId?: string;
  agentName?: string;
  questionData?: PendingQuestion;
}

interface Session {
  id: string;
  title: string;
  created_at: string;
}

// ─── NETWORK LAYOUT CONSTANTS ───
const NETWORK_CENTER_X = 200;
const NETWORK_CENTER_Y = 200;
const NETWORK_RADIUS = 145;
const BRAIN_SIZE = 80;

export default function ChatPage() {
  const { user, token } = useAuth();
  const router = useRouter();
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [isSourceOpen, setIsSourceOpen] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<Record<string, 'up' | 'down'>>({}); // v3 §7.3 feedback tracking
  const [showCorrectionInput, setShowCorrectionInput] = useState<Record<string, boolean>>({});
  const [correctionTexts, setCorrectionTexts] = useState<Record<string, string>>({});

  // Export state
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportTitle, setExportTitle] = useState('');
  const [exportContent, setExportContent] = useState('');

  // Sessions
  const [rejectFeedback, setRejectFeedback] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [isOutputExpanded, setIsOutputExpanded] = useState(false);
  // Review comments (Phase A3/A4): threaded + section-level
  const [outputComments, setOutputComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentSection, setCommentSection] = useState<string | null>(null);
  const [commentLoading, setCommentLoading] = useState(false);
  // Agent workspace (Phase W)
  const [workspaceTab, setWorkspaceTab] = useState<string>('chat'); // 'chat' | recipeId | 'deliverables'
  const [planMode, setPlanMode] = useState(true); // Plan (true) vs Execute (false)
  const [recipes, setRecipes] = useState<Record<string, any[]>>({});
  const [recipeLaunching, setRecipeLaunching] = useState<string | null>(null);
  const [allRuns, setAllRuns] = useState<any[]>([]);
  const [fullPreviewHtml, setFullPreviewHtml] = useState<string | null>(null); // web_artifact full-screen preview
  const [isLogsExpanded, setIsLogsExpanded] = useState(false);
  const [approvalLoading, setApprovalLoading] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  // Markdown converter helper for exporting agent structured data
  const convertOutputToMarkdown = useCallback((title: string, summary: string, type: string, data: any): string => {
    if (!data) return '';
    let markdown = `# ${title || 'Deliverable'}\n\n`;
    if (summary) {
      markdown += `> ${summary}\n\n`;
    }
    
    const formatValue = (val: any, indent = 0): string => {
      const spacing = ' '.repeat(indent);
      if (val === null || val === undefined) return '';
      if (Array.isArray(val)) {
        return val.map(item => {
          if (typeof item === 'object') {
            return `\n${spacing}- ${formatValue(item, indent + 2)}`;
          }
          return `\n${spacing}- ${item}`;
        }).join('');
      }
      if (typeof val === 'object') {
        let result = '';
        for (const [k, v] of Object.entries(val)) {
          const cleanKey = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          if (typeof v === 'object') {
            result += `\n${spacing}**${cleanKey}**:${formatValue(v, indent + 2)}`;
          } else {
            result += `\n${spacing}**${cleanKey}**: ${v}`;
          }
        }
        return result;
      }
      return String(val);
    };

    if (Array.isArray(data)) {
      markdown += data.map((item, idx) => {
        let itemStr = `## Item ${idx + 1}\n`;
        if (item && typeof item === 'object') {
          if (item.name || item.company || item.title) {
            itemStr = `## ${item.name || item.company || item.title}\n`;
          }
          for (const [k, v] of Object.entries(item)) {
            if (['name', 'company', 'title'].includes(k.toLowerCase())) continue;
            const cleanKey = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            if (typeof v === 'object') {
              itemStr += `**${cleanKey}**:\n${formatValue(v, 2)}\n\n`;
            } else {
              itemStr += `**${cleanKey}**: ${v}\n\n`;
            }
          }
        } else {
          itemStr += `${item}\n\n`;
        }
        return itemStr;
      }).join('\n');
    } else if (typeof data === 'object') {
      if (data.findings && typeof data.findings === 'string') {
        markdown += `${data.findings}\n\n`;
      }
      if (data.content && typeof data.content === 'string') {
        markdown += `${data.content}\n\n`;
      }
      
      for (const [key, value] of Object.entries(data)) {
        if (key === 'findings' || key === 'content' || key === 'logs' || key === 'researchNotes') continue;
        const cleanKey = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        markdown += `## ${cleanKey}\n`;
        if (typeof value === 'object') {
          markdown += `${formatValue(value)}\n\n`;
        } else {
          markdown += `${value}\n\n`;
        }
      }
    } else {
      markdown += String(data);
    }

    return markdown;
  }, []);

  // Selection: 'brain' | agent id | null
  const [selectedTarget, setSelectedTarget] = useState<string | null>('brain');

  // Agent states (from backend) + fallback idle states
  const [agentStates, setAgentStates] = useState<Record<string, AgentState>>({});
  const [agentAnswer, setAgentAnswer] = useState('');
  const [agentAnswerLoading, setAgentAnswerLoading] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [qMultiSelect, setQMultiSelect] = useState<string[]>([]); // multi-select answers to an agent question
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [inlineSelected, setInlineSelected] = useState<string[]>([]); // multi-select for inline chat questions
  const [questionAnswer, setQuestionAnswer] = useState('');
  const [questionAnswerLoading, setQuestionAnswerLoading] = useState(false);
  const [agentWizardIndex, setAgentWizardIndex] = useState(0);
  const [agentSelectedChoices, setAgentSelectedChoices] = useState<string[][]>([[], [], []]);
  const [agentOtherInputs, setAgentOtherInputs] = useState<string[]>(['', '', '']);
  const agentStatesRef = useRef<Record<string, AgentState>>({});
  const agentsRef = useRef(FALLBACK_AGENTS);

  // Network hover & animation
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [animPhase, setAnimPhase] = useState(0); // For animated pulses
  const [backendError, setBackendError] = useState(false);

  // Starters
  const [starters, setStarters] = useState<string[]>([]);
  const [startersLoading, setStartersLoading] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastHistoryLengthRef = useRef<Record<string, number>>({});
  const selectedTargetRef = useRef<string | null>(null);

  // AGENTS array - ALWAYS uses FALLBACK_AGENTS IDs (finance, people, hr, etc.)
  // Backend only updates metadata like names/colors/system_prompts but NOT IDs
  const [agents, setAgents] = useState(FALLBACK_AGENTS);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(() => { scrollToBottom(); }, [messages]);

  // Animation cycle
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimPhase(p => (p + 1) % 100);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  // Initial load
  useEffect(() => {
    if (token) {
      loadAgents();
      loadSessions();
      loadAgentStates();
      loadStarters();
    }
  }, [token]);

  // Load starters on target change
  useEffect(() => {
    if (token && selectedTarget === 'brain') {
      loadStarters();
    }
  }, [token, selectedTarget]);

  // Load history on session change
  useEffect(() => {
    if (token && activeSessionId) {
      loadSessionHistory(activeSessionId);
    }
  }, [activeSessionId]);

  // (D0) The per-agent workspace was removed — chat is Brain-only. The agent-state
  // polling and capability-recipe catalog (Phase W) are no longer used here; agent
  // interaction now lives on the department dashboard pages.

  // Load review comments for the selected agent's pending deliverable (Phase A3/A4).
  const lastCommentOutputId = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedTarget || selectedTarget === 'brain') return;
    const st = agentStates[selectedTarget];
    const po = st?.status === 'awaiting_approval'
      ? st?.agent_outputs?.find((o: any) => o.status === 'pending_approval')
      : null;
    const id = po?.id || null;
    if (id !== lastCommentOutputId.current) {
      lastCommentOutputId.current = id;
      setShowRejectInput(false); setRejectFeedback('');
      if (id) loadOutputComments(id); else setOutputComments([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTarget, agentStates]);

  // Sync new conversation history from polling into messages for selected agent
  useEffect(() => {
    if (!selectedTarget || selectedTarget === 'brain') return;
    const state = agentStates[selectedTarget];
    const agent = agents.find(a => a.id === selectedTarget);
    if (!state || !agent) return;

    const newHistoryLength = state.conversation_history?.length || 0;
    const prevLength = lastHistoryLengthRef.current[selectedTarget] || 0;
    const hasNewOutputSummary = state.output_summary && !messages.some(m => m.role === 'assistant' && m.id?.startsWith('agent-completed-'));

    if (newHistoryLength > prevLength || hasNewOutputSummary) {
      const updatedMsgs: Message[] = [];

      // Rebuild completed work message
      if (state.output_summary) {
        updatedMsgs.push({
          id: `agent-completed-${selectedTarget}`,
          role: 'assistant',
          content: `✅ **Completed Work**\n\n${state.output_summary}`,
          timestamp: state.last_completed ? new Date(state.last_completed) : new Date(),
          agentId: selectedTarget,
          agentName: agent.name,
        });
      }

      // Rebuild conversation history
      if (state.conversation_history?.length) {
        state.conversation_history.forEach((entry: any, i: number) => {
          updatedMsgs.push({
            id: `agent-hist-${selectedTarget}-${i}`,
            role: entry.role === 'user' ? 'user' : 'assistant',
            content: entry.content,
            timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
            ...(entry.role === 'assistant' ? { agentId: selectedTarget, agentName: agent.name } : {}),
          });
        });
      }

      // Preserve any new user/agent messages (from active chat) that aren't history
      const activeMessages = messages.filter(
        m => !m.id?.startsWith('agent-hist-') && !m.id?.startsWith('agent-completed-')
      );

      setMessages([...updatedMsgs, ...activeMessages]);
      lastHistoryLengthRef.current[selectedTarget] = newHistoryLength;
    }
  }, [agentStates, selectedTarget]);

  // ─── DATA LOADING ───

  const loadAgents = async () => {
    try {
      const data = await apiRequest('/api/orchestrator/agents', {}, token!);
      if (data.agents && data.agents.length >= 10) {
        // Build a lookup map by backend agent name (e.g. "Finance Agent" -> backendAgent)
        const backendByName: Record<string, any> = {};
        for (const a of data.agents) {
          backendByName[a.name] = a;
        }

        // Only update metadata — NEVER replace IDs. FALLBACK_AGENTS IDs are canonical.
        const updated = FALLBACK_AGENTS.map((fallback) => {
          const backendAgent = backendByName[fallback.name] || {};
          return {
            id: fallback.id, // ALWAYS keep fallback ID
            name: fallback.name, // Keep canonical name
            emoji: backendAgent.icon || fallback.emoji,
            color: backendAgent.color || fallback.color,
            role: backendAgent.role || fallback.role,
            description: fallback.description,
            system_prompt: backendAgent.system_prompt || '',
          };
        });
        setAgents(updated);
        agentsRef.current = updated;
        setBackendError(false);
        return;
      }
    } catch {
      // Backend unavailable — use fallback as-is
    }
    setBackendError(true);
    agentsRef.current = FALLBACK_AGENTS;
  };

  const loadSessions = async (agentName?: string) => {
    setSessionsLoading(true);
    try {
      if (agentName && agentName !== 'brain') {
        // Load agent-specific sessions from the per-agent history endpoint
        const agent = agentsRef.current.find(a => a.id === agentName);
        if (agent) {
          const data = await apiRequest(`/api/orchestrator/agent-chat/history/${encodeURIComponent(agent.name)}`, {}, token!);
          setSessions((data.sessions || []).map((s: any) => ({
            ...s,
            title: s.title?.replace(`Agent: ${agent.name} - `, '').replace(/^Agent:.*? - /, '') || 'Chat',
          })));
        }
      } else {
        // Load Brain-only sessions (exclude agent sessions)
        const data = await apiRequest('/api/brain/chat/sessions', {}, token!);
        const brainSessions = (data.sessions || []).filter(
          (s: any) => !s.title?.startsWith('Agent: ')
        );
        setSessions(brainSessions);
      }
    } catch { setSessions([]); } finally { setSessionsLoading(false); }
  };

  const loadStarters = async () => {
    setStartersLoading(true);
    try {
      const data = await apiRequest('/api/brain/chat/starters', {}, token!);
      setStarters(data.starters || []);
    } catch {
      setStarters([
        'What did we decide recently?',
        'List my open action items',
        'Summarize last meeting',
        'What are my priorities?',
      ]);
    } finally { setStartersLoading(false); }
  };

  const loadAgentStates = async () => {
    // Always use FALLBACK_AGENTS as the canonical list of agent IDs
    const canonicalAgents = FALLBACK_AGENTS;
    const states: Record<string, AgentState> = {};

    // Initialize all agents as idle
    for (const agent of canonicalAgents) {
      states[agent.id] = {
        status: 'idle', current_action: '', progress_pct: 0,
        output_summary: null, error_message: null, last_completed: null,
        conversation_history: [], current_question: null, current_question_choices: null,
      };
    }

    try {
      const data = await apiRequest('/api/agents/runs', {}, token!);
      const executions = data.executions || [];
      setAllRuns(executions); // keep the full run list for the workspace tabs (Phase W)

      for (const exec of executions) {
        const agentId = findAgentIdForType(exec.agent_type);
        if (agentId && states[agentId]) {
          // A plan awaiting approval reuses the same review UI as a deliverable
          // awaiting approval; the output_type ('plan') distinguishes the content.
          const normStatus = exec.status === 'awaiting_plan_approval' ? 'awaiting_approval' : (exec.status || 'idle');
          states[agentId] = {
            status: normStatus,
            run_id: exec.id,
            current_action: exec.current_action || '',
            progress_pct: exec.progress_pct || 0,
            output_summary: exec.output_summary || null,
            error_message: exec.error_message || null,
            last_completed: exec.completed_at || null,
            conversation_history: exec.conversation_history || [],
            current_question: exec.current_question || null,
            current_question_choices: exec.current_question_choices || null,
            output_data: exec.output_data || null,
            agent_outputs: exec.agent_outputs || null,
          };
        }
      }
    } catch {
      // Backend not available — agents stay idle
    }

    setAgentStates(states);
    agentStatesRef.current = states;
  };

  const findAgentIdForType = (type: string): string | null => {
    // 1:1 mapping — backend now uses the same 11 agent type IDs
    const validTypes = ['finance', 'people', 'hr', 'investment', 'crm', 'marketing', 'sales', 'product', 'roadmap', 'meeting', 'engineering'];
    return validTypes.includes(type) ? type : null;
  };

  const loadSessionHistory = async (sessionId: string) => {
    try {
      const data = await apiRequest(`/api/brain/chat/sessions/${sessionId}/history`, {}, token!);
      if (data.messages) {
        const selectedAgent = selectedTarget && selectedTarget !== 'brain'
          ? agents.find(a => a.id === selectedTarget)
          : null;
        const restored: Message[] = data.messages
          .filter((msg: any) => msg.role !== 'system') // Never show system prompts
          .map((msg: any) => {
            const agent = msg.agent_name
              ? agents.find(a => a.name === msg.agent_name)
              : selectedAgent;
            return {
              id: msg.id,
              role: msg.role as 'user' | 'assistant',
              content: msg.content,
              sources: msg.sources || [],
              timestamp: new Date(msg.created_at),
              ...(msg.choices && Array.isArray(msg.choices) && msg.choices.length > 0 ? {
                questionData: { question: msg.content, choices: msg.choices }
              } : {}),
              ...(agent && msg.role === 'assistant' ? { agentId: agent.id, agentName: agent.name } : {}),
            };
          });
        setMessages(restored);

        // Restore pending question if the last message is a question
        const lastMsg = restored[restored.length - 1];
        if (lastMsg && lastMsg.role === 'assistant' && lastMsg.questionData) {
          setPendingQuestion({
            question: lastMsg.questionData.question,
            choices: lastMsg.questionData.choices
          });
        } else {
          setPendingQuestion(null);
        }
      }
    } catch { /* ignore */ }
  };

  // ─── NAVIGATION ───

  const handleNewChat = () => {
    setActiveSessionId(null);
    setMessages([]);
    setInput('');
    if (!selectedTarget) {
      setSelectedTarget('brain');
    }
  };

  const handleDeleteChat = async (sessionId: string) => {
    if (!confirm('Delete this chat? Its conversation and any pending (unapproved) drafts it created will be removed. Already-approved documents stay in your Brain.')) return;
    try {
      await apiRequest(`/api/brain/chat/sessions/${sessionId}`, { method: 'DELETE' }, token!);
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setMessages([]);
      }
      setSessions(prev => prev.filter(s => s.id !== sessionId));
    } catch (err: any) {
      alert(`Failed to delete chat: ${err.message || err}`);
    }
  };

  const handleRunRecipe = async (agentType: string, recipeId: string) => {
    setRecipeLaunching(recipeId);
    try {
      await apiRequest('/api/agents/launch-recipe', {
        method: 'POST',
        body: JSON.stringify({ agentType, recipeId, requirePlan: planMode }),
      }, token!);
      setTimeout(loadAgentStates, 1200);
    } catch (err: any) {
      alert(`Failed to start: ${err.message || err}`);
    } finally {
      setTimeout(() => setRecipeLaunching(null), 1200);
    }
  };

  const handleSelectTarget = async (target: string | null) => {
    if (target === selectedTarget) return;
    setSelectedTarget(target);
    setWorkspaceTab('chat');
    setMessages([]);
    setInput('');
    setActiveSessionId(null);

    // Reset agent wizard states
    setAgentWizardIndex(0);
    setAgentSelectedChoices([[], [], []]);
    setAgentOtherInputs(['', '', '']);

    // Always track the current target in ref (for race condition guard)
    selectedTargetRef.current = target;

    // Load appropriate sessions for this target
    loadSessions(target || 'brain');

    // Load agent conversation history from API on-demand
    if (target && target !== 'brain') {
      lastHistoryLengthRef.current = {};
      const loadingTarget = target;
      const agent = agentsRef.current.find(a => a.id === loadingTarget);
      if (!agent) return;

      // Show loading state
      setMessages([{
        id: `agent-loading-${loadingTarget}`,
        role: 'assistant',
        content: '',
        loading: true,
        agentId: loadingTarget,
        agentName: agent.name,
      }]);

      try {
        // Fetch latest execution data from the API
        const data = await apiRequest('/api/agents/runs', {}, token!);
        const executions = data.executions || [];
        const matchingExec = executions.find((e: any) =>
          findAgentIdForType(e.agent_type) === loadingTarget
        );

        const state = matchingExec ? {
          status: matchingExec.status,
          output_summary: matchingExec.output_summary,
          last_completed: matchingExec.completed_at,
          conversation_history: matchingExec.conversation_history || [],
        } : agentStatesRef.current[loadingTarget] || {};

        // Build history messages from fresh API data
        const historyMessages: Message[] = [];

        if (state.output_summary) {
          historyMessages.push({
            id: `agent-completed-${loadingTarget}`,
            role: 'assistant',
            content: `✅ **Completed Work**\n\n${state.output_summary}`,
            timestamp: state.last_completed ? new Date(state.last_completed) : new Date(),
            agentId: loadingTarget,
            agentName: agent.name,
          });
        }

        if (state.conversation_history && state.conversation_history.length > 0) {
          state.conversation_history.forEach((entry: any, i: number) => {
            historyMessages.push({
              id: `agent-hist-${loadingTarget}-${i}`,
              role: entry.role === 'user' ? 'user' : 'assistant',
              content: entry.content,
              timestamp: entry.timestamp ? new Date(entry.timestamp) : new Date(),
              ...(entry.role === 'assistant' ? { agentId: loadingTarget, agentName: agent.name } : {}),
            });
          });
        }

        setMessages(historyMessages);
        lastHistoryLengthRef.current[loadingTarget] = state.conversation_history?.length || 0;
      } catch {
        // Fallback: use refs
        const state = agentStatesRef.current[loadingTarget];
        const historyMessages: Message[] = [];

        if (state?.output_summary) {
          historyMessages.push({
            id: `agent-completed-${loadingTarget}`,
            role: 'assistant',
            content: `✅ **Completed Work**\n\n${state.output_summary}`,
            timestamp: new Date(),
            agentId: loadingTarget,
            agentName: agent.name,
          });
        }

        if (state?.conversation_history) {
          state.conversation_history.forEach((entry: any, i: number) => {
            historyMessages.push({
              id: `agent-hist-${loadingTarget}-${i}`,
              role: entry.role === 'user' ? 'user' : 'assistant',
              content: entry.content,
              timestamp: new Date(),
              ...(entry.role === 'assistant' ? { agentId: loadingTarget, agentName: agent.name } : {}),
            });
          });
        }

        setMessages(historyMessages);
      }
    }
  };

  // ─── SEND MESSAGE TO BRAIN ───

  const handleSend = async (text?: string) => {
    const message = text || input.trim();
    if (!message || loading || selectedTarget !== 'brain') return;

    const userMsg: Message = { id: `user-${Date.now()}`, role: 'user', content: message, timestamp: new Date() };
    const assistantMsg: Message = { id: `brain-${Date.now()}`, role: 'assistant', content: '', timestamp: new Date(), loading: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await apiRequest('/api/orchestrator/chat', {
        method: 'POST',
        body: JSON.stringify({ message, sessionId: activeSessionId }),
      }, token!);

      if (!activeSessionId && res.sessionId) {
        setActiveSessionId(res.sessionId);
        loadSessions();
      }

      let cleanReply = (res.reply || '').replace(/\*\*Tool Call:.*?\*\*\s*```[\s\S]*?```/gi, '')
        .replace(/```json\s*\{[\s\S]*?\}\s*```/gi, '')
        .replace(/\*\*Please wait while I (?:retrieve|fetch|call|access).*?\*\*/gi, '')
        .replace(/\n{3,}/g, '\n\n').trim();

      if (!cleanReply) cleanReply = "I searched your company data but couldn't find relevant information.";

      setMessages(prev => prev.map(msg =>
        msg.id === assistantMsg.id
          ? { ...msg, content: cleanReply, sources: res.sources || [], loading: false }
          : msg));
    } catch (error: any) {
      setMessages(prev => prev.map(msg =>
        msg.id === assistantMsg.id
          ? { ...msg, content: `Sorry, I encountered an error: ${error.message}. Make sure the backend is running.`, loading: false }
          : msg));
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  // ─── SEND MESSAGE TO AGENT ───

  const handleAgentSend = async (text?: string) => {
    const message = text || input.trim();
    if (!message || loading || !selectedTarget || selectedTarget === 'brain') return;

    const agent = agents.find(a => a.id === selectedTarget || a.name === selectedTarget);
    if (!agent) return;

    // Route message to active run if agent is awaiting input, awaiting approval, or completed
    const state = agentStates[selectedTarget];
    if (state && (state.status === 'awaiting_input' || state.status === 'awaiting_approval' || state.status === 'completed')) {
      setInput('');
      await handleRespondToAgentQuestion(message);
      return;
    }

    // Find the matching agent for name display
    const matchingAgent = agents.find(a => a.id === selectedTarget);
    const agentName = matchingAgent?.name || agent.name || selectedTarget;
    const agentSystemPrompt = AGENT_SYSTEM_PROMPTS[selectedTarget] ||
      (matchingAgent as any)?.system_prompt || '';

    const userMsg: Message = {
      id: `agent-user-${Date.now()}`, role: 'user', content: message,
      timestamp: new Date(), agentId: selectedTarget, agentName,
    };
    const assistantMsg: Message = {
      id: `agent-resp-${Date.now()}`, role: 'assistant', content: '',
      timestamp: new Date(), loading: true, agentId: selectedTarget, agentName,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setLoading(true);

    try {
      // Try the dedicated agent-chat endpoint first
      const res = await apiRequest('/api/orchestrator/agent-chat', {
        method: 'POST',
        body: JSON.stringify({
          message,
          sessionId: activeSessionId,
          agentName: agentName,
          agentSystemPrompt,
        }),
      }, token!);

      // ─── Capture session ID if the backend created one ───
      if (!activeSessionId && res.sessionId) {
        setActiveSessionId(res.sessionId);
        loadSessions(selectedTarget || undefined);
      }

      // ─── Handle question response (interactive choices) ───
      if (res.type === 'question') {
        // Remove the loading message, replace with question card
        setMessages(prev => prev.filter(m => m.id !== assistantMsg.id));

        const questionMsg: Message = {
          id: `agent-question-${Date.now()}`,
          role: 'assistant',
          content: res.question,
          questionData: { question: res.question, choices: res.choices || [] },
          timestamp: new Date(),
          agentId: selectedTarget,
          agentName,
        };
        setMessages(prev => [...prev, questionMsg]);
        setPendingQuestion({ question: res.question, choices: res.choices || [] });
        setLoading(false);
        return;
      }

      let cleanReply = (res.reply || '').replace(/\*\*Tool Call:.*?\*\*\s*```[\s\S]*?```/gi, '')
        .replace(/```json\s*\{[\s\S]*?\}\s*```/gi, '')
        .replace(/\*\*Please wait while I (?:retrieve|fetch|call|access).*?\*\*/gi, '')
        .replace(/\n{3,}/g, '\n\n').trim();

      if (!cleanReply) {
        cleanReply = `I'm ${agentName}. I analyzed your request. Could you provide more details?`;
      }

      setMessages(prev => prev.map(msg =>
        msg.id === assistantMsg.id ? { ...msg, content: cleanReply, loading: false } : msg));
    } catch (error: any) {
      // Fallback: use the general chat with agent prefix
      try {
        const fallbackRes = await apiRequest('/api/orchestrator/chat', {
          method: 'POST',
          body: JSON.stringify({
            message: `[You are now acting as ${agentName}. ${agentSystemPrompt ? 'System prompt: ' + agentSystemPrompt.substring(0, 300) : ''}]\n\nUser request: ${message}`,
            sessionId: activeSessionId,
          }),
        }, token!);

        let cleanReply = (fallbackRes.reply || '').replace(/\*\*Tool Call:.*?\*\*\s*```[\s\S]*?```/gi, '')
          .replace(/```json\s*\{[\s\S]*?\}\s*```/gi, '')
          .replace(/\n{3,}/g, '\n\n').trim();

        setMessages(prev => prev.map(msg =>
          msg.id === assistantMsg.id ? { ...msg, content: cleanReply || `I'm ${agentName}. How can I help?`, loading: false } : msg));
      } catch {
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMsg.id
            ? { ...msg, content: `**${agentName}** is ready. Tell me what you need related to ${agent.description || 'my domain'}.`, loading: false }
            : msg));
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── APPROVAL WORKFLOW HANDLERS ───

  const handleApproveOutput = async (outputId: string) => {
    setApprovalLoading(true);
    try {
      await apiRequest(`/api/approvals/${outputId}/approve`, {
        method: 'POST',
      }, token!);
      await loadAgentStates();
      setIsOutputExpanded(false);
      
      const agentName = selectedAgent ? selectedAgent.name : 'Agent';
      setMessages(prev => [
        ...prev,
        {
          id: `approve-success-${Date.now()}`,
          role: 'assistant',
          content: `✅ **Deliverable Approved & Stored to The Brain!**\n\nThe ${agentName}'s analysis has been successfully stored in your company's permanent memory bank. You can now ask general questions about it or search it from the search bar.`,
          timestamp: new Date(),
        }
      ]);
    } catch (err: any) {
      console.error('[Approval] Approve failed:', err);
      alert(`Approval failed: ${err.message || err}`);
    } finally {
      setApprovalLoading(false);
    }
  };

  const handleRejectOutput = async (outputId: string, feedbackOverride?: string) => {
    const feedback = (feedbackOverride ?? rejectFeedback) || 'Discarded — please start over with a different approach.';
    setApprovalLoading(true);
    try {
      await apiRequest(`/api/approvals/${outputId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ feedback }),
      }, token!);
      await loadAgentStates();
      setShowRejectInput(false);
      setRejectFeedback('');
      setIsOutputExpanded(false);
      
      const agentName = selectedAgent ? selectedAgent.name : 'Agent';
      setMessages(prev => [
        ...prev,
        {
          id: `reject-success-${Date.now()}`,
          role: 'assistant',
          content: `📝 **Changes requested**\n\nYour comments were sent to ${agentName}: "${rejectFeedback}"\n\nThe agent is revising the deliverable.`,
          timestamp: new Date(),
        }
      ]);
    } catch (err: any) {
      console.error('[Approval] Reject failed:', err);
      alert(`Rejection failed: ${err.message || err}`);
    } finally {
      setApprovalLoading(false);
    }
  };

  // ─── Review comments (Phase A3/A4) ───
  const loadOutputComments = async (outputId: string) => {
    if (!outputId || outputId === 'fallback') { setOutputComments([]); return; }
    try {
      const data = await apiRequest(`/api/approvals/${outputId}/comments`, {}, token!);
      setOutputComments(data.comments || []);
    } catch {
      setOutputComments([]);
    }
  };

  const handleAddComment = async (outputId: string) => {
    if (!commentText.trim() || outputId === 'fallback') return;
    setCommentLoading(true);
    try {
      await apiRequest(`/api/approvals/${outputId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: commentText.trim(), section_ref: commentSection }),
      }, token!);
      setCommentText('');
      setCommentSection(null);
      await loadOutputComments(outputId);
    } catch (err: any) {
      alert(`Failed to add comment: ${err.message || err}`);
    } finally {
      setCommentLoading(false);
    }
  };

  const handleRequestRevision = async (outputId: string) => {
    if (outputId === 'fallback') return;
    setApprovalLoading(true);
    try {
      await apiRequest(`/api/approvals/${outputId}/request-revision`, { method: 'POST' }, token!);
      setOutputComments([]);
      setIsOutputExpanded(false);
      await loadAgentStates();
      const agentName = selectedAgent ? selectedAgent.name : 'Agent';
      setMessages(prev => [...prev, {
        id: `revise-${Date.now()}`, role: 'assistant',
        content: `📝 **Revision requested**\n\n${agentName} is revising the deliverable to address your comments.`,
        timestamp: new Date(),
      }]);
    } catch (err: any) {
      alert(`Revision request failed: ${err.message || err}`);
    } finally {
      setApprovalLoading(false);
    }
  };

  const startSectionComment = (sectionRef: string) => {
    setCommentSection(sectionRef);
    setIsOutputExpanded(true);
    const el = document.getElementById('deliverable-comment-box');
    if (el) (el as HTMLTextAreaElement).focus();
  };

  const renderOutputContent = (type: string, data: any, onSectionComment?: (ref: string) => void) => {
    if (!data || typeof data !== 'object') {
      return <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{String(data)}</pre>;
    }

    if (Object.keys(data).length === 0) {
      return <div style={{ color: 'var(--text-muted)' }}>Empty content.</div>;
    }

    switch (type) {
      case 'web_artifact': {
        const html = typeof data.html === 'string' ? data.html : '';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Live preview (sandboxed)</span>
              <button onClick={() => setFullPreviewHtml(html)} className="btn-ghost" style={{ fontSize: '11px', padding: '4px 10px' }}>
                <ExternalLink size={11} /> Full screen
              </button>
            </div>
            <iframe
              srcDoc={html}
              sandbox="allow-scripts allow-popups"
              title="Agent web preview"
              style={{ width: '100%', height: '440px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'white' }}
            />
          </div>
        );
      }
      case 'asset_collection': {
        const assets = Array.isArray(data.assets) ? data.assets : [];
        if (assets.length === 0) return <div style={{ color: 'var(--text-muted)' }}>No assets.</div>;
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px' }}>
            {assets.map((a: any, i: number) => {
              const code = typeof a.code === 'string' ? a.code : '';
              const src = a.url || a.dataUri || '';
              let cell;
              if (code && a.kind === 'html') {
                // HTML code asset → render inside a small sandboxed iframe cell.
                cell = (
                  <iframe srcDoc={code} sandbox="allow-scripts" title={a.caption || `Asset ${i + 1}`}
                    style={{ width: '100%', height: '150px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', background: 'white' }} />
                );
              } else if (code) {
                // SVG (or other) markup → render inline.
                cell = (
                  <div style={{ width: '100%', minHeight: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}
                    dangerouslySetInnerHTML={{ __html: code }} />
                );
              } else if (src) {
                cell = (
                  <img src={src} alt={a.caption || `Asset ${i + 1}`} loading="lazy"
                    style={{ width: '100%', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', display: 'block' }} />
                );
              } else {
                cell = (
                  <div style={{ width: '100%', height: '100px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>No asset</div>
                );
              }
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {cell}
                  {a.caption && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{a.caption}</span>}
                </div>
              );
            })}
          </div>
        );
      }
      case 'marketing_strategy':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {data.executiveSummary && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '0 0 4px 0', color: 'var(--accent-primary)' }}>Executive Summary</h5>
                <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{data.executiveSummary}</p>
              </div>
            )}
            {data.channels && Array.isArray(data.channels) && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '8px 0 6px 0', color: 'var(--accent-primary)' }}>Recommended Channels</h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {data.channels.map((ch: any, i: number) => (
                    <div key={i} style={{ padding: '10px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: '12px' }}>
                        <span>{ch.name}</span>
                        <span style={{ color: 'var(--accent-cyan)' }}>{ch.budget || 'No Budget'} &middot; Priority: {ch.priority || 'Medium'}</span>
                      </div>
                      <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>{ch.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.timeline && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '8px 0 4px 0', color: 'var(--accent-primary)' }}>Timeline</h5>
                <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{data.timeline}</p>
              </div>
            )}
            {data.keyMetrics && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '8px 0 4px 0', color: 'var(--accent-primary)' }}>Key Metrics</h5>
                <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{data.keyMetrics}</p>
              </div>
            )}
            {data.recommendations && Array.isArray(data.recommendations) && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '8px 0 4px 0', color: 'var(--accent-primary)' }}>Recommendations</h5>
                <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)' }}>
                  {data.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}
          </div>
        );

      case 'lead_list':
      case 'investor_list':
        const items = data.leads || data.investors || [];
        const isLeads = type === 'lead_list';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text-muted)' }}>
              Total Found: {data.totalFound || items.length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {items.map((item: any, i: number) => (
                <div key={i} style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--accent-cyan)' }}>{item.name || item.firm || item.company || 'Unnamed'}</span>
                    {item.priority && (
                      <span style={{
                        padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 700,
                        background: item.priority === 'High' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                        color: item.priority === 'High' ? '#ef4444' : '#f59e0b'
                      }}>
                        {item.priority}
                      </span>
                    )}
                  </div>
                  {item.website && (
                    <a href={item.website.startsWith('http') ? item.website : `https://${item.website}`} target="_blank" rel="noopener noreferrer"
                       style={{ fontSize: '11px', color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '3px', textDecoration: 'none', marginBottom: '6px' }}>
                      {item.website} <ExternalLink size={10} />
                    </a>
                  )}
                  {isLeads ? (
                    <>
                      {item.reason && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}><strong>Why:</strong> {item.reason}</div>}
                      {item.notes && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}><strong>Notes:</strong> {item.notes}</div>}
                    </>
                  ) : (
                    <>
                      {item.checkSize && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><strong>Check Size:</strong> {item.checkSize}</div>}
                      {item.focus && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}><strong>Focus:</strong> {item.focus}</div>}
                      {item.portfolio && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}><strong>Portfolio:</strong> {item.portfolio}</div>}
                      {item.approach && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}><strong>Outreach:</strong> {item.approach}</div>}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        );

      case 'competitor_analysis':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {data.competitors && Array.isArray(data.competitors) && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '0 0 6px 0', color: 'var(--accent-primary)' }}>Competitors</h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {data.competitors.map((comp: any, i: number) => (
                    <div key={i} style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ fontWeight: 700, marginBottom: '4px', color: 'var(--accent-cyan)' }}>{comp.name}</div>
                      {comp.website && <div style={{ fontSize: '11px', color: 'var(--accent-primary)', marginBottom: '6px' }}>{comp.website}</div>}
                      {comp.overview && <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{comp.overview}</div>}
                      {comp.strengths && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}><strong>Strengths:</strong> {comp.strengths}</div>}
                      {comp.weaknesses && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}><strong>Weaknesses:</strong> {comp.weaknesses}</div>}
                      {comp.pricing && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}><strong>Pricing:</strong> {comp.pricing}</div>}
                      {comp.marketingStrategy && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}><strong>Marketing:</strong> {comp.marketingStrategy}</div>}
                      {comp.gap && <div style={{ fontSize: '12px', color: '#10b981', marginTop: '4px' }}><strong>Opportunity Gap:</strong> {comp.gap}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.marketPosition && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '8px 0 4px 0', color: 'var(--accent-primary)' }}>Market Position</h5>
                <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{data.marketPosition}</p>
              </div>
            )}
            {data.opportunities && Array.isArray(data.opportunities) && (
              <div>
                <h5 style={{ fontWeight: 700, margin: '8px 0 4px 0', color: 'var(--accent-primary)' }}>Opportunities</h5>
                <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)' }}>
                  {data.opportunities.map((o: string, i: number) => <li key={i}>{o}</li>)}
                </ul>
              </div>
            )}
          </div>
        );

      case 'content_draft':
      case 'social_post':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {data.platform && <div style={{ fontWeight: 600, fontSize: '12px' }}>Platform: {data.platform}</div>}
            {data.posts && Array.isArray(data.posts) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {data.posts.map((post: any, i: number) => (
                  <div key={i} style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontWeight: 700, fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                      POST #{i + 1} {post.platform ? `(${post.platform})` : ''}
                    </div>
                    {post.hook && <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '6px' }}>"{post.hook}"</div>}
                    {post.body && <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', marginBottom: '8px' }}>{post.body}</div>}
                    {post.cta && <div style={{ fontSize: '12px', fontStyle: 'italic', color: 'var(--accent-cyan)' }}>CTA: {post.cta}</div>}
                    {post.hashtags && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{post.hashtags}</div>}
                  </div>
                ))}
              </div>
            )}
            {data.content && typeof data.content === 'string' && (
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>
                {data.content}
              </div>
            )}
          </div>
        );

      case 'plan': {
        const steps = Array.isArray(data.steps) ? data.steps : [];
        const deliverables = Array.isArray(data.deliverables) ? data.deliverables : [];
        const assumptions = Array.isArray(data.assumptions) ? data.assumptions : [];
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--accent-primary)', letterSpacing: '0.04em' }}>PROPOSED PLAN — approve or comment before execution</div>
            {data.objective && (
              <div><h5 style={{ fontWeight: 700, margin: '0 0 4px 0', fontSize: '13px', color: 'var(--accent-primary)' }}>Objective</h5><p style={{ margin: 0, color: 'var(--text-secondary)' }}>{data.objective}</p></div>
            )}
            {data.approach && (
              <div><h5 style={{ fontWeight: 700, margin: '0 0 4px 0', fontSize: '13px', color: 'var(--accent-primary)' }}>Approach</h5><p style={{ margin: 0, color: 'var(--text-secondary)' }}>{data.approach}</p></div>
            )}
            {deliverables.length > 0 && (
              <div><h5 style={{ fontWeight: 700, margin: '0 0 4px 0', fontSize: '13px', color: 'var(--accent-primary)' }}>Deliverables</h5>
                <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)' }}>
                  {deliverables.map((d: any, i: number) => <li key={i}>{typeof d === 'string' ? d : (d.title || JSON.stringify(d))}</li>)}
                </ul>
              </div>
            )}
            {steps.length > 0 && (
              <div><h5 style={{ fontWeight: 700, margin: '0 0 4px 0', fontSize: '13px', color: 'var(--accent-primary)' }}>Steps</h5>
                <ol style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {steps.map((s: any, i: number) => (
                    <li key={s.id || i}>
                      <strong>{s.title || s}</strong>{s.detail ? ` — ${s.detail}` : ''}
                      {onSectionComment && (
                        <button onClick={() => onSectionComment(`step ${s.id || i + 1}: ${s.title || ''}`.trim())} title="Comment on this step"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 0 0 6px', display: 'inline-flex', verticalAlign: 'middle' }}>
                          <MessageSquare size={11} />
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {assumptions.length > 0 && (
              <div><h5 style={{ fontWeight: 700, margin: '0 0 4px 0', fontSize: '13px', color: 'var(--accent-primary)' }}>Assumptions</h5>
                <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-muted)' }}>
                  {assumptions.map((a: any, i: number) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
          </div>
        );
      }

      case 'code_project': {
        const files = Array.isArray(data.files) ? data.files : [];
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.preview_url ? (
              <iframe src={data.preview_url} sandbox="allow-scripts allow-same-origin allow-popups" title="Project preview"
                style={{ width: '100%', height: '440px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'white' }} />
            ) : typeof data.html === 'string' ? (
              <iframe srcDoc={data.html} sandbox="allow-scripts allow-popups" title="Project preview"
                style={{ width: '100%', height: '440px', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'white' }} />
            ) : null}
            {files.length > 0 && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>Files</div>
                <ul style={{ margin: 0, paddingLeft: '16px' }}>
                  {files.map((f: any, i: number) => <li key={i}>{typeof f === 'string' ? f : f.path}</li>)}
                </ul>
              </div>
            )}
          </div>
        );
      }

      default:
        return renderStructured(data, onSectionComment);
    }
  };

  // Recursively render an arbitrary structured deliverable as readable sections —
  // headings for keys, bullet lists for arrays, nested cards for objects. Avoids
  // dumping raw JSON for the many structured deliverable types (Phase A2).
  const renderStructured = (data: any, onSectionComment?: (ref: string) => void): any => {
    const labelize = (k: string) => k.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').replace(/^./, s => s.toUpperCase()).trim();
    const renderVal = (val: any): any => {
      if (val == null) return null;
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        return <p style={{ margin: 0, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{String(val)}</p>;
      }
      if (Array.isArray(val)) {
        return (
          <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {val.map((item: any, idx: number) => (
              <li key={idx}>
                {(item && typeof item === 'object')
                  ? Object.entries(item).map(([k, v]: [string, any]) => (
                      <span key={k} style={{ display: 'block' }}><strong>{labelize(k)}:</strong> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                    ))
                  : String(item)}
              </li>
            ))}
          </ul>
        );
      }
      // nested object
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingLeft: '8px' }}>
          {Object.entries(val).map(([k, v]: [string, any]) => (
            <div key={k} style={{ color: 'var(--text-secondary)' }}><strong>{labelize(k)}:</strong> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
          ))}
        </div>
      );
    };
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {Object.entries(data).map(([key, val]: [string, any]) => {
          if (key === 'researchNotes' || key === 'generatedAt' || key === 'logs') return null;
          return (
            <div key={key}>
              <h5 style={{ fontWeight: 700, margin: '0 0 4px 0', fontSize: '13px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {labelize(key)}
                {onSectionComment && (
                  <button onClick={() => onSectionComment(labelize(key))} title={`Comment on ${labelize(key)}`}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'inline-flex' }}>
                    <MessageSquare size={11} />
                  </button>
                )}
              </h5>
              {renderVal(val)}
            </div>
          );
        })}
      </div>
    );
  };

  // Render a chat message body, turning ```svg / ```html fenced blocks into live
  // previews (so an agent can show logos/graphics inline) while leaving text as-is.
  const renderMessageBody = (content: string): any => {
    if (!content) return null;
    const regex = /```(svg|html)\s*\n?([\s\S]*?)```/gi;
    const parts: any[] = [];
    let last = 0; let m: RegExpExecArray | null; let key = 0;
    while ((m = regex.exec(content)) !== null) {
      if (m.index > last) parts.push(<span key={key++}>{content.slice(last, m.index)}</span>);
      const lang = m[1].toLowerCase();
      const code = m[2].trim();
      if (lang === 'svg') {
        parts.push(<div key={key++} style={{ display: 'inline-block', margin: '8px 8px 8px 0', verticalAlign: 'top', maxWidth: '180px' }} dangerouslySetInnerHTML={{ __html: code }} />);
      } else {
        parts.push(<iframe key={key++} srcDoc={code} sandbox="allow-scripts" title="preview"
          style={{ display: 'block', width: '100%', maxWidth: '420px', height: '240px', margin: '8px 0', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'white' }} />);
      }
      last = regex.lastIndex;
    }
    if (last < content.length) parts.push(<span key={key++}>{content.slice(last)}</span>);
    return parts.length > 0 ? parts : content;
  };

  // ─── Dedicated deliverable review panel (right pane) ───
  // Shown when the selected agent has a deliverable/plan awaiting review. Hosts the
  // preview + threaded/section comments + approve/revise — separated from the chat.
  const renderDeliverablePanel = () => {
    if (!selectedAgent) return null;
    const state = agentStates[selectedAgent.id];
    if (!state || state.status !== 'awaiting_approval') return null;
    const pendingOutput: any = state?.agent_outputs?.find((o: any) => o.status === 'pending_approval') ||
      (state?.output_data ? { id: 'fallback', title: `${selectedAgent.name} Deliverable`, summary: state.output_summary, content: state.output_data } : null);
    if (!pendingOutput) return null;
    const actualOutputId = pendingOutput.id;
    const isPlan = pendingOutput.output_type === 'plan';
    const hasOpenComments = outputComments.some((c: any) => c.status === 'open');

    return (
      <div style={{
        width: '440px', flexShrink: 0, borderLeft: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', minWidth: 0,
      }}>
        {/* Panel header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: isPlan ? 'var(--accent-primary)' : '#10b981', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CheckCircle2 size={14} /> {isPlan ? 'Plan — review' : 'Deliverable — review'}
          </div>
          <button
            onClick={() => {
              const md = convertOutputToMarkdown(pendingOutput.title, pendingOutput.summary, pendingOutput.output_type, pendingOutput.content);
              setExportTitle(pendingOutput.title); setExportContent(md); setIsExportOpen(true);
            }}
            className="btn-ghost" style={{ padding: '4px 8px', fontSize: '11px', color: 'var(--accent-primary)' }} title="Export / download">
            <FileDown size={13} />
          </button>
        </div>

        {/* Scrollable body: title + preview + comments */}
        <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 4px 0', color: 'var(--text-primary)' }}>
              {isPlan ? '📝 ' : ''}{pendingOutput.title}{pendingOutput.version > 1 ? ` (v${pendingOutput.version})` : ''}
            </h3>
            {pendingOutput.summary && <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{pendingOutput.summary}</p>}
          </div>

          <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '14px', fontSize: '12.5px', lineHeight: 1.6, color: 'var(--text-primary)' }}>
            {renderOutputContent(pendingOutput.output_type || 'generic', pendingOutput.content, startSectionComment)}
          </div>

          {/* Comments thread */}
          {outputComments.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Comments</div>
              {outputComments.map((c: any) => (
                <div key={c.id} style={{ fontSize: '12px', padding: '8px 10px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', opacity: c.status === 'addressed' ? 0.55 : 1 }}>
                  {c.section_ref && <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--accent-primary)', display: 'block', marginBottom: '2px' }}>on: {c.section_ref}</span>}
                  <span style={{ color: 'var(--text-secondary)' }}>{c.body}</span>
                  {c.status === 'addressed' && <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '6px' }}>✓ addressed</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Composer + actions (pinned bottom) */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {commentSection && (
            <div style={{ fontSize: '11px', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              Commenting on: <strong>{commentSection}</strong>
              <button onClick={() => setCommentSection(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '11px' }}>clear</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
            <textarea
              id="deliverable-comment-box"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={commentSection ? `Comment on "${commentSection}"...` : 'Add a comment for the agent...'}
              style={{ flex: 1, minHeight: '38px', maxHeight: '120px', fontSize: '12px', padding: '8px 10px', background: 'var(--bg-tertiary)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', outline: 'none', resize: 'vertical' }}
              disabled={commentLoading || actualOutputId === 'fallback'}
            />
            <button onClick={() => handleAddComment(actualOutputId)} className="btn-ghost" style={{ padding: '8px 12px', fontSize: '11px', whiteSpace: 'nowrap' }}
              disabled={!commentText.trim() || commentLoading || actualOutputId === 'fallback'}>
              {commentLoading ? <Loader2 size={12} className="animate-spin" /> : 'Add'}
            </button>
          </div>
          {showRejectInput ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#ef4444' }}>Why are you discarding this? (the agent will use this to start over)</label>
              <textarea
                value={rejectFeedback}
                onChange={(e) => setRejectFeedback(e.target.value)}
                placeholder="e.g. Wrong direction — too corporate, I wanted something playful and bold…"
                style={{ width: '100%', minHeight: '60px', fontSize: '12px', padding: '8px 10px', background: 'var(--bg-tertiary)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', outline: 'none', resize: 'vertical' }}
                disabled={approvalLoading}
                autoFocus
              />
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button onClick={() => { setShowRejectInput(false); setRejectFeedback(''); }} className="btn-ghost" style={{ padding: '4px 10px', fontSize: '11px' }} disabled={approvalLoading}>Cancel</button>
                <button
                  onClick={() => { handleRejectOutput(actualOutputId, rejectFeedback.trim()); setShowRejectInput(false); }}
                  className="btn-primary"
                  style={{ padding: '4px 10px', fontSize: '11px', background: '#ef4444', borderColor: '#ef4444', color: '#fff' }}
                  disabled={!rejectFeedback.trim() || approvalLoading}>
                  {approvalLoading ? <Loader2 size={11} className="animate-spin" /> : 'Discard & restart'}
                </button>
              </div>
            </div>
          ) : (
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button onClick={() => { setRejectFeedback(''); setShowRejectInput(true); }} className="btn-ghost"
              style={{ padding: '6px 12px', fontSize: '11px', color: '#ef4444', borderColor: 'rgba(239,68,68,0.15)', background: 'transparent' }}
              disabled={approvalLoading} title="Discard with a reason so the agent can start over">
              Discard
            </button>
            {hasOpenComments && (
              <button onClick={() => handleRequestRevision(actualOutputId)} className="btn-ghost"
                style={{ padding: '6px 12px', fontSize: '11px', color: 'var(--accent-primary)', borderColor: 'var(--border-default)', background: 'transparent', display: 'flex', alignItems: 'center', gap: '4px' }}
                disabled={approvalLoading || actualOutputId === 'fallback'}>
                {approvalLoading ? <Loader2 size={12} className="animate-spin" /> : <><MessageSquare size={12} /> Send & revise</>}
              </button>
            )}
            <button onClick={() => handleApproveOutput(actualOutputId)} className="btn-primary"
              style={{ padding: '6px 12px', fontSize: '11px', background: '#10b981', borderColor: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', gap: '4px' }}
              disabled={approvalLoading}>
              {approvalLoading ? <Loader2 size={12} className="animate-spin" /> : <><CheckCircle2 size={12} /> {isPlan ? 'Approve & Execute' : 'Approve'}</>}
            </button>
          </div>
          )}
        </div>
      </div>
    );
  };

  // ─── Workspace tab content: capability panels + deliverables list (Phase W) ───
  const renderWorkspaceTabContent = () => {
    if (!selectedAgent) return null;
    const backendType = agentTypeToBackend[selectedAgent.id] || selectedAgent.id;
    const color = selectedAgent.color;

    // DELIVERABLES TAB — list this agent's outputs (pending + history).
    if (workspaceTab === 'deliverables') {
      const outputs: any[] = [];
      allRuns.filter(r => r.agent_type === backendType).forEach(r => {
        (r.agent_outputs || []).forEach((o: any) => outputs.push(o));
      });
      outputs.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      return (
        <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '24px', background: 'var(--bg-primary)' }}>
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '12px' }}>Deliverables</h3>
            {outputs.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No deliverables yet. Run a capability to produce one — pending items appear in the review panel on the right.</div>
            ) : outputs.map((o: any) => {
              const st = o.status === 'pending_approval' ? { c: '#f59e0b', l: 'Pending review' } : o.status === 'approved' ? { c: '#10b981', l: 'Approved' } : { c: '#ef4444', l: o.status };
              return (
                <div key={o.id} style={{ marginBottom: '12px', padding: '14px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 700 }}>{o.title}{o.version > 1 ? ` (v${o.version})` : ''}</span>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: st.c, background: `${st.c}18`, padding: '2px 8px', borderRadius: 'var(--radius-full)' }}>{st.l}</span>
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--text-primary)' }}>{renderOutputContent(o.output_type || 'generic', o.content)}</div>
                  {o.status === 'pending_approval' && (
                    <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>Review, comment, and approve in the panel on the right →</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    // CAPABILITY TAB — recipe card + run + this recipe's latest run status.
    const recipe = (recipes[backendType] || []).find((r: any) => r.id === workspaceTab);
    if (!recipe) return null;
    const run = allRuns
      .filter(r => r.agent_type === backendType && r.output_data?.recipe_id === recipe.id)
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
    const runStatus = run?.status === 'awaiting_plan_approval' ? 'awaiting_approval' : run?.status;
    const isRunning = runStatus === 'running' || runStatus === 'active';
    const logs: string[] = run?.output_data?.logs || [];

    return (
      <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '24px', background: 'var(--bg-primary)' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ padding: '20px', background: 'var(--bg-secondary)', border: `1px solid ${color}22`, borderRadius: 'var(--radius-lg)' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 6px 0' }}>{recipe.label}</h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 16px 0', lineHeight: 1.5 }}>{recipe.description}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                onClick={() => handleRunRecipe(backendType, recipe.id)}
                disabled={recipeLaunching === recipe.id || isRunning}
                className="btn-primary"
                style={{ padding: '8px 16px', fontSize: '13px', background: color, borderColor: color, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {(recipeLaunching === recipe.id || isRunning)
                  ? <><Loader2 size={13} className="animate-spin" /> Working…</>
                  : <><Zap size={13} /> {planMode ? 'Plan it' : 'Run it'}</>}
              </button>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {planMode ? 'Agent proposes a plan you approve first' : 'Agent produces the deliverable directly'}
              </span>
            </div>

            {/* This recipe's live run status + activity */}
            {run && (
              <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  {isRunning && <Loader2 size={13} className="animate-spin" style={{ color }} />}
                  <span style={{ fontSize: '12px', fontWeight: 600, color: getStatusColor(runStatus || 'idle') }}>{getStatusLabel(runStatus || 'idle')}</span>
                  {run.current_action && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{run.current_action}</span>}
                </div>
                {isRunning && (
                  <div style={{ height: '4px', borderRadius: '2px', background: 'var(--bg-tertiary)', overflow: 'hidden', marginBottom: '10px' }}>
                    <div style={{ height: '100%', width: `${run.progress_pct || 0}%`, background: color, transition: 'width 0.4s ease' }} />
                  </div>
                )}
                {runStatus === 'awaiting_input' && (
                  <div style={{ fontSize: '12px', color: '#f59e0b' }}>
                    The agent has a question — answer it in the <button onClick={() => setWorkspaceTab('chat')} style={{ background: 'transparent', border: 'none', color, cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: '12px' }}>Chat tab</button>.
                  </div>
                )}
                {runStatus === 'awaiting_approval' && (
                  <div style={{ fontSize: '12px', color: '#10b981' }}>Deliverable ready — review, comment & approve in the panel on the right →</div>
                )}
                {logs.length > 0 && (
                  <details style={{ marginTop: '8px' }}>
                    <summary style={{ cursor: 'pointer', fontSize: '11px', color: 'var(--text-muted)' }}>Activity ({logs.length})</summary>
                    <div style={{ marginTop: '6px', maxHeight: '160px', overflowY: 'auto', background: '#0a0a0f', borderRadius: 'var(--radius-md)', padding: '10px', fontSize: '10.5px', fontFamily: 'monospace', color: '#a5b4fc' }}>
                      {logs.map((l: string, i: number) => <div key={i} style={{ marginBottom: '2px' }}>{l}</div>)}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ─── LAUNCH AGENT ───

  // Agent type mapping — 1:1 mapping to backend agent types
  // Backend now has the same 11 agent types as the frontend
  const agentTypeToBackend: Record<string, string> = {
    finance: 'finance', people: 'people', hr: 'hr',
    investment: 'investment', crm: 'crm',
    marketing: 'marketing', sales: 'sales',
    product: 'product', roadmap: 'roadmap',
    meeting: 'meeting', engineering: 'engineering',
  };

  const handleLaunchAgent = async (agentId: string) => {
    // Find agent by canonical ID (FALLBACK_AGENTS IDs are always in the agents array)
    const agent = FALLBACK_AGENTS.find(a => a.id === agentId) || agents.find(a => a.id === agentId);
    if (!agent) return;

    setAgentStates(prev => ({
      ...prev,
      [agentId]: {
        ...(prev[agentId] || { status: 'idle', current_action: '', progress_pct: 0, output_summary: null, error_message: null, last_completed: null, conversation_history: [], current_question: null }),
        status: 'active', current_action: 'Launching...', progress_pct: 5,
      },
    }));

    try {
      const backendType = agentTypeToBackend[agentId] || agentId;
      await apiRequest('/api/agents/launch', {
        method: 'POST',
        body: JSON.stringify({ agentType: backendType }),
      }, token!);
      setTimeout(loadAgentStates, 1500);
    } catch {
      setTimeout(() => {
        setAgentStates(prev => ({
          ...prev,
          [agentId]: { ...(prev[agentId] || {} as AgentState), status: 'idle', current_action: '', progress_pct: 0 } as AgentState,
        }));
      }, 2000);
    }
  };

  // ─── LAUNCH ALL ───

  const handleLaunchAll = async () => {
    // Use canonical FALLBACK_AGENTS for consistent launching
    for (const agent of FALLBACK_AGENTS.slice(0, 10)) {
      setAgentStates(prev => ({
        ...prev,
        [agent.id]: { ...(prev[agent.id] || {} as AgentState), status: 'active', current_action: 'Launching...', progress_pct: 5 } as AgentState,
      }));
    }
    for (const agent of FALLBACK_AGENTS.slice(0, 10)) {
      try {
        const backendType = agentTypeToBackend[agent.id] || 'company_researcher';
        await apiRequest('/api/agents/launch', {
          method: 'POST', body: JSON.stringify({ agentType: backendType }),
        }, token!);
      } catch { /* ignore */ }
    }
    setTimeout(loadAgentStates, 2000);
  };

  // ─── RESPOND TO AGENT QUESTION ───

  const handleRespondToAgentQuestion = async (customAnswer?: string) => {
    const answer = customAnswer !== undefined ? customAnswer : agentAnswer.trim();
    if (!answer || !selectedTarget || selectedTarget === 'brain') return;
    setAgentAnswerLoading(true);

    try {
      const data = await apiRequest('/api/agents/runs', {}, token!);
      const executions = data.executions || [];
      const matchingExec = executions.find((e: any) =>
        findAgentIdForType(e.agent_type) === selectedTarget && 
        (e.status === 'awaiting_input' || e.status === 'awaiting_approval' || e.status === 'completed'));

      if (matchingExec) {
        await apiRequest(`/api/agents/runs/${matchingExec.id}/respond`, {
          method: 'POST', body: JSON.stringify({ answer }),
        }, token!);

        const userMsg: Message = {
          id: `agent-answer-${Date.now()}`, role: 'user', content: answer,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, userMsg]);
        setAgentAnswer('');
        setSelectedChoice(null);
        setQMultiSelect([]);
        setShowCustomInput(false);
        setTimeout(loadAgentStates, 500);
      }
    } catch { /* ignore */ }

    setAgentAnswerLoading(false);
  };

  const handleChoiceSelect = (choice: string) => {
    if (choice === '__other__') {
      setShowCustomInput(true);
      setSelectedChoice(null);
    } else {
      setSelectedChoice(choice);
      setShowCustomInput(false);
      setAgentAnswer('');
      handleRespondToAgentQuestion(choice);
    }
  };

  // ─── HANDLE INLINE QUESTION CHOICE (from chat message) ───
  const handleInlineChoiceSelect = async (choice: string) => {
    if (choice === '__other__') {
      // User clicked "Other" - show text input inline in the message
      // This is handled by the message UI state
      return;
    }
    if (!selectedTarget || selectedTarget === 'brain') return;

    // Route choices to active run if agent is awaiting input
    const state = agentStates[selectedTarget];
    if (state && state.status === 'awaiting_input') {
      setPendingQuestion(null);
      await handleRespondToAgentQuestion(choice);
      return;
    }

    setQuestionAnswerLoading(true);

    // Add user's answer as a chat message
    const userMsg: Message = {
      id: `inline-answer-${Date.now()}`,
      role: 'user',
      content: choice,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setPendingQuestion(null);

    // Send the answer back to the agent to continue the conversation
    try {
      const agent = agents.find(a => a.id === selectedTarget);
      const agentSystemPrompt = AGENT_SYSTEM_PROMPTS[selectedTarget] || (agent as any)?.system_prompt || '';

      const res = await apiRequest('/api/orchestrator/agent-chat', {
        method: 'POST',
        body: JSON.stringify({
          message: choice,
          sessionId: activeSessionId,
          agentName: agent?.name || selectedTarget,
          agentSystemPrompt,
        }),
      }, token!);

      // Capture session ID if the backend created one
      if (!activeSessionId && res.sessionId) {
        setActiveSessionId(res.sessionId);
        loadSessions(selectedTarget || undefined);
      }

      if (res.type === 'question') {
        // Agent asked another question
        const questionMsg: Message = {
          id: `agent-question-${Date.now()}`,
          role: 'assistant',
          content: res.question,
          questionData: { question: res.question, choices: res.choices || [] },
          timestamp: new Date(),
          agentId: selectedTarget,
          agentName: agent?.name || selectedTarget,
        };
        setMessages(prev => [...prev, questionMsg]);
        setPendingQuestion({ question: res.question, choices: res.choices || [] });
      } else {
        // Normal response
        let cleanReply = (res.reply || '').replace(/\*\*Tool Call:.*?\*\*\s*```[\s\S]*?```/gi, '')
          .replace(/```json\s*\{[\s\S]*?\}\s*```/gi, '')
          .replace(/\*\*Please wait while I (?:retrieve|fetch|call|access).*?\*\*/gi, '')
          .replace(/\n{3,}/g, '\n\n').trim();

        const assistantMsg: Message = {
          id: `agent-response-${Date.now()}`,
          role: 'assistant',
          content: cleanReply,
          timestamp: new Date(),
          agentId: selectedTarget,
          agentName: agent?.name || selectedTarget,
        };
        setMessages(prev => [...prev, assistantMsg]);
      }
    } catch {
      // Fallback: just acknowledge the answer
      const fallbackMsg: Message = {
        id: `agent-fallback-${Date.now()}`,
        role: 'assistant',
        content: `Thanks for your answer. How else can I help you?`,
        timestamp: new Date(),
        agentId: selectedTarget,
        agentName: agents.find(a => a.id === selectedTarget)?.name || selectedTarget,
      };
      setMessages(prev => [...prev, fallbackMsg]);
    }
    setQuestionAnswerLoading(false);
  };

  const handleInlineCustomAnswerSubmit = async () => {
    if (!questionAnswer.trim() || !pendingQuestion) return;
    await handleInlineChoiceSelect(questionAnswer.trim());
    setQuestionAnswer('');
  };

  // Submit one or more selected answers (plus any custom text) to an inline question.
  const handleInlineMultiSubmit = async () => {
    const parts = [...inlineSelected];
    if (questionAnswer.trim()) parts.push(questionAnswer.trim());
    const ans = parts.join(', ');
    if (!ans) return;
    setInlineSelected([]);
    setQuestionAnswer('');
    await handleInlineChoiceSelect(ans);
  };

  // ─── UTILITIES ───

  const sourceIconMap = (type: string) => {
    switch (type) {
      case 'meeting': return <Calendar size={12} />;
      case 'google_doc': return <FileText size={12} />;
      case 'slack': return <Hash size={12} />;
      case 'email': return <Mail size={12} />;
      case 'web': case 'web_search': case 'research': return <Globe size={12} />;
      default: return <FileText size={12} />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': case 'running': return '#6366f1';
      case 'awaiting_input': return '#f59e0b';
      case 'awaiting_approval': return '#10b981';
      case 'completed': return '#34d399';
      case 'error': case 'failed': return '#ef4444';
      case 'stopped': return '#f59e0b';
      case 'idle': default: return '#64748b';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active': case 'running': return 'Active';
      case 'awaiting_input': return 'Needs Input';
      case 'awaiting_approval': return 'Ready to Review';
      case 'completed': return 'Completed';
      case 'error': case 'failed': return 'Error';
      case 'stopped': return 'Stopped';
      case 'idle': default: return 'Idle';
    }
  };

  // Ask a running agent to stop its current task.
  const handleStopAgent = async (agentId: string) => {
    try {
      let runId = agentStates[agentId]?.run_id;
      if (!runId) {
        const data = await apiRequest('/api/agents/runs', {}, token!);
        const match = (data.executions || []).find((e: any) =>
          findAgentIdForType(e.agent_type) === agentId &&
          ['running', 'awaiting_input', 'awaiting_approval'].includes(e.status));
        runId = match?.id;
      }
      if (!runId) return;
      setAgentStates(prev => ({
        ...prev,
        [agentId]: { ...(prev[agentId] || {} as AgentState), status: 'idle', current_action: '', progress_pct: 0 } as AgentState,
      }));
      await apiRequest(`/api/agents/runs/${runId}/stop`, { method: 'POST' }, token!);
      setTimeout(loadAgentStates, 600);
    } catch (err) {
      console.error('Failed to stop agent', err);
    }
  };

  // ─── COMPUTE AGENT POSITIONS (circle around brain) ───
  const agentPositions = useMemo(() => {
    const displayed = agents.slice(0, 11);
    return displayed.map((agent, i) => {
      const angle = (i / displayed.length) * 2 * Math.PI - Math.PI / 2;
      const x = NETWORK_CENTER_X + NETWORK_RADIUS * Math.cos(angle);
      const y = NETWORK_CENTER_Y + NETWORK_RADIUS * Math.sin(angle);
      return { ...agent, x, y, angle };
    });
  }, [agents]);

  // ─── COMPUTE STATS ───
  const activeAgentCount = useMemo(() =>
    Object.values(agentStates).filter(s => s.status === 'active' || s.status === 'running').length, [agentStates]);
  const pendingApprovalCount = useMemo(() =>
    Object.values(agentStates).filter(s => s.status === 'awaiting_approval').length, [agentStates]);
  const awaitingInputCount = useMemo(() =>
    Object.values(agentStates).filter(s => s.status === 'awaiting_input').length, [agentStates]);

  const selectedAgent = useMemo(() => {
    if (!selectedTarget || selectedTarget === 'brain') return null;
    return agents.find(a => a.id === selectedTarget);
  }, [selectedTarget, agents]);

  const isBrainSelected = selectedTarget === 'brain';

  // Animate pulse based on active agents
  const pulseOpacity = 0.3 + 0.2 * Math.sin(animPhase * 0.3);

  // ─── SVG LINE PATHS ───
  const linePaths = useMemo(() => agentPositions.map(agent => {
    const state = agentStates[agent.id] || { status: 'idle' };
    const isActive = state.status === 'active' || state.status === 'running';
    // Animated dash offset
    const dashOffset = isActive ? animPhase * 3 : 0;
    return { agent, isActive, dashOffset };
  }), [agentPositions, agentStates, animPhase]);

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-primary)' }}>
      {/* ─── LEFT SIDEBAR: Sessions ─── */}
      <div style={{
        width: '220px', borderRight: '1px solid var(--border-subtle)',
        display: 'flex', flexDirection: 'column', background: 'var(--bg-tertiary)', flexShrink: 0,
      }}>
        <div style={{ padding: '14px' }}>
          <button onClick={handleNewChat} className="btn-primary"
            style={{ width: '100%', justifyContent: 'center', display: 'flex', gap: '8px', fontSize: '13px', padding: '8px 14px' }}>
            <Plus size={14} /> New Chat
          </button>
        </div>

        <div style={{ padding: '0 14px 8px', flex: 1, overflowY: 'auto' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {selectedAgent ? (
              <>
                <span style={{ fontSize: '13px' }}>{selectedAgent.emoji}</span>
                {selectedAgent.name.replace(' Agent', '')} Chats
              </>
            ) : (
              <>
                <Brain size={10} />
                Brain Chats
              </>
            )}
          </div>
          {sessionsLoading && sessions.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
              <Loader2 size={14} className="animate-spin" color="var(--text-muted)" />
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', padding: '6px 2px' }}>
              No recent chats.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {sessions.slice(0, 15).map(session => (
                <div key={session.id}
                  className="hover-bg-secondary session-row"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 8px 8px 10px',
                    width: '100%', borderRadius: 'var(--radius-sm)',
                    background: activeSessionId === session.id ? 'var(--bg-secondary)' : 'transparent',
                    transition: 'all 0.15s ease',
                  }}>
                  <button
                    onClick={() => {
                      setActiveSessionId(session.id);
                      if (!selectedTarget || selectedTarget === 'brain') {
                        setSelectedTarget('brain');
                      }
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0,
                      background: 'transparent', border: 'none', textAlign: 'left', padding: 0,
                      color: activeSessionId === session.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontSize: '12px', cursor: 'pointer',
                    }}>
                    <MessageSquare size={12} style={{ opacity: 0.5, flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {session.title}
                    </span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteChat(session.id); }}
                    className="session-delete-btn"
                    title="Delete chat"
                    style={{
                      background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px',
                      color: 'var(--text-muted)', flexShrink: 0, display: 'flex', opacity: 0.6,
                    }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>


      {/* ─── RIGHT PANEL: Chat Area + Deliverable Panel (two-pane) ─── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minWidth: 0 }}>
        {/* Left: conversation column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* ─── CHAT HEADER ─── */}
        <div style={{
          padding: '12px 24px', borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--bg-secondary)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {isBrainSelected ? (
              <>
                <div style={{
                  width: '36px', height: '36px', borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
                }}>
                  <Brain size={20} color="white" />
                </div>
                <div>
                  <h1 style={{ fontSize: '16px', fontWeight: 700 }}>The Brain</h1>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Sparkles size={12} /> Delegates tasks to agents automatically
                  </p>
                </div>
              </>
            ) : selectedAgent ? (
              <>
                <button onClick={() => handleSelectTarget('brain')} className="btn-ghost"
                  style={{ padding: '4px 8px', fontSize: '12px' }}>
                  <ChevronLeft size={14} /> Brain
                </button>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: `${selectedAgent.color}20`,
                  border: `2px solid ${selectedAgent.color}40`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '18px',
                }}>
                  {selectedAgent.emoji}
                </div>
                <div>
                  <h1 style={{ fontSize: '16px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {selectedAgent.name}
                    <span style={{
                      padding: '2px 8px', borderRadius: 'var(--radius-full)',
                      background: `${getStatusColor(agentStates[selectedAgent.id]?.status || 'idle')}15`,
                      color: getStatusColor(agentStates[selectedAgent.id]?.status || 'idle'),
                      fontSize: '10px', fontWeight: 700,
                    }}>
                      {getStatusLabel(agentStates[selectedAgent.id]?.status || 'idle')}
                    </span>
                  </h1>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {selectedAgent.role} &middot; {selectedAgent.description}
                  </p>
                </div>
              </>
            ) : null}
          </div>

          {/* Agent action buttons */}
          {selectedAgent && !isBrainSelected && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              {(agentStates[selectedAgent.id]?.status === 'awaiting_approval') && (
                <span className="badge badge-success" style={{ fontSize: '10px' }}>
                  <CheckCircle2 size={10} /> Ready for Review
                </span>
              )}
              {['running', 'active', 'awaiting_input'].includes(agentStates[selectedAgent.id]?.status || '') && (
                <button onClick={() => handleStopAgent(selectedAgent.id)} className="btn-ghost"
                  title="Stop this agent's current task"
                  style={{ fontSize: '11px', padding: '6px 12px', color: 'var(--accent-rose)', borderColor: 'var(--accent-rose)' }}>
                  <Square size={11} fill="currentColor" /> Stop
                </button>
              )}
              <button onClick={() => handleLaunchAgent(selectedAgent.id)} className="btn-primary"
                style={{ fontSize: '11px', padding: '6px 12px' }}>
                <Zap size={12} /> {agentStates[selectedAgent.id]?.status === 'idle' ? 'Launch' : 'Relaunch'}
              </button>
            </div>
          )}
        </div>

        {/* ─── AGENT WORKSPACE BAR: tabs + Plan/Execute toggle (Phase W) ─── */}
        {selectedAgent && !isBrainSelected && (() => {
          const backendType = agentTypeToBackend[selectedAgent.id] || selectedAgent.id;
          const agentRecipes = recipes[backendType] || [];
          const tabBtn = (id: string, label: string, active: boolean) => (
            <button key={id} onClick={() => setWorkspaceTab(id)} style={{
              padding: '8px 12px', fontSize: '12px', fontWeight: active ? 700 : 500,
              background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              color: active ? selectedAgent.color : 'var(--text-secondary)',
              borderBottom: active ? `2px solid ${selectedAgent.color}` : '2px solid transparent',
            }}>{label}</button>
          );
          return (
            <div style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '16px' }}>
              <div className="custom-scrollbar" style={{ display: 'flex', alignItems: 'center', gap: '2px', overflowX: 'auto', padding: '0 8px' }}>
                {tabBtn('chat', 'Chat', workspaceTab === 'chat')}
                {agentRecipes.map((r: any) => tabBtn(r.id, r.label, workspaceTab === r.id))}
                {tabBtn('deliverables', 'Deliverables', workspaceTab === 'deliverables')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              {/* Live status pill (W4) */}
              {(() => {
                const st = agentStates[selectedAgent.id];
                if (!st || st.status === 'idle') return null;
                const working = st.status === 'running' || st.status === 'active';
                const sc = getStatusColor(st.status);
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', maxWidth: '260px' }}>
                    {working
                      ? <Loader2 size={12} className="animate-spin" style={{ color: sc, flexShrink: 0 }} />
                      : <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: sc, flexShrink: 0 }} />}
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {working ? (st.current_action || 'Working…') : getStatusLabel(st.status)}
                    </span>
                  </div>
                );
              })()}
              {/* Plan / Execute toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-full)', padding: '3px' }}>
                <button onClick={() => setPlanMode(true)} title="Agent proposes a plan you approve before any work"
                  style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 700, borderRadius: 'var(--radius-full)', border: 'none', cursor: 'pointer',
                    background: planMode ? selectedAgent.color : 'transparent', color: planMode ? '#fff' : 'var(--text-muted)' }}>Plan</button>
                <button onClick={() => setPlanMode(false)} title="Agent does the task directly"
                  style={{ padding: '4px 10px', fontSize: '11px', fontWeight: 700, borderRadius: 'var(--radius-full)', border: 'none', cursor: 'pointer',
                    background: !planMode ? selectedAgent.color : 'transparent', color: !planMode ? '#fff' : 'var(--text-muted)' }}>Execute</button>
              </div>
              </div>
            </div>
          );
        })()}

        {/* ─── COMPACT AGENT STATUS CARD (Chat tab only) ─── */}
        {selectedAgent && (isBrainSelected || workspaceTab === 'chat') && agentStates[selectedAgent.id] && (
          <div style={{
            marginBottom: '16px', padding: '12px 16px',
            background: `linear-gradient(135deg, ${selectedAgent.color}06, ${selectedAgent.color}01)`,
            border: `1px solid ${selectedAgent.color}12`,
            borderRadius: 'var(--radius-lg)',
            maxWidth: '800px', marginLeft: 'auto', marginRight: 'auto', width: '100%',
            boxSizing: 'border-box',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Agent icon */}
              <div style={{
                width: '36px', height: '36px', borderRadius: '50%',
                background: `${selectedAgent.color}18`,
                border: `1px solid ${selectedAgent.color}25`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '18px', flexShrink: 0,
              }}>
                {selectedAgent.emoji}
              </div>

              {/* Status info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>{selectedAgent.name}</span>
                  <span style={{
                    padding: '2px 8px', borderRadius: 'var(--radius-full)',
                    background: `${getStatusColor(agentStates[selectedAgent.id]?.status || 'idle')}15`,
                    color: getStatusColor(agentStates[selectedAgent.id]?.status || 'idle'),
                    fontSize: '10px', fontWeight: 700,
                  }}>
                    {getStatusLabel(agentStates[selectedAgent.id]?.status || 'idle')}
                  </span>
                  {agentStates[selectedAgent.id]?.status !== 'idle' && (
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {agentStates[selectedAgent.id]?.current_action || ''}
                    </span>
                  )}
                </div>

                {/* Progress bar (when active) */}
                {(agentStates[selectedAgent.id]?.status === 'active' || agentStates[selectedAgent.id]?.status === 'running') && (
                  <div style={{ marginTop: '6px' }}>
                    <div style={{ width: '100%', height: '4px', background: 'var(--bg-elevated)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: '2px',
                        width: `${agentStates[selectedAgent.id]?.progress_pct || 0}%`,
                        background: `linear-gradient(90deg, ${selectedAgent.color}, ${selectedAgent.color}cc)`,
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px', display: 'block' }}>
                      {agentStates[selectedAgent.id]?.progress_pct || 0}%
                    </span>
                  </div>
                )}

                {/* Current question inline (when awaiting input) */}
                {agentStates[selectedAgent.id]?.status === 'awaiting_input' && (
                  <div style={{
                    marginTop: '8px', padding: '14px 16px',
                    background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
                    borderRadius: 'var(--radius-md)',
                  }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#f59e0b', marginBottom: '8px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <AlertCircle size={10} /> Needs Your Input
                    </div>
                    
                    {Array.isArray((agentStates[selectedAgent.id]?.output_data as any)?.discovery_questions) ? (
                      /* ─── DISCOVERY QUESTION WIZARD (3-Step) ─── */
                      (() => {
                        const discoveryQs = (agentStates[selectedAgent.id]!.output_data as any).discovery_questions;
                        const q = discoveryQs[agentWizardIndex];
                        if (!q) return null;

                        const choices = [...(q.choices || []), 'Other'];
                        const currentSel = agentSelectedChoices[agentWizardIndex] || [];
                        const otherVal = agentOtherInputs[agentWizardIndex] || '';

                        const handleWizardSubmit = async () => {
                          setAgentAnswerLoading(true);
                          try {
                            const finalAnswers = discoveryQs.map((item: any, idx: number) => {
                              const sel = agentSelectedChoices[idx] || [];
                              const oth = agentOtherInputs[idx]?.trim();
                              const list = [...sel.filter(c => c !== 'Other')];
                              if (sel.includes('Other') && oth) {
                                list.push(oth);
                              }
                              return {
                                question: item.question,
                                answer: list.join(', ') || 'No answer provided'
                              };
                            });

                            const data = await apiRequest('/api/agents/runs', {}, token!);
                            const executions = data.executions || [];
                            const matchingExec = executions.find((e: any) =>
                              findAgentIdForType(e.agent_type) === selectedTarget && e.status === 'awaiting_input');

                            if (matchingExec) {
                              await apiRequest(`/api/agents/runs/${matchingExec.id}/respond`, {
                                method: 'POST',
                                body: JSON.stringify({ answers: finalAnswers }),
                              }, token!);
                              
                              setAgentSelectedChoices([[], [], []]);
                              setAgentOtherInputs(['', '', '']);
                              setAgentWizardIndex(0);
                              setTimeout(loadAgentStates, 500);
                            }
                          } catch (err) {
                            console.error('[AgentWizard] Submit failed:', err);
                          } finally {
                            setAgentAnswerLoading(false);
                          }
                        };

                        const isStepValid = currentSel.length > 0 && (!currentSel.includes('Other') || otherVal.trim() !== '');

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px', lineHeight: 1.5 }}>
                              Question {agentWizardIndex + 1}: {q.question}
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                              {choices.map((choice, idx) => {
                                const isSelected = currentSel.includes(choice);
                                return (
                                  <div key={idx} style={{ display: 'flex', flexDirection: 'column' }}>
                                    <button
                                      onClick={() => {
                                        setAgentSelectedChoices(prev => {
                                          const nextSel = [...prev];
                                          const sel = nextSel[agentWizardIndex] || [];
                                          if (sel.includes(choice)) {
                                            nextSel[agentWizardIndex] = sel.filter(c => c !== choice);
                                          } else {
                                            nextSel[agentWizardIndex] = [...sel, choice];
                                          }
                                          return nextSel;
                                        });
                                      }}
                                      style={{
                                        padding: '10px 14px',
                                        borderRadius: 'var(--radius-md)',
                                        border: isSelected ? '1.5px solid var(--accent-primary)' : '1px solid var(--border-default)',
                                        background: isSelected ? 'rgba(99,102,241,0.12)' : 'var(--bg-secondary)',
                                        color: isSelected ? 'var(--accent-secondary)' : 'var(--text-primary)',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s ease',
                                        textAlign: 'left',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px'
                                      }}
                                    >
                                      <div style={{
                                        width: '16px',
                                        height: '16px',
                                        borderRadius: '3px',
                                        border: '2px solid ' + (isSelected ? 'var(--accent-primary)' : 'var(--text-muted)'),
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        background: isSelected ? 'var(--accent-primary)' : 'transparent',
                                        transition: 'all 0.15s ease'
                                      }}>
                                        {isSelected && <Check size={10} color="white" />}
                                      </div>
                                      <span style={{ fontSize: '13px', fontWeight: 500 }}>{choice}</span>
                                    </button>

                                    {choice === 'Other' && isSelected && (
                                      <input
                                        type="text"
                                        placeholder="Type your own answer..."
                                        value={otherVal}
                                        onChange={e => {
                                          setAgentOtherInputs(prev => {
                                            const nextVal = [...prev];
                                            nextVal[agentWizardIndex] = e.target.value;
                                            return nextVal;
                                          });
                                        }}
                                        className="input-field animate-fade-in"
                                        style={{
                                          marginTop: '6px',
                                          fontSize: '13px',
                                          padding: '8px 12px',
                                          width: '100%',
                                          background: 'var(--bg-secondary)',
                                          border: '1px solid var(--border-default)',
                                          borderRadius: 'var(--radius-md)',
                                          color: 'var(--text-primary)'
                                        }}
                                        autoFocus
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            {/* Wizard navigation buttons */}
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center' }}>
                              <button
                                onClick={() => {
                                  if (agentWizardIndex > 0) {
                                    setAgentWizardIndex(prev => prev - 1);
                                  }
                                }}
                                disabled={agentWizardIndex === 0 || agentAnswerLoading}
                                className="btn-ghost"
                                style={{ padding: '6px 12px', fontSize: '12px' }}
                              >
                                <ChevronLeft size={14} style={{ display: 'inline', marginRight: '2px' }} /> Previous
                              </button>

                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                {agentWizardIndex + 1} of {discoveryQs.length}
                              </span>

                              {agentWizardIndex < discoveryQs.length - 1 ? (
                                <button
                                  onClick={() => {
                                    if (isStepValid) {
                                      setAgentWizardIndex(prev => prev + 1);
                                    }
                                  }}
                                  disabled={!isStepValid || agentAnswerLoading}
                                  className="btn-primary"
                                  style={{ padding: '6px 12px', fontSize: '12px' }}
                                >
                                  Next →
                                </button>
                              ) : (
                                <button
                                  onClick={handleWizardSubmit}
                                  disabled={!isStepValid || agentAnswerLoading}
                                  className="btn-primary"
                                  style={{ padding: '6px 16px', fontSize: '12px', background: 'var(--accent-primary)' }}
                                >
                                  {agentAnswerLoading ? <Loader2 size={12} className="animate-spin" /> : 'Submit Answers'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      /* ─── STANDARD SINGLE QUESTION ─── */
                      <>
                        <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '12px', lineHeight: 1.5 }}>
                          {agentStates[selectedAgent.id]?.current_question}
                        </p>
                        
                        {agentStates[selectedAgent.id]?.current_question_choices && agentStates[selectedAgent.id]!.current_question_choices!.length > 0 ? (
                          <>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                              {agentStates[selectedAgent.id]!.current_question_choices!.map((choice, idx) => {
                                const sel = qMultiSelect.includes(choice);
                                return (
                                  <button
                                    key={idx}
                                    onClick={() => setQMultiSelect(prev => prev.includes(choice) ? prev.filter(c => c !== choice) : [...prev, choice])}
                                    disabled={agentAnswerLoading}
                                    style={{
                                      padding: '8px 14px',
                                      borderRadius: 'var(--radius-full)',
                                      border: sel ? '2px solid #f59e0b' : '1.5px solid rgba(245,158,11,0.25)',
                                      background: sel ? 'rgba(245,158,11,0.15)' : 'var(--bg-secondary)',
                                      color: sel ? '#f59e0b' : 'var(--text-primary)',
                                      fontSize: '13px',
                                      fontWeight: sel ? 600 : 400,
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease',
                                      display: 'flex', alignItems: 'center', gap: '7px',
                                    }}
                                  >
                                    <span style={{
                                      width: '15px', height: '15px', borderRadius: '4px', flexShrink: 0,
                                      border: '2px solid ' + (sel ? '#f59e0b' : 'var(--text-muted)'),
                                      background: sel ? '#f59e0b' : 'transparent',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                      {sel && <Check size={9} color="white" />}
                                    </span>
                                    {choice}
                                  </button>
                                );
                              })}

                              <button
                                onClick={() => setShowCustomInput(v => !v)}
                                disabled={agentAnswerLoading}
                                style={{
                                  padding: '8px 14px',
                                  borderRadius: 'var(--radius-full)',
                                  border: showCustomInput ? '2px solid #f59e0b' : '1.5px dashed rgba(245,158,11,0.3)',
                                  background: showCustomInput ? 'rgba(245,158,11,0.12)' : 'transparent',
                                  color: showCustomInput ? '#f59e0b' : 'var(--text-secondary)',
                                  fontSize: '13px',
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease',
                                  display: 'flex', alignItems: 'center', gap: '6px',
                                }}
                              >
                                <span>✏️</span> Other
                              </button>
                            </div>

                            {showCustomInput && (
                              <input
                                type="text"
                                value={agentAnswer}
                                onChange={(e) => setAgentAnswer(e.target.value)}
                                placeholder="Add your own answer (optional)…"
                                autoFocus
                                disabled={agentAnswerLoading}
                                style={{
                                  width: '100%', fontSize: '13px', padding: '8px 12px', marginBottom: '10px',
                                  background: 'var(--bg-secondary)', border: '1px solid rgba(245,158,11,0.3)',
                                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none',
                                }}
                              />
                            )}

                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <button
                                onClick={() => {
                                  const parts = [...qMultiSelect];
                                  if (showCustomInput && agentAnswer.trim()) parts.push(agentAnswer.trim());
                                  const ans = parts.join(', ');
                                  if (ans) { setQMultiSelect([]); handleRespondToAgentQuestion(ans); }
                                }}
                                disabled={agentAnswerLoading || (qMultiSelect.length === 0 && !(showCustomInput && agentAnswer.trim()))}
                                className="btn-primary"
                                style={{ padding: '8px 16px', fontSize: '12px' }}
                              >
                                {agentAnswerLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                Submit{qMultiSelect.length > 1 ? ` (${qMultiSelect.length})` : ''}
                              </button>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Select one or more, then Submit</span>
                            </div>
                          </>
                        ) : (
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                              type="text"
                              value={agentAnswer}
                              onChange={(e) => setAgentAnswer(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleRespondToAgentQuestion();
                                }
                              }}
                              placeholder="Type your answer..."
                              style={{
                                  flex: 1, fontSize: '13px', padding: '8px 12px',
                                  background: 'var(--bg-secondary)', border: '1px solid rgba(245,158,11,0.3)',
                                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                                  outline: 'none',
                              }}
                              disabled={agentAnswerLoading}
                            />
                            <button
                              onClick={() => handleRespondToAgentQuestion()}
                              disabled={!agentAnswer.trim() || agentAnswerLoading}
                              className="btn-primary"
                              style={{ padding: '8px 12px', fontSize: '12px' }}
                            >
                              {agentAnswerLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            </button>
                          </div>
                        )}

                        <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                            {agentStates[selectedAgent.id]?.current_question_choices?.length
                            ? 'You can pick multiple answers — and add your own via “Other”.'
                            : 'Type your answer and press Enter'}
                        </div>
                      </>
                    )}

                    {/* ─── ERROR or FAILED ALERT CARD ─── */}
                    {(agentStates[selectedAgent.id]?.status === 'failed' || agentStates[selectedAgent.id]?.status === 'error') && (
                      <div style={{
                        marginTop: '12px', padding: '16px',
                        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                        borderRadius: 'var(--radius-lg)',
                        animation: 'fade-in 0.3s ease',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <AlertCircle size={16} style={{ color: '#ef4444' }} />
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase' }}>
                            Execution Failed
                          </span>
                        </div>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '0 0 12px 0', lineHeight: 1.5 }}>
                          {agentStates[selectedAgent.id]?.error_message || 'An unexpected error occurred during execution. Please retry.'}
                        </p>
                        <button
                          onClick={() => handleLaunchAgent(selectedAgent.id)}
                          className="btn-primary"
                          style={{
                            padding: '6px 14px', fontSize: '11px', background: '#ef4444', borderColor: '#ef4444', color: '#fff',
                            display: 'flex', alignItems: 'center', gap: '4px'
                          }}
                        >
                          <RefreshCw size={11} />
                          Relaunch Agent
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ─── CUSTOM STYLES ─── */}
                <style>{`
                  @keyframes pulseGlow {
                    0% { transform: scale(0.95); opacity: 0.6; }
                    50% { transform: scale(1.2); opacity: 1; filter: drop-shadow(0 0 4px currentColor); }
                    100% { transform: scale(0.95); opacity: 0.6; }
                  }
                `}</style>

                {/* ─── LIVE AGENT EXECUTION LOGS ─── */}
                {selectedAgent && agentStates[selectedAgent.id] && (
                  (() => {
                    const state = agentStates[selectedAgent.id];
                    const logs = state?.output_data?.logs || [];
                    const isWorking = state.status === 'active' || state.status === 'running';
                    
                    if (logs.length === 0 && !isWorking) return null;

                    return (
                      <div style={{ marginTop: '10px' }}>
                        <button
                          onClick={() => setIsLogsExpanded(!isLogsExpanded)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '6px',
                            background: 'transparent', border: 'none', padding: '2px 0',
                            fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer',
                            fontWeight: 600, outline: 'none',
                          }}
                        >
                          <Activity size={12} className={isWorking ? "animate-pulse" : ""} style={{ color: isWorking ? selectedAgent.color : 'var(--text-muted)' }} />
                          {isWorking ? 'Live Thinking Logs' : 'Execution Logs'}
                          <span style={{
                            width: '6px', height: '6px', borderRadius: '50%',
                            background: isWorking ? selectedAgent.color : 'var(--text-muted)',
                            display: 'inline-block',
                            color: selectedAgent.color,
                            animation: isWorking ? 'pulseGlow 1.5s infinite' : 'none'
                          }} />
                          <ChevronDown size={11} style={{ transform: isLogsExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: 'var(--text-muted)' }} />
                        </button>

                        {isLogsExpanded && (
                          <div className="custom-scrollbar" style={{
                            marginTop: '6px', padding: '10px 12px',
                            background: '#0a0a0f', border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: 'var(--radius-md)', fontFamily: 'monospace',
                            fontSize: '10.5px', color: '#a5b4fc', maxHeight: '180px',
                            overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px',
                            boxSizing: 'border-box',
                            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)',
                            lineHeight: 1.4,
                          }}>
                            {logs.map((log: string, idx: number) => (
                              <div key={idx} style={{
                                color: log.includes('✅') ? '#34d399' : log.includes('⚠️') ? '#fca5a5' : log.includes('🔍') ? '#60a5fa' : '#a5b4fc',
                                display: 'flex', gap: '4px',
                              }}>
                                <span style={{ opacity: 0.4 }}>{(idx + 1).toString().padStart(2, '0')}</span>
                                <span>{log}</span>
                              </div>
                            ))}
                            {isWorking && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: selectedAgent.color, marginTop: '2px' }}>
                                <Loader2 size={10} className="animate-spin" />
                                <span style={{ fontStyle: 'italic', opacity: 0.8 }}>Agent is thinking...</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()
                )}
              </div>

              {/* Launch button (when idle) */}
              {agentStates[selectedAgent.id]?.status === 'idle' && (
                <button onClick={() => handleLaunchAgent(selectedAgent.id)}
                  className="btn-primary" style={{ fontSize: '10px', padding: '6px 12px', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  <Zap size={11} /> Launch
                </button>
              )}
              {(agentStates[selectedAgent.id]?.status === 'awaiting_approval') && (
                <span style={{
                  display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
                  padding: '4px 10px', borderRadius: 'var(--radius-full)',
                  background: 'rgba(16,185,129,0.12)', color: '#34d399', fontSize: '10px', fontWeight: 700,
                }}>
                  <ThumbsUp size={11} /> Ready
                </span>
              )}
            </div>
          </div>
        )}

        {/* ─── WORKSPACE TAB CONTENT (capability / deliverables) ─── */}

        {/* ─── MESSAGES AREA (Chat tab only) ─── */}
        {(isBrainSelected || workspaceTab === 'chat') && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', background: 'var(--bg-primary)' }}>
          {messages.length === 0 && isBrainSelected ? (
            /* ─── BRAIN EMPTY STATE ─── */
            <div className="animate-fade-in" style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '100%', textAlign: 'center', padding: '40px',
            }}>
              <div className="animate-float" style={{
                width: '80px', height: '80px', borderRadius: 'var(--radius-xl)',
                background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: '24px', boxShadow: '0 0 50px rgba(99,102,241,0.3)',
              }}>
                <Brain size={40} color="white" />
              </div>
              <h2 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '8px', letterSpacing: '-0.02em' }}>
                Ask The Brain anything
              </h2>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '32px', maxWidth: '450px' }}>
                The Brain searches across your agents, documents, and integrations
                to answer anything about your business.
              </p>

              {/* Agent mini-chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', marginBottom: '28px', maxWidth: '420px' }}>
                {agents.slice(0, 11).map(agent => (
                  <button key={agent.id} onClick={() => handleSelectTarget(agent.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '4px 10px', background: `${agent.color}10`,
                      border: `1px solid ${agent.color}20`,
                      borderRadius: 'var(--radius-full)', fontSize: '11px',
                      color: agent.color, cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${agent.color}25`; }}
                    onMouseLeave={e => { e.currentTarget.style.background = `${agent.color}10`; }}>
                    <span style={{ fontSize: '12px' }}>{agent.emoji}</span>
                    {agent.name.replace(' Agent', '')}
                  </button>
                ))}
              </div>

              {/* Starters */}
              {startersLoading ? (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                  <Loader2 size={12} className="animate-spin" /> Thinking...
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', maxWidth: '500px' }}>
                  {starters.map((q) => (
                    <button key={q} onClick={() => handleSend(q)}
                      style={{
                        padding: '8px 14px', background: 'var(--bg-tertiary)',
                        border: '1px solid var(--border-default)', borderRadius: 'var(--radius-full)',
                        color: 'var(--text-secondary)', fontSize: '12px', cursor: 'pointer',
                        transition: 'all 0.2s ease', display: 'flex', alignItems: 'center', gap: '6px',
                      }}
                      className="hover-border-primary">
                      <Lightbulb size={12} style={{ color: 'var(--accent-primary)' }} />
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : messages.length === 0 && selectedAgent ? (
            /* ─── AGENT EMPTY STATE (no history yet) ─── */
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', height: '100%', textAlign: 'center', padding: '20px',
            }}>
              {agentStates[selectedAgent.id]?.status === 'idle' ? (
                <>
                  <Bot size={32} style={{ opacity: 0.2, marginBottom: '12px', color: 'var(--text-muted)' }} />
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    No conversation history yet.
                  </p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    Launch the agent or type a message below to get started.
                  </p>
                </>
              ) : (
                <>
                  <Loader2 size={20} className="animate-spin" style={{ marginBottom: '12px', color: selectedAgent.color }} />
                  <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    Agent is working... conversation will appear here.
                  </p>
                </>
              )}
            </div>
          ) : (
            /* ─── CHAT MESSAGES ─── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '800px', margin: '0 auto', width: '100%' }}>
              {messages.map((msg) => (
                <div key={msg.id} className="animate-slide-up" style={{
                  display: 'flex', gap: '12px',
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                }}>
                  <div style={{
                    width: '32px', height: '32px', flexShrink: 0, borderRadius: 'var(--radius-full)',
                    background: msg.role === 'user'
                      ? 'var(--bg-tertiary)'
                      : msg.agentId
                        ? `${agents.find(a => a.id === msg.agentId)?.color || '#6366f1'}20`
                        : 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
                    border: msg.role === 'user' ? '1px solid var(--border-default)' : 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: msg.role === 'user' ? 'var(--text-secondary)' : 'white',
                    fontSize: '14px',
                  }}>
                    {msg.role === 'user'
                      ? <User size={14} />
                      : msg.agentId
                        ? agents.find(a => a.id === msg.agentId)?.emoji || <Bot size={14} />
                        : <Sparkles size={14} />}
                  </div>

                  <div style={{
                    maxWidth: '85%',
                    background: msg.role === 'user' ? 'var(--bg-tertiary)' : 'transparent',
                    border: msg.role === 'user' ? '1px solid var(--border-default)' : 'none',
                    padding: msg.role === 'user' ? '10px 14px' : '6px 0',
                    borderRadius: 'var(--radius-lg)',
                    borderTopRightRadius: msg.role === 'user' ? '4px' : 'var(--radius-lg)',
                    borderTopLeftRadius: msg.role === 'assistant' ? '4px' : 'var(--radius-lg)',
                  }}>
                    {/* Agent name header */}
                    {msg.agentName && msg.role === 'assistant' && (
                      <div style={{ fontSize: '11px', fontWeight: 700, color: agents.find(a => a.id === msg.agentId)?.color || 'var(--accent-primary)', marginBottom: '4px' }}>
                        {msg.agentName}
                      </div>
                    )}

                    {msg.loading ? (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', height: '20px' }}>
                        <div className="typing-dot" style={{ animationDelay: '0s' }} />
                        <div className="typing-dot" style={{ animationDelay: '0.2s' }} />
                        <div className="typing-dot" style={{ animationDelay: '0.4s' }} />
                      </div>
                    ) : (
                      <>
                        <div className="prose" style={{ fontSize: '14px', lineHeight: 1.7, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                          {msg.role === 'assistant' ? renderMessageBody(msg.content) : msg.content}
                        </div>

                        {/* Sources */}
                        {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                          <div style={{ marginTop: '12px' }}>
                            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                              Sources
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {msg.sources.map((source, idx) => (
                                <button key={idx}
                                  onClick={() => { if (source.id) { setSelectedDocId(source.id); setIsSourceOpen(true); }}}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                    padding: '3px 8px', background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-full)',
                                    fontSize: '11px', color: 'var(--text-secondary)', cursor: source.id ? 'pointer' : 'default',
                                    transition: 'all 0.15s ease',
                                  }}>
                                  {sourceIconMap(source.source_type)}
                                  <span style={{ maxWidth: '120px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {source.title}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* ─── INTERACTIVE QUESTION CHOICES (inline in chat) ─── */}
                        {msg.questionData && msg.questionData.choices && msg.questionData.choices.length > 0 && pendingQuestion && pendingQuestion.question === msg.questionData.question && (
                          <div style={{ marginTop: '12px' }}>
                            <div style={{ fontSize: '10px', fontWeight: 700, color: '#f59e0b', marginBottom: '8px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <AlertCircle size={10} /> Choose one or more
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                              {msg.questionData.choices.map((choice, idx) => {
                                const sel = inlineSelected.includes(choice);
                                return (
                                  <button
                                    key={idx}
                                    onClick={() => setInlineSelected(prev => prev.includes(choice) ? prev.filter(c => c !== choice) : [...prev, choice])}
                                    disabled={questionAnswerLoading}
                                    style={{
                                      padding: '8px 14px',
                                      borderRadius: 'var(--radius-full)',
                                      border: sel ? '2px solid #f59e0b' : '1.5px solid rgba(245,158,11,0.25)',
                                      background: sel ? 'rgba(245,158,11,0.15)' : 'var(--bg-secondary)',
                                      color: sel ? '#f59e0b' : 'var(--text-primary)',
                                      fontSize: '13px',
                                      fontWeight: sel ? 600 : 400,
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease',
                                      display: 'flex', alignItems: 'center', gap: '7px',
                                    }}
                                  >
                                    <span style={{
                                      width: '15px', height: '15px', borderRadius: '4px', flexShrink: 0,
                                      border: '2px solid ' + (sel ? '#f59e0b' : 'var(--text-muted)'),
                                      background: sel ? '#f59e0b' : 'transparent',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                      {sel && <Check size={9} color="white" />}
                                    </span>
                                    {choice}
                                  </button>
                                );
                              })}
                            </div>
                            {/* Optional custom answer + submit */}
                            {pendingQuestion && pendingQuestion.question === msg.questionData.question && (
                              <>
                                <input
                                  type="text"
                                  value={questionAnswer}
                                  onChange={(e) => setQuestionAnswer(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                      e.preventDefault();
                                      handleInlineMultiSubmit();
                                    }
                                  }}
                                  placeholder="Add your own answer (optional)…"
                                  style={{
                                    width: '100%', fontSize: '13px', padding: '8px 12px', marginBottom: '10px',
                                    background: 'var(--bg-secondary)', border: '1px solid rgba(245,158,11,0.3)',
                                    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none',
                                  }}
                                  disabled={questionAnswerLoading}
                                />
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <button
                                    onClick={handleInlineMultiSubmit}
                                    disabled={questionAnswerLoading || (inlineSelected.length === 0 && !questionAnswer.trim())}
                                    className="btn-primary"
                                    style={{ padding: '8px 16px', fontSize: '12px' }}
                                  >
                                    {questionAnswerLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                    Submit{inlineSelected.length > 1 ? ` (${inlineSelected.length})` : ''}
                                  </button>
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Pick any that apply, then Submit</span>
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {/* Actions */}
                        {msg.role === 'assistant' && msg.content && !msg.questionData && (
                          <div style={{ display: 'flex', gap: '6px', marginTop: '10px', alignItems: 'center' }}>
                            <button onClick={() => { navigator.clipboard.writeText(msg.content); setCopiedId(msg.id); setTimeout(() => setCopiedId(null), 2000); }}
                              className="btn-ghost" style={{ padding: '3px 8px', fontSize: '11px' }}>
                              {copiedId === msg.id ? <Check size={12} color="#34d399" /> : <Copy size={12} />}
                              {copiedId === msg.id ? 'Copied' : 'Copy'}
                            </button>

                            {/* v3 §7.3: Feedback Signal Collection */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginLeft: '8px', borderLeft: '1px solid var(--border-subtle)', paddingLeft: '10px', width: '100%' }}>
                              <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
                                <button
                                  onClick={async () => {
                                    if (feedbackSent[msg.id]) return;
                                    try {
                                      await apiRequest('/api/feedback', {
                                        method: 'POST',
                                        body: JSON.stringify({
                                          message_id: msg.id,
                                          session_id: activeSessionId,
                                          rating: 'up',
                                          agent_name: msg.agentName || 'brain',
                                          task_type: msg.agentName ? 'agent_task' : 'brain_query',
                                        }),
                                      });
                                      setFeedbackSent(prev => ({ ...prev, [msg.id]: 'up' }));
                                      setShowCorrectionInput(prev => ({ ...prev, [msg.id]: false }));
                                    } catch (e) { console.warn('Feedback failed:', e); }
                                  }}
                                  className="btn-ghost"
                                  title="Good response"
                                  style={{
                                    padding: '3px 6px',
                                    fontSize: '11px',
                                    opacity: feedbackSent[msg.id] === 'down' ? 0.3 : 1,
                                    color: feedbackSent[msg.id] === 'up' ? '#34d399' : undefined,
                                    cursor: feedbackSent[msg.id] ? 'default' : 'pointer',
                                  }}
                                  disabled={!!feedbackSent[msg.id]}
                                >
                                  <ThumbsUp size={12} />
                                </button>
                                <button
                                  onClick={() => {
                                    if (feedbackSent[msg.id]) return;
                                    setShowCorrectionInput(prev => ({ ...prev, [msg.id]: !prev[msg.id] }));
                                  }}
                                  className="btn-ghost"
                                  title="Poor response"
                                  style={{
                                    padding: '3px 6px',
                                    fontSize: '11px',
                                    opacity: feedbackSent[msg.id] === 'up' ? 0.3 : 1,
                                    color: feedbackSent[msg.id] === 'down' ? '#ef4444' : (showCorrectionInput[msg.id] ? '#ef4444' : undefined),
                                    cursor: feedbackSent[msg.id] ? 'default' : 'pointer',
                                  }}
                                  disabled={!!feedbackSent[msg.id]}
                                >
                                  <ThumbsDown size={12} />
                                </button>
                                {feedbackSent[msg.id] && (
                                  <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginLeft: '4px', alignSelf: 'center' }}>
                                    {feedbackSent[msg.id] === 'up' ? 'Thanks!' : 'Noted'}
                                  </span>
                                )}
                              </div>

                              {/* v3 §7.3: Correction Input Box (Self-Learning Loop) */}
                              {showCorrectionInput[msg.id] && (
                                <div style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '8px',
                                  background: 'rgba(239, 68, 68, 0.03)',
                                  border: '1px solid rgba(239, 68, 68, 0.15)',
                                  borderRadius: 'var(--radius-md)',
                                  padding: '10px 14px',
                                  width: '100%',
                                  maxWidth: '420px',
                                  marginTop: '8px',
                                }}>
                                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                    Help us improve: What should have been different?
                                  </div>
                                  <textarea
                                    value={correctionTexts[msg.id] || ''}
                                    onChange={(e) => setCorrectionTexts(prev => ({ ...prev, [msg.id]: e.target.value }))}
                                    placeholder="Provide the correct context, details, or direct feedback..."
                                    style={{
                                      width: '100%',
                                      minHeight: '60px',
                                      fontSize: '12px',
                                      padding: '8px 10px',
                                      background: 'var(--bg-tertiary)',
                                      border: '1px solid var(--border-default)',
                                      borderRadius: 'var(--radius-sm)',
                                      color: 'var(--text-primary)',
                                      outline: 'none',
                                      resize: 'vertical',
                                      lineHeight: 1.4,
                                    }}
                                  />
                                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                                    <button
                                      onClick={() => {
                                        setShowCorrectionInput(prev => ({ ...prev, [msg.id]: false }));
                                      }}
                                      className="btn-ghost"
                                      style={{ padding: '3px 8px', fontSize: '11px' }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={async () => {
                                        try {
                                          await apiRequest('/api/feedback', {
                                            method: 'POST',
                                            body: JSON.stringify({
                                              message_id: msg.id,
                                              session_id: activeSessionId,
                                              rating: 'down',
                                              agent_name: msg.agentName || 'brain',
                                              task_type: msg.agentName ? 'agent_task' : 'brain_query',
                                              correction_text: correctionTexts[msg.id] || '',
                                            }),
                                          });
                                          setFeedbackSent(prev => ({ ...prev, [msg.id]: 'down' }));
                                          setShowCorrectionInput(prev => ({ ...prev, [msg.id]: false }));
                                        } catch (e) {
                                          console.warn('Feedback failed:', e);
                                        }
                                      }}
                                      className="btn-primary"
                                      style={{
                                        padding: '3px 10px',
                                        fontSize: '11px',
                                        background: '#ef4444',
                                        borderColor: '#ef4444',
                                        color: '#ffffff',
                                      }}
                                    >
                                      Submit Feedback
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
        )}

        {/* ─── INPUT AREA (Chat tab only) ─── */}
        {(isBrainSelected || workspaceTab === 'chat') && (
        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
          <div style={{ maxWidth: '800px', margin: '0 auto', position: 'relative' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (isBrainSelected) handleSend();
                  else if (selectedAgent) handleAgentSend();
                }
              }}
              placeholder={
                isBrainSelected
                  ? "Ask The Brain anything..."
                  : `Ask ${selectedAgent?.name || 'agent'} anything...`
              }
              style={{
                width: '100%', background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)',
                padding: '14px 56px 14px 20px', fontSize: '14px',
                color: 'var(--text-primary)', resize: 'none', height: '56px',
                outline: 'none', transition: 'border-color 0.2s', lineHeight: '1.5',
              }}
              onFocus={(e) => e.target.style.borderColor = isBrainSelected ? 'var(--accent-primary)' : (selectedAgent?.color || 'var(--accent-primary)')}
              onBlur={(e) => e.target.style.borderColor = 'var(--border-default)'}
              disabled={loading}
            />
            <button
              onClick={() => { if (isBrainSelected) handleSend(); else if (selectedAgent) handleAgentSend(); }}
              disabled={!input.trim() || loading}
              style={{
                position: 'absolute', right: '10px', bottom: '10px',
                width: '36px', height: '36px', borderRadius: 'var(--radius-md)',
                background: input.trim() && !loading
                  ? (isBrainSelected ? 'var(--accent-primary)' : (selectedAgent?.color || 'var(--accent-primary)'))
                  : 'var(--bg-elevated)',
                color: input.trim() && !loading ? 'white' : 'var(--text-muted)',
                border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                transition: 'all 0.2s',
              }}
            >
              <Send size={15} />
            </button>
          </div>
          <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
            {isBrainSelected
              ? 'The Brain delegates tasks to agents automatically'
              : `Chat directly with ${selectedAgent?.name || 'agent'} — ask anything about ${selectedAgent?.role || 'their domain'}`}
          </div>
        </div>
        )}
        </div>{/* close left conversation column */}

        {/* Right: dedicated deliverable review panel (shown when a deliverable awaits review) */}
      </div>

      <SourceViewer documentId={selectedDocId} isOpen={isSourceOpen} onClose={() => setIsSourceOpen(false)} token={token} />

      {/* Full-screen live preview of a web_artifact */}
      {fullPreviewHtml !== null && (
        <div
          onClick={() => setFullPreviewHtml(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)', display: 'flex', flexDirection: 'column', padding: '24px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
            <button onClick={() => setFullPreviewHtml(null)} className="btn-ghost" style={{ fontSize: '12px', padding: '6px 12px', color: 'white' }}>
              <X size={14} /> Close preview
            </button>
          </div>
          <iframe
            onClick={(e) => e.stopPropagation()}
            srcDoc={fullPreviewHtml}
            sandbox="allow-scripts allow-popups"
            title="Full preview"
            style={{ flex: 1, width: '100%', border: 'none', borderRadius: 'var(--radius-md)', background: 'white' }}
          />
        </div>
      )}

      {isExportOpen && token && (
        <ExportDialog
          isOpen={isExportOpen}
          onClose={() => setIsExportOpen(false)}
          title={exportTitle}
          content={exportContent}
          token={token}
        />
      )}

      {/* ─── ANIMATION STYLES ─── */}
      <style>{`
        @keyframes pulse-ring {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.15); opacity: 0.2; }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out forwards;
        }
        .typing-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--text-muted);
          animation: typing-pulse 1.4s ease-in-out infinite;
        }
        @keyframes typing-pulse {
          0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
          30% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
