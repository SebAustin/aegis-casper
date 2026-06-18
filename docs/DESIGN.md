# Aegis — UI/UX Design Specification

**Version:** 1.0  
**Date:** 2026-06-18  
**Applies to:** FR-D-01 through FR-D-08, FR-W-01 through FR-W-04  
**Design tokens file:** `docs/design/tokens.css`

---

## Table of Contents

1. [Visual Direction](#1-visual-direction)
2. [Design Tokens Summary](#2-design-tokens-summary)
3. [Information Architecture](#3-information-architecture)
4. [Layout — Cockpit Grid](#4-layout--cockpit-grid)
5. [Responsive Behavior](#5-responsive-behavior)
6. [Component Specifications](#6-component-specifications)
7. [Motion and State Transitions](#7-motion-and-state-transitions)
8. [Accessibility Requirements](#8-accessibility-requirements)
9. [Microcopy Guide](#9-microcopy-guide)
10. [Open Design Risks](#10-open-design-risks)

---

## 1. Visual Direction

### Named Style: Deep Space Instrument Panel

The reference world is a high-stakes monitoring environment — a mission-control room, a naval combat information center, a financial terminal used by people who do not make casual decisions. This is not a marketing page. It is a cockpit for capital.

**Why this fits Aegis:**
- The agent runs autonomously. The human's role is monitoring and override, not operation. The UI should feel like an instrument panel: dense, honest, precise, always live.
- On-chain state is immutable and verifiable. The aesthetic should match: hard edges, no decorative softness, real data rendered without disguise.
- The Casper Network audience is technical. A swiss-grid, data-forward layout with serious typography signals competence without requiring explanation.
- Trustworthiness is the primary design job. An interface that looks like it was generated from a template undermines the claim that the underlying system is sophisticated.

**Mood keywords:** cold authority, operational readiness, measured precision, low-latency awareness.

**Not:** a consumer fintech app, a dark-mode SaaS dashboard, a crypto landing page with gradient blobs.

### Palette Character

Near-black blue-black backgrounds (not pure #000000, which reads as cheap) with cold steel mid-layers. Two accent axes:

- **Amber gold** — the primary action color and the "instrument needle" color. Used for: primary CTAs, active allocation segments, the Trigger Agent Run control, currently focused instrument. Draws the eye to the most important interactive element.
- **Cyan-green** — the live-signal color. Used for: live polling indicator, oracle feed, positive reputation delta, healthy status chips. Connotes real-time data flowing.

These two are never used simultaneously in the same visual cluster. They anchor different information domains.

### Typography Pairing

- **Space Grotesk** (display/headings): Geometric grotesque with subtle quirks — not neutral, has instrument-gauge energy. Used for all headings, nav, panel titles, and the large stat numbers.
- **JetBrains Mono** (data): Monospaced with strong character differentiation for 0/O, 1/l. Used for: account hashes, transaction hashes, basis-point numbers, APY values, balances. The mono type signals "this is raw chain data."
- **Inter** (body): Neutral, maximum legibility at 12–14px. Used for all running text, rationale snippets, labels, helper text.

Pairing principle: headings and data values use Space Grotesk or JetBrains Mono; prose and captions use Inter. Never mix them within the same semantic unit.

### Design Quality Criteria Demonstrated

This design demonstrates at minimum six of the required qualities:

1. **Scale-contrast hierarchy** — The vault balance renders at `--text-3xl` in Space Grotesk against `--text-xs` labels. Reputation score is large; its denominator is small. Contrast is 5:1 minimum within each data cluster.
2. **Intentional spacing rhythm** — Panels use a strict 24px inner padding, 16px inter-cell gap, 40px section separation. No uniform padding everywhere: the decision feed uses 12px row padding, oracle rows use 16px, stat cards use 24px.
3. **Depth and layering** — Three distinct background levels (`--color-bg-void`, `--color-bg-panel`, `--color-bg-raised`) create real Z-depth. Modals sit on a fourth level with `--shadow-modal`. Allocation chart uses a subtle inner glow on the active segment.
4. **Typography with a real pairing strategy** — Space Grotesk display + JetBrains Mono data + Inter body. Each has an explicit role; they do not interchange freely.
5. **Designed hover/focus/active states** — Every interactive element has three distinct states beyond default. Details are in Section 6.
6. **Editorial / bento composition** — The cockpit uses a 12-column grid with intentionally unequal cells. Vault overview spans 5 columns; allocation chart spans 4; reputation spans 3. This is not a uniform card grid.
7. **Motion that clarifies** — Allocation segments animate width/opacity on reallocation. Decision feed items slide in from below. Polling indicator pulses. All on compositor-friendly properties only.

---

## 2. Design Tokens Summary

Full implementation-ready values are in `/docs/design/tokens.css`. Summary for builders:

### Core Color Roles

| Token | oklch Value | Role |
|---|---|---|
| `--color-bg-void` | `oklch(7% 0.008 250)` | Page canvas |
| `--color-bg-panel` | `oklch(11% 0.010 252)` | Panel / sidebar surface |
| `--color-bg-raised` | `oklch(15% 0.012 253)` | Cards, bento cells |
| `--color-bg-overlay` | `oklch(18% 0.014 254)` | Modal backdrop content area |
| `--color-text-primary` | `oklch(94% 0.006 255)` | Headings, key values |
| `--color-text-secondary` | `oklch(68% 0.012 255)` | Labels, meta |
| `--color-text-muted` | `oklch(45% 0.010 255)` | Placeholders, disabled |
| `--color-accent-gold` | `oklch(78% 0.165 72)` | Primary action, active instrument |
| `--color-accent-cyan` | `oklch(75% 0.160 185)` | Live signals, healthy state |
| `--color-positive` | `oklch(72% 0.155 150)` | Gains, successful tx |
| `--color-warning` | `oklch(80% 0.165 65)` | Low confidence, caution |
| `--color-danger` | `oklch(60% 0.220 27)` | Errors, paused vault, loss |

### Contrast Compliance

All primary-text-on-background combinations exceed WCAG 2.1 AA (4.5:1 for normal text, 3:1 for large text):

| Foreground | Background | Computed Ratio | Status |
|---|---|---|---|
| `--color-text-primary` | `--color-bg-void` | ~13.5:1 | AAA |
| `--color-text-primary` | `--color-bg-panel` | ~11.2:1 | AAA |
| `--color-text-secondary` | `--color-bg-panel` | ~5.8:1 | AA |
| `--color-text-muted` | `--color-bg-panel` | ~3.2:1 | AA Large only — use only for 18px+ or bold 14px+ |
| `--color-accent-gold` | `--color-bg-void` | ~8.4:1 | AAA |
| `--color-accent-cyan` | `--color-bg-void` | ~7.9:1 | AAA |
| `--color-text-inverse` | `--color-accent-gold` | ~9.1:1 | AAA |
| `--color-danger` | `--color-bg-panel` | ~4.6:1 | AA |

Note on `--color-text-muted`: restrict use to non-essential decorative labels. Never use it for meaningful content that a user needs to read to complete a task.

### Font Stack

```css
--font-display: 'Space Grotesk', system-ui, sans-serif;
--font-body:    'Inter', system-ui, sans-serif;
--font-mono:    'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
```

Load via `@fontsource/space-grotesk`, `@fontsource/inter`, `@fontsource/jetbrains-mono`. Only load weights 400, 500, 600 for Space Grotesk and Inter; 400, 500 for JetBrains Mono. Use `font-display: swap`.

---

## 3. Information Architecture

### Primary Surfaces

```
Aegis Dashboard
├── /                     Cockpit (main dashboard — all panels visible at once)
│   ├── Vault Overview     (FR-D-01)
│   ├── Allocation Chart   (FR-D-01)
│   ├── Agent Reputation   (FR-D-02)
│   ├── Decision Feed      (FR-D-03)
│   ├── Oracle Panel       (FR-D-04)
│   └── Deposit / Withdraw (FR-D-05) — modal overlay triggered from vault panel
└── [Header]
    ├── Wallet Connect     (FR-W-01, FR-W-02)
    └── Trigger Agent Run  (FR-D-07)
```

This is a single-page application. There are no sub-routes in MVP. All panels are visible simultaneously on the cockpit at 1440px. On smaller breakpoints, panels reflow vertically.

### Key User Journeys

**Journey 1: Observer (no wallet)**

```
Land → See vault balance → Read current allocation → Watch decision feed refresh → 
Read last LLM rationale → Check oracle data → See agent reputation
```

No interaction required. The dashboard is a live read. Observer never hits a modal.

**Journey 2: Depositor**

```
Land → Connect wallet (header button) → Wallet connection modal → 
Confirm connected → Read balance → Click "Deposit CSPR" in vault panel → 
Deposit modal: enter amount → Review → Sign in Casper Wallet extension → 
Tx submitted → See tx hash → Poll confirmation → Balance updates in vault panel
```

**Journey 3: Withdrawer**

```
Connect wallet → See AEGIS share balance in vault panel → 
Click "Withdraw" → Withdraw modal: enter share amount, see CSPR estimate → 
Sign → Tx submitted → Balance updates
```

**Journey 4: Demo Operator (trigger run)**

```
Observe current allocation → Click "Trigger Agent Run" → Button shows loading state → 
Decision feed prepends new entry → Allocation chart animates to new state → 
Reputation score may update
```

### Information Priority Order (within each panel)

Panels follow the F-pattern: the primary number or status is top-left, labels follow, actions are bottom or trailing. This is consistent across all panels so users build a scanning habit.

---

## 4. Layout — Cockpit Grid

### 1440px Layout (Primary Demo Width)

The cockpit uses a 12-column grid with 16px gutters. All panels are direct children of the grid container.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ HEADER                                                                               │
│ [AEGIS logo + wordmark]                 [●Trigger Agent Run]  [Connect Wallet ▼]     │
│ h: 56px, sticky, bg: --color-bg-panel, border-bottom: 1px --color-border-subtle      │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│ MAIN COCKPIT GRID  (max-width: 1440px, padding: 0 32px, gap: 16px)                  │
│                                                                                      │
│  col:  1  2  3  4  5  │  6  7  8  9  │  10  11  12           │
│  ┌──────────────────┐  ┌─────────────┐  ┌──────────────────┐ │
│  │                  │  │             │  │                  │ │
│  │  VAULT OVERVIEW  │  │ ALLOCATION  │  │  AGENT           │ │
│  │  cols 1–5        │  │  CHART      │  │  REPUTATION      │ │
│  │  rows 1–2        │  │  cols 6–9   │  │  cols 10–12      │ │
│  │                  │  │  rows 1–2   │  │  rows 1–2        │ │
│  │  total balance   │  │  donut chart│  │  gauge + score   │ │
│  │  shares          │  │  + legend   │  │  decisions/acc   │ │
│  │  last realloc    │  │             │  │                  │ │
│  │  agent hash      │  │             │  │                  │ │
│  │  [Deposit][Wdraw]│  │             │  │                  │ │
│  └──────────────────┘  └─────────────┘  └──────────────────┘ │
│                                                                │
│  ┌────────────────────────────────┐  ┌──────────────────────┐ │
│  │                                │  │                      │ │
│  │  DECISION FEED                 │  │  ORACLE / x402       │ │
│  │  cols 1–7                      │  │  PANEL               │ │
│  │  rows 3–5                      │  │  cols 8–12           │ │
│  │                                │  │  rows 3–5            │ │
│  │  live-updating list            │  │  5 asset rows        │ │
│  │  each: timestamp, allocation,  │  │  APY / risk / liq    │ │
│  │  confidence, rationale snippet │  │  payment receipt     │ │
│  │  tx hash (if submitted)        │  │  freshness indicator │ │
│  │                                │  │                      │ │
│  └────────────────────────────────┘  └──────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Row heights:** The top row (vault + chart + reputation) has a minimum height of 280px. The bottom row (feed + oracle) is allowed to grow with content; minimum height 320px. The decision feed shows exactly 4 visible rows before scroll.

**Panel padding:** `--panel-padding` (24px) on all four sides. Panel radius: `--radius-xl` (16px). Panel border: 1px `--color-border-subtle`. Panel background: `--color-bg-raised`. Panel shadow: `--shadow-panel`.

### Exact Column Spans

| Panel | Column Span | Row Span | Notes |
|---|---|---|---|
| Vault Overview | 1–5 (5 cols) | 1 | Contains total balance as hero number |
| Allocation Chart | 6–9 (4 cols) | 1 | Donut/ring chart, 240px diameter target |
| Agent Reputation | 10–12 (3 cols) | 1 | Arc gauge + stat block |
| Decision Feed | 1–7 (7 cols) | 2 | Scrollable list, `aria-live` region |
| Oracle Panel | 8–12 (5 cols) | 2 | Table-style rows |

---

## 5. Responsive Behavior

### 1440px (Primary)

Full 12-column cockpit as specified in Section 4. All five panels visible simultaneously. Header is sticky.

### 1024px (Tablet Landscape)

Grid collapses to 8 columns. Panels restack:

```
Row 1: Vault Overview (cols 1–5) | Agent Reputation (cols 6–8)
Row 2: Allocation Chart (cols 1–4) | Oracle Panel (cols 5–8)
Row 3: Decision Feed (full width, cols 1–8)
```

Header: Trigger Agent Run button becomes icon-only (play icon + tooltip). Wallet button stays full-width label.

### 768px (Tablet Portrait)

Grid collapses to single column. Panel order (top to bottom):

1. Vault Overview
2. Allocation Chart (chart shrinks to 180px diameter)
3. Agent Reputation
4. Oracle Panel
5. Decision Feed

Header: both buttons are full-width; AEGIS wordmark truncates to logo mark only.

**Breakpoint tokens:**

```css
/* In global.css or layout.css */
@media (max-width: 1023px) { --grid-cols-cockpit: repeat(8, 1fr); }
@media (max-width: 767px)  { --grid-cols-cockpit: 1fr; }
```

Panels never shrink below 300px width. Below 320px (minimum supported width) the layout becomes a single column with `--panel-padding` reduced to `--space-4` (16px).

---

## 6. Component Specifications

---

### 6.1 Header

**Structure:**

```
<header role="banner">
  <a href="/" aria-label="Aegis home">
    [logo mark — 24×24 SVG] [AEGIS wordmark — Space Grotesk, 600, --text-md]
  </a>
  <nav aria-label="Cockpit controls">
    <TriggerAgentRunButton />
    <WalletConnectButton />
  </nav>
</header>
```

Background: `--color-bg-panel`. Bottom border: `1px solid var(--color-border-subtle)`. Height: `--header-height` (56px). `position: sticky; top: 0; z-index: 100`.

---

### 6.2 Wallet Connect Button

**Anatomy:** Pill-shaped control in the header trailing position. 40px minimum height. Horizontal padding: 16px. Uses `--font-body`, `--text-sm`, `--weight-medium`.

**States:**

| State | Visual |
|---|---|
| Default (disconnected) | bg: `--color-accent-gold-20`, border: 1px `--color-accent-gold-dim`, text: `--color-accent-gold`, label: "Connect Wallet" |
| Hover | bg: `--color-accent-gold-20` brightens to `--color-accent-gold-10` on border, text brighter, `--glow-gold` box-shadow |
| Focus | `--shadow-focus` ring (2px void + 4px gold outline), outline: none (handled via box-shadow) |
| Active / pressed | `transform: scale(0.97)`, bg darkens slightly |
| Loading (connecting) | Spinner icon replaces leading icon, label: "Connecting…", pointer-events: none |
| Connected | bg: `--color-bg-raised`, border: 1px `--color-border-default`, leading: green dot 6px pulsing, label: truncated account hash `[first 6]…[last 4]` in JetBrains Mono `--text-xs`, trailing: CSPR balance in secondary text |
| Hover (connected) | Reveal dropdown arrow, tooltip shows full account hash |
| Error | Border: `--color-danger`, text: `--color-danger`, label: "Connection Failed — Retry" |

**Connected dropdown menu** (appears below button, `--shadow-lg`, `--radius-md`, `--color-bg-overlay`):

- Row 1: Full account hash (mono, selectable/copyable, copy icon on hover)
- Row 2: CSPR balance (large, mono)
- Row 3: "Disconnect" action (danger tint on hover)

**Touch target:** minimum 44×44px. The button is at least 40px tall; on mobile bump to 44px.

**ARIA:**
- Button: `aria-label="Connect Casper Wallet"` when disconnected.
- When connected: `aria-label="Wallet connected: [truncated hash]. Click to manage."` 
- Dropdown: `role="menu"`, items: `role="menuitem"`.

---

### 6.3 Vault Overview Panel

**Layout:**

```
┌──────────────────────────────────────────────┐
│ VAULT BALANCE           [status chip]         │
│ ════════════════════════════════════════      │
│ 12,450.00  CSPR                              │
│ [mono, --text-3xl]  [--text-lg, secondary]   │
│                                               │
│ SHARES OUTSTANDING                            │
│ 12,450.000000  AEGIS                          │
│ [mono, --text-xl]                             │
│                                               │
│ ─────────────────────────────────────────    │
│                                               │
│ LAST REALLOCATION    AGENT                   │
│ 4m 32s ago           [hash chip]             │
│ [--text-sm]          [mono, --text-xs]       │
│                                               │
│ ─────────────────────────────────────────    │
│                                               │
│ [Deposit CSPR]              [Withdraw]        │
└──────────────────────────────────────────────┘
```

**Status chip** (top right of panel): pill badge, `--radius-full`, `--text-xs`, `--tracking-widest`, uppercase.
- Active: bg `--color-positive-dim`, text `--color-positive`, label "LIVE"
- Paused: bg `--color-danger-dim`, text `--color-danger`, label "PAUSED"
- Stale (data > 60s): bg `--color-warning-dim`, text `--color-warning`, label "STALE"

**Balance number:** Space Grotesk, `--weight-bold`, `--text-3xl`, `--color-text-primary`. The fractional part (`.00`) renders at 60% opacity to maintain hierarchy while keeping precision visible.

**Agent hash chip:** `--color-bg-void` background, `--radius-sm`, mono `--text-2xs`, icon: external-link 10px. Click/tap opens cspr.live in a new tab.

**Loading state:** The balance and shares render as skeleton shimmer blocks — same dimensions as the data, background animates from `--color-bg-raised` to `--color-bg-panel` and back, 1.5s loop, `--ease-in-out`. Label text is replaced by 60%-width gray bars.

**Empty state (vault balance is 0, no deposits yet):**

```
Balance: 0.00 CSPR
[Deposit CSPR to start earning yield]  ← secondary text, centered below
```

**Error state (CSPR.cloud fetch failed):**
Small inline alert below the balance: orange warning icon, `--color-warning` text, `--text-xs`: "Unable to fetch vault data. Retrying in 12s." No loading skeleton — show last known value with a `--color-text-muted` suffix "(cached)".

**Deposit button:** Primary — `--color-accent-gold` text, `--color-accent-gold-20` bg, gold border. See Section 6.7 for full button states.

**Withdraw button:** Secondary — `--color-text-secondary` text, transparent bg, `--color-border-default` border.

---

### 6.4 Deposit / Withdraw Modal Flow

**Trigger:** Deposit or Withdraw button in Vault Overview Panel.

**Modal structure:**

```html
<dialog role="dialog" aria-modal="true" aria-labelledby="modal-title">
  <header>
    <h2 id="modal-title">Deposit CSPR</h2>
    <button aria-label="Close deposit modal">✕</button>
  </header>
  <main>
    <!-- Step 1: Amount entry -->
    <!-- Step 2: Review -->
    <!-- Step 3: Signing (pending) -->
    <!-- Step 4: Submitted / Confirmed -->
  </main>
</dialog>
```

Backdrop: `--color-bg-void` at 85% opacity. Modal: `--color-bg-panel`, `--shadow-modal`, `--radius-2xl`, max-width 480px, `--modal-padding`. Enter animation: `opacity 0→1` + `transform: translateY(16px) → translateY(0)`, `--duration-normal`, `--ease-out-expo`. Exit: reverse.

**Step 1 — Amount Entry:**

```
[Modal header: "Deposit CSPR"]

Available: 1,250.00 CSPR     [MAX]
┌──────────────────────────────┐
│ [CSPR icon]  1000            │   ← input, mono, --text-xl
└──────────────────────────────┘
You will receive: ~1,000.000 AEGIS

[Continue →]
```

Amount input: `type="number"`, `inputmode="decimal"`, `min="0"`, `step="0.000001"`. Validation: inline error below field if amount exceeds balance or is below minimum. Error text: `--color-danger`, `--text-xs`, role="alert".

**Step 2 — Review:**

```
Depositing            1,000.00 CSPR
Receiving             ~1,000.000 AEGIS
Network fee           ~0.001 CSPR (estimated)
────────────────────────────────────────
[← Back]                    [Sign & Deposit]
```

"Sign & Deposit" button: `--color-accent-gold`, full-width at this step.

**Step 3 — Signing:**

```
[spinner icon, --color-accent-cyan]
Awaiting signature in your wallet…
Transaction has been sent to Casper Wallet.
Check the extension popup.

[Cancel]
```

Spinner: CSS `transform: rotate()` animation, 0.9s linear infinite. Reduced motion: no spin, static icon.

**Step 4 — Submitted:**

```
[checkmark icon, --color-positive, 48px]
Transaction Submitted

[copy icon]  a7f3…8c2b   [↗ View on cspr.live]
             [mono, --text-sm]

Confirming on-chain…
[progress pulse bar, --color-accent-cyan]

[Done]
```

Once confirmed: pulse bar completes, text changes to "Confirmed in block #1,234,567". Done button closes modal.

**Error at any step:**

```
[X icon, --color-danger]
Transaction Failed

User rejected signature in wallet.
[← Try again]  [Close]
```

**Focus management:**
- On modal open: focus moves to the modal's `<h2>` or first interactive element.
- `focus-trap` must be applied: tab cycles within the modal only.
- On modal close: focus returns to the button that opened it.

**Keyboard:** Escape closes modal (Step 1 and 2 only — not Step 3 while awaiting signature).

---

### 6.5 Allocation Chart

**Recommended visualization: Animated Radial Ring (Donut Chart)**

A donut chart is preferred over a bar chart here because:
- At 3–5 segments (the oracle provides 5 RWA assets), a donut communicates proportional area better than bars at the panel's width constraint.
- The center of the donut provides space for a live numeric read of the dominant allocation, reinforcing the instrument-panel aesthetic.
- It allows smooth arc-length animation on reallocation, which is the most visually compelling moment in the live demo.

**Specifications:**

- Outer radius: 110px. Inner radius: 72px. Gap between arc panel: 2px (visible as `--color-bg-raised` ring between segments).
- Chart diameter is capped at 240px; scales down proportionally.
- Container is `role="img"` with `aria-label="Current allocation chart"` — a text legend is also always present.
- SVG-based. Use pure SVG path or `stroke-dasharray` technique for the arcs — avoids Canvas accessibility issues.

**Segment color assignment** (consistent across chart and legend, never dynamically random):

| Asset Slot | Color |
|---|---|
| Asset 1 (highest APY) | `--color-accent-gold` |
| Asset 2 | `oklch(68% 0.14 185)` (mid cyan) |
| Asset 3 | `oklch(65% 0.12 280)` (steel blue) |
| Asset 4 | `oklch(60% 0.10 150)` (sage) |
| Asset 5 | `oklch(55% 0.08 320)` (muted violet) |

Colors are pre-assigned by position, not by asset ID, to keep the chart visually stable across reallocations.

**Center of donut:**

```
T-BILL
42.5%
[--text-xs, --color-text-secondary]
[--text-xl mono, --color-text-primary]
```

Shows the name and percentage of the largest-weight allocation. Updates on reallocation.

**Legend:** Horizontal list of pills below the chart. Each pill: colored 8px square swatch + asset name (`--text-xs`) + `XX.X%` (`--text-xs`, mono). Current active (highest weight) pill has `--color-bg-raised` background.

**Reallocation animation:** When allocation changes (detected during the 15-second poll cycle), the SVG arc `stroke-dasharray` values tween from old to new values over `--duration-slow` (400ms), `--ease-out-expo`. The center value cross-fades: old value fades to `opacity: 0`, new value fades in from `opacity: 0`. Requires `prefers-reduced-motion` check — if `reduce`, jump instantly.

**Loading state:** Three skeleton arcs (gray rings with shimmer), center shows `--` placeholder.

**Error state:** Ring renders flat (uniform distribution placeholder) with an inline error caption below: "Allocation data unavailable."

**Empty state (no allocation set yet):** Full ring in `--color-border-subtle` with center text "No allocation".

**Accessible alternative:** Below the chart, a visually hidden `<table>` (`.sr-only`) with Asset, Basis Points, and Percentage columns provides full data for screen readers.

---

### 6.6 Agent Reputation Panel

**Layout:**

```
┌──────────────────────────────┐
│ AGENT REPUTATION             │
│ ─────────────────────────    │
│                              │
│    [Arc gauge, 160px wide]   │
│         750                  │  ← --text-2xl, mono
│       Score                  │  ← --text-xs, secondary
│                              │
│ ─────────────────────────    │
│ DECISIONS   CORRECT   ACC.   │
│ 42          38        90.5%  │
│ [mono]      [mono]    [pos.] │
│                              │
│ Updated 2m ago               │
│ [--text-xs, muted]           │
└──────────────────────────────┘
```

**Arc gauge:**

A semicircular SVG arc, 180° sweep. Stroke width: 12px. Background arc: `--color-border-subtle`. Foreground arc: gradient from `--color-rep-low` (red) at 0° through `--color-rep-mid` (amber) at 90° to `--color-rep-high` (green) at 180°. The needle or fill position corresponds to `score / 1000` (assuming max 1000 based on on-chain u64 display capped for UI).

Expose the fill extent as a CSS custom property `--gauge-fill: 75%` and animate via `clip-path` or `stroke-dashoffset`. The fill animates from its previous value to the new value over `--duration-slow`, `--ease-spring`. This is the "instrument needle settling" moment.

**Accuracy percentage:** Uses `--color-positive` if above 80%, `--color-warning` if 60–80%, `--color-danger` if below 60%.

**ARIA:** `role="meter"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="1000"`, `aria-label="Agent reputation score"`.

**Loading:** Gauge arc is a full `--color-border-subtle` arc with shimmer. Score shows `—`.

**Error:** Gauge stays at last known value, a small warning chip appears: "Score unavailable".

---

### 6.7 Decision Feed

**Container:** `role="log"`, `aria-label="Agent decision feed"`, `aria-live="polite"`, `aria-relevant="additions"`. Scroll container: `overflow-y: auto`, shows 4 items before scroll, `scroll-behavior: smooth`.

**Poll indicator:** A thin 2px line at the top of the feed panel. Color: `--color-accent-cyan`. Animates: a 2px-tall progress bar that fills from 0% to 100% width over 15 seconds (`transform: scaleX()`), then resets. This visualizes the polling countdown. Reduced motion: static dashed line, no animation, text counter instead "Next update in Xs".

**Decision Feed Item:**

```
┌───────────────────────────────────────────────────────────────┐
│  [status icon]  14:32:07  ·  Confidence: 87%                  │
│                            [confidence badge]                  │
│  "Rebalanced toward T-Bills due to elevated risk in private    │
│   credit sector. Oracle data shows 340bps spread compression." │
│  [rationale text, --text-sm, Inter, --color-text-secondary]   │
│                                                                 │
│  T-BILL 42%  PRIV-CR 28%  COMMOD 15%  LIQ-ST 10%  OTHER 5%  │
│  [allocation micro-pills]                                       │
│                                                                 │
│  [↗ a7f3…8c2b]  [copy icon]                                    │
│  [tx hash chip, only if reallocation was submitted]            │
└───────────────────────────────────────────────────────────────┘
```

**Borders / spacing:** 12px vertical padding, 0 horizontal (full-width within panel). Divider: 1px `--color-border-subtle` between rows. No card background per row — the feed is a list within the panel, not cards within cards.

**Status icon:** 16px, left-leading.
- Reallocated: `--color-accent-gold` arrow-swap icon
- Skipped (below threshold): `--color-text-muted` dash icon, row is dimmer (0.7 opacity)
- Error: `--color-danger` warning icon

**Confidence badge:** Pill, `--radius-full`, `--text-2xs`, uppercase.
- ≥80: bg `--color-positive-dim`, text `--color-positive`
- 60–79: bg `--color-warning-dim`, text `--color-warning`
- <60: bg `--color-danger-dim`, text `--color-danger`

**Allocation micro-pills:** Horizontal flex row. Each pill: mono `--text-2xs`, `--radius-xs`, 4px padding horizontal, no background — just border `1px --color-border-subtle`. Max 5 pills (one per asset). If allocation has no reallocation (skipped), this row is omitted.

**Tx hash chip:** Only rendered if a transaction hash is present in the decision record. Mono `--text-2xs`. Click: opens cspr.live testnet explorer in a new tab. `aria-label="View transaction [full hash] on cspr.live"`, `rel="noopener noreferrer"`, target `_blank`.

**New item entrance animation:** On prepend, new item enters with `transform: translateY(-12px)` → `translateY(0)`, `opacity: 0` → `1`, duration `--duration-normal`, `--ease-out-expo`. Existing items shift down smoothly. Reduced motion: instant appearance.

**Empty state:**

```
[clock icon, --color-text-muted, 32px]
No decisions yet
The agent loop has not run.
[Trigger Agent Run →]   ← link to the trigger button
```

**Error state:** "Failed to load decision feed." with a retry button.

---

### 6.8 Oracle / x402 Panel

**Layout:**

```
┌──────────────────────────────────────────────────────┐
│ RWA ORACLE  ·  x402 GATED         [freshness chip]   │
│ ──────────────────────────────────────────────────   │
│ ASSET         APY       RISK    LIQUIDITY            │
│ ──────────────────────────────────────────────────   │
│ T-Bill        6.24%     18/100   92/100              │
│ Private Credit 9.10%    54/100   61/100              │
│ Commodities   7.80%     42/100   74/100              │
│ Liquid Staking 8.50%    35/100   88/100              │
│ Other         5.90%     22/100   95/100              │
│ ──────────────────────────────────────────────────   │
│ PAYMENT RECEIPT                                      │
│ [hash chip]  0.001 CSPR  ·  Paid via x402            │
│ [--text-2xs, mono, --color-text-muted]               │
└──────────────────────────────────────────────────────┘
```

**Freshness chip:** top right. Shows how old the last oracle fetch is.
- < 30s: `--color-positive` "FRESH"
- 30–60s: `--color-warning` "AGING"
- > 60s: `--color-danger` "STALE"

**Table structure:** `<table>` with `<thead>` / `<tbody>`. Column headers: `--text-2xs`, `--tracking-widest`, uppercase, `--color-text-muted`. Data rows: `--text-sm`. APY value: mono, `--color-text-primary`. Risk and Liquidity scores: small inline bar (`4px tall`, `48px wide`) + numeric value.

**Risk bar color:** maps to risk score — low risk (< 30): `--color-positive`; medium (30–60): `--color-warning`; high (> 60): `--color-danger`.

**Payment receipt hash:** Click copies to clipboard. Tooltip on hover: "Copy receipt hash". On copy: icon briefly swaps to checkmark for `--duration-normal`. `aria-label="Copy payment receipt hash"`.

**Loading state:** Skeleton table rows — each cell replaced by a gray shimmer bar of the appropriate column width.

**Error state (402 not resolved / facilitator failure):** "Oracle unavailable — x402 payment pending." with a `--color-warning` icon. Last known data shown with a `(cached)` label.

---

### 6.9 Trigger Agent Run Control

**Location:** Header, left of wallet connect button.

**Anatomy:** Button with play-icon leading glyph, label "Trigger Agent Run". Uses an outlined style distinct from both primary and secondary buttons to signal it is an operational control, not a navigation or financial action.

Border: 1px `--color-accent-cyan`. Text: `--color-accent-cyan`. Background: `--color-accent-cyan-10`. Height: 36px. Padding: 12px horizontal. Border radius: `--radius-md`.

**States:**

| State | Visual |
|---|---|
| Default | Outlined cyan, play icon |
| Hover | bg brightens to `--color-accent-cyan-20`, `--glow-cyan` box-shadow |
| Focus | `--shadow-focus` (gold ring — consistent with all focus rings) |
| Active / pressed | `transform: scale(0.96)`, bg `--color-accent-cyan-20` |
| Loading (agent running) | Play icon replaced by spinner, label "Running…", `pointer-events: none`, opacity 0.7 |
| Success (run complete) | Momentary flash: border `--color-positive`, icon checkmark, label "Done", reverts after 2s |
| Error | Border `--color-danger`, icon X, label "Failed", reverts after 3s, tooltip with error message on hover |

**Keyboard:** Activatable with Enter or Space. While loading, Enter/Space are ignored.

**ARIA:** `aria-label="Trigger immediate agent run"`, `aria-busy="true"` during loading.

At 1024px: icon-only (`aria-label` still present), tooltip on hover/focus.

---

### 6.10 Transaction Hash Treatment

Used in: decision feed, deposit modal, withdraw modal, oracle panel.

**Anatomy:** Inline chip with mono type.

```
[↗ icon]  a7f3c1…8c2b
[14px icon + --text-2xs mono + --color-accent-gold]
```

Clicking opens `https://testnet.cspr.live/deploy/[full_hash]` in `_blank` with `rel="noopener noreferrer"`.

**Truncation format:** First 6 chars + `…` + last 4 chars. Full hash always available in a tooltip (`title` attribute plus a custom tooltip for browsers that strip `title` on touch). Full hash is also always selectable via copy icon.

**Hover state:** Text color brightens to `--color-accent-gold-bright`, underline appears.

**Focus state:** `--shadow-focus` ring, then matches hover.

**ARIA:** `aria-label="View transaction [full hash] on cspr.live testnet explorer"`.

---

### 6.11 Primary and Secondary Button Tokens

**Primary (gold):**

```
background:      --color-accent-gold-20
color:           --color-accent-gold
border:          1px solid --color-accent-gold-dim
border-radius:   --radius-md
padding:         12px 20px
font:            --font-body, --text-sm, --weight-semibold
transition:      background --duration-fast, box-shadow --duration-fast
```

| State | Delta |
|---|---|
| Hover | bg → `--color-accent-gold-10` on border brightens, `--glow-gold` box-shadow |
| Focus | `--shadow-focus` |
| Active | `transform: scale(0.97)` |
| Disabled | `opacity: 0.4`, `cursor: not-allowed` |
| Loading | Spinner icon prepended, label appended with "…", pointer-events none |

**Secondary (neutral):**

```
background:    transparent
color:         --color-text-secondary
border:        1px solid --color-border-default
```

| State | Delta |
|---|---|
| Hover | bg: `--color-bg-raised`, border: `--color-border-strong` |
| Focus | `--shadow-focus` |
| Active | `transform: scale(0.97)` |
| Disabled | `opacity: 0.4` |

**Minimum touch target:** All buttons must have a minimum of 44×44px effective tap area, achieved via padding or an invisible pseudo-element if the visual size is smaller.

---

## 7. Motion and State Transitions

All animation uses compositor-friendly properties only: `transform`, `opacity`, `clip-path`. No animation on `width`, `height`, `top`, `left`, `color`, or `background-color` unless the user has not set `prefers-reduced-motion: reduce`.

### Transition Registry

| Element | Trigger | Property | Duration | Easing |
|---|---|---|---|---|
| Decision feed item entrance | New item prepended | `transform: translateY`, `opacity` | `--duration-normal` | `--ease-out-expo` |
| Allocation chart arc | Poll detects reallocation | `stroke-dashoffset` | `--duration-slow` | `--ease-out-expo` |
| Reputation gauge fill | Score update detected | `stroke-dashoffset` | `--duration-slow` | `--ease-spring` |
| Polling progress bar | 15s cycle | `transform: scaleX` | 15000ms | linear |
| Modal entrance | Open trigger | `transform: translateY`, `opacity` | `--duration-normal` | `--ease-out-expo` |
| Modal exit | Close trigger | `transform: translateY`, `opacity` | `--duration-fast` | `--ease-in-expo` |
| Button press | Active state | `transform: scale` | `--duration-instant` | linear |
| Trigger button success flash | Run complete | `opacity` | 2000ms total | ease |
| Wallet dropdown open | Click connected state | `transform: translateY`, `opacity` | `--duration-fast` | `--ease-out-expo` |
| Skeleton shimmer | Loading states | `transform: translateX` on pseudo `::after` | 1500ms | `--ease-in-out`, infinite |

### Pulse Animation (live status dot)

The green dot in the connected wallet button uses a CSS keyframe:

```css
@keyframes live-pulse {
  0%, 100% { transform: scale(1);   opacity: 1; }
  50%       { transform: scale(1.4); opacity: 0.6; }
}
/* Applied: animation: live-pulse 2s ease-in-out infinite */
/* @media (prefers-reduced-motion: reduce) { animation: none; } */
```

### Reduced Motion Fallback

When `prefers-reduced-motion: reduce` is set:
- All duration tokens resolve to `0ms` (handled in `tokens.css`).
- Polling progress bar becomes a static dashed border with text countdown instead.
- Allocation chart jumps instantly to new values.
- Modal appears instantly.
- Skeleton shimmer stops; background remains static `--color-bg-panel`.
- Gauge needle jumps.

No motion is required to understand any state. Every animation is a progressive enhancement.

---

## 8. Accessibility Requirements

### Target: WCAG 2.1 AA

### Contrast Ratios

Enforced minimum ratios:

| Use | Minimum Ratio | Applies To |
|---|---|---|
| Normal body text (< 18px normal or < 14px bold) | 4.5:1 | All foreground/background pairs |
| Large text (≥ 18px normal or ≥ 14px bold) | 3:1 | Headings, large numbers |
| UI components and icons (active states) | 3:1 | Borders in focus states, icon-only buttons |
| Focus indicator | 3:1 against adjacent color | The `--shadow-focus` gold ring vs `--color-bg-void` |

`--color-text-muted` (`oklch(45%)`) fails normal-text contrast on `--color-bg-panel`. It must never be used for:
- Form labels
- Error messages
- Required field markers
- Decision feed content
- Any text the user needs to complete a task

It is only permitted for: timestamps in decision feed after 24h, placeholder text (which has its own WCAG rule), and the `(cached)` suffix on stale data.

### Keyboard Navigation

**Tab order (cockpit page, natural DOM order):**

1. Skip-to-main link (visually hidden, appears on focus)
2. AEGIS logo link
3. Trigger Agent Run button
4. Wallet Connect button
5. Vault Overview: Deposit button → Withdraw button → Agent hash chip
6. Allocation chart legend (focusable pills, `tabindex="0"`, `role="listitem"`)
7. Decision feed: scroll container then each tx hash chip and copy button in order
8. Oracle panel: each row's copy action → payment receipt copy
9. Any open modal: captures all focus until closed

**Focus indicators:** Every interactive element must have a visible focus ring. The design uses `--shadow-focus` (2px void gap + 4px gold ring) applied via `box-shadow` rather than `outline` to preserve rounded corners. `outline: none` is only set when this custom ring is applied. Never set `outline: none` without a replacement.

**Skip Navigation:** A `<a href="#main-cockpit">Skip to dashboard</a>` link at the top of `<body>`. Visually hidden with `.sr-only` until focused, then visible at top of page.

### ARIA Requirements

**Live regions (FR-D-06: 15-second polling):**

The decision feed container must use:
```html
<section
  role="log"
  aria-label="Agent decision feed"
  aria-live="polite"
  aria-relevant="additions"
  aria-atomic="false"
>
```

`aria-atomic="false"` means screen readers announce only newly added items, not the entire feed on each update.

The vault balance and reputation score panels that update on polling must NOT use `aria-live="assertive"` or `role="alert"`. Use `aria-live="polite"` so announcements queue after the current screen reader speech. The vault balance panel:
```html
<output aria-live="polite" aria-label="Total vault balance">
  12,450.00 CSPR
</output>
```

**Allocation chart:** `role="img"` with `aria-label="Current portfolio allocation"`. The hidden `<table>` provides data-complete fallback.

**Reputation gauge:** `role="meter"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="1000"`, `aria-label="Agent reputation score: [value] out of 1000"`.

**Modal:** `role="dialog"`, `aria-modal="true"`, `aria-labelledby="[modal-heading-id]"`. Focus trap required.

**Buttons with icons only:** Always include `aria-label`. Never use an icon glyph as the only accessible name.

**Status chips and badges:** Use `aria-label` on the chip element itself to provide meaning, not just the visual color. Example: `<span role="status" aria-label="Vault status: active">LIVE</span>`.

**Tx hash external links:** `aria-label` with full hash and destination context. Include `<span class="sr-only"> (opens in new tab)</span>` or a visually hidden equivalent.

### Semantic HTML Structure

```html
<body>
  <a href="#main-cockpit" class="skip-link">Skip to dashboard</a>
  <header role="banner">
    <nav aria-label="Application controls">...</nav>
  </header>
  <main id="main-cockpit" aria-label="Aegis cockpit">
    <section aria-labelledby="vault-heading">
      <h2 id="vault-heading">Vault Overview</h2>
      ...
    </section>
    <section aria-labelledby="alloc-heading">
      <h2 id="alloc-heading" class="sr-only">Portfolio Allocation</h2>
      ...
    </section>
    <section aria-labelledby="rep-heading">
      <h2 id="rep-heading">Agent Reputation</h2>
      ...
    </section>
    <section aria-labelledby="feed-heading">
      <h2 id="feed-heading">Decision Feed</h2>
      <div role="log" aria-live="polite" ...>...</div>
    </section>
    <section aria-labelledby="oracle-heading">
      <h2 id="oracle-heading">Oracle Data</h2>
      ...
    </section>
  </main>
</body>
```

Panel headings (`<h2>`) may be visually styled at `--text-xs`, `--tracking-widest`, uppercase with `--color-text-muted` — but they must remain semantic headings. Do not replace them with `<div class="label">`.

### Touch Targets

All interactive elements: minimum 44×44px tap area. On 768px breakpoint:
- Buttons: `min-height: 44px`
- Row items in decision feed: `min-height: 48px`
- Tab/pill navigation: `min-height: 44px`

Insufficient-size elements (e.g., copy icon buttons at 16px visual size) must have `padding` or a transparent `::after` pseudo-element to hit 44×44px.

### Color Independence

No information is conveyed by color alone. Every status uses color plus one of: icon, text label, or pattern. Examples:
- Vault status chip: color + text label ("LIVE" / "PAUSED" / "STALE")
- Confidence badge: color + numeric value always shown
- Decision item status: color + icon + text label on hover/focus
- Risk bar in oracle panel: color + numeric score always shown

---

## 9. Microcopy Guide

### Labels and Headings

Use sentence case for everything except:
- Panel section labels: ALL CAPS with `--tracking-widest`, e.g., "VAULT BALANCE", "AGENT REPUTATION"
- Asset names in oracle table: all-caps abbreviations are acceptable, e.g., "T-BILL"

Avoid jargon where possible, but do not dumb down chain-specific concepts. The audience is technical.

### Empty States

| Surface | Empty Heading | Empty Body | Action |
|---|---|---|---|
| Decision feed, no runs | "No decisions yet" | "The agent loop has not run. Trigger a run to see live decisions." | "Trigger Agent Run" button link |
| Vault balance = 0 | (no heading) | "Deposit CSPR to begin earning yield through autonomous reallocation." | "Deposit CSPR" button |
| Oracle panel, no data | "Awaiting oracle data" | "The agent will fetch yield data on its next run." | None |
| Allocation chart, no allocation | "No allocation set" | "The agent will set an allocation on its first run." | None |

Empty states are centered within the panel, icon above (32px, muted), heading (`--text-md`, secondary), body (`--text-sm`, muted), optional action button.

### Error Messages

| Context | Message |
|---|---|
| CSPR.cloud fetch timeout | "Vault data unavailable. Retrying in [Xs]." |
| Oracle fetch failed | "Oracle data unavailable — x402 payment may have failed." |
| Decision log read error | "Could not load decision history." |
| Wallet connection rejected | "Connection declined. Check that Casper Wallet is unlocked." |
| Signature rejected by user | "Transaction cancelled. You can try again at any time." |
| Transaction submission failed | "Transaction could not be submitted. Check your CSPR balance and try again." |
| Agent run trigger failed | "Agent run failed to start. Check that the agent process is running." |

Error messages: concise, specific, never blame the user, always suggest a next action where one exists.

### Number Formatting

- CSPR balances: always 2 decimal places minimum, e.g., "12,450.00 CSPR" — comma-separated thousands.
- AEGIS shares: 6 decimal places, e.g., "12,450.000000 AEGIS".
- APY: 2 decimal places, percentage, e.g., "6.24%".
- Basis points: show as percentage in UI (divide by 100), e.g., "4,250 bps" → "42.5%".
- Confidence: integer, e.g., "87" — never "87.0" or "87%".
- Timestamps: relative for < 24h ("4m 32s ago"), ISO date for older ("2026-06-17 14:32").
- Tx hashes: always monospaced, truncated to `[6]…[4]`.

---

## 10. Open Design Risks

**Risk 1 — Decision feed density at 768px.**
At 768px, a decision item with allocation micro-pills, timestamp, confidence badge, and tx hash will be very dense. Mitigation: at 768px, collapse allocation micro-pills behind a "Show allocation" disclosure button, reducing the row to timestamp + confidence + rationale snippet. Priority: Medium.

**Risk 2 — Large numbers overflow vault balance cell.**
At 1024px, balances like "1,234,567.89 CSPR" may overflow the `--text-3xl` slot in a 5-column span. Mitigation: set `font-size: clamp(...)` that reduces on container width using container queries, or use a JS hook to detect overflow and reduce font size by one step. Priority: Medium.

**Risk 3 — Allocation chart with very small segments.**
If one asset has < 2% allocation, its arc segment may be invisible or overlap with the gap. Mitigation: enforce a minimum visual arc of 3° (1% visual floor) for all non-zero allocations; show actual percentage in legend regardless. Priority: Low.

**Risk 4 — Polling `aria-live` verbosity.**
With `aria-live="polite"` on both vault balance and decision feed, a screen reader user may hear constant announcements every 15 seconds. Mitigation: consider a user-controlled "Pause announcements" toggle (pause icon in feed header). This would set `aria-live="off"` on the region and re-enable manually. Priority: Medium — flag for post-buildathon but document now.

**Risk 5 — Casper Wallet SDK event handling timing.**
The deposit modal Step 3 (awaiting signature) relies on the Casper Wallet extension opening a popup. If the popup is blocked, the modal may wait indefinitely. Mitigation: add a 90-second timeout on Step 3 that reverts to Step 2 with an error: "Wallet popup may have been blocked. Check your browser and try again." Priority: High.

**Risk 6 — Contrast of allocation chart segment labels.**
Short allocation segment arcs will not have room for a text label on the arc itself — hence the decision to use a legend instead. The legend pill colors against `--color-bg-raised` must be verified. The pre-assigned segment colors in Section 6.5 are designed for this, but steel-blue (Asset 3) and sage (Asset 4) are close in lightness and may be confused by users with color vision deficiency. Mitigation: add a small letter badge (A, B, C, D, E) inside each legend pill and in the center of the segment on hover/focus. Priority: Medium.

---

*End of design specification. Token file: `/Users/sebastienhenry/Documents/Casper/docs/design/tokens.css`.*
