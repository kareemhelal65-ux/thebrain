'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../layout';
import AgentQuickActions from '../_components/AgentQuickActions';
import { apiRequest } from '@/lib/api';
import { useRouter } from 'next/navigation';
import {
  Map, Target, Rocket, TrendingUp,
  CheckCircle2, Clock, BarChart3, Lightbulb,
  ChevronRight, ChevronDown, Loader2, Brain,
  Flag, Award, Zap, RefreshCw, ExternalLink,
  UserCheck, CheckSquare, Square, Bot, Sparkles,
} from 'lucide-react';

// Map icon string names from backend to lucide-react components
const ICON_MAP: Record<string, any> = {
  Lightbulb, Rocket, BarChart3, TrendingUp, Award, Flag, Map, Target, CheckCircle2, Clock, Brain, Zap,
};

function resolveIcon(icon: any): any {
  if (typeof icon === 'string') return ICON_MAP[icon] || Map;
  return icon || Map;
}

interface RoadmapPhase {
  id: string;
  label: string;
  icon: any;
  color: string;
  description: string;
  estimated_valuation: string;
  timeline: string;
  objectives: RoadmapItem[];
  completed: boolean;
  active: boolean;
  locked: boolean;
  evaluation_notes?: string | null;
}

interface RoadmapItem {
  id: string;
  label: string;
  type: 'objective' | 'sub_objective' | 'task' | 'sub_task';
  status: 'complete' | 'in_progress' | 'pending';
  children?: RoadmapItem[];
  agent_source?: string | null;
  auto_checkable?: boolean;
  user_must_do?: boolean;
}

