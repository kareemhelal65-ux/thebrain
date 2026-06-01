/**
 * Roadmap Service
 * 
 * Manages per-company dynamic roadmap generation, objective tracking,
 * agent-contributed objectives, and valuation estimation.
 * 
 * The roadmap is dynamically generated based on:
 * - Company profile data from onboarding
 * - Agent evaluations (esp. finance and investment agents)
 * - Approved agent outputs
 * - Web research about the company's industry/market
 */

const supabase = require('../models/supabaseClient');
const { v4: uuidv4 } = require('uuid');
const { callLLMWithTools } = require('./llmService');

// ─── Phase Definitions (template — values are overridden per company) ───

const PHASE_TEMPLATES = [
  {
    id: 'pre-seed',
    label: 'Pre-Seed',
    icon: 'Lightbulb',
    color: '#8b5cf6',
    description: 'Validate the concept, build your MVP, and secure initial funding from angels or friends & family.',
    default_valuation: '$1M – $5M',
    timeline: '0 – 6 months',
    order: 0,
  },
  {
    id: 'seed',
    label: 'Seed',
    icon: 'Rocket',
    color: '#f59e0b',
    description: 'Launch your product, acquire first paying customers, and raise your seed round from VCs and angels.',
    default_valuation: '$5M – $15M',
    timeline: '6 – 18 months',
    order: 1,
  },
  {
    id: 'series-a',
    label: 'Series A',
    icon: 'BarChart3',
    color: '#3b82f6',
    description: 'Scale your product-market fit, grow the team, and raise Series A for aggressive expansion.',
    default_valuation: '$15M – $50M',
    timeline: '18 – 36 months',
    order: 2,
  },
  {
    id: 'series-b',
    label: 'Series B',
    icon: 'TrendingUp',
    color: '#10b981',
    description: 'Scale operations, expand to new markets, and build for exponential growth.',
    default_valuation: '$50M – $200M',
    timeline: '36 – 54 months',
    order: 3,
  },
  {
    id: 'series-c',
    label: 'Series C',
    icon: 'Award',
    color: '#ec4899',
    description: 'Dominant market position, aggressive M&A, and preparation for IPO.',
    default_valuation: '$200M – $1B',
    timeline: '54 – 72 months',
    order: 4,
  },
  {
    id: 'ipo',
    label: 'IPO',
    icon: 'Flag',
    color: '#f43f5e',
    description: 'Go public, unlock liquidity for stakeholders, and enter the next era as a public company.',
    default_valuation: '$1B+',
    timeline: '72 – 84 months',
    order: 5,
  },
];

