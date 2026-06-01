# Cortex OS — Zero-Budget Viral Marketing Playbook

**Version 1.0 | May 2026**
**Classification: Internal — Founding Team Only**

---

## Table of Contents

1. Executive Summary
2. Current State Assessment
3. Competitive Landscape
4. Target Audience
5. Brand Voice & Messaging Framework
6. Content Strategy
7. Channel Playbook
8. Viral Mechanics
9. 30-Day Launch Calendar
10. KPIs & Milestones
11. Budget (Zero-Dollar Constraint)

---

## 1. Executive Summary

Cortex OS is a multi-tenant AI operating system that ingests a company's entire knowledge base — meetings, documents, Slack, email — into a persistent semantic memory store, then lets users query it in natural language with source citations. A central orchestrator delegates tasks to specialized AI agents (Finance, HR, Sales, Marketing, etc.) with human-in-the-loop approval on write actions.

This playbook outlines how to go from zero to thousands of signups without spending a dollar on paid marketing. The strategy relies on:

- **Build-in-public content** that showcases technical depth
- **Contrast positioning** against incumbents (Fireflies, Notion, Artisan)
- **Community-driven growth** (Product Hunt, Hacker News, Reddit, Indie Hackers)
- **Seeding to micro-influencers** in the AI/productivity space
- **A viral demo experience** that sells itself

---

## 2. Current State Assessment

### What Exists
- **Backend**: 109 JS files, 24 Supabase migrations, working orchestrator, Sentinel pipeline, 10 agent definitions, meeting ingestion, document processing,semantic routing, rollback engine, audit logging, RBAC
- **Frontend**: 23 TSX/TS files, Next.js dashboard with chat, agents, decisions, documents, meetings, memory health, roadmap, settings pages
- **Marketing site**: Neo-Brutalist landing page (index.html + style.css), currently NOT deployed (Vercel URL returns 404)
- **Assets**: 2 SVG architecture diagrams, 1 pitch deck (DOCX), 1 technical plan (DOCX)
- **Demo video**: Does not exist yet — CRITICAL GAP

### Critical Gaps to Fix Before Launch Day
1. **Deploy the marketing site** to Vercel with a working email capture form
2. **Record a 60-second demo video** — this is the single most important marketing asset
3. **Create a waitlist database** (Supabase table: email, source, created_at)
4. **Make the CTA buttons functional** — "Sign Up for Early Access" currently goes nowhere

### What's NOT Needed Right Now
- Paid ads (no budget, no conversion data)
- Blog/SEO (6-month game, need signups now)
- Influencer budget (organic seeding only)
- PR agency (DIY outreach)

---

## 3. Competitive Landscape

### Direct Competitors (competing for the same user need)

| Competitor | What They Do | Their Strength | Your Advantage |
|---|---|---|---|
| **Notion AI** | AI embedded in workspace/wiki | 30M+ users, compliance certs | Real agent orchestration, multi-tenant, human-in-the-loop |
| **Fireflies.ai** | AI meeting transcription + summaries | Best-in-class transcription, 4.8/5 G2 rating | Goes beyond transcription to action + delegation |
| **Artisan (Ava)** | AI BDR for outbound sales | Proven ROI, paying customers, press coverage | Platform breadth (all departments vs. sales only) |
| **Dust** | Team AI collaboration | Clean UI, European enterprise presence | Meeting engine, rollback, roadmap/decision features |
| **Glean** | Enterprise search across apps | $200M+ funding | Agent delegation, proactive suggestions, rollback |
| **Polsia** | "AI runs your company" marketing | Bold positioning, viral messaging | You have a real product; they have a landing page |

### Your Positioning Statement
**"Fireflies transcribes your meetings. Cortex OS acts on them."**

This is your north star for all competitive messaging. It's short, contrastive, easy to understand, and demonstrably true.

---

## 4. Target Audience

### Primary: Tech-Spain / Solo Founders (1-10 employees)
- Building their first company
- Drowning in meetings, docs, Slack, email
- Can't afford to hire ops/VA
- Active on Twitter, Indie Hackers, Product Hunt
- Will try new tools based on a good demo video

### Secondary: Startup Teams (10-50 employees)
- Scaling fast, losing institutional knowledge
- Already using Fireflies/Notion but hitting limits
- Need department-level automation (sales, marketing, finance)
- Founders are technical, will appreciate architecture

### Tertiary: Mid-Market SMBs (50-200 employees)
- Looking for competitive advantage without linear headcount growth
- Need enterprise governance (RBAC, audit logs, compliance)
- Longer sales cycle — not the initial target