const ROADMAP_PHASES: RoadmapPhase[] = [
  {
    id: 'pre-seed',
    label: 'Pre-Seed',
    icon: Lightbulb,
    color: '#8b5cf6',
    description: 'Validate the concept, build your MVP, and secure initial funding from angels or friends & family.',
    estimated_valuation: '$1M – $5M',
    timeline: '0 – 6 months',
    completed: false,
    active: true,
    locked: false,
    objectives: [
      {
        id: 'ps-1', label: 'Problem Validation', type: 'objective', status: 'in_progress',
        children: [
          { id: 'ps-1a', label: 'Conduct 20+ customer discovery interviews', type: 'sub_objective', status: 'in_progress',
            children: [
              { id: 'ps-1a-1', label: 'Identify target customer segments', type: 'sub_task', status: 'complete' },
              { id: 'ps-1a-2', label: 'Prepare interview script and questions', type: 'sub_task', status: 'complete' },
              { id: 'ps-1a-3', label: 'Schedule and conduct first 10 interviews', type: 'sub_task', status: 'in_progress' },
              { id: 'ps-1a-4', label: 'Synthesize interview findings into insights doc', type: 'sub_task', status: 'pending' },
            ]
          },
          { id: 'ps-1b', label: 'Define core problem and value proposition', type: 'sub_objective', status: 'pending',
            children: [
              { id: 'ps-1b-1', label: 'Draft problem statement document', type: 'sub_task', status: 'pending' },
              { id: 'ps-1b-2', label: 'Create value proposition canvas', type: 'sub_task', status: 'pending' },
              { id: 'ps-1b-3', label: 'Validate with 5 early adopters', type: 'sub_task', status: 'pending' },
            ]
          },
          { id: 'ps-1c', label: 'Validate market demand with early adopter signups', type: 'sub_objective', status: 'pending',
            children: [
              { id: 'ps-1c-1', label: 'Build landing page with waitlist', type: 'sub_task', status: 'pending' },
              { id: 'ps-1c-2', label: 'Run targeted ad campaigns for signups', type: 'sub_task', status: 'pending' },
              { id: 'ps-1c-3', label: 'Reach 200+ waitlist signups', type: 'sub_task', status: 'pending' },
            ]
          },
          { id: 'ps-1d', label: 'Competitive landscape analysis', type: 'task', status: 'pending',
            children: [
              { id: 'ps-1d-1', label: 'Identify top 10 competitors', type: 'sub_task', status: 'pending' },
              { id: 'ps-1d-2', label: 'Create feature comparison matrix', type: 'sub_task', status: 'pending' },
              { id: 'ps-1d-3', label: 'Identify differentiation opportunities', type: 'sub_task', status: 'pending' },
            ]
          },
          { id: 'ps-1e', label: 'Define TAM, SAM, SOM', type: 'task', status: 'pending',
            children: [
              { id: 'ps-1e-1', label: 'Research market size data and reports', type: 'sub_task', status: 'pending' },
              { id: 'ps-1e-2', label: 'Build bottom-up market sizing model', type: 'sub_task', status: 'pending' },
            ]
          },
        ]
      },
      {
        id: 'ps-2', label: 'MVP Development', type: 'objective', status: 'pending',
        children: [
          { id: 'ps-2a', label: 'Design core feature set and wireframes', type: 'sub_objective', status: 'pending',
            children: [
              { id: 'ps-2a-1', label: 'Define core user stories', type: 'sub_task', status: 'pending' },
              { id: 'ps-2a-2', label: 'Create low-fidelity wireframes', type: 'sub_task', status: 'pending' },
              { id: 'ps-2a-3', label: 'Design high-fidelity UI mockups', type: 'sub_task', status: 'pending' },
            ]
          },
          { id: 'ps-2b', label: 'Build MVP with core functionality', type: 'sub_objective', status: 'pending',
            children: [
              { id: 'ps-2b-1', label: 'Set up development environment and CI/CD', type: 'sub_task', status: 'pending' },
              { id: 'ps-2b-2', label: 'Implement authentication and user management', type: 'sub_task', status: 'pending' },
              { id: 'ps-2b-3', label: 'Build core feature modules', type: 'sub_task', status: 'pending' },
              { id: 'ps-2b-4', label: 'Deploy to staging environment', type: 'sub_task', status: 'pending' },
            ]
          },
          { id: 'ps-2c', label: 'Internal testing and QA', type: 'task', status: 'pending',
            children: [
              { id: 'ps-2c-1', label: 'Write test plan and test cases', type: 'sub_task', status: 'pending' },
              { id: 'ps-2c-2', label: 'Run internal dogfooding with team', type: 'sub_task', status: 'pending' },
              { id: 'ps-2c-3', label: 'Fix critical bugs from QA round', type: 'sub_task', status: 'pending' },
            ]
          },
          { id: 'ps-2d', label: 'Set up analytics and tracking', type: 'task', status: 'pending',
            children: [
              { id: 'ps-2d-1', label: 'Integrate analytics platform (Mixpanel/Amplitude)', type: 'sub_task', status: 'pending' },
              { id: 'ps-2d-2', label: 'Define key metrics and events to track', type: 'sub_task', status: 'pending' },
            ]
          },
        ]
      },
      {
        id: 'ps-3', label: 'Initial Team & Operations', type: 'objective', status: 'pending',
        children: [
          { id: 'ps-3a', label: 'Founding team legal structure (C-Corp/LLC)', type: 'task', status: 'pending',
            children: [
              { id: 'ps-3a-1', label: 'Choose entity type and jurisdiction', type: 'sub_task', status: 'pending' },
              { id: 'ps-3a-2', label: 'File incorporation documents', type: 'sub_task', status: 'pending' },
              { id: 'ps-3a-3', label: 'Draft founder agreements and vesting schedules', type: 'sub_task', status: 'pending' },
            ]
          },
          { id: 'ps-3b', label: 'Open bank account and accounting setup', type: 'task', status: 'pending',
            children: [
              { id: 'ps-3b-1', label: 'Open business bank account', type: 'sub_task', status: 'pending' },
              { id: 'ps-3b-2', label: 'Set up accounting software (QuickBooks/Xero)', type: 'sub_task', status: 'pending' },
            ]
          },
          { id: 'ps-3c', label: 'Hire first 2-3 core team members', type: 'sub_objective', status: 'pending',
            children: [
              { id: 'ps-3c-1', label: 'Define roles and job descriptions', type: 'sub_task', status: 'pending' },
              { id: 'ps-3c-2', label: 'Source candidates and conduct interviews', type: 'sub_task', status: 'pending' },
              { id: 'ps-3c-3', label: 'Make offers and onboard hires', type: 'sub_task', status: 'pending' },
            ]
          },
        ]
      },
    ]
  },
  {
    id: 'seed',
    label: 'Seed',
    icon: Rocket,
    color: '#f59e0b',
    description: 'Launch your product, acquire first paying customers, and raise your seed round from VCs and angels.',
    estimated_valuation: '$5M – $15M',
    timeline: '6 – 18 months',
    completed: false,
    active: false,
    locked: true,
    objectives: [
      {
        id: 'sd-1', label: 'Product Launch & Traction', type: 'objective', status: 'pending',
        children: [
          { id: 'sd-1a', label: 'Public launch of MVP v1.0', type: 'sub_objective', status: 'pending' },
          { id: 'sd-1b', label: 'Acquire 100+ active users / 10+ paying customers', type: 'sub_objective', status: 'pending' },
          { id: 'sd-1c', label: 'Achieve $10K+ MRR', type: 'sub_objective', status: 'pending' },
          { id: 'sd-1d', label: 'Implement customer feedback loop', type: 'task', status: 'pending' },
        ]
      },
      {
        id: 'sd-2', label: 'Go-to-Market Engine', type: 'objective', status: 'pending',
        children: [
          { id: 'sd-2a', label: 'Define ICP and buyer personas', type: 'task', status: 'pending' },
          { id: 'sd-2b', label: 'Launch content marketing strategy', type: 'sub_objective', status: 'pending' },
          { id: 'sd-2c', label: 'Establish social media presence', type: 'sub_objective', status: 'pending' },
          { id: 'sd-2d', label: 'Build sales pipeline and CRM', type: 'sub_objective', status: 'pending' },
        ]
      },
      {
        id: 'sd-3', label: 'Seed Fundraising', type: 'objective', status: 'pending',
        children: [
          { id: 'sd-3a', label: 'Prepare pitch deck and financial model', type: 'task', status: 'pending' },
          { id: 'sd-3b', label: 'Identify and reach out to 50+ investors', type: 'sub_objective', status: 'pending' },
          { id: 'sd-3c', label: 'Close seed round ($500K – $2M)', type: 'sub_objective', status: 'pending' },
        ]
      },
    ]
  },
  {
    id: 'series-a',
    label: 'Series A',
    icon: BarChart3,
    color: '#3b82f6',
    description: 'Scale your product-market fit, grow the team, and raise Series A for aggressive expansion.',
    estimated_valuation: '$15M – $50M',
    timeline: '18 – 36 months',
    completed: false,
    active: false,
    locked: true,
    objectives: [
      {
        id: 'sa-1', label: 'Scale Product & Engineering', type: 'objective', status: 'pending',
        children: [
          { id: 'sa-1a', label: 'Expand engineering team to 10-15', type: 'sub_objective', status: 'pending' },
          { id: 'sa-1b', label: 'Ship major product milestones v2.0+', type: 'sub_objective', status: 'pending' },
          { id: 'sa-1c', label: 'Achieve 90%+ uptime and enterprise-grade reliability', type: 'sub_objective', status: 'pending' },
          { id: 'sa-1d', label: 'Implement advanced features based on data', type: 'task', status: 'pending' },
        ]
      },
      {
        id: 'sa-2', label: 'Revenue Growth', type: 'objective', status: 'pending',
        children: [
          { id: 'sa-2a', label: 'Achieve $500K+ ARR', type: 'sub_objective', status: 'pending' },
          { id: 'sa-2b', label: 'Hire dedicated sales team (3-5 reps)', type: 'sub_objective', status: 'pending' },
          { id: 'sa-2c', label: 'Build customer success function', type: 'sub_objective', status: 'pending' },
          { id: 'sa-2d', label: 'Achieve < 5% monthly churn', type: 'task', status: 'pending' },
        ]
      },
      {
        id: 'sa-3', label: 'Series A Fundraising', type: 'objective', status: 'pending',
        children: [
          { id: 'sa-3a', label: 'Prepare Series A data room and metrics', type: 'task', status: 'pending' },
          { id: 'sa-3b', label: 'Run structured fundraising process', type: 'sub_objective', status: 'pending' },
          { id: 'sa-3c', label: 'Close Series A ($2M – $10M)', type: 'sub_objective', status: 'pending' },
        ]
      },
    ]
  },
  {
    id: 'series-b',
    label: 'Series B',
    icon: TrendingUp,
    color: '#10b981',
    description: 'Scale operations, expand to new markets, and build for exponential growth.',
    estimated_valuation: '$50M – $200M',
    timeline: '36 – 54 months',
    completed: false,
    active: false,
    locked: true,
    objectives: [
      {
        id: 'sb-1', label: 'Market Expansion', type: 'objective', status: 'pending',
        children: [
          { id: 'sb-1a', label: 'Expand to 2+ new geographic markets', type: 'sub_objective', status: 'pending' },
          { id: 'sb-1b', label: 'Launch enterprise tier / strategic partnerships', type: 'sub_objective', status: 'pending' },
          { id: 'sb-1c', label: 'Scale to 500+ customers', type: 'sub_objective', status: 'pending' },
        ]
      },
      {
        id: 'sb-2', label: 'Organizational Scaling', type: 'objective', status: 'pending',
        children: [
          { id: 'sb-2a', label: 'Scale team to 50-80 employees', type: 'sub_objective', status: 'pending' },
          { id: 'sb-2b', label: 'Build management and leadership team', type: 'sub_objective', status: 'pending' },
          { id: 'sb-2c', label: 'Implement formal OKR system', type: 'sub_objective', status: 'pending' },
          { id: 'sb-2d', label: 'Establish HR, legal, and finance departments', type: 'task', status: 'pending' },
        ]
      },
      {
        id: 'sb-3', label: 'Revenue Milestones', type: 'objective', status: 'pending',
        children: [
          { id: 'sb-3a', label: 'Achieve $3M+ ARR', type: 'sub_objective', status: 'pending' },
          { id: 'sb-3b', label: 'Path to unit economics profitability', type: 'sub_objective', status: 'pending' },
          { id: 'sb-3c', label: 'Close Series B ($10M – $30M)', type: 'sub_objective', status: 'pending' },
        ]
      },
    ]
  },
  {
    id: 'series-c',
    label: 'Series C',
    icon: Award,
    color: '#ec4899',
    description: 'Dominant market position, aggressive M&A, and preparation for IPO.',
    estimated_valuation: '$200M – $1B',
    timeline: '54 – 72 months',
    completed: false,
    active: false,
    locked: true,
    objectives: [
      {
        id: 'sc-1', label: 'Market Leadership', type: 'objective', status: 'pending',
        children: [
          { id: 'sc-1a', label: 'Capture 20%+ market share in core market', type: 'sub_objective', status: 'pending' },
          { id: 'sc-1b', label: 'Strategic acquisitions (1-3 companies)', type: 'sub_objective', status: 'pending' },
          { id: 'sc-1c', label: 'Expand product line / platform ecosystem', type: 'sub_objective', status: 'pending' },
        ]
      },
      {
        id: 'sc-2', label: 'Enterprise & Scale', type: 'objective', status: 'pending',
        children: [
          { id: 'sc-2a', label: 'Scale to 200+ employees', type: 'sub_objective', status: 'pending' },
          { id: 'sc-2b', label: 'Serve enterprise clients with $100K+ ACV', type: 'sub_objective', status: 'pending' },
          { id: 'sc-2c', label: 'Global operations and multi-region support', type: 'sub_objective', status: 'pending' },
        ]
      },
      {
        id: 'sc-3', label: 'IPO Readiness', type: 'objective', status: 'pending',
        children: [
          { id: 'sc-3a', label: 'Achieve $20M+ ARR', type: 'sub_objective', status: 'pending' },
          { id: 'sc-3b', label: 'GAAP-compliant financial reporting', type: 'task', status: 'pending' },
          { id: 'sc-3c', label: 'Build independent board of directors', type: 'sub_objective', status: 'pending' },
          { id: 'sc-3d', label: 'Close Series C ($30M – $100M)', type: 'sub_objective', status: 'pending' },
        ]
      },
    ]
  },
  {
    id: 'ipo',
    label: 'IPO',
    icon: Flag,
    color: '#f43f5e',
    description: 'Go public, unlock liquidity for stakeholders, and enter the next era as a public company.',
    estimated_valuation: '$1B+',
    timeline: '72 – 84 months',
    completed: false,
    active: false,
    locked: true,
    objectives: [
      {
        id: 'ipo-1', label: 'Pre-IPO Preparation', type: 'objective', status: 'pending',
        children: [
          { id: 'ipo-1a', label: 'Select underwriters (Goldman Sachs, Morgan Stanley, etc.)', type: 'sub_objective', status: 'pending' },
          { id: 'ipo-1b', label: 'Complete S-1 filing with SEC', type: 'sub_objective', status: 'pending' },
          { id: 'ipo-1c', label: 'Roadshow preparation and investor meetings', type: 'sub_objective', status: 'pending' },
          { id: 'ipo-1d', label: 'Achieve $50M+ ARR with strong growth', type: 'sub_objective', status: 'pending' },
        ]
      },
      {
        id: 'ipo-2', label: 'Public Company Infrastructure', type: 'objective', status: 'pending',
        children: [
          { id: 'ipo-2a', label: 'Establish investor relations department', type: 'task', status: 'pending' },
          { id: 'ipo-2b', label: 'Implement SOX compliance and controls', type: 'sub_objective', status: 'pending' },
          { id: 'ipo-2c', label: 'Quarterly earnings reporting process', type: 'sub_objective', status: 'pending' },
          { id: 'ipo-2d', label: 'Build internal audit and compliance team', type: 'task', status: 'pending' },
        ]
      },
      {
        id: 'ipo-3', label: 'Going Public', type: 'objective', status: 'pending',
        children: [
          { id: 'ipo-3a', label: 'Pricing and listing on NYSE/NASDAQ', type: 'sub_objective', status: 'pending' },
          { id: 'ipo-3b', label: 'IPO day execution and bell ringing', type: 'sub_objective', status: 'pending' },
          { id: 'ipo-3c', label: 'Post-IPO lockup period management', type: 'sub_objective', status: 'pending' },
        ]
      },
    ]
  },
];

