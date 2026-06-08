# BRAIN aOS — Brand Identity & Design System
*by RecallLabs*

This document outlines the core visual system, typography, color palettes, and tone of voice extracted from the Brain aOS brand identity and marketing interface.

---

## 1. Brand Core & Strategy

### The Mission
To build the world’s most structured, autonomous corporate operating system that relinks distributed company memory—diarized transcripts, calendars, documents, CRM feeds—into a centralized, self-learning cognitive graph.

### Brand Attributes
*   **Structured Intelligence**: Decisions and automation are stage-gated, safe, and verifiable. 
*   **Minimalist Authority**: Swiss-inspired layout, low layout density, and clean typographic grids.
*   **Cairo Roots**: Cairo-engineered, serving global organizations outside of Silicon Valley.
*   **Living System**: Organic color gradients representing fluid, shifting data in an otherwise structured environment.

---

## 2. Color Palette

The color system is built around a "Mercury Flow" concept—combining a stark, premium black-and-white canvas with a continuously shifting fluid gradient.

### Core Canvas
| Color Name | Hex Code | Usage |
| :--- | :--- | :--- |
| **Ink Black** | `#000000` | Primary dark background, immersive frames, footer panels |
| **Carbon** | `#181818` | Dark cards, container fills, primary light-theme text |
| **Paper White** | `#ffffff` | Primary light background, primary dark-theme text |
| **Ash** | `#6d6d6d` | Sub-labels, labels, monospace indicator borders |
| **Smoke** | `#9a9a9a` | Secondary paragraph text, disabled states, borders |

### The Mercury Gradient (Signature Accents)
The signature element is a flowing, high-contrast tri-color gradient representing fluid intelligence.
*   **Mercury Green**: `#a0e0ab` (represents activation, success, start-states)
*   **Mercury Orange**: `#ffac2e` (represents processing, mid-points, warnings)
*   **Mercury Red**: `#a52d25` (represents execution boundaries, locks, endpoints)

*Gradient Specification:*
```css
background: linear-gradient(135deg, #a0e0ab, #ffac2e, #a52d25);
```

---

## 3. Typography & Hierarchy

Brain aOS uses a high-contrast combination of geometric sans-serif typefaces (for readability) and structured monospace tags (for mechanical, technical framing).

### Font Stack
*   **Primary Typeface**: `Inter` (Sans-serif)
*   **System UI Monospace**: `system-ui` (used for tags, section headers, codes)
*   **Display Accent**: `Raleway` (used sparingly for display text)

### Typographic Hierarchy
| Role | Font Family | Size / Leading | Style Guidelines |
| :--- | :--- | :--- | :--- |
| **Hero Title** | `Inter` | `clamp(4.5rem, 14vw, 14rem)` / `0.76` | Font weight: 300 (Light). Minimal kerning. |
| **Section Title** | `Inter` | `54px` / `1.21` | Font weight: 300. Gradient text-clipping. |
| **Body Large** | `Inter` | `18px` / `1.36` | Font weight: 300. High readability. |
| **Body Text** | `Inter` | `16px` / `1.39` | Font weight: 300. Light-medium contrast. |
| **Mono Labels** | `system-ui` | `9px` / — | All-caps, `letter-spacing: 0.2em`, weight: 400. |

---

## 4. Logo Guidelines

The Brain aOS logo represents the human-machine collaboration: a structured, symmetric split-brain icon combined with a flowing gradient.

### The Icon
- **Outline Path**: Created using two symmetric lobes based on the Lucide `brain` icon, but with a thicker stroke width (`1.6px` to `1.8px`).
- **Gradient Fill**: The outline stroke must always be clipped/colored with the animated signature **Mercury Gradient**.
- **Variants**:
  - **Transparent** (`assets/logo_transparent.png`): Primary logo. Used for white/dark canvases.
  - **Black Background** (`assets/logo_black.png`): Immersive branding.
  - **White Background** (`assets/logo_white.png`): Traditional print and light-theme layouts.

### Wordmark Lockup
The text accompanying the logo is written in all-caps except the "a" in aOS, representing *autonomous Operating System*.
*   **Format**: `BRAIN aOS`
*   **Weight**: Regular (`400`) or Semi-Bold (`600`) Inter.
*   **Letter Spacing**: `0.1em` for header layouts.

---

## 5. Tone of Voice

Our voice is **scientific, structured, and editorial**. We do not use typical SaaS hyper-marketing, rather technical, authoritative communication.

| What We Are | What We Are Not | Example |
| :--- | :--- | :--- |
| **Authoritative & Exact** | Hype-driven or Vague | *"We build structured, diarized cognitive graphs from calendar integrations."* |
| **Human-in-the-Loop** | Fully-Auto or Unsupervised | *"AI agents execute tasks only after explicit review and checklist approval."* |
| **Cairo-Proud** | Silicon Valley Mimics | *" Cairo, Egypt. Intelligence built on structure."* |
| **Editorial & Precise** | Conversational or Casual | *"Your spot on the private beta waitlist is secured. Cohorts onboard weekly."* |

---

## 6. RecallLabs Parent Brand Guidelines

RecallLabs is the parent brand and research laboratory responsible for Brain aOS. Its identity is focused on scientific infrastructure and structured data.

### The Icon
- **Vector Shape** (`assets/recalllabs_logo.svg`): An interlocking node loop forming a stylized geometric letter **"R"**. It represents data nodes and neural intersections, conveying research, storage, and retrieval.
- **Stroke & Gradient**: Designed using a `1.6px` stroke width colored with the rotating Mercury Gradient, establishing brand lineage with the Brain aOS product family.
- **Variants**:
  - **Transparent** (`assets/recalllabs_logo_transparent.png`): Primary logo for digital layout integrations.
  - **Black Background** (`assets/recalllabs_logo_black.png`): Immersive dark mode assets.
  - **White Background** (`assets/recalllabs_logo_white.png`): Formal corporate print and light-theme templates.

### Wordmark Lockup
- **Format**: `RecallLabs`
- **Weight**: Bold (`600`) for the "Recall" stem to represent durability, and light (`300`) for "Labs" to reflect scientific precision.
- **Font**: Inter (Sans-serif)

### Parent Company Banner
- **Format** (`assets/recalllabs_banner.png`): A wide corporate asset (1200x630 px) with a dark background and three blurred Mercury Gradient blobs. Features the geometric RecallLabs "R" logo, the parent company wordmark lockup, and the slogan:
  - **Subtitle**: `Autonomous Cognitive Architecture`
  - **Top Label**: `Intelligence Infrastructure`

