# DESIGN.md — pi durable

> A quiet room where a team of agents works for you. Apple's restraint, Linear's precision, a messenger's warmth.

**Theme:** light first (Apple), dark as a first-class twin (Linear's midnight). **Platform:** desktop web, down to 320px.

Every agent working on UI reads this before touching a component. It wins over taste, over shadcn defaults and over
older notes. When a value here is missing, extend this file first, then build.

Sources (read 2026-10-19 on Refero Styles, styles.refero.design): Apple (`apple.com`, "white room with a single blue
switch"), Linear (`linear.app`, "midnight precision instrument"), Things (`culturedcode.com/things`, "Apple keynote at
half volume"), Signal (`signal.org`, "frosted privacy glass"). Contrast pairs below were measured, not estimated.

## 1. What this product is (verbs, not nouns)

Not "a chat app". It is: **handing research to a few tireless specialists, seeing at a glance who is working on what,
and trusting what comes back because you can open the receipts.** Every screen serves one of those three verbs:

- **Delegate:** writing to a bot or a group must feel like texting a person (iMessage).
- **Glance:** what each bot is doing, what's new since you looked, without opening anything (Linear's inbox/status).
- **Trust:** every claim has its sources, data and steps one click away, never in your face (Apple: chrome recedes).

## 2. Principles

0. **Minimal and intentional; no sticker book (user's call, 2026-10-19).** Icons only where a symbol beats a word
   (send arrow, close, the model brain). No icons on activity lines, panel sections, list rows, empty states or menu
   items. Typography, spacing and one blue do the work.

1. **One accent, one job.** Apple Blue `#0071e3` means "yours / act here": your bubbles, the send button, the one primary
   action per view, the active rail ring. Nothing decorative is ever blue.
2. **Chrome recedes, content speaks.** No borders where space works; hairlines (0.5–1px) where it doesn't; shadows only
   for things that truly float (popovers, the composer). (Apple, Linear)
3. **Type is the interface.** Hierarchy comes from size and weight in a narrow band (400/510/590), with negative tracking
   that tightens as size grows. No bold 700+ in UI. (Linear, Apple)
4. **Machine work reads like a sentence.** Tool calls, steps and agents' activity are plain-language lines in secondary
   gray; the raw thing (SQL, JSON, arguments) only behind a disclosure. (ours, from the user's brief)
5. **Every state is designed.** Empty, loading, streaming, working, error, offline, stopped, long, narrow. If a state has
   no design here, it isn't done.
6. **Calm motion.** Movement only to explain change (a message arriving, a panel opening); 150–300ms, ease-out, opacity +
   small translate; nothing on hover beyond color. Reduced motion → opacity only.

## 3. Color

### Light (default)

| Token | Value | Role |
|---|---|---|
| `--background` | `#ffffff` | Thread canvas (messages sit on pure white, like Messages) |
| `--canvas` | `#f5f5f7` | Apple Frost: rail, side panel, page behind cards |
| `--surface` | `#ffffff` | Lifted cards on the canvas (Things two-tone) |
| `--muted` | `#e9e9eb` | Incoming bubble fill (iMessage gray) |
| `--foreground` | `#1d1d1f` | Primary text (Apple Carbon) — 15.46:1 on canvas, 13.88:1 on `--muted` |
| `--muted-foreground` | `#6e6e73` | Secondary text, activity lines, timestamps — 5.07:1 on white, 4.66:1 on canvas |
| `--faint` | `#86868b` | Placeholders, disabled, decorative only (3.62:1 — never body text) |
| `--hairline` | `rgb(0 0 0 / 0.08)` | Dividers, card edges, input borders |
| `--primary` | `#0071e3` | Apple Blue — white text on it 4.70:1 |
| `--primary-foreground` | `#ffffff` | |
| `--destructive` | `#d70015` | Errors, delete — always with an icon or words, never color alone |
| `--highlight` | `rgb(255 214 10 / 0.35)` | Search hit wash |

### Dark (Linear midnight)

| Token | Value | Role |
|---|---|---|
| `--background` | `#08090a` | Void — thread canvas |
| `--canvas` | `#0f1011` | Carbon — rail, panel |
| `--surface` | `#161718` | Obsidian — lifted cards |
| `--muted` | `#23252a` | Incoming bubble |
| `--foreground` | `#f5f5f7` | |
| `--muted-foreground` | `#8a8f98` | 6.13:1 on Void |
| `--hairline` | `rgb(255 255 255 / 0.08)` | |
| `--primary` | `#0071e3` | Kept: iMessage's dark `#0a84ff` fails white text (3.65:1) |

**Bot colors** are identity, not UI: the avatar palette (`BOT_COLORS`) only ever fills avatars and a 2px presence ring.
Never text, never buttons, never backgrounds.

## 4. Typography

- **Family:** `system-ui, -apple-system, "SF Pro Text", "Inter Variable", Inter, sans-serif` — SF on Apple devices
  (Things: "the restraint IS the brand"), Inter Variable elsewhere with `font-feature-settings: "cv01", "ss03"`
  (Linear). Mono: `ui-monospace, "SF Mono", "JetBrains Mono"` — only for IDs, SQL, code.
- **Weights:** 400 body, 510 emphasis/labels, 590 titles. Never 700+ in UI.
- **Scale (px / line-height / tracking):**

| Role | Size | LH | Tracking | Weight |
|---|---|---|---|---|
| Title (empty states, panel name) | 22 | 1.2 | -0.022em | 590 |
| Headline (section, bot name in panel) | 17 | 1.3 | -0.016em | 590 |
| Body (bubbles, composer) | 15 | 1.45 | -0.011em | 400 |
| Callout (activity lines, rail tooltips, lists) | 13 | 1.4 | -0.006em | 400/510 |
| Caption (timestamps, dividers, counts) | 11 | 1.3 | 0 | 510, `tabular-nums` |

Bubbles are 15px (Messages on macOS is ~15px); inputs are 16px below `md` (iOS zoom), 15px above.

**In code** the scale lives on Tailwind's own names (`src/styles.css`), so shadcn parts and class merging follow it:
`text-2xl` title, `text-lg` headline, `text-base` body, `text-sm` callout, `text-xs` caption (each carries its line-height
and tracking); `font-medium` is 510, `font-semibold` 590. No arbitrary `text-[Npx]` or `font-[N]` in components.

## 5. Space, shape, elevation

- **Grid:** 4px base. Ladder: 2, 4, 6, 8, 12, 16, 24, 32, 48. Between messages from the same sender: 2px; between
  senders: 12px; around a time divider: 24px.
- **Radii (four, no others):** 6px controls (Linear buttons/inputs), 12px cards/panels, 18px bubbles (iMessage), pill
  `9999px` for avatars-as-badges, the composer, and toggles. Nested surfaces: outer = inner + padding.
- **Elevation:** flat by default. Floating things only: popover/menu `0 8px 24px rgb(0 0 0/.12), 0 0 0 0.5px
  rgb(0 0 0/.08)`; composer `0 1px 2px rgb(0 0 0/.06), 0 0 0 0.5px var(--hairline)`. Dark: hairline inset
  `0 0 0 1px rgb(255 255 255/.06) inset` instead of drop shadows (Linear).
- **Layout:** rail 64px · thread max 720px centered · panel 320px · below 768px the panel replaces the thread.
- **Controls (src/components/ui):** heights 24/28/32/36 (buttons, toggles), inputs 36; menu and list rows 32 min. Hover
  is the translucent `--accent` fill on every surface; a selected toggle is ink (`--foreground`), never blue. Focus is a
  2px `--ring` outline 2px off the edge; rows in scrolling lists draw it 2px inside; inputs turn their border ring-color
  and add a 1px outline. Neutral fills (secondary buttons, chips) are `--muted`, as the incoming bubble is.

## 6. Components

### Rail
- Canvas fill, no border (the color step is the edge). Bots 36px squircle avatars (12px radius), main bot first with an
  8px gap + hairline. Groups after another hairline as overlapped round faces.
- **Glance layer (required):** a working bot shows a 2px ring in its own color, softly pulsing (opacity, 1.6s, off under
  reduced motion); unread shows a 8px blue dot top-right. Tooltip = name + one-line status ("Reading 3 pages…").

### Thread
- Pure white canvas. Header: centered avatar (24px) over name (13px/510) — tapping opens details (Messages' contact
  header). No horizontal rule; content scrolls under a 0.5px hairline that appears only once scrolled.
- **Bubbles:** yours `--primary` right; theirs `--muted` left; 18px radius; 10px/14px padding; max 75% width (520px).
  Consecutive bubbles from one sender group: only the last shows the tail-corner (4px radius on the outer bottom corner),
  only the first shows the sender name (groups), avatar only on the last.
- **Time divider:** caption, centered, `Today 12:11`, shown when 30+ min pass. No lines.
- **Delivered/read:** under your last bubble, caption gray: "Delivered" → "Read" when the bot starts → "Working…" (live
  line) → the reply.
- **Intent and outcome (tools):** every tool call carries an `intent` the model writes for the user ("Checking
  Cloudflare's official limits page for the row-size cap"). The thread shows intents as editorial lines, never tool
  names, icons, arguments or raw output. While running: the intent with a shimmer. Settled: the intent in muted ink, its
  outcome after it in the same voice ("found it", "3 sources", or "didn't work: the page was down"). A run reads like a
  short paragraph of what the bot set out to do and how each attempt went; details (sources as links, a data table, the
  report) only on request.
- **Activity (superseded by intent and outcome):** a single 13px secondary line with a leading 14px icon above the reply ("Searched the web, read 3 pages,
  saved data"), chevron on hover only; expands into steps; steps expand into sources/data. Running: shimmer on the text,
  never a spinner.
- **Artifacts:** reports, tables and links render as cards (12px radius, surface fill, hairline) inline after the
  activity line: title 13px/510, description caption, no icon tile (§2.0). Click opens in the side panel.
- **Links in bubbles** are underlined in the bubble's own ink, as in Messages: blue on the gray bubble is 3.9:1.
- **Agent messages** (another bot, a helper, a routine): group-chat style (avatar + name), or a centered caption
  ("Routine ai-news ran", "scout brought in digger") for system events.

### Composer
- Floating pill on the thread canvas: 44px min height, pill radius, composer shadow, 15px text. Left: model brain (24px
  ghost). Right: send — 28px blue circle with a white up-arrow, appears enabled only with text; while running it becomes
  a stop square in `--muted`.

### Side panel
- Canvas fill, 320px, sections separated by 24px space (no rules), section titles caption/510 uppercase-free, sentence
  case. Destructive actions last, ghost, red only on hover + inline confirm.

### Empty states
- Title 22/590, one sentence 15px secondary, one primary action. For a new bot: its avatar large (56px), name, and three
  suggestion chips that send a first message ("Research …", "Every morning, …", "Build me a table of …").

## 7. Motion

| What | Spec |
|---|---|
| Your message arrives | opacity 0→1, y 12→0, blur 4→0, 300ms ease-out (`SLIDE_UP`) |
| Reply/agent message | opacity only, 200ms |
| Panel open/close | width/opacity 200ms `cubic-bezier(0.2,0,0,1)`; content fades 150ms |
| Disclosure | height via `--radix-collapsible-content-height`, 200ms |
| Press | scale 0.96, 150ms, buttons only |
| Hover | color/background only, ≤150ms |
| Working ring / shimmer | 1.6s loops; none under `prefers-reduced-motion` |

## 8. Words

Sentence case everywhere. Activity in plain verbs, past tense when done ("Read developers.cloudflare.com"), progressive
while running ("Reading…"), "Stopped" when interrupted, "Couldn't …" when failed, plus what to do. Never show tool
names, IDs, SQL or JSON outside a disclosure. Bots are named, never "the AI".

## 9. Don't

- No second accent color, no gradients in UI, no glassmorphism blur panels.
- No borders around the thread, the rail or the panel — color steps and space separate them.
- No bold 700+, no all-caps labels, no letter-spacing on body.
- No spinners where a shimmer or a progress sentence works.
- No modals (UI decisions are inline; research/ui-decisions.md).
- No raw `bg-blue-500`-style colors in components — tokens only.

## 10. How we check (outside judges, not taste)

- `/interfaces:break` harness per new component (worst-case content, 360/600/900px).
- Measured contrast for every new text/background pair (script in the browser, numbers in the PR).
- Keyboard walk + accessible names (no unnamed control), 320px reflow, reduced motion.
- Screenshot diff of the reference scenes (thread with activity, group, details panel, empty bot) before/after.
