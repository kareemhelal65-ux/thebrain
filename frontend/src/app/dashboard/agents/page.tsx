'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../layout';
import { apiRequest } from '@/lib/api';
import {
  Bot, Plus, Download, Sparkles, Send, User, Loader2, Wrench, ChevronRight,
  Check, MessageSquare, Calendar
} from 'lucide-react';

interface AgentTemplate {
  id: string;
  name: string;
  role: string;
  system_prompt: string;
  tools: string[];
}

interface InstalledAgent {
  id: string;
  name: string;
  role: string;
  system_prompt: string;
  tools: string[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  loading?: boolean;
}

export default function AgentsPage() {
  const { token } = useAuth();
  
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [installedAgents, setInstalledAgents] = useState<InstalledAgent[]>([]);
  
  const [activeTab, setActiveTab] = useState<'templates' | 'my_agents'>('my_agents');
  const [selectedAgent, setSelectedAgent] = useState<InstalledAgent | AgentTemplate | null>(null);
  
  const [showBuilder, setShowBuilder] = useState(false);
  const [availableTools, setAvailableTools] = useState<any[]>([]);
  
  // Builder Form State
  const [builderName, setBuilderName] = useState('');
  const [builderRole, setBuilderRole] = useState('');
  const [builderPrompt, setBuilderPrompt] = useState('');
  const [builderTools, setBuilderTools] = useState<string[]>([]);
  
  // Agent Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (token) {
      loadData();
    }
  }, [token]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadData = async () => {
    // Load each independently so one failure doesn't block the others
    try {
      const tplRes = await apiRequest('/api/orchestrator/agents/templates', {}, token!);
      setTemplates(tplRes.templates || []);
    } catch (err) {
      console.error('Failed to load templates', err);
    }

    try {
      const agtRes = await apiRequest('/api/orchestrator/agents', {}, token!);
      setInstalledAgents(agtRes.agents || []);
    } catch (err) {
      console.error('Failed to load installed agents', err);
    }

    try {
      const toolsRes = await apiRequest('/api/orchestrator/tools', {}, token!);
      setAvailableTools(toolsRes.tools || []);
    } catch (err) {
      console.error('Failed to load tools', err);
    }
  };

  const handleInstallTemplate = async (template: AgentTemplate) => {
    try {
      const res = await apiRequest('/api/orchestrator/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: template.name,
          role: template.role,
          system_prompt: template.system_prompt,
          tools: template.tools
        })
      }, token!);
      
      setInstalledAgents([res.agent, ...installedAgents]);
      setActiveTab('my_agents');
      setSelectedAgent(res.agent);
      setMessages([]);
    } catch (err) {
      console.error('Install failed', err);
    }
  };

  const handleBuildAgent = async () => {
    try {
      const res = await apiRequest('/api/orchestrator/agents', {
        method: 'POST',
        body: JSON.stringify({
          name: builderName,
          role: builderRole,
          system_prompt: builderPrompt,
          tools: builderTools
        })
      }, token!);
      
      setInstalledAgents([res.agent, ...installedAgents]);
      setShowBuilder(false);
      setActiveTab('my_agents');
      setSelectedAgent(res.agent);
      setMessages([]);
    } catch (err) {
      console.error('Build failed', err);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isChatLoading || !selectedAgent) return;
    
    const text = input.trim();
    setInput('');
    
    const userMsg: Message = { id: `user-${Date.now()}`, role: 'user', content: text };
    const assistantMsg: Message = { id: `assistant-${Date.now()}`, role: 'assistant', content: '', loading: true };
    
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsChatLoading(true);

    try {
      // In a real app, you would pass the agentId to the orchestrator so it uses the specific agent's prompt and tools.
      // For this demo, we'll prefix the message to simulate the agent persona.
      const simulatedPrompt = `[DIRECTIVE: You are strictly acting as the following agent. Name: ${selectedAgent.name}, Role: ${selectedAgent.role}, System Prompt: ${(selectedAgent as any).system_prompt}. Respond to the user's task as this agent.]\n\nTask: ${text}`;
      
      const res = await apiRequest('/api/brain/query', {
        method: 'POST',
        body: JSON.stringify({ question: simulatedPrompt })
      }, token!);

      setMessages(prev => prev.map(msg => 
        msg.id === assistantMsg.id ? { ...msg, content: res.answer, loading: false } : msg
      ));
    } catch (err: any) {
      setMessages(prev => prev.map(msg => 
        msg.id === assistantMsg.id ? { ...msg, content: `Error: ${err.message}`, loading: false } : msg
      ));
    } finally {
      setIsChatLoading(false);
    }
  };

  const toggleTool = (toolName: string) => {
    setBuilderTools(prev => 
      prev.includes(toolName) ? prev.filter(t => t !== toolName) : [...prev, toolName]
    );
  };

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-primary)' }}>
      {/* LEFT SIDEBAR: AGENT HUB */}
      <div style={{
        width: '280px',
        borderRight: '1px solid var(--border-subtle)',
        background: 'var(--bg-tertiary)',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <div style={{ padding: '20px', borderBottom: '1px solid var(--border-subtle)' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bot size={20} color="var(--accent-primary)" />
            Agent Hub
          </h2>
          <button 
            onClick={() => { setShowBuilder(true); setSelectedAgent(null); }}
            className="btn-primary" 
            style={{ width: '100%', marginTop: '16px', display: 'flex', justifyContent: 'center', gap: '8px' }}
          >
            <Plus size={16} /> Build Agent
          </button>
        </div>

        <div style={{ padding: '16px', flex: 1, overflowY: 'auto' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              onClick={() => setActiveTab('my_agents')}
              style={{
                flex: 1, padding: '6px', fontSize: '12px', fontWeight: 600,
                background: activeTab === 'my_agents' ? 'var(--bg-secondary)' : 'transparent',
                color: activeTab === 'my_agents' ? 'var(--text-primary)' : 'var(--text-muted)',
                border: '1px solid',
                borderColor: activeTab === 'my_agents' ? 'var(--border-default)' : 'transparent',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer'
              }}
            >
              My Agents
            </button>
            <button
              onClick={() => setActiveTab('templates')}
              style={{
                flex: 1, padding: '6px', fontSize: '12px', fontWeight: 600,
                background: activeTab === 'templates' ? 'var(--bg-secondary)' : 'transparent',
                color: activeTab === 'templates' ? 'var(--text-primary)' : 'var(--text-muted)',
                border: '1px solid',
                borderColor: activeTab === 'templates' ? 'var(--border-default)' : 'transparent',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer'
              }}
            >
              Templates
            </button>
          </div>

          {/* List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(activeTab === 'my_agents' ? installedAgents : templates).map((agent: any) => (
              <button
                key={agent.id}
                onClick={() => {
                  setSelectedAgent(agent);
                  setShowBuilder(false);
                  if (activeTab === 'my_agents') setMessages([]);
                }}
                style={{
                  display: 'flex', alignItems: 'center', padding: '12px',
                  background: selectedAgent?.id === agent.id ? 'var(--bg-secondary)' : 'transparent',
                  border: '1px solid',
                  borderColor: selectedAgent?.id === agent.id ? 'var(--border-default)' : 'transparent',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s',
                }}
                className="hover-bg-secondary"
              >
                <div style={{
                  width: '32px', height: '32px', borderRadius: 'var(--radius-md)',
                  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: '12px'
                }}>
                  <Bot size={16} color="white" />
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {agent.name}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{agent.role}</div>
                </div>
              </button>
            ))}
            
            {activeTab === 'my_agents' && installedAgents.length === 0 && (
              <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                No agents installed. Try installing a template.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT AREA: DETAILS / BUILDER / TASK INTERFACE */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {showBuilder ? (
          /* BUILDER VIEW */
          <div style={{ padding: '40px', maxWidth: '600px', margin: '0 auto', width: '100%', overflowY: 'auto' }}>
            <h1 style={{ fontSize: '24px', fontWeight: 800, marginBottom: '8px' }}>Create Custom Agent</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>
              Give your agent a specialized role and equip them with tools to automate your workflows.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Agent Name</label>
                <input 
                  value={builderName} onChange={e => setBuilderName(e.target.value)}
                  placeholder="e.g. Code Reviewer" className="input-field" 
                />
              </div>
              
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Role / Department</label>
                <input 
                  value={builderRole} onChange={e => setBuilderRole(e.target.value)}
                  placeholder="e.g. Engineering" className="input-field" 
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>System Prompt</label>
                <textarea 
                  value={builderPrompt} onChange={e => setBuilderPrompt(e.target.value)}
                  placeholder="You are a strict code reviewer. You analyze pull requests..."
                  className="input-field" style={{ minHeight: '100px', resize: 'vertical' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>Tool Access</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid var(--border-subtle)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
                  {availableTools.map(tool => (
                    <label key={tool.name} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={builderTools.includes(tool.name)}
                        onChange={() => toggleTool(tool.name)}
                        style={{ marginTop: '4px' }}
                      />
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{tool.name}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{tool.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: '16px' }}>
                <button onClick={handleBuildAgent} className="btn-primary" disabled={!builderName || !builderPrompt}>
                  Create Agent
                </button>
              </div>
            </div>
          </div>
        ) : selectedAgent && activeTab === 'templates' ? (
          /* TEMPLATE PREVIEW */
          <div style={{ padding: '40px', maxWidth: '600px', margin: '0 auto', width: '100%' }}>
            <div style={{
              width: '64px', height: '64px', borderRadius: 'var(--radius-xl)',
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px'
            }}>
              <Bot size={32} color="white" />
            </div>
            <h1 style={{ fontSize: '32px', fontWeight: 800, marginBottom: '8px' }}>{selectedAgent.name}</h1>
            <div style={{ display: 'inline-block', background: 'var(--bg-secondary)', padding: '4px 12px', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '24px' }}>
              {selectedAgent.role}
            </div>

            <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '24px', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '8px' }}>System Prompt</h3>
              <p style={{ fontSize: '14px', lineHeight: 1.6, color: 'var(--text-primary)' }}>{(selectedAgent as any).system_prompt}</p>
            </div>

            <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: '24px', marginBottom: '32px' }}>
              <h3 style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '12px' }}>Capabilities (Tools)</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {selectedAgent.tools.map(t => (
                  <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-primary)', border: '1px solid var(--border-default)', padding: '6px 12px', borderRadius: 'var(--radius-full)', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    <Wrench size={12} /> {t}
                  </div>
                ))}
              </div>
            </div>

            <button onClick={() => handleInstallTemplate(selectedAgent as AgentTemplate)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 24px', fontSize: '15px' }}>
              <Download size={18} /> Install Agent
            </button>
          </div>
        ) : selectedAgent && activeTab === 'my_agents' ? (
          /* AGENT DASHBOARD WINDOW */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', overflowY: 'auto' }}>
            {/* Header Banner */}
            <div style={{ 
              padding: '40px', background: 'linear-gradient(135deg, rgba(99,102,241,0.1), rgba(6,182,212,0.1))',
              borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'flex-start', gap: '24px'
            }}>
               <div style={{
                  width: '64px', height: '64px', borderRadius: 'var(--radius-xl)',
                  background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  boxShadow: '0 8px 16px rgba(99,102,241,0.2)'
                }}>
                  <Bot size={32} color="white" />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <h2 style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{selectedAgent.name}</h2>
                    <span style={{ padding: '4px 10px', background: 'rgba(34,197,94,0.1)', color: 'var(--success)', borderRadius: 'var(--radius-full)', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--success)' }} />
                      Online
                    </span>
                  </div>
                  <p style={{ fontSize: '15px', color: 'var(--text-secondary)', fontWeight: 500, marginBottom: '16px' }}>{selectedAgent.role}</p>
                  
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {selectedAgent.tools.map(t => (
                      <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--bg-secondary)', border: '1px solid var(--border-default)', padding: '4px 8px', borderRadius: 'var(--radius-sm)', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>
                        <Wrench size={10} /> {t}
                      </div>
                    ))}
                  </div>
                </div>
            </div>

            {/* Dashboard Content */}
            <div style={{ padding: '40px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
              
              {/* Currently Working On */}
              <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.02)' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Loader2 size={16} className="spin" color="var(--accent-primary)" />
                    Active Tasks
                  </h3>
                </div>
                <div style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Mock Active Task 1 */}
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-primary)', marginTop: '6px' }} />
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Monitoring #general for Announcements</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Listening via Slack Integration</div>
                      </div>
                    </div>
                    {/* Mock Active Task 2 */}
                    {selectedAgent.tools.includes('google_drive_read') && (
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-cyan)', marginTop: '6px' }} />
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>Scanning new Drive uploads</div>
                          <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Background synchronization active</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Today's Automations */}
              <div style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.02)' }}>
                  <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Check size={16} color="var(--success)" />
                    Completed Today
                  </h3>
                </div>
                <div style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ padding: '6px', background: 'rgba(34,197,94,0.1)', borderRadius: 'var(--radius-sm)' }}>
                          <MessageSquare size={14} color="var(--success)" />
                        </div>
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Drafted Q3 Summary Email</div>
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Sent via Slack</div>
                        </div>
                      </div>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>9:41 AM</span>
                    </div>

                    {selectedAgent.tools.includes('google_calendar_create') && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{ padding: '6px', background: 'rgba(99,102,241,0.1)', borderRadius: 'var(--radius-sm)' }}>
                            <Calendar size={14} color="var(--accent-primary)" />
                          </div>
                          <div>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>Scheduled Sync Meeting</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Google Calendar</div>
                          </div>
                        </div>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>11:30 AM</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>
          </div>
        ) : (
          /* EMPTY STATE */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <Bot size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
            <p style={{ fontSize: '15px' }}>Select an agent or build a new one to get started.</p>
          </div>
        )}

      </div>
    </div>
  );
}