### Where They Hang Out
- Twitter/X (AI community, build-in-public, startup Twitter)
- LinkedIn (enterprise decision-makers)
- Reddit (r/artificial, r/SaaS, r/startups, r/LocalLLaMA)
- Hacker News (technical audience, Show HN)
- Product Hunt (early adopters)
- Indie Hackers (bootstrapped founders)
- YouTube (AI tool reviewers, productivity channels)

---

## 5. Brand Voice & Messaging Framework

### Brand Personality
- **Technical but not academic.** You explain complex architecture in plain language.
- **Bold but not hypey.** Polsia says "NEVER HIRE AGAIN." You say "Fireflies transcribes. Cortex OS acts." Show, don't tell.
- **Founder-led.** You ARE the brand. Every post should sound like a builder, not a marketer.
- **Contrastive.** Always position against the default choice. Not "we're an AI OS" — "We're what Fireflies would be if it could take action."

### Messaging Hierarchy

**Elevator pitch (5 seconds):**
"Cortex OS is an AI operating system that remembers everything about your company and acts on it."

**One-liner (15 seconds):**
"Cortex OS ingests your meetings, documents, email, and Slack into a persistent memory. Ask it anything — 'What did we decide about pricing?' 'What are my open action items?' — and get instant answers with source citations. It doesn't just store information. It delegates tasks to AI agents that draft emails, create follow-ups, and run workflows. All with your approval."

**Key messages by audience:**

*For solo founders:*
"You can't afford a COO. Cortex OS is your AI operating team — finance, sales, marketing, ops — for the price of a coffee."

*For startup teams:*
"Your team's knowledge is scattered across 7 tools. Cortex OS unifies it, makes it searchable, and acts on it."

*For technical audiences:*
"Multi-tenant AI OS with pgvector hot memory, Pinecone cold storage, Sentinel PII scrubbing, RBAC at the DB level, and a rollback engine on every write action. Built in Cairo. Open for beta."

### Phrases That Work
- "Fireflies transcribes. Cortex OS acts."
- "Your company's second brain"
- "Ask your company anything"
- "AI that actually knows your business"
- "From meeting to action in 2 seconds"
- "Every decision, every document, every action item — instantly searchable"
- "Human-in-the-loop AI. Because you should always be the one pressing send."
- "Built in Cairo. Shipping to the world."

### Phrases That Don't Work
- "We're an AI-powered solution" (vague, every startup says this)
- "Revolutionize your workflow" (cliche)
- "Leverage the power of AI" (cliche)
- "The future of work" (too broad)
- Anything that sounds like a press release

---

## 6. Content Strategy

### Content Pillars

**Pillar 1: Build in Public (40% of content)**
Your development journey. Architecture decisions. Screenshots. Milestones.
Why it works: People follow journeys, not products. It builds trust, attracts technical audience, and is infinitely renewable.

**Pillar 2: Contrast Content (25% of content)**
How Cortex OS compares to Fireflies, Notion, Artisan, etc. Not bashy — genuinely helpful comparisons.
Why it works: Piggybacks on existing search traffic and audience interest. Positions you as the "next level" option.

**Pillar 3: Educational/How-To (20% of content)**
"How enterprise AI should handle PII," "Why agent governance matters," "How to build a rollback engine."
Why it works: Positions you as a thought leader. Gets shared by engineers and CTOs. Long-tail search value.

**Pillar 4: Product Updates + Social Proof (15% of content)**
New features, user milestones, testimonials, use cases.
Why it works: Creates urgency and FOMO. "We hit 500 beta users" is social proof.

### Content Formats

| Format | Platform | Frequency | Effort |
|---|---|---|---|
| Twitter threads | X/Twitter | 3-4x/week | Medium |
| Twitter one-liners | X/Twitter | Daily | Low |
| LinkedIn posts | LinkedIn | 3x/week | Medium |
| Reddit posts | Reddit | 1-2x/week | Medium |
| Blog-style threads (long-form) | X/Twitter + LinkedIn | 1x/week | High |
| Product Hunt discussion | Product Hunt | On launch | High |
| Hacker News Show HN | HN | Once (big launch) | High |
| YouTube/TikTok demo clips | YT/TT/Reels | 2-3x/week | Medium |
| Cold outreach DMs | X + LinkedIn | 10-20/day | Low |

### The Content Flywheel
1. Write a Twitter thread about an architecture decision
2. Cross-post the key insight to LinkedIn as a text post
3. Summarize it as a Reddit post in r/artificial
4. Expand into a longer-form blog-style post
5. Clip the best 30 seconds as a TikTok/Reel
6. Next thread references the previous one — followers go back and read