const DEFAULT_OBJECTIVES = {
  'pre-seed': [
    {
      id: 'ps-product', label: 'Product', type: 'objective',
      children: [
        {
          id: 'ps-product-o1', label: 'MVP Development', type: 'sub_objective',
          children: [
            { id: 'ps-product-t1', label: 'Design core user stories and wireframes', type: 'task' },
            { id: 'ps-product-t2', label: 'Implement key MVP features', type: 'task',
              children: [
                { id: 'ps-product-st1', label: 'Setup backend database and Auth', type: 'sub_task' },
                { id: 'ps-product-st2', label: 'Build main web application views', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'ps-sales', label: 'Sales', type: 'objective',
      children: [
        {
          id: 'ps-sales-o1', label: 'Customer Discovery', type: 'sub_objective',
          children: [
            { id: 'ps-sales-t1', label: 'Conduct 20 customer interviews', type: 'task' },
            { id: 'ps-sales-t2', label: 'Draft pilot agreement templates', type: 'task',
              children: [
                { id: 'ps-sales-st1', label: 'Define standard SLA and pricing metrics', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'ps-raise', label: 'Raise', type: 'objective',
      children: [
        {
          id: 'ps-raise-o1', label: 'Capital Planning', type: 'sub_objective',
          children: [
            { id: 'ps-raise-t1', label: 'Prepare pre-seed investor deck', type: 'task',
              children: [
                { id: 'ps-raise-st1', label: 'Draft problem-solution slides', type: 'sub_task' },
                { id: 'ps-raise-st2', label: 'Build 12-month use of funds slide', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'ps-dilution', label: 'Dilution', type: 'objective',
      children: [
        {
          id: 'ps-dilution-o1', label: 'Cap Table Modeling (Tied to: Raise)', type: 'sub_objective',
          children: [
            { id: 'ps-dilution-t1', label: 'Founder equity allocation', type: 'task',
              children: [
                { id: 'ps-dilution-st1', label: 'Establish 4-year vesting with 1-year cliff', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'ps-traction', label: 'Traction', type: 'objective',
      children: [
        {
          id: 'ps-traction-o1', label: 'Waitlist Growth (Tied to: Marketing)', type: 'sub_objective',
          children: [
            { id: 'ps-traction-t1', label: 'Acquire 200 waitlist signups', type: 'task',
              children: [
                { id: 'ps-traction-st1', label: 'Submit startup to BetaList and directories', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'ps-marketing', label: 'Marketing', type: 'objective',
      children: [
        {
          id: 'ps-marketing-o1', label: 'Landing Page Setup', type: 'sub_objective',
          children: [
            { id: 'ps-marketing-t1', label: 'Launch teaser website', type: 'task',
              children: [
                { id: 'ps-marketing-st1', label: 'Design waitlist capture form', type: 'sub_task' },
                { id: 'ps-marketing-st2', label: 'Write initial copy describing MVP value proposition', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'ps-finance', label: 'Finance', type: 'objective',
      children: [
        {
          id: 'ps-finance-o1', label: 'Runway & Budgeting', type: 'sub_objective',
          children: [
            { id: 'ps-finance-t1', label: 'Open business bank account', type: 'task', user_must_do: true },
            { id: 'ps-finance-t2', label: 'Configure bookkeeping software', type: 'task',
              children: [
                { id: 'ps-finance-st1', label: 'Link credit card and bank account feeds', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'ps-legal', label: 'Legal', type: 'objective',
      children: [
        {
          id: 'ps-legal-o1', label: 'Corporate Formation', type: 'sub_objective',
          children: [
            { id: 'ps-legal-t1', label: 'File Delaware C-Corp papers', type: 'task', user_must_do: true },
            { id: 'ps-legal-t2', label: 'Execute IP assignment agreements', type: 'task',
              children: [
                { id: 'ps-legal-st1', label: 'Assign founder IP to new entity', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    }
  ],
  'seed': [
    {
      id: 'sd-product', label: 'Product', type: 'objective',
      children: [
        {
          id: 'sd-product-o1', label: 'Beta Release', type: 'sub_objective',
          children: [
            { id: 'sd-product-t1', label: 'Launch private beta to early adopters', type: 'task' },
            { id: 'sd-product-t2', label: 'Integrate usage tracking and analytics', type: 'task',
              children: [
                { id: 'sd-product-st1', label: 'Install Mixpanel/Amplitude tracking scripts', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'sd-sales', label: 'Sales', type: 'objective',
      children: [
        {
          id: 'sd-sales-o1', label: 'Initial Monetization (Tied to: Finance)', type: 'sub_objective',
          children: [
            { id: 'sd-sales-t1', label: 'Secure first 10 paying customers', type: 'task',
              children: [
                { id: 'sd-sales-st1', label: 'Run sales demos with 50 qualified leads', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'sd-raise', label: 'Raise', type: 'objective',
      children: [
        {
          id: 'sd-raise-o1', label: 'Seed Round Fundraising', type: 'sub_objective',
          children: [
            { id: 'sd-raise-t1', label: 'Build pitch list of 50 angel & VC investors', type: 'task',
              children: [
                { id: 'sd-raise-st1', label: 'Search investor portfolios for matching stage', type: 'sub_task' }
              ]
            },
            { id: 'sd-raise-t2', label: 'Close seed funding round', type: 'task',
              children: [
                { id: 'sd-raise-st2', label: 'Execute SAFEs / convertible notes', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'sd-dilution', label: 'Dilution', type: 'objective',
      children: [
        {
          id: 'sd-dilution-o1', label: 'SAFE Conversion Modeling (Tied to: Raise)', type: 'sub_objective',
          children: [
            { id: 'sd-dilution-t1', label: 'Build post-money SAFE conversion tables', type: 'task',
              children: [
                { id: 'sd-dilution-st1', label: 'Analyze dilution scenarios at various valuations', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'sd-traction', label: 'Traction', type: 'objective',
      children: [
        {
          id: 'sd-traction-o1', label: 'User Growth', type: 'sub_objective',
          children: [
            { id: 'sd-traction-t1', label: 'Reach 100+ weekly active users (WAU)', type: 'task',
              children: [
                { id: 'sd-traction-st1', label: 'Implement onboarding walkthrough flow', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'sd-marketing', label: 'Marketing', type: 'objective',
      children: [
        {
          id: 'sd-marketing-o1', label: 'Launch Strategy', type: 'sub_objective',
          children: [
            { id: 'sd-marketing-t1', label: 'Execute Product Hunt launch', type: 'task',
              children: [
                { id: 'sd-marketing-st1', label: 'Prepare promotional graphics and video demo', type: 'sub_task' },
                { id: 'sd-marketing-st2', label: 'Reach out to initial hunter and top supporters', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'sd-finance', label: 'Finance', type: 'objective',
      children: [
        {
          id: 'sd-finance-o1', label: 'MRR Tracking (Tied to: Sales)', type: 'sub_objective',
          children: [
            { id: 'sd-finance-t1', label: 'Achieve $10K MRR milestone', type: 'task',
              children: [
                { id: 'sd-finance-st1', label: 'Setup Stripe dashboard for subscription metrics', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    },
    {
      id: 'sd-legal', label: 'Legal', type: 'objective',
      children: [
        {
          id: 'sd-legal-o1', label: 'Policy Compliance', type: 'sub_objective',
          children: [
            { id: 'sd-legal-t1', label: 'Publish standard Terms of Service and Privacy Policy', type: 'task',
              children: [
                { id: 'sd-legal-st1', label: 'Draft policies complying with GDPR/CCPA rules', type: 'sub_task' }
              ]
            }
          ]
        }
      ]
    }
  ],
  'series-a': [
    { id: 'sa-product', label: 'Product', type: 'objective', children: [{ id: 'sa-product-o1', label: 'Scale Architecture', type: 'sub_objective', children: [{ id: 'sa-product-t1', label: 'Achieve 99.9% uptime SLA', type: 'task', children: [{ id: 'sa-product-st1', label: 'Deploy database clustering', type: 'sub_task' }] }] }] },
    { id: 'sa-sales', label: 'Sales', type: 'objective', children: [{ id: 'sa-sales-o1', label: 'Direct Playbook (Tied to: Finance)', type: 'sub_objective', children: [{ id: 'sa-sales-t1', label: 'Hire sales director', type: 'task', children: [{ id: 'sa-sales-st1', label: 'Source candidate pipeline', type: 'sub_task' }] }] }] },
    { id: 'sa-raise', label: 'Raise', type: 'objective', children: [{ id: 'sa-raise-o1', label: 'Series A round', type: 'sub_objective', children: [{ id: 'sa-raise-t1', label: 'Prepare data room', type: 'task', children: [{ id: 'sa-raise-st1', label: 'Gather tax documents', type: 'sub_task' }] }] }] },
    { id: 'sa-dilution', label: 'Dilution', type: 'objective', children: [{ id: 'sa-dilution-o1', label: 'ESOP expansion (Tied to: Raise)', type: 'sub_objective', children: [{ id: 'sa-dilution-t1', label: 'Model 10% options pool expansion', type: 'task', children: [{ id: 'sa-dilution-st1', label: 'Draft option agreements', type: 'sub_task' }] }] }] },
    { id: 'sa-traction', label: 'Traction', type: 'objective', children: [{ id: 'sa-traction-o1', label: 'LTV/CAC Optimization', type: 'sub_objective', children: [{ id: 'sa-traction-t1', label: 'Increase average LTV to $5K', type: 'task', children: [{ id: 'sa-traction-st1', label: 'Implement annual contract plans', type: 'sub_task' }] }] }] },
    { id: 'sa-marketing', label: 'Marketing', type: 'objective', children: [{ id: 'sa-marketing-o1', label: 'Performance Ads', type: 'sub_objective', children: [{ id: 'sa-marketing-t1', label: 'Scale Google and LinkedIn ads', type: 'task', children: [{ id: 'sa-marketing-st1', label: 'A/B test advertising hooks', type: 'sub_task' }] }] }] },
    { id: 'sa-finance', label: 'Finance', type: 'objective', children: [{ id: 'sa-finance-o1', label: 'ARR Milestone (Tied to: Sales, Traction)', type: 'sub_objective', children: [{ id: 'sa-finance-t1', label: 'Achieve $100K MRR', type: 'task', children: [{ id: 'sa-finance-st1', label: 'Establish cohort metrics dashboard', type: 'sub_task' }] }] }] },
    { id: 'sa-legal', label: 'Legal', type: 'objective', children: [{ id: 'sa-legal-o1', label: 'Board Setup', type: 'sub_objective', children: [{ id: 'sa-legal-t1', label: 'Establish board seats post-raise', type: 'task', children: [{ id: 'sa-legal-st1', label: 'Draft new board bylaws', type: 'sub_task' }] }] }] }
  ],
  'series-b': [
    { id: 'sb-product', label: 'Product', type: 'objective', children: [{ id: 'sb-product-o1', label: 'Enterprise Platform', type: 'sub_objective', children: [{ id: 'sb-product-t1', label: 'Launch developer API', type: 'task', children: [{ id: 'sb-product-st1', label: 'Write API endpoint documentation', type: 'sub_task' }] }] }] },
    { id: 'sb-sales', label: 'Sales', type: 'objective', children: [{ id: 'sb-sales-o1', label: 'Enterprise scale (Tied to: Finance)', type: 'sub_objective', children: [{ id: 'sb-sales-t1', label: 'Hire enterprise reps', type: 'task', children: [{ id: 'sb-sales-st1', label: 'Establish commission tiers', type: 'sub_task' }] }] }] },
    { id: 'sb-raise', label: 'Raise', type: 'objective', children: [{ id: 'sb-raise-o1', label: 'Series B round', type: 'sub_objective', children: [{ id: 'sb-raise-t1', label: 'Run VC process', type: 'task', children: [{ id: 'sb-raise-st1', label: 'Deliver pitch to 15 growth VCs', type: 'sub_task' }] }] }] },
    { id: 'sb-dilution', label: 'Dilution', type: 'objective', children: [{ id: 'sb-dilution-o1', label: 'Growth round modeling (Tied to: Raise)', type: 'sub_objective', children: [{ id: 'sb-dilution-t1', label: 'Calculate share price escalation', type: 'task', children: [{ id: 'sb-dilution-st1', label: 'Update options valuation model', type: 'sub_task' }] }] }] },
    { id: 'sb-traction', label: 'Traction', type: 'objective', children: [{ id: 'sb-traction-o1', label: 'Retention optimization', type: 'sub_objective', children: [{ id: 'sb-traction-t1', label: 'Achieve Net Revenue Retention of 115%', type: 'task', children: [{ id: 'sb-traction-st1', label: 'Launch customer success CS team', type: 'sub_task' }] }] }] },
    { id: 'sb-marketing', label: 'Marketing', type: 'objective', children: [{ id: 'sb-marketing-o1', label: 'ABM Campaign', type: 'sub_objective', children: [{ id: 'sb-marketing-t1', label: 'Launch account marketing program', type: 'task', children: [{ id: 'sb-marketing-st1', label: 'Identify top 100 enterprise accounts', type: 'sub_task' }] }] }] },
    { id: 'sb-finance', label: 'Finance', type: 'objective', children: [{ id: 'sb-finance-o1', label: 'Profitability Path (Tied to: Sales)', type: 'sub_objective', children: [{ id: 'sb-finance-t1', label: 'Achieve positive unit economics', type: 'task', children: [{ id: 'sb-finance-st1', label: 'Model contribution margin improvements', type: 'sub_task' }] }] }] },
    { id: 'sb-legal', label: 'Legal', type: 'objective', children: [{ id: 'sb-legal-o1', label: 'Regulatory expansion', type: 'sub_objective', children: [{ id: 'sb-legal-t1', label: 'Establish multi-region compliance', type: 'task', children: [{ id: 'sb-legal-st1', label: 'Draft global data agreements', type: 'sub_task' }] }] }] }
  ],
  'series-c': [
    { id: 'sc-product', label: 'Product', type: 'objective', children: [{ id: 'sc-product-o1', label: 'Multi-Product Portfolio', type: 'sub_objective', children: [{ id: 'sc-product-t1', label: 'Launch secondary SaaS module', type: 'task', children: [{ id: 'sc-product-st1', label: 'Complete private beta tests', type: 'sub_task' }] }] }] },
    { id: 'sc-sales', label: 'Sales', type: 'objective', children: [{ id: 'sc-sales-o1', label: 'Global sales (Tied to: Finance)', type: 'sub_objective', children: [{ id: 'sc-sales-t1', label: 'Establish European sales hubs', type: 'task', children: [{ id: 'sc-sales-st1', label: 'Hire regional GM', type: 'sub_task' }] }] }] },
    { id: 'sc-raise', label: 'Raise', type: 'objective', children: [{ id: 'sc-raise-o1', label: 'Series C round', type: 'sub_objective', children: [{ id: 'sc-raise-t1', label: 'Partner with growth banks', type: 'task', children: [{ id: 'sc-raise-st1', label: 'Model IPO mock pricing ranges', type: 'sub_task' }] }] }] },
    { id: 'sc-dilution', label: 'Dilution', type: 'objective', children: [{ id: 'sc-dilution-o1', label: 'Liquidation analysis (Tied to: Raise)', type: 'sub_objective', children: [{ id: 'sc-dilution-t1', label: 'Model late stage preference stacks', type: 'task', children: [{ id: 'sc-dilution-st1', label: 'Review investor warrants', type: 'sub_task' }] }] }] },
    { id: 'sc-traction', label: 'Traction', type: 'objective', children: [{ id: 'sc-traction-o1', label: 'Market dominance', type: 'sub_objective', children: [{ id: 'sc-traction-t1', label: 'Achieve 30% segment market share', type: 'task', children: [{ id: 'sc-traction-st1', label: 'Publish comparative benchmark reports', type: 'sub_task' }] }] }] },
    { id: 'sc-marketing', label: 'Marketing', type: 'objective', children: [{ id: 'sc-marketing-o1', label: 'Global campaigns', type: 'sub_objective', children: [{ id: 'sc-marketing-t1', label: 'Launch major corporate ads campaign', type: 'task', children: [{ id: 'sc-marketing-st1', label: 'Secure Tier 1 media placements', type: 'sub_task' }] }] }] },
    { id: 'sc-finance', label: 'Finance', type: 'objective', children: [{ id: 'sc-finance-o1', label: 'ARR Milestone (Tied to: Sales)', type: 'sub_objective', children: [{ id: 'sc-finance-t1', label: 'Achieve $20M+ ARR', type: 'task', children: [{ id: 'sc-finance-st1', label: 'Perform audit readiness tests', type: 'sub_task' }] }] }] },
    { id: 'sc-legal', label: 'Legal', type: 'objective', children: [{ id: 'sc-legal-o1', label: 'Pre-IPO audits', type: 'sub_objective', children: [{ id: 'sc-legal-t1', label: 'Complete mock SEC review', type: 'task', children: [{ id: 'sc-legal-st1', label: 'Draft mock S-1 sections', type: 'sub_task' }] }] }] }
  ],
  'ipo': [
    { id: 'ipo-product', label: 'Product', type: 'objective', children: [{ id: 'ipo-product-o1', label: 'IPO readiness stability', type: 'sub_objective', children: [{ id: 'ipo-product-t1', label: 'Ensure continuous compliance', type: 'task', children: [{ id: 'ipo-product-st1', label: 'Conduct automated security tests', type: 'sub_task' }] }] }] },
    { id: 'ipo-sales', label: 'Sales', type: 'objective', children: [{ id: 'ipo-sales-o1', label: 'Consistent growth', type: 'sub_objective', children: [{ id: 'ipo-sales-t1', label: 'Maintain 35% YoY expansion', type: 'task', children: [{ id: 'ipo-sales-st1', label: 'Lock in multi-year SLA contracts', type: 'sub_task' }] }] }] },
    { id: 'ipo-raise', label: 'Raise', type: 'objective', children: [{ id: 'ipo-raise-o1', label: 'Public listing', type: 'sub_objective', children: [{ id: 'ipo-raise-t1', label: 'Execute roadshow process', type: 'task', children: [{ id: 'ipo-raise-st1', label: 'Draft underwriters presentation slides', type: 'sub_task' }] }] }] },
    { id: 'ipo-dilution', label: 'Dilution', type: 'objective', children: [{ id: 'ipo-dilution-o1', label: 'Listing structures', type: 'sub_objective', children: [{ id: 'ipo-dilution-t1', label: 'Establish public share structure', type: 'task', children: [{ id: 'ipo-dilution-st1', label: 'Define founder lock-up schedules', type: 'sub_task' }] }] }] },
    { id: 'ipo-traction', label: 'Traction', type: 'objective', children: [{ id: 'ipo-traction-o1', label: 'Market leadership', type: 'sub_objective', children: [{ id: 'ipo-traction-t1', label: 'Expand enterprise segment share', type: 'task', children: [{ id: 'ipo-traction-st1', label: 'Form strategic advisory board', type: 'sub_task' }] }] }] },
    { id: 'ipo-marketing', label: 'Marketing', type: 'objective', children: [{ id: 'ipo-marketing-o1', label: 'NYSE/Nasdaq day', type: 'sub_objective', children: [{ id: 'ipo-marketing-t1', label: 'Prepare public press release kits', type: 'task', children: [{ id: 'ipo-marketing-st1', label: 'Finalize listing day bell schedule', type: 'sub_task' }] }] }] },
    { id: 'ipo-finance', label: 'Finance', type: 'objective', children: [{ id: 'ipo-finance-o1', label: 'Public reporting', type: 'sub_objective', children: [{ id: 'ipo-finance-t1', label: 'GAAP compliance transition', type: 'task', children: [{ id: 'ipo-finance-st1', label: 'Complete standard quarterly review audit', type: 'sub_task' }] }] }] },
    { id: 'ipo-legal', label: 'Legal', type: 'objective', children: [{ id: 'ipo-legal-o1', label: 'SEC Registration', type: 'sub_objective', children: [{ id: 'ipo-legal-t1', label: 'File final S-1 documentation', type: 'task', children: [{ id: 'ipo-legal-st1', label: 'Resolve SEC comment letters', type: 'sub_task' }] }] }] }
  ]
};

// ─── Non-VC Roadmap Templates ───────────────────────────────────────────────
// The VC track above (PHASE_TEMPLATES / DEFAULT_OBJECTIVES) is the legacy default.
// These alternative tracks populate when a company selects a non-venture path at
// onboarding. Each phase reuses the same shape (id/label/icon/color/description/
// default_valuation/timeline/order); for non-VC tracks `default_valuation` holds a
// target milestone metric rather than an equity valuation — the UI renders it as a
// plain string either way.

const BOOTSTRAPPED_PHASES = [
  { id: 'bs-validate', label: 'Validate', icon: 'Lightbulb', color: '#8b5cf6', description: 'Confirm a real, painful problem people will pay to solve — before building much.', default_valuation: '0 paying users', timeline: '0 – 3 months', order: 0 },
  { id: 'bs-first-revenue', label: 'First Revenue', icon: 'Rocket', color: '#f59e0b', description: 'Ship a paid v1 and land your first paying customers. Charge from day one.', default_valuation: '$1 – $1K MRR', timeline: '3 – 9 months', order: 1 },
  { id: 'bs-ramen', label: 'Ramen Profitable', icon: 'BarChart3', color: '#3b82f6', description: 'Cover the founder(s) living costs from revenue. Default alive, not default dead.', default_valuation: '$3K – $10K MRR', timeline: '9 – 18 months', order: 2 },
  { id: 'bs-sustainable', label: 'Sustainable Growth', icon: 'TrendingUp', color: '#10b981', description: 'Reinvest profit into repeatable acquisition. Grow without outside capital.', default_valuation: '$10K – $50K MRR', timeline: '18 – 36 months', order: 3 },
  { id: 'bs-scale', label: 'Scale', icon: 'Award', color: '#ec4899', description: 'Hire a small team, systematize delivery, and protect margins as you grow.', default_valuation: '$50K – $150K MRR', timeline: '36 – 54 months', order: 4 },
  { id: 'bs-independence', label: 'Independence', icon: 'Flag', color: '#f43f5e', description: 'A durable, profitable business — optional acquisition or lifestyle freedom.', default_valuation: '$150K+ MRR', timeline: '54 – 72 months', order: 5 },
];

const AGENCY_PHASES = [
  { id: 'ag-foundation', label: 'Foundation', icon: 'Lightbulb', color: '#8b5cf6', description: 'Define your service offering, niche, and pricing. Build a portfolio of proof.', default_valuation: '0 clients', timeline: '0 – 3 months', order: 0 },
  { id: 'ag-first-clients', label: 'First Clients', icon: 'Rocket', color: '#f59e0b', description: 'Win your first paying engagements and deliver standout results.', default_valuation: '1 – 3 clients', timeline: '3 – 9 months', order: 1 },
  { id: 'ag-retainers', label: 'Recurring Retainers', icon: 'BarChart3', color: '#3b82f6', description: 'Convert one-off projects into predictable monthly retainers.', default_valuation: '$10K – $40K MRR', timeline: '9 – 18 months', order: 2 },
  { id: 'ag-team', label: 'Team & Delivery', icon: 'TrendingUp', color: '#10b981', description: 'Hire and systematize delivery so you are not the bottleneck.', default_valuation: '$40K – $100K MRR', timeline: '18 – 36 months', order: 3 },
  { id: 'ag-scale', label: 'Scale', icon: 'Award', color: '#ec4899', description: 'Multiple delivery pods, sharpened niche, and a referral/sales engine.', default_valuation: '$100K – $300K MRR', timeline: '36 – 54 months', order: 4 },
  { id: 'ag-productize', label: 'Productize / Exit', icon: 'Flag', color: '#f43f5e', description: 'Productize a service line or position the agency for acquisition.', default_valuation: '$300K+ MRR', timeline: '54 – 72 months', order: 5 },
];

const NONPROFIT_PHASES = [
  { id: 'np-formation', label: 'Formation', icon: 'Lightbulb', color: '#8b5cf6', description: 'Incorporate, define mission and theory of change, and recruit a founding board.', default_valuation: 'Pre-program', timeline: '0 – 6 months', order: 0 },
  { id: 'np-first-programs', label: 'First Programs', icon: 'Rocket', color: '#f59e0b', description: 'Pilot your first program and serve your first beneficiaries.', default_valuation: 'First beneficiaries', timeline: '6 – 12 months', order: 1 },
  { id: 'np-funding', label: 'Funding & Grants', icon: 'BarChart3', color: '#3b82f6', description: 'Build a diversified funding base: grants, individual donors, and earned revenue.', default_valuation: '$50K – $250K raised', timeline: '12 – 24 months', order: 2 },
  { id: 'np-impact', label: 'Impact & Measurement', icon: 'TrendingUp', color: '#10b981', description: 'Measure outcomes rigorously and report impact to funders and stakeholders.', default_valuation: 'Measured outcomes', timeline: '24 – 36 months', order: 3 },
  { id: 'np-scale-programs', label: 'Scale Programs', icon: 'Award', color: '#ec4899', description: 'Expand proven programs to new sites or populations with strong governance.', default_valuation: '$250K – $1M budget', timeline: '36 – 54 months', order: 4 },
  { id: 'np-sustainability', label: 'Sustainability', icon: 'Flag', color: '#f43f5e', description: 'Durable funding (endowment/recurring donors) and lasting systemic impact.', default_valuation: '$1M+ budget', timeline: '54 – 72 months', order: 5 },
];

// Helper to build a single objective-tree group for the compact non-VC templates.
const og = (id, label, subLabel, tasks) => ({
  id, label, type: 'objective',
  children: [{
    id: `${id}-o1`, label: subLabel, type: 'sub_objective',
    children: tasks.map((t, i) => ({ id: `${id}-t${i + 1}`, label: t.label, type: 'task', ...(t.user_must_do ? { user_must_do: true } : {}) })),
  }],
});

const BOOTSTRAPPED_OBJECTIVES = {
  'bs-validate': [
    og('bsv-research', 'Customer Discovery', 'Problem Validation', [{ label: 'Interview 30 potential customers about the problem' }, { label: 'Document the top 3 painful, frequent problems' }]),
    og('bsv-offer', 'Offer', 'Define a Paid Solution', [{ label: 'Draft a one-sentence value proposition' }, { label: 'Price the offer and pre-sell to 3 prospects' }]),
  ],
  'bs-first-revenue': [
    og('bsr-mvp', 'Product', 'Paid v1', [{ label: 'Ship the smallest version someone will pay for' }, { label: 'Set up payment collection (Stripe/invoice)', user_must_do: true }]),
    og('bsr-sales', 'Sales', 'First Paying Customers', [{ label: 'Land the first 5 paying customers' }, { label: 'Collect testimonials and case-study proof' }]),
  ],
  'bs-ramen': [
    og('bsm-revenue', 'Revenue', 'Cover Founder Costs', [{ label: 'Reach MRR that covers founder living costs' }, { label: 'Cut non-essential expenses to extend runway' }]),
    og('bsm-retention', 'Retention', 'Keep Customers', [{ label: 'Measure and reduce monthly churn' }, { label: 'Build a lightweight onboarding flow' }]),
  ],
  'bs-sustainable': [
    og('bss-acq', 'Acquisition', 'Repeatable Channel', [{ label: 'Find one acquisition channel with positive ROI' }, { label: 'Document a repeatable acquisition playbook' }]),
    og('bss-finance', 'Finance', 'Profit Discipline', [{ label: 'Maintain a profit-first cash allocation' }, { label: 'Build a 12-month cash-flow forecast' }]),
  ],
  'bs-scale': [
    og('bsc-team', 'Team', 'First Hires', [{ label: 'Hire to remove the founder bottleneck' }, { label: 'Document core SOPs for delegated work' }]),
    og('bsc-systems', 'Systems', 'Operational Leverage', [{ label: 'Automate the most repetitive operations' }, { label: 'Protect gross margin as you add headcount' }]),
  ],
  'bs-independence': [
    og('bsi-durability', 'Durability', 'Defensible Business', [{ label: 'Diversify revenue beyond a single channel' }, { label: 'Reduce key-person dependency' }]),
    og('bsi-options', 'Options', 'Freedom or Exit', [{ label: 'Decide: keep, hire a GM, or sell' }, { label: 'If selling, prepare clean financials for diligence', user_must_do: true }]),
  ],
};

const AGENCY_OBJECTIVES = {
  'ag-foundation': [
    og('agf-offer', 'Offer', 'Service & Niche', [{ label: 'Define a focused service offering and ideal client' }, { label: 'Set packaged pricing (project + retainer)' }]),
    og('agf-proof', 'Proof', 'Portfolio', [{ label: 'Produce 2 portfolio pieces or pilot results' }, { label: 'Publish a simple services one-pager/site' }]),
  ],
  'ag-first-clients': [
    og('agc-pipeline', 'Sales', 'Pipeline', [{ label: 'Build an outbound list of 50 ideal prospects' }, { label: 'Book 10 discovery calls' }]),
    og('agc-close', 'Sales', 'First Engagements', [{ label: 'Close the first 3 paying clients' }, { label: 'Use a standard proposal & contract template', user_must_do: true }]),
  ],
  'ag-retainers': [
    og('agr-convert', 'Revenue', 'Recurring Retainers', [{ label: 'Convert 3 project clients to monthly retainers' }, { label: 'Define clear retainer scope and SLAs' }]),
    og('agr-delivery', 'Delivery', 'Quality', [{ label: 'Create a repeatable delivery process per service' }, { label: 'Track utilization and delivery deadlines' }]),
  ],
  'ag-team': [
    og('agt-hire', 'Team', 'First Delivery Hires', [{ label: 'Hire delivery talent to remove founder from delivery' }, { label: 'Onboard with documented SOPs' }]),
    og('agt-ops', 'Operations', 'Capacity', [{ label: 'Implement project management & time tracking' }, { label: 'Define a capacity model tied to revenue' }]),
  ],
  'ag-scale': [
    og('ags-pods', 'Delivery', 'Multiple Pods', [{ label: 'Stand up a second delivery pod/team lead' }, { label: 'Sharpen the niche and raise prices' }]),
    og('ags-engine', 'Growth', 'Sales Engine', [{ label: 'Build a referral and case-study engine' }, { label: 'Hire or assign a dedicated sales role' }]),
  ],
  'ag-productize': [
    og('agp-product', 'Product', 'Productized Service', [{ label: 'Package a repeatable service into a fixed-scope product' }, { label: 'Test self-serve or subscription delivery' }]),
    og('agp-exit', 'Options', 'Exit Readiness', [{ label: 'Reduce client concentration risk' }, { label: 'Prepare clean financials & SOPs for acquisition', user_must_do: true }]),
  ],
};

const NONPROFIT_OBJECTIVES = {
  'np-formation': [
    og('npf-legal', 'Legal', 'Incorporation', [{ label: 'File for nonprofit/charity status', user_must_do: true }, { label: 'Recruit a founding board of directors', user_must_do: true }]),
    og('npf-mission', 'Mission', 'Theory of Change', [{ label: 'Document mission, vision, and theory of change' }, { label: 'Define the population you serve and the need' }]),
  ],
  'np-first-programs': [
    og('npp-pilot', 'Programs', 'Pilot Program', [{ label: 'Design and run a first pilot program' }, { label: 'Serve and document your first beneficiaries' }]),
    og('npp-volunteers', 'People', 'Volunteers/Staff', [{ label: 'Recruit initial volunteers or staff' }, { label: 'Establish basic program delivery processes' }]),
  ],
  'np-funding': [
    og('npg-grants', 'Funding', 'Grants', [{ label: 'Identify and apply to 10 relevant grants' }, { label: 'Build a grant pipeline and reporting calendar' }]),
    og('npg-donors', 'Funding', 'Individual Donors', [{ label: 'Launch an individual giving / donor campaign' }, { label: 'Set up donation processing & receipts', user_must_do: true }]),
  ],
  'np-impact': [
    og('npi-measure', 'Impact', 'Outcome Measurement', [{ label: 'Define key outcome metrics (not just outputs)' }, { label: 'Collect baseline and follow-up data' }]),
    og('npi-report', 'Impact', 'Reporting', [{ label: 'Produce an annual impact report' }, { label: 'Share results with funders and stakeholders' }]),
  ],
  'np-scale-programs': [
    og('nps-expand', 'Programs', 'Expansion', [{ label: 'Expand proven programs to new sites/populations' }, { label: 'Codify program model for replication' }]),
    og('nps-governance', 'Governance', 'Capacity', [{ label: 'Strengthen board governance & financial controls' }, { label: 'Hire program leadership' }]),
  ],
  'np-sustainability': [
    og('npu-funding', 'Funding', 'Durable Base', [{ label: 'Build recurring donor base / endowment' }, { label: 'Diversify funding to reduce single-source risk' }]),
    og('npu-impact', 'Impact', 'Systemic Change', [{ label: 'Pursue policy or systemic-level impact' }, { label: 'Establish long-term measurement of lasting change' }]),
  ],
};

// Registry: maps a company's roadmap_type to its template set. NULL/unknown → VC.
const ROADMAP_TEMPLATES = {
  vc:           { label: 'VC Track',            phases: PHASE_TEMPLATES,    objectives: DEFAULT_OBJECTIVES,      metricLabel: 'Valuation' },
  bootstrapped: { label: 'Bootstrapped Growth', phases: BOOTSTRAPPED_PHASES, objectives: BOOTSTRAPPED_OBJECTIVES, metricLabel: 'Revenue milestone' },
  agency:       { label: 'Agency / Services',   phases: AGENCY_PHASES,       objectives: AGENCY_OBJECTIVES,       metricLabel: 'Revenue milestone' },
  nonprofit:    { label: 'Non-Profit',          phases: NONPROFIT_PHASES,    objectives: NONPROFIT_OBJECTIVES,    metricLabel: 'Milestone' },
};

/**
 * Resolve a company's roadmap template set, defaulting to the VC track.
 */
function getRoadmapTemplate(roadmapType) {
  return ROADMAP_TEMPLATES[roadmapType] || ROADMAP_TEMPLATES.vc;
}

// ─── Public Functions ───

/**
 * Get or generate a roadmap for a company.
 * Returns the stored roadmap if it exists, or generates one from company data.
 * Automatically runs evaluation and updates summary/valuations on load.
 */
async function getOrCreateRoadmap(companyId) {
  // Check if roadmap exists
  const { data: existing, error: fetchError } = await supabase
    .from('roadmap_plans')
    .select('*')
    .eq('company_id', companyId)
    .single();

  let roadmap;
  if (!fetchError && existing) {
    roadmap = existing;

    // Auto-upgrade legacy/generic roadmaps: if this roadmap's tasks were never
    // tailored to the company, regenerate it once so existing users get a roadmap
    // tailored to what they actually do (rather than the static template).
    if (!existing.is_tailored) {
      console.log(`[RoadmapService] Roadmap for company ${companyId} is untailored — regenerating with company-specific tasks.`);
      try {
        return await regenerateRoadmap(companyId);
      } catch (regenErr) {
        console.error('[RoadmapService] Auto-tailor regeneration failed, returning existing roadmap:', regenErr.message);
        return roadmap;
      }
    }

    // Valuations are computed ONCE per stage at generation/regeneration and then
    // frozen — we deliberately do NOT re-run the LLM valuation on load. Re-rolling
    // it on every tab switch produced different numbers each time (the model is
    // non-deterministic). Phase valuations, summary, active/completed/locked state,
    // and objective progress are all already persisted on the stored roadmap (phase
    // progression is written directly by updateObjectiveStatus / approval handlers),
    // so the stored record is the source of truth. Use Regenerate to recompute.
    return roadmap;
  } else {
    // Generate new roadmap
    return await generateRoadmap(companyId);
  }
}

/**
 * Build a rich, grounded context string about the company from its profile fields
 * plus the onboarding discovery Q&A and top document segments stored at onboarding.
 * This is what lets the roadmap tasks reflect what the company ACTUALLY does.
 */
async function buildDeepCompanyContext(company) {
  const lines = [
    `Name: ${company.name || 'Unknown'}`,
    `Industry: ${company.industry || 'N/A'}`,
    company.roadmap_type ? `Growth Path: ${company.roadmap_type}` : null,
    company.company_stage ? `Stage: ${company.company_stage}` : null,
    company.description ? `What they do: ${company.description}` : null,
    company.mission_vision ? `Mission/Vision: ${company.mission_vision}` : null,
    company.target_customer ? `Target Customer: ${company.target_customer}` : null,
    company.competitors ? `Competitors: ${company.competitors}` : null,
    company.business_model ? `Business Model: ${company.business_model}` : null,
    company.pain_points ? `Pain Points: ${company.pain_points}` : null,
    company.current_tools ? `Current Tools: ${company.current_tools}` : null,
    company.team_size ? `Team Size: ${company.team_size}` : null,
    company.employee_count ? `Employees: ${company.employee_count}` : null,
    company.location ? `Location: ${company.location}` : null,
  ].filter(Boolean);

  // Pull the onboarding profile chunk (contains the discovery Q&A) + a few docs.
  try {
    const { data: chunks } = await supabase
      .from('document_chunks')
      .select('content, source_type, source_title')
      .eq('tenant_id', company.id)
      .in('source_type', ['company_profile', 'document', 'meeting'])
      .order('created_at', { ascending: false })
      .limit(6);

    if (Array.isArray(chunks) && chunks.length > 0) {
      // Prefer the company_profile chunk first (it holds the discovery Q&A).
      const ordered = [...chunks].sort((a, b) =>
        (a.source_type === 'company_profile' ? -1 : 0) - (b.source_type === 'company_profile' ? -1 : 0));
      const extra = ordered
        .map(c => (c.content || '').slice(0, 1200))
        .filter(Boolean)
        .join('\n---\n');
      if (extra) lines.push(`\nOnboarding answers & document context:\n${extra}`);
    }
  } catch (err) {
    console.warn('[RoadmapService] buildDeepCompanyContext chunk fetch failed:', err.message);
  }

  return lines.join('\n');
}

/**
 * Normalize an LLM-produced objectives tree into the canonical roadmap shape with
 * deterministic, collision-free ids. Enforces the objective → sub_objective → task
 * → sub_task hierarchy regardless of how loosely the model nested its output.
 */
function normalizeTailoredObjectives(phaseId, rawObjs) {
  if (!Array.isArray(rawObjs) || rawObjs.length === 0) return null;
  const lbl = (x) => (x && (x.label || x.title || x.name)) || (typeof x === 'string' ? x : null);

  const objectives = [];
  rawObjs.slice(0, 8).forEach((obj, oi) => {
    const oLabel = lbl(obj);
    if (!oLabel) return;
    const oid = `${phaseId}-o${oi + 1}`;
    const objective = { id: oid, label: String(oLabel).slice(0, 120), type: 'objective' };

    const subObjsRaw = Array.isArray(obj.children) ? obj.children : [];
    const children = [];
    subObjsRaw.slice(0, 6).forEach((so, si) => {
      const sLabel = lbl(so);
      if (!sLabel) return;
      const sid = `${oid}-s${si + 1}`;
      const subObj = { id: sid, label: String(sLabel).slice(0, 120), type: 'sub_objective' };

      const tasksRaw = Array.isArray(so.children) ? so.children : [];
      const taskChildren = [];
      tasksRaw.slice(0, 8).forEach((t, ti) => {
        const tLabel = lbl(t);
        if (!tLabel) return;
        const tid = `${sid}-t${ti + 1}`;
        const task = { id: tid, label: String(tLabel).slice(0, 160), type: 'task' };
        if (t && t.user_must_do) task.user_must_do = true;

        const stRaw = Array.isArray(t.children) ? t.children : [];
        const stChildren = stRaw.slice(0, 6).map((st, sti) => {
          const stLabel = lbl(st);
          return stLabel ? { id: `${tid}-st${sti + 1}`, label: String(stLabel).slice(0, 160), type: 'sub_task' } : null;
        }).filter(Boolean);
        if (stChildren.length) task.children = stChildren;
        taskChildren.push(task);
      });
      if (taskChildren.length) subObj.children = taskChildren;
      children.push(subObj);
    });
    if (children.length) objective.children = children;
    objectives.push(objective);
  });

  return objectives.length ? objectives : null;
}

/**
 * Use the LLM to produce objectives/tasks tailored to what THIS company does, for a
 * single phase. Returns normalized objectives or null on failure (caller falls back
 * to the track's default objectives for the phase).
 */
async function generateTailoredPhaseObjectives(company, template, phase, defaultObjs, deepContext) {
  // Don't attempt tailoring with almost no signal — defaults are fine then.
  if (!company || (!company.description && !deepContext)) return null;

  const categoryHints = (defaultObjs || []).map(o => o.label).filter(Boolean).join(', ');

  const prompt = `You are an expert advisor building a startup/company roadmap on the "${template.label}" growth path.
Produce the concrete objectives, tasks, and sub-tasks for ONE phase, TAILORED specifically to this company based on everything known about it. Generic, boilerplate tasks are unacceptable — every task must reflect this company's actual product, industry, customers, tools, and stated goals.

=== COMPANY ===
${deepContext}

=== PHASE TO PLAN ===
Phase: ${phase.label}
Phase goal: ${phase.description}
Typical timeline: ${phase.timeline}
${categoryHints ? `Suggested objective categories for this phase (adapt as fits the company): ${categoryHints}` : ''}

=== RULES ===
- Return 3-6 top-level objectives. Each objective has 1-2 sub_objectives. Each sub_objective has 2-4 tasks. Tasks may have 0-3 sub_tasks.
- Make task labels specific to THIS company: name their product/service, target customer, channels, tools, or competitors where relevant. Avoid generic phrasing like "build MVP" — say what THEY must build.
- Keep tasks realistic for the phase and the company's stage/size.
- Mark a task with "user_must_do": true ONLY if it legally/physically requires the founder (e.g. signing documents, opening bank accounts, incorporating).
- Output STRICT JSON only, no commentary.

Return JSON exactly in this shape:
{
  "objectives": [
    {
      "label": "Objective name",
      "children": [
        {
          "label": "Sub-objective name",
          "children": [
            { "label": "Specific task", "user_must_do": false, "children": [ { "label": "Specific sub-task" } ] }
          ]
        }
      ]
    }
  ]
}`;

  try {
    const result = await callLLMWithTools(
      [{ role: 'system', content: prompt }],
      [],
      { model: 'openai/gpt-oss-120b', temperature: 0.5, response_format: { type: 'json_object' } }
    );
    if (!result?.content) return null;
    const parsed = JSON.parse(result.content);
    const raw = Array.isArray(parsed) ? parsed : (parsed.objectives || parsed.phases || []);
    return normalizeTailoredObjectives(phase.id, raw);
  } catch (err) {
    console.warn(`[RoadmapService] Tailoring failed for phase ${phase.id}:`, err.message);
    return null;
  }
}

/**
 * Generate a dynamic roadmap for a company.
 * Uses company profile + agent evaluation data to estimate valuations and customize objectives.
 */
async function generateRoadmap(companyId) {
  // Fetch company profile
  const { data: company, error: companyErr } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .single();

  if (companyErr) throw new Error(`Company not found: ${companyErr.message}`);

  // Fetch relevant agent executions for evaluation data
  const { data: executions } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(50);

  // Fetch approved agent outputs
  const { data: approvals } = await supabase
    .from('agent_output_approvals')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false })
    .limit(20);

  // Select the roadmap template for this company's chosen track (VC default).
  const roadmapTemplate = getRoadmapTemplate(company.roadmap_type);

  // Evaluate company based on profile + agent data
  const evaluation = await evaluateCompany(company, executions || [], approvals || [], roadmapTemplate);

  // Build a rich, grounded context (profile fields + onboarding discovery Q&A +
  // top document segments) used to tailor every phase's tasks to THIS company.
  const deepContext = await buildDeepCompanyContext(company);

  // Tailor each phase's objectives/tasks to the company IN PARALLEL. Each call is
  // scoped to a single phase (small, reliable JSON) and falls back to the track's
  // default objectives for that phase if the LLM call fails.
  const tailoredByPhase = await Promise.all(
    roadmapTemplate.phases.map(async (template) => {
      const defaultObjs = (roadmapTemplate.objectives || {})[template.id] || [];
      const tailored = await generateTailoredPhaseObjectives(company, roadmapTemplate, template, defaultObjs, deepContext);
      return { phaseId: template.id, objectives: tailored || defaultObjs, tailored: !!tailored };
    })
  );
  const baseObjectivesByPhase = Object.fromEntries(tailoredByPhase.map(t => [t.phaseId, t.objectives]));
  const tailoredCount = tailoredByPhase.filter(t => t.tailored).length;
  console.log(`[RoadmapService] Roadmap for ${companyId}: ${tailoredCount}/${tailoredByPhase.length} phases AI-tailored.`);

  // Build phases with dynamic valuations and tailored + agent-contributed objectives
  const phases = roadmapTemplate.phases.map((template, idx) => {
    const isCurrent = idx === evaluation.currentPhaseIndex;
    const isCompleted = idx < evaluation.currentPhaseIndex;
    const isLocked = idx > evaluation.currentPhaseIndex;

    // Get dynamic valuation/milestone from evaluation
    const phaseValuation = evaluation.phaseValuations[template.id] || template.default_valuation;

    // Get objectives (tailored base + agent-contributed)
    const objectives = buildPhaseObjectives(template.id, baseObjectivesByPhase[template.id] || [], approvals || []);

    return {
      id: template.id,
      label: template.label,
      icon: template.icon,
      color: template.color,
      description: template.description,
      estimated_valuation: phaseValuation,
      timeline: template.timeline,
      order: template.order,
      completed: isCompleted,
      active: isCurrent,
      locked: isLocked,
      objectives,
      // Evaluation notes from agents
      evaluation_notes: evaluation.phaseNotes[template.id] || null,
    };
  });

  const roadmapData = {
    phases,
    company_summary: evaluation.companySummary,
    last_evaluated: new Date().toISOString(),
    generated_by: evaluation.generatedBy,
    // Mark as processed by the tailoring pipeline so existing users are upgraded
    // exactly once (avoids an infinite regenerate loop if the LLM is unavailable).
    is_tailored: true,
  };

  // Store in database
  const roadmapId = uuidv4();
  const { error: insertError } = await supabase
    .from('roadmap_plans')
    .upsert([{
      id: roadmapId,
      company_id: companyId,
      phases: roadmapData.phases,
      company_summary: roadmapData.company_summary,
      last_evaluated: roadmapData.last_evaluated,
      generated_by: roadmapData.generated_by || 'system',
      is_tailored: roadmapData.is_tailored,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }], { onConflict: 'company_id' });

  if (insertError) {
    console.error('[RoadmapService] Failed to insert roadmap:', insertError.message);
    // Return an in-memory roadmap anyway
  }

  return {
    id: roadmapId,
    company_id: companyId,
    ...roadmapData,
  };
}

/**
 * Evaluate a company's stage, valuation, and readiness based on profile + agent data.
 */
async function evaluateCompany(company, executions, approvals, roadmapTemplate = ROADMAP_TEMPLATES.vc) {
  const template = roadmapTemplate || ROADMAP_TEMPLATES.vc;
  const isVc = template === ROADMAP_TEMPLATES.vc;
  // Phase ids in order for THIS template (not hardcoded to the VC track).
  const stages = template.phases.map(p => p.id);
  const maxIdx = stages.length - 1;

  // Start with default evaluation
  const defaultEvaluation = {
    currentPhaseIndex: 0,
    phaseValuations: {},
    phaseNotes: {},
    companySummary: `${company.name || 'The Company'} — ${company.industry || 'Technology'} company`,
    generatedBy: 'system',
  };

  // Use company profile to determine initial phase
  let currentPhaseIdx = 0;

  // Map company_stage to a phase index. The onboarding stage vocabulary
  // (idea/mvp/launched/growing) applies to every track; VC funding terms map too.
  if (company.company_stage) {
    const genericStageMap = {
      'idea': 0, 'concept': 0, 'pre_seed': 0, 'pre-seed': 0,
      'mvp': 1, 'building': 1, 'seed': 1,
      'launched': 2, 'live': 2, 'series_a': 2, 'series-a': 2, 'series a': 2,
      'growing': 3, 'scaling': 3, 'series_b': 3, 'series-b': 3, 'series b': 3,
      'series_c': 4, 'series-c': 4, 'series c': 4,
      'ipo': 5, 'public': 5,
    };
    const mapped = genericStageMap[company.company_stage.toLowerCase()];
    if (typeof mapped === 'number') currentPhaseIdx = Math.min(mapped, maxIdx);
  }

  // Check for agent evaluation data that might adjust the phase
  const financeExecution = executions.find(e => e.agent_type === 'finance' && e.output_summary);
  const investmentExecution = executions.find(e => e.agent_type === 'investment' && e.output_summary);
  const marketingExecution = executions.find(e => e.agent_type === 'marketing' && e.output_summary);
  const productExecution = executions.find(e => e.agent_type === 'product' && e.output_summary);

  // Parse agent outputs for valuation insights
  const agentInsights = [];
  const phaseValuations = {};
  const phaseNotes = {};

  if (financeExecution?.output_summary) {
    agentInsights.push(`Finance: ${financeExecution.output_summary.substring(0, 200)}`);
    defaultEvaluation.generatedBy = 'agents';
  }

  if (investmentExecution?.output_summary) {
    agentInsights.push(`Investment: ${investmentExecution.output_summary.substring(0, 200)}`);
    defaultEvaluation.generatedBy = 'agents';
  }

  if (marketingExecution?.output_summary) {
    agentInsights.push(`Marketing: ${marketingExecution.output_summary.substring(0, 200)}`);
  }

  if (productExecution?.output_summary) {
    agentInsights.push(`Product: ${productExecution.output_summary.substring(0, 200)}`);
  }

  // Always perform dynamic valuation/milestone and phase estimation using the LLM.
  if (company.description) {
    try {
      // Frame the per-phase metric for the chosen track. VC wants equity valuations;
      // other tracks want a concrete milestone metric (e.g. MRR, clients, budget).
      const metricNoun = isVc ? 'valuation range' : `${template.metricLabel.toLowerCase()} target`;
      const metricExample = isVc ? '"$1.5M - $3.5M"' : '"$10K - $25K MRR" or "3 - 5 retained clients"';
      const phaseLines = template.phases
        .map(p => `- ${p.id} (${p.label}, ${p.timeline}):`)
        .join('\n');
      const exampleJson = template.phases
        .map(p => `"${p.id}": "..."`)
        .join(', ');

      const llmResult = await callLLMWithTools([
        { role: 'system', content: `You are a "${template.label}" roadmap advisor. Given company data and agent evaluations, determine the company's current phase and a realistic ${metricNoun} for each phase. Be specific and data-driven. This company is NOT necessarily raising venture capital — respect the "${template.label}" path.` },
        { role: 'user', content: `Company: ${company.name || 'Unknown'}
Industry: ${company.industry || 'N/A'}
Description: ${company.description || 'N/A'}
Stage: ${company.company_stage || 'early'}
Team Size: ${company.team_size || 'N/A'}
Website: ${company.website || 'N/A'}
Pain Points: ${company.pain_points || 'N/A'}
Target Customer: ${company.target_customer || 'N/A'}

Agent Evaluations:
${agentInsights.length > 0 ? agentInsights.join('\n') : 'No agent evaluations run yet. Perform initial estimation based on onboarding profile.'}

For each phase below, estimate a realistic ${metricNoun} for THIS specific company (e.g. ${metricExample}):
${phaseLines}

Also determine which phase index (0-${maxIdx}) the company is CURRENTLY in right now.
Respond with JSON: { "currentPhaseIndex": number, "valuations": { ${exampleJson} }, "summary": "one line company summary" }` }
      ], [], { model: 'openai/gpt-oss-120b', temperature: 0.3 });

      if (llmResult?.content) {
        try {
          const parsed = JSON.parse(llmResult.content);
          if (typeof parsed.currentPhaseIndex === 'number') {
            currentPhaseIdx = Math.max(0, Math.min(parsed.currentPhaseIndex, maxIdx));
          }
          if (parsed.valuations) {
            for (const stage of stages) {
              if (parsed.valuations[stage]) {
                phaseValuations[stage] = parsed.valuations[stage];
              }
            }
          }
          if (parsed.summary) {
            defaultEvaluation.companySummary = parsed.summary;
          }
        } catch {}
      }
    } catch {}
  }

  // Store insights as phase notes
  for (const stage of stages) {
    const stageExecutions = executions.filter(e => e.agent_type !== stage);
    const stageApprovals = approvals.filter(a => a.agent_type === stage);
    const notes = [];
    if (stageExecutions.length > 0) notes.push(`${stageExecutions.length} agent executions completed`);
    if (stageApprovals.length > 0) notes.push(`${stageApprovals.length} outputs approved`);
    if (notes.length > 0) {
      phaseNotes[stage] = notes.join('. ');
    }
  }

  return {
    currentPhaseIndex: currentPhaseIdx,
    phaseValuations,
    phaseNotes,
    companySummary: defaultEvaluation.companySummary,
    generatedBy: defaultEvaluation.generatedBy,
    agentInsights,
    financeEvaluation: financeExecution?.output_summary || null,
    investmentEvaluation: investmentExecution?.output_summary || null,
  };
}

/**
 * Build objectives for a phase, combining defaults with agent-contributed objectives.
 */
function buildPhaseObjectives(phaseId, baseObjs, approvals) {
  const sourceObjs = Array.isArray(baseObjs) ? baseObjs : [];

  // Deep clone the base (tailored or default) objectives
  const objectives = sourceObjs.map(obj => ({
    ...obj,
    status: 'pending',
    children: (obj.children || []).map(child => ({
      ...child,
      status: child.user_must_do ? 'pending' : 'pending', // user_must_do = user checks manually
    })),
  }));

  // Add agent-contributed objectives from approved outputs
  for (const approval of approvals) {
    const outputData = approval.output_data;
    if (!outputData) continue;

    // Agents can contribute objectives via their approved output
    if (outputData.objectives && Array.isArray(outputData.objectives)) {
      for (const obj of outputData.objectives) {
        if (obj.phase === phaseId || !obj.phase) {
          objectives.push({
            id: `agent-${approval.id}-${objectives.length}`,
            label: obj.label || `Objective from ${approval.agent_type || 'agent'}`,
            type: 'objective',
            status: 'pending',
            agent_source: approval.agent_type || 'agent',
            auto_checkable: true, // Agent-completed objectives can be auto-checked
            children: (obj.children || []).map((child) => ({
              ...child,
              status: 'pending',
              user_must_do: false,
            })),
          });
        }
      }
    }
  }

  return objectives;
}

/**
 * Update status of a specific objective or child item.
 */
async function updateObjectiveStatus(companyId, phaseId, objectiveId, status) {
  const { data: roadmap } = await supabase
    .from('roadmap_plans')
    .select('*')
    .eq('company_id', companyId)
    .single();

  if (!roadmap) throw new Error('Roadmap not found');

  const phases = roadmap.phases || [];    const phase = phases.find((p) => p.id === phaseId);
  if (!phase) throw new Error('Phase not found');

  // Update objective status recursively
  const updateInObjectives = (objs) => {
    for (const obj of objs) {
      if (obj.id === objectiveId) {
        obj.status = status;
        // If marking complete, also mark all children complete
        if (status === 'complete' && obj.children) {
          obj.children = obj.children.map((c) => ({ ...c, status: 'complete' }));
        }
        // If marking pending, also mark all children pending
        if (status === 'pending' && obj.children) {
          obj.children = obj.children.map((c) => ({ ...c, status: c.user_must_do ? 'pending' : 'pending' }));
        }
        return true;
      }
      if (obj.children) {
        for (const child of obj.children) {
          if (child.id === objectiveId) {
            child.status = status;
            return true;
          }
        }
      }
    }
    return false;
  };

  updateInObjectives(phase.objectives);

  // Auto-unlock next phase if all objectives in current phase are complete
  if (status === 'complete') {
    const allComplete = phase.objectives.every((o) => o.status === 'complete');
    if (allComplete) {
      const currentIdx = phases.findIndex((p) => p.id === phaseId);
      if (currentIdx >= 0 && currentIdx < phases.length - 1) {
        phases[currentIdx].completed = true;
        phases[currentIdx].active = false;
        phases[currentIdx + 1].active = true;
        phases[currentIdx + 1].locked = false;
      }
    }
  }

  await supabase
    .from('roadmap_plans')
    .update({ phases, updated_at: new Date().toISOString() })
    .eq('company_id', companyId);

  return { phases };
}

/**
 * Auto-complete objectives related to an approved agent output.
 * Matches by agent_type to relevant objectives.
 */
async function autoCompleteObjectivesOnApproval(companyId, agentType, outputData) {
  const { data: roadmap } = await supabase
    .from('roadmap_plans')
    .select('*')
    .eq('company_id', companyId)
    .single();

  if (!roadmap) return;

  const phases = roadmap.phases || [];
  let updated = false;

  for (const phase of phases) {
    if (phase.locked || phase.completed) continue;

    for (const obj of phase.objectives) {
      // Auto-check objectives that:
      // 1. Are auto_checkable
      // 2. Either have a matching agent_source OR are default objectives (agent_source: null)
      // but NOT marked as user_must_do at the root level
      if (obj.auto_checkable !== false && !obj.user_must_do && obj.status !== 'complete') {
        const agentMatches = !obj.agent_source || obj.agent_source === agentType;
        if (agentMatches) {
          obj.status = 'complete';
          if (obj.children) {
            obj.children = obj.children.map((c) => ({
              ...c,
              status: c.user_must_do ? c.status : 'complete'
            }));
          }
          updated = true;
        }
      }
    }
  }

  if (updated) {
    await supabase
      .from('roadmap_plans')
      .update({ phases, updated_at: new Date().toISOString() })
      .eq('company_id', companyId);
  }

  return { phases };
}

/**
 * Add objectives contributed by an agent's approved output.
 */
async function addAgentContributedObjectives(companyId, agentType, outputData) {
  if (!outputData || !outputData.objectives) return;

  const { data: roadmap } = await supabase
    .from('roadmap_plans')
    .select('*')
    .eq('company_id', companyId)
    .single();

  if (!roadmap) return;

  const phases = roadmap.phases || [];

  for (const obj of outputData.objectives) {
    const targetPhase = obj.phase ? phases.find((p) => p.id === obj.phase) : phases.find((p) => p.active || !p.locked);
    if (!targetPhase) continue;

    targetPhase.objectives.push({
      id: `agent-${agentType}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      label: obj.label || `Objective from ${agentType}`,
      type: obj.type || 'objective',
      status: 'pending',
      agent_source: agentType,
      auto_checkable: true,
      children: (obj.children || []).map((c) => ({
        ...c,
        status: 'pending',
        user_must_do: c.user_must_do || false,
      })),
    });
  }

  await supabase
    .from('roadmap_plans')
    .update({ phases, updated_at: new Date().toISOString() })
    .eq('company_id', companyId);

  return { phases };
}

/**
 * Regenerate the roadmap (called periodically or on-demand).
 */
async function regenerateRoadmap(companyId) {
  // Generate fresh
  return await generateRoadmap(companyId);
}

module.exports = {
  getOrCreateRoadmap,
  generateRoadmap,
  regenerateRoadmap,
  updateObjectiveStatus,
  autoCompleteObjectivesOnApproval,
  addAgentContributedObjectives,
  generateTailoredPhaseObjectives,
  buildDeepCompanyContext,
  getRoadmapTemplate,
  PHASE_TEMPLATES,
  DEFAULT_OBJECTIVES,
};