function RecursiveRoadmapItem({
  item,
  depth = 0,
  phaseId,
  phaseColor,
  onToggle,
  expandedObjectives,
  toggleObjectiveExpand,
}: {
  item: RoadmapItem;
  depth: number;
  phaseId: string;
  phaseColor: string;
  onToggle: (phaseId: string, itemId: string, currentStatus: 'complete' | 'in_progress' | 'pending') => void;
  expandedObjectives: Set<string>;
  toggleObjectiveExpand: (objectiveId: string) => void;
}) {
  const isComplete = item.status === 'complete';
  const isInProgress = item.status === 'in_progress';
  const isExpanded = expandedObjectives.has(item.id);
  const hasChildren = item.children && item.children.length > 0;

  // depthPadding is applied to left padding: 0px, 8px, 16px, 24px (based on depth * 8)
  const depthPadding = depth * 8;

  const handleClick = () => {
    onToggle(phaseId, item.id, item.status);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: depth === 0 ? '12px 14px' : '6px 8px',
          paddingLeft: `${12 + depthPadding}px`,
          background: depth === 0 
            ? (isComplete ? `${phaseColor}04` : 'var(--bg-tertiary)') 
            : 'transparent',
          borderRadius: depth === 0 ? 'var(--radius-md)' : '0',
          border: depth === 0 
            ? `1px solid ${isComplete ? `${phaseColor}15` : 'var(--border-subtle)'}` 
            : 'none',
          marginTop: depth === 0 ? '8px' : '0',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onClick={handleClick}
        onMouseEnter={e => {
          if (depth === 0) {
            e.currentTarget.style.borderColor = `${phaseColor}40`;
            e.currentTarget.style.background = `${phaseColor}08`;
          } else {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
          }
        }}
        onMouseLeave={e => {
          if (depth === 0) {
            e.currentTarget.style.borderColor = isComplete ? `${phaseColor}15` : 'var(--border-subtle)';
            e.currentTarget.style.background = isComplete ? `${phaseColor}04` : 'var(--bg-tertiary)';
          } else {
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        {/* Expand/Collapse Chevron */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleObjectiveExpand(item.id);
            }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <ChevronDown
              size={12}
              style={{
                transition: 'transform 0.2s',
                transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              }}
            />
          </button>
        ) : (
          <div style={{ width: '16px', flexShrink: 0 }} />
        )}

        {/* Status Indicator */}
        {isComplete ? (
          <CheckCircle2 size={14} color="#34d399" style={{ flexShrink: 0 }} />
        ) : isInProgress ? (
          <Clock size={14} color="#f59e0b" style={{ flexShrink: 0 }} />
        ) : (
          <div style={{
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            border: '2px solid var(--border-default)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'transparent' }} />
          </div>
        )}

        {/* Label and Source */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: depth === 0 ? '13px' : depth === 1 ? '12px' : '11px',
              fontWeight: depth === 0 ? 700 : depth === 1 ? 600 : 500,
              color: isComplete ? 'var(--text-muted)' : 'var(--text-primary)',
              lineHeight: 1.5,
              textDecoration: isComplete ? 'line-through' : 'none',
            }}
          >
            {item.label}
          </span>

          {item.agent_source && (
            <span style={{
              fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
              background: 'rgba(99,102,241,0.1)', color: '#6366f1',
              fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px',
              border: '1px solid rgba(99,102,241,0.2)',
            }}>
              <Bot size={8} /> {item.agent_source}
            </span>
          )}

          {item.user_must_do && !isComplete && (
            <span style={{
              fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
              background: 'rgba(245,158,11,0.1)', color: '#f59e0b',
              fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px',
            }}>
              <UserCheck size={8} /> You
            </span>
          )}
        </div>
      </div>

      {/* Children (Recursive Call) */}
      {hasChildren && isExpanded && (
        <div 
          className="animate-fade-in"
          style={{
            display: 'flex',
            flexDirection: 'column',
            borderLeft: depth === 0 ? '1px solid var(--border-subtle)' : 'none',
            marginLeft: depth === 0 ? '20px' : '0px',
            marginTop: '2px',
            gap: '2px',
          }}
        >
          {item.children?.map((child, index) => (
            <RecursiveRoadmapItem
              key={child.id ? `${child.id}-${index}` : `${item.id}-child-${index}`}
              item={child}
              depth={depth + 1}
              phaseId={phaseId}
              phaseColor={phaseColor}
              onToggle={onToggle}
              expandedObjectives={expandedObjectives}
              toggleObjectiveExpand={toggleObjectiveExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}


export default function RoadmapPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [expandedPhase, setExpandedPhase] = useState<string | null>('pre-seed');
  const [phases, setPhases] = useState<RoadmapPhase[]>(ROADMAP_PHASES);
  const [loading, setLoading] = useState(true);
  const [companyInfo, setCompanyInfo] = useState<any>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [launchingPhase, setLaunchingPhase] = useState<string | null>(null);
  const [launchSuccess, setLaunchSuccess] = useState<string | null>(null);
  const [evaluatingPhase, setEvaluatingPhase] = useState<string | null>(null);
  const [expandedObjectives, setExpandedObjectives] = useState<Set<string>>(new Set());

  const PHASE_AGENT_MAP: Record<string, string[]> = {
    'pre-seed': ['product', 'marketing', 'finance'],
    'seed': ['marketing', 'sales', 'investment', 'finance'],
    'series-a': ['sales', 'people', 'hr', 'finance'],
    'series-b': ['crm', 'people', 'hr', 'marketing'],
    'series-c': ['investment', 'crm', 'meeting'],
    'ipo': ['investment', 'finance', 'meeting'],
  };

  const AGENT_LABELS: Record<string, string> = {
    product: 'Product', marketing: 'Marketing', finance: 'Finance',
    sales: 'Sales', investment: 'Investment', people: 'People',
    hr: 'HR', crm: 'CRM', meeting: 'Meeting', roadmap: 'Roadmap',
  };

  const fetchRoadmap = useCallback(async () => {
    if (!token) return;
    try {
      const data = await apiRequest('/api/roadmap', {}, token!);
      if (data.roadmap && data.roadmap.phases) {
        setPhases(data.roadmap.phases);
        setCompanyInfo(data.company || null);

        // Auto-expand Level 0 (Section) and Level 1 (Objective)
        const initialExpanded = new Set<string>();
        data.roadmap.phases.forEach((phase: any) => {
          if (phase.objectives) {
            phase.objectives.forEach((section: any) => {
              initialExpanded.add(section.id);
              if (section.children) {
                section.children.forEach((objective: any) => {
                  initialExpanded.add(objective.id);
                });
              }
            });
          }
        });
        setExpandedObjectives(initialExpanded);
      }
    } catch {
      // Fallback to static ROADMAP_PHASES
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    // Populate initially from static ROADMAP_PHASES
    const initialExpanded = new Set<string>();
    ROADMAP_PHASES.forEach((phase) => {
      if (phase.objectives) {
        phase.objectives.forEach((section) => {
          initialExpanded.add(section.id);
          if (section.children) {
            section.children.forEach((objective) => {
              initialExpanded.add(objective.id);
            });
          }
        });
      }
    });
    setExpandedObjectives(initialExpanded);
    fetchRoadmap();
  }, [fetchRoadmap]);

  const handleRegenerate = async () => {
    if (!token || regenerating) return;
    setRegenerating(true);
    try {
      const data = await apiRequest('/api/roadmap/regenerate', { method: 'POST' }, token!);
      if (data.roadmap && data.roadmap.phases) {
        setPhases(data.roadmap.phases as RoadmapPhase[]);
      }
    } catch { /* ignore */ }
    setRegenerating(false);
  };

  const handleToggleObjective = async (phaseId: string, objectiveId: string, currentStatus: 'complete' | 'in_progress' | 'pending') => {
    if (!token || togglingId) return;
    setTogglingId(objectiveId);
    const newStatus: 'complete' | 'pending' = currentStatus === 'complete' ? 'pending' : 'complete';

    // Optimistic update
    setPhases(prev => prev.map(phase => {
      if (phase.id !== phaseId) return phase;
      return {
        ...phase,
        objectives: phase.objectives.map(obj => {
          if (obj.id === objectiveId) {
            return { ...obj, status: newStatus };
          }
          // Recursively update status if needed
          if (obj.children) {
            const updateChildren = (items: RoadmapItem[]): RoadmapItem[] =>
                items.map(i => i.id === objectiveId ? { ...i, status: newStatus } : (i.children ? { ...i, children: updateChildren(i.children) } : i));
            return { ...obj, children: updateChildren(obj.children) };
          }
          return obj;
        }),
      };
    }));

    try {
      await apiRequest(`/api/roadmap/objectives/${phaseId}/${objectiveId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      }, token!);
    } catch {
      // Revert on error
      fetchRoadmap();
    }
    setTogglingId(null);
  };

  const handleLaunchRelatedAgents = async (phase: RoadmapPhase) => {
    if (!token || launchingPhase) return;
    setLaunchingPhase(phase.id);
    setLaunchSuccess(null);

    const agents = PHASE_AGENT_MAP[phase.id] || ['finance', 'marketing', 'sales'];
    const launchedNames: string[] = [];

    for (const agentType of agents) {
      try {
        await apiRequest('/api/agents/launch', {
          method: 'POST',
          body: JSON.stringify({ agentType }),
        }, token!);
        launchedNames.push(AGENT_LABELS[agentType] || agentType);
      } catch { /* ignore */ }
    }

    setLaunchingPhase(null);
    setLaunchSuccess(`Launched ${launchedNames.join(', ')} agents for ${phase.label}`);
    setTimeout(() => setLaunchSuccess(null), 4000);
    // Navigate to chat tab after a brief delay
    setTimeout(() => router.push('/dashboard/chat'), 1500);
  };

  const handleEvaluatePhase = async (phase: RoadmapPhase) => {
    if (!token || evaluatingPhase) return;
    setEvaluatingPhase(phase.id);
    try {
      const res = await apiRequest(`/api/roadmap/evaluate/${phase.id}`, {
        method: 'POST',
        body: JSON.stringify({ phase }),
      }, token!);
      if (res.evaluation) {
        setPhases(prev => prev.map(p =>
          p.id === phase.id ? { ...p, evaluation_notes: res.evaluation } : p
        ));
      }
    } catch {
      setPhases(prev => prev.map(p =>
        p.id === phase.id ? { ...p, evaluation_notes: '⚠️ Evaluation failed — please try again later.' } : p
      ));
    }
    setEvaluatingPhase(null);
  };

  const toggleObjectiveExpand = (objectiveId: string) => {
    setExpandedObjectives(prev => {
      const next = new Set(prev);
      if (next.has(objectiveId)) next.delete(objectiveId);
      else next.add(objectiveId);
      return next;
    });
  };

  const togglePhase = (phaseId: string) => {
    setExpandedPhase(expandedPhase === phaseId ? null : phaseId);
  };

  // Count stats
  const totalObjectives = phases.reduce((sum, p) => sum + p.objectives.length, 0);
  const totalTasks = phases.reduce((sum, p) => 
    sum + p.objectives.reduce((s, o) => s + (o.children?.length || 0), 0), 0
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Loader2 size={24} className="animate-spin" color="var(--accent-primary)" />
      </div>
    );
  }

  return (
    <div style={{ padding: '32px', maxWidth: '1000px', margin: '0 auto', width: '100%', overflow: 'auto' }}>
      {/* Header */}
      <div className="animate-fade-in" style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '8px' }}>
          <div style={{
            width: '48px', height: '48px', borderRadius: 'var(--radius-lg)',
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-cyan))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(99,102,241,0.2)',
          }}>
            <Map size={24} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 800, letterSpacing: '-0.02em' }}>
              The <span className="gradient-text">Roadmap</span>
            </h1>
            <p style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
              {phases.length > 0
                ? `AI-generated growth roadmap with checkpoints from ${phases[0].label} to ${phases[phases.length - 1].label}`
                : 'AI-generated growth roadmap'}
            </p>
          </div>
        </div>
      </div>

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '32px' }}>
        {[
          { label: 'Phases', value: phases.length, icon: Map, color: 'var(--accent-primary)' },
          { label: 'Objectives', value: totalObjectives, icon: Target, color: 'var(--accent-cyan)' },
          { label: 'Tasks', value: totalTasks, icon: CheckCircle2, color: 'var(--accent-emerald)' },
          { label: 'Timeline', value: (() => {
            const last = phases[phases.length - 1]?.timeline || '';
            const end = last.match(/(\d+)\s*months?\s*$/);
            return end ? `0 – ${end[1]} months` : (last || '—');
          })(), icon: Clock, color: 'var(--accent-amber)' },
        ].map((stat, i) => (
          <div key={i} className="glass-card" style={{
            padding: '16px', display: 'flex', alignItems: 'center', gap: '14px',
          }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: 'var(--radius-md)',
              background: `${stat.color}15`, border: `1px solid ${stat.color}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <stat.icon size={16} color={stat.color} />
            </div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>{stat.value}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{stat.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Roadmap agent actions */}
      <div style={{ marginBottom: '24px' }}>
        <AgentQuickActions
          token={token}
          title="Roadmap agent"
          actions={[
            { agentType: 'roadmap', recipeId: 'ninety_day_plan', label: '90-Day Plan', description: 'A focused next-90-days execution plan with milestones, owners, and risks.' },
            { agentType: 'roadmap', recipeId: 'risk_map', label: 'Risk Map', description: 'The top strategic/operational risks with likelihood, impact, and mitigations.' },
          ]}
        />
      </div>

      {/* Timeline / Phases */}
      <div style={{ position: 'relative', marginBottom: '40px' }}>
        {/* Vertical timeline line */}
        <div style={{
          position: 'absolute', left: '24px', top: '0', bottom: '0',
          width: '2px', background: 'linear-gradient(to bottom, var(--accent-primary), var(--accent-cyan), var(--accent-emerald), var(--accent-amber), var(--accent-rose), #f43f5e)',
          opacity: 0.3, borderRadius: '2px',
        }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {phases.map((phase, idx) => {
            const isExpanded = expandedPhase === phase.id;
            const PhaseIcon = resolveIcon(phase.icon);

            return (
              <div key={phase.id} className="animate-slide-up" style={{ position: 'relative' }}>
                {/* Collapsed view */}
                <div
                  onClick={() => togglePhase(phase.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '16px',
                    padding: '16px 20px', marginLeft: '40px',
                    background: isExpanded ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
                    border: `1px solid ${isExpanded ? `${phase.color}30` : 'var(--border-subtle)'}`,
                    borderRadius: isExpanded ? 'var(--radius-lg) var(--radius-lg) 0 0' : 'var(--radius-lg)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    position: 'relative',
                    opacity: phase.locked ? 0.6 : 1,
                  }}
                  onMouseEnter={e => {
                    if (!isExpanded) e.currentTarget.style.borderColor = `${phase.color}40`;
                  }}
                  onMouseLeave={e => {
                    if (!isExpanded) e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  }}
                >
                  {/* Timeline dot */}
                  <div style={{
                    position: 'absolute', left: '-52px', top: '50%', transform: 'translateY(-50%)',
                    width: '16px', height: '16px', borderRadius: '50%',
                    background: phase.active ? phase.color : 'var(--bg-tertiary)',
                    border: `3px solid ${phase.active ? phase.color : 'var(--border-default)'}`,
                    boxShadow: phase.active ? `0 0 12px ${phase.color}60` : 'none',
                  }} />

                  {/* Phase icon */}
                  <div style={{
                    width: '36px', height: '36px', borderRadius: 'var(--radius-md)',
                    background: `${phase.color}20`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: phase.color, flexShrink: 0,
                  }}>
                    <PhaseIcon size={18} />
                  </div>

                  {/* Phase info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {phase.label}
                      </h3>
                      {phase.active && (
                        <span style={{
                          padding: '2px 8px', borderRadius: 'var(--radius-full)',
                          background: `${phase.color}20`, color: phase.color,
                          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                          border: `1px solid ${phase.color}40`,
                        }}>
                          Current Phase
                        </span>
                      )}
                      {phase.completed && (
                        <span style={{
                          padding: '2px 8px', borderRadius: 'var(--radius-full)',
                          background: 'rgba(52,211,153,0.15)', color: '#34d399',
                          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                        }}>
                          <CheckCircle2 size={10} style={{ display: 'inline', marginRight: '4px' }} />
                          Completed
                        </span>
                      )}
                      {phase.locked && !phase.completed && (
                        <span style={{
                          padding: '2px 8px', borderRadius: 'var(--radius-full)',
                          background: 'rgba(100,116,139,0.15)', color: 'var(--text-muted)',
                          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                        }}>
                          Locked
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.4 }}>
                      {phase.description}
                    </p>
                  </div>

                  {/* Valuation & Timeline */}
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: phase.color }}>
                      {phase.estimated_valuation}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                      <Clock size={10} />
                      {phase.timeline}
                    </div>
                  </div>

                  {/* Expand/collapse */}
                  <ChevronDown size={16} color="var(--text-muted)" style={{
                    transition: 'transform 0.2s ease',
                    transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                    flexShrink: 0,
                  }} />
                </div>

                {/* Expanded view - objectives */}
                {isExpanded && (
                  <div className="animate-fade-in" style={{
                    marginLeft: '40px',
                    background: 'var(--bg-secondary)',
                    border: `1px solid ${phase.color}20`,
                    borderTop: 'none',
                    borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
                    padding: '20px',
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {phase.objectives.map((objective, index) => (
                        <RecursiveRoadmapItem
                          key={objective.id ? `${objective.id}-${index}` : `${phase.id}-obj-${index}`}
                          item={objective}
                          depth={0}
                          phaseId={phase.id}
                          phaseColor={phase.color}
                          onToggle={handleToggleObjective}
                          expandedObjectives={expandedObjectives}
                          toggleObjectiveExpand={toggleObjectiveExpand}
                        />
                      ))}
                    </div>

                    {/* Evaluation notes from agents */}
                    {phase.evaluation_notes && (
                      <div style={{
                        marginTop: '12px', padding: '12px 14px',
                        background: `${phase.color}06`, border: `1px solid ${phase.color}15`,
                        borderRadius: 'var(--radius-md)', fontSize: '12px',
                        color: 'var(--text-secondary)', lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', fontSize: '10px', fontWeight: 700, color: phase.color, textTransform: 'uppercase' }}>
                          <Sparkles size={10} /> Agent Evaluation
                        </div>
                        {phase.evaluation_notes}
                      </div>
                    )}

                    {/* Launch success message */}
                    {launchSuccess && launchSuccess.includes(phase.label) && (
                      <div className="animate-fade-in" style={{
                        marginTop: '8px', padding: '8px 12px',
                        background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)',
                        borderRadius: 'var(--radius-md)', fontSize: '11px',
                        color: '#34d399', display: 'flex', alignItems: 'center', gap: '6px',
                      }}>
                        <CheckCircle2 size={12} /> {launchSuccess}
                      </div>
                    )}

                    {/* Phase action buttons */}
                    <div style={{ display: 'flex', gap: '10px', marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                      <button
                        onClick={() => handleEvaluatePhase(phase)}
                        disabled={evaluatingPhase === phase.id}
                        className="btn-primary"
                        style={{ fontSize: '12px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        {evaluatingPhase === phase.id ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        {evaluatingPhase === phase.id ? 'Evaluating...' : 'Evaluate Phase'}
                      </button>
                      <button
                        onClick={() => handleLaunchRelatedAgents(phase)}
                        disabled={launchingPhase === phase.id}
                        className="btn-ghost"
                        style={{ fontSize: '12px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        {launchingPhase === phase.id ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                        {launchingPhase === phase.id
                          ? `Launching ${(PHASE_AGENT_MAP[phase.id] || []).map(a => AGENT_LABELS[a]).join(', ')}...`
                          : `Launch ${(PHASE_AGENT_MAP[phase.id] || []).map(a => AGENT_LABELS[a]).join(', ')}`}
                      </button>
                    </div>
                  </div>
                )}

                {/* Locked phase message */}
                {phase.locked && !isExpanded && (
                  <div style={{
                    marginLeft: '40px', padding: '12px 20px',
                    border: '1px dashed var(--border-subtle)', borderTop: 'none',
                    borderRadius: '0 0 var(--radius-lg) var(--radius-lg)',
                    background: 'var(--bg-secondary)',
                    opacity: 0.6,
                  }}>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Map size={12} />
                      {phase.label} phase will unlock when previous checkpoints are completed
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom summary */}
      <div className="glass-card" style={{
        padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <Brain size={20} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              AI-Powered Dynamic Roadmap
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              The Brain will adjust objectives and targets as new data and documents are ingested
            </p>
          </div>
        </div>
        <button onClick={handleRegenerate} disabled={regenerating} className="btn-ghost" style={{ fontSize: '12px', padding: '8px 16px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {regenerating ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {regenerating ? 'Refreshing...' : 'Refresh Roadmap'}
        </button>
      </div>

      <style>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