Each piece of content multiplies across 4-5 channels. One hour of writing = 4-5 pieces of content.

---

## 7. Channel Playbook

### Channel 1: X/Twitter (PRIMARY — 50% of effort)

**Why:** The AI agent/startup community lives here. Build-in-public thrives here. Viral threads drive thousands of signups.

**Profile setup:**
- Bio: "Building Cortex OS — an AI OS that remembers everything about your company and acts on it. Fireflies transcribes. CortexOS acts. Beta open."
- Pinned tweet: Demo video + waitlist link
- Header image: Product screenshot or architecture diagram
- Location: Cairo, Egypt (your differentiator)

**Posting strategy:**
- Daily one-liners (observations, hot takes, product screenshots)
- 3-4 threads per week (architecture deep-dives, build-in-public updates, contrast posts)
- Daily engagement: reply to 20-30 accounts in the AI/startup space. Add value. Don't pitch.

**Accounts to follow and engage:**
- @karpathy, @swyx, @levelsio, @paul_graham, @sama, @ab265 (Andrew Ng)
- AI agent builders and researchers
- YC founders and batch accounts
- Productivity/startup tool makers
- Tech Twitter in the MENA region

**Thread templates (see Asset 2 for full threads):**
1. Architecture deep-dive (how the orchestrator works)
2. Contrast post (Fireflies vs. Cortex OS)
3. Build-in-public (development journey)
4. Founder story (building from Cairo)
5. Technical tutorial (PII scrubbing, RBAC, etc.)

### Channel 2: LinkedIn (SECONDARY — 20% of effort)

**Why:** Enterprise decision-makers, VCs, and startup founders are here. The "building from Cairo" story resonates powerfully.

**Profile setup:**
- Headline: "Founder @ Cortex OS | Building an AI Operating System from Cairo"
- About: Your story + the product + the mission
- Featured: Demo video, waitlist link

**Posting strategy:**
- 3x/week text posts (longer, more reflective than Twitter)
- Engage with VCs, enterprise software founders, AI leaders
- Share the Cairo/underdog angle
- Post architecture diagrams with enterprise-governance framing

**Content angles:**
- "Why enterprise AI needs human-in-the-loop governance"
- "Building an AI OS from Cairo — week [X] update"
- "The meeting memory problem nobody is solving"
- "How we built multi-tenant RBAC at the database level"

### Channel 3: Reddit (STEALTH — 15% of effort)

**Why:** Highly targeted audiences, zero cost, high intent. r/artificial and r/Saas have millions of members.

**Rules:**
- NEVER lead with a link or product mention
- Share genuine insights, architecture, lessons learned
- "I built X, here's how it works" format
- Link to demo video in comments WHEN ASKED

**Target subreddits:**
- r/artificial (1.8M members)
- r/SaaS (200K members)
- r/startups (1.2M members)
- r/LocalLLaMA (150K members)
- r/productivity (2M members)
- r/entrepreneur (1.5M members)
- r/webdev (2M members) — for architecture content

### Channel 4: Hacker News (CREDIBILITY — 5% of effort, HIGH impact)

**Why:** A top Show HN can drive 5,000-20,000 visitors in 24 hours. The HN audience is technical, influential, and writes about what they discover.

**When to post:** When you have a working demo anyone can try. Tuesday-Thursday, 8-10am EST.

**Post format:** "Show HN: Cortex OS — an AI operating system that ingests your company's knowledge and acts on it"

**Preparation:**
- Have your best technical writer help craft the post
- Be ready for brutal, honest feedback
- Don't get defensive in comments
- Link to the demo prominently

### Channel 5: Product Hunt (TRAFFIC SPIKE — 5% of effort, HIGH impact)

**Why:** A top-5 product gets thousands of visitors in a day. PH users are exactly your target audience (early adopters, startup people, AI enthusiasts).

**Preparation (2 weeks before launch):**
- Create PH account, build profile
- Line up 50+ people to upvote on launch day
- Prepare: screenshots (5), demo video, tagline (160 chars), description (500 chars), maker comment
- Find a hunter with PH clout (someone with 100+ followers on PH)

**Launch day strategy:**
- Post at 12:01 AM PST (PH timezone)
- Message all upvote commitments simultaneously
- Post in PH discussions throughout the day
- Respond to every comment within 5 minutes

### Channel 6: YouTube / TikTok / Shorts (DISCOVERY — 5% of effort)

**Why:** Short-form video is the highest-reach organic format in 2025-2026. AI content performs extremely well.

**Content ideas:**
- 30-second demo clips ("Ask your company anything" format)
- "POV: Your AI just read every meeting, email, and doc your company ever created"
- Screen recordings of the dashboard with voiceover
- "Building an AI OS in my apartment in Cairo"

**Posting:** 2-3x/week. Vertical format (9:16) for TikTok/Reels, horizontal for YouTube.

---

## 8. Viral Mechanics

### Mechanic 1: Itself Product Is Viral
- **"Powered by Cortex OS"** watermark on every generated document, email draft, meeting summary
- **Shareable meeting summaries** — one-click share a meeting summary link (non-users can view)
- **Public demo chat** — a version of Ask Cortex OS pre-loaded with sample company data. Let people experience the magic, then gate the real thing behind signup.

### Mechanic 2: Referral Loop
- "Invite a teammate, both get [premium feature] free for a month"
- Built into the product from day one of beta
- Track referral source via unique invite codes

### Mechanic 3: Demo-First Funnel
The demo video is your #1 growth lever. Here's the funnel:
1. Someone sees a Twitter TikTok Reddit post → clicks demo video
2. Demo video ends with "Beta open — link in bio"
3. They land on waitlist page → enter email
4. They get a welcome email with "Share with a founder who needs this" + referral link

### It must be sub-90 seconds. It must show the "holy shit" moment.**

### Mechanic 4: Social Proof Milestones
- "500 companies on the waitlist" → post it everywhere
- "1,000 beta signups" → bigger post, LinkedIn + Twitter
- User testimonials → screenshot + quote graphics
- "We just processed 10,000 meetings" → architecture can handle scale

### Mechanic 5: Controversy (Use Carefully)
The AI agent space has genuine debates you can weigh in on:
- "Should AI agents be able to send emails without human approval?" (You say no — Sentinel.)
- "Is RAG enough, or do we need persistent memory?" (You say persistent.)
- "Can one AI department replace an entire team?" (You say no — but it can replace the *repetitive* work.)

Controversial (but defensible) positions get shared and debated = free reach.

---

## 9. 30-Day Launch Calendar

### Week 1: Foundation (Days 1-7)

| Day | Action | Deliverable |
|---|---|---|
| 1 | Deploy marketing site to Vercel with email capture | Live URL with waitlist |
| 1 | Create Supabase waitlist table (email, source, created_at) | Working signup DB |
| 2 | Record 60-second demo video | Loom/YouTube link |
| 2 | Edit and upload demo video | Published video |
| 3 | Set up Twitter profile (bio, header, pinned tweet) | Optimized profile |
| 3 | Set up LinkedIn profile update | Updated profile |
| 4 | Post first Twitter thread (see Asset 2, Thread 1) | Thread published |
| 4 | Post first LinkedIn post | Post published |
| 5 | Post build-in-public thread on Twitter | Thread published |
| 5 | Engage with 20 AI/startup accounts | Replies posted |
| 6 | Submit to BetaList, StartupList | Submissions confirmed |
| 7 | Post Reddit thread in r/artificial | Post published |
| 7 | Draft cold outreach templates (see Asset 4) | Templates ready |

### Week 2: Content Ramp (Days 8-14)

| Day | Action |
|---|---|
| 8 | Twitter contrast thread: "Fireflies transcribes. Cortex OS acts." |
| 9 | LinkedIn post: "Why enterprise AI needs human-in-the-loop governance" |
| 10 | Reddit post in r/SaaS |
| 10 | Begin cold outreach: 10 personalized DMs (see Asset 4) |
| 11 | Twitter thread: Architecture deep-dive (Sentinel pipeline) |
| 12 | TikTok/Reel #1: Demo video clip |
| 12 | Cold outreach: 10 more DMs |
| 13 | LinkedIn post: "Building an AI OS from Cairo" |
| 14 | Twitter thread: "How the rollback engine works" |
| 14 | Seed 5 free accounts to micro-influencers |

### Week 3: Community Building (Days 15-21)

| Day | Action |
|---|---|
| 15 | Twitter thread: "The meeting memory problem" |
| 15 | Engage with every comment on all posts |
| 16 | Reddit post in r/startups |
| 16 | Cold outreach: 10 DMs to founders who engaged with content |
| 17 | TikTok/Reel #2: "POV: Your AI just read every meeting" |
| 17 | Seed 5 more free accounts |
| 18 | Twitter thread: "Multi-tenant architecture at the data layer" |
| 18 | LinkedIn post on RBAC architecture |
| 19 | Begin Product Hunt preparation (screenshots, hunter, upvote list) |
| 19 | Seed 5 more free accounts |
| 20 | Twitter thread: "Agent delegation — how the Brain delegates tasks" |
| 20 | Cold outreach: 10 DMs |
| 21 | Final Product Hunt prep: confirm 50+ upvote commitments |

### Week 4: Launch Week (Days 22-30)

| Day | Action |
|---|---|
| 22 | PH Launch Day - 12:01 AM PST |
| 22 | Message all upvote commitments |
| 22 | Post on Twitter: "We just launched on Product Hunt" |
| 22 | Every comment on PH: respond within 5 minutes |
| 23 | HN Show HN post (if traction from PH) |
| 23 | Twitter: Product Hunt milestone updates |
| 24 | LinkedIn: "What we learned from our Product Hunt launch" |
| 24 | Reddit: Share PH experience in r/startups |
| 25 | TikTok/Reel #3: "We hit [X] signups" celebration |
| 25 | Seed final 5 free accounts |
| 26 | Twitter thread: Week 1 retrospective + what's next |
| 27 | LinkedIn post: User milestone / testimonial |
| 28 | Reddit post in r/LocalLLaMA: Architecture deep-dive |
| 29 | Compile week 4 metrics. Double down on what worked. Cut what didn't. |
| 30 | Update this playbook with learnings. Plan month 2. |

---

## 10. KPIs & Milestones

### Leading Indicators (Weekly)
| Metric | Week 1 Target | Week 2 Target | Week 3 Target | Week 4 Target |
|---|---|---|---|---|
| Twitter followers | 100 | 300 | 700 | 1,500 |
| Twitter impressions | 5,000 | 20,000 | 50,000 | 150,000 |
| LinkedIn followers | 50 | 150 | 300 | 500 |
| Demo video views | 500 | 2,000 | 5,000 | 15,000 |
| DMs sent | 0 | 30 | 60 | 90 |
| Demo video completion rate | — | — | 40%+ | 50%+ |
| Reddit upvotes (total) | 50 | 200 | 500 | 1,000 |

### Lagging Indicators (Weekly)
| Metric | Week 1 | Week 2 | Week 3 | Week 4 |
|---|---|---|---|---|
| Waitlist signups | 50 | 150 | 400 | 1,000 |
| Product Hunt votes | — | — | — | 300+ |
| HN upvotes | — | — | — | 100+ |
| PH ranking | — | — | — | Top 5 |
| Referrals generated | 5 | 20 | 60 | 150 |
| Micro-influencer mentions | 0 | 2 | 5 | 10 |

### Month 1 Big Goals
- **1,000 waitlist signups**
- **Top 5 on Product Hunt** (launch day)
- **10,000 demo video views**
- **1,500 Twitter followers**
- **50 DMs → trial conversations**
- **A working demo loop** that converts waitlist → active user

---

## 11. Budget (Zero-Dollar Constraint)

### Free Tools Stack
| Purpose | Tool | Cost |
|---|---|---|
| Marketing site | Vercel | $0 |
| Email capture | Supabase (waitlist table) | $0 |
| Demo video | Loom (free tier) | $0 |
| Screen recording | OBS Studio | $0 |
| Image editing | Canva (free tier) | $0 |
|短视频 editing | CapCut (free tier) | $0 |
| Link in bio | Linktree (free tier) | $0 |
| Form alternative | Tally.so (free tier) | $0 |
| Product Hunt | Product Hunt | $0 |
| Beta listing | BetaList / TinyLaunch / Indie Hackers | $0 |
| Analytics | Twitter analytics + Supabase queries | $0 |
| Scheduling | Post manually (authentic > scheduled) | $0 |

**Total budget: $0/month**

### What to Reinvest First (When Revenue Comes)
1. Custom domain for marketing site ($12/year)
2. Loom Pro for longer demos ($15/month)
3. Canva Pro for branded graphics ($13/month)

---

## Appendix A: Pre-Launch Checklist

Before Day 1 of the 30-day calendar, these must be done:

- [ ] Marketing site deployed to Vercel at thebrain-aios.vercel.app
- [ ] Waitlist signup form connected and working
- [ ] Demo video recorded (under 90 seconds)
- [ ] Demo video published and public
- [ ] Twitter account created and profile optimized
- [ ] LinkedIn profile updated
- [ ] Reddit accounts created (with some history/karma if possible)
- [ ] Product Hunt account created
- [ ] BetaList / Indie Hackers submissions drafted
- [ ] Supabase waitlist table created
- [ ] "Powered by Cortex OS" badge added to generated outputs
- [ ] Public demo chat working with sample data

---

*This playbook is a living document. Update it weekly with what's working, what's not, and what you've learned. The best marketing playbook is the one that evolves with real data.*
