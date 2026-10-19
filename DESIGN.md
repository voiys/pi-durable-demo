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

**Bot colors** are identity, not UI: a bot's look (`LOOK_COLORS`) only ever fills its face.
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
- **Controls (src/components/ui):** heights 24/28/32/36 (buttons, toggles), inputs 36; menu and list rows 32 min, side panel rows 44. Hover
  is the translucent `--accent` fill on every surface; a selected toggle is ink (`--foreground`), never blue. Focus is a
  2px `--ring` outline 2px off the edge; rows in scrolling lists draw it 2px inside; inputs turn their border ring-color
  and add a 1px outline. Neutral fills (secondary buttons, chips) are `--muted`, as the incoming bubble is.

## 6. Components

### Faces
- Every bot is a bloub (`bloub-react`, MIT): a body shape, an ink color and a resting face, picked by the user — no
  letters. `BotAvatar` (`src/components/bot-avatar.tsx`) takes a look and a px size; the eyes are cut out of the body, so
  they show the surface behind on both themes. Helpers (and bots no longer in the catalog) are a plain gray circle.
  Sizes: rail 36, panel 48, empty state and new bot 56, thread sender 28, header 24, rows and lists 20.
- **Look** (details panel, under the identity; and in the new-bot form): one card, three rows (Shape 8, Color 10, Face
  16) of square tiles, each drawn as the look it would give; the picked tile `--muted`, hover `--accent`. Native radios
  (arrows within a row, Tab between rows); a pick saves at once and every face of that bot moves to it. Ink and cream
  are left out of the colors: each vanishes on one theme. New bots start on the next shape and color in line.

### Rail
- Canvas fill, no border (the color step is the edge). Bots as their 36px faces, main bot first with an 8px gap +
  hairline. Groups after another hairline: a 36px muted tile holding up to three member faces.
- **Glance layer (required):** a working bot's face becomes bloub's thinking dots (still dots under reduced motion);
  unread shows a 8px blue dot top-right. Tooltip = name + one-line status ("Reading 3 pages…").
  Bots only: groups get no working/unread marker in the rail, since you see who's working inside the room and groups are
  short-lived (decided 2026-10-19).

### Thread
- Pure white canvas. Header: centered avatar (24px) over name (13px/510) — tapping opens details (Messages' contact
  header). No horizontal rule; content scrolls under a 0.5px hairline that appears only once scrolled.
- **Bubbles:** yours `--primary` right; theirs `--muted` left; 18px radius; 10px/14px padding; max 75% width (520px).
  Consecutive bubbles from one sender group into one stack (a bot turn's words are one stack, activity between them
  or not): the stack's outer corners stay 18px, the corners where its bubbles meet drop to 4px on the sender's side
  (first: bottom; middle: top and bottom; last: top). Only the first shows the sender name (groups), avatar only on the last.
- **Time divider:** caption, centered, `Today 12:11`, shown when 30+ min pass. No lines.
- **Delivered:** under your last bubble, caption gray: "Delivered" → "Working…" (live line) → the reply. No "Read" step:
  a bot reads instantly, so it would only flash (decided 2026-10-19).
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
- **Typing, then sent (user's call, 2026-10-19):** replies never stream into a bubble. While the bot writes a text block
  a typing bubble shows (`role="status"`, "Typing…" for screen readers); once the block is done (a later block starts
  or the message is saved) the whole bubble appears. Each text block is its own bubble, so a turn reads as several
  messages; the bot is told to say one short line before longer work. Between a run's steps the activity line says
  "Thinking…" again, so the thread never looks idle while the bot works.
- **Replies and quotes:** "Reply" (caption, muted) beside a bubble on hover, keyboard focus or long press; "Quote" floats
  over text selected in a bubble, and ⌘L (Ctrl+L off Mac) does the same, or with nothing selected moves to the composer.
  Each puts a quote pill inline in the composer (see Composer). Your bubble shows its quotes
  as excerpts on top: a 2px rule in the bubble's ink, sender caption, two lines. One quote format everywhere:
  "> <sender> said:" lines, then a blank line, then your words. In groups, Reply sends the message id and the room
  quotes it for the bots; replying to a bot's message reaches that bot.
- **Question cards** (a bot's `ask`): a surface card (12px radius, hairline), the question 15/510, options as rows with
  muted letters A, B, C (no icons); each option is a button named by its text, `aria-pressed` for the pick. Picking
  sends your answer as a steer, so the bot hears it at its next step and never waits on it. Answered: the pick stays
  selected (muted fill, ink letter), the rest at 50%, nothing clickable; your bubble shows the pick, captioned "Answered".
- **Links in bubbles** are underlined in the bubble's own ink, as in Messages: blue on the gray bubble is 3.9:1.
- **Agent messages** (another bot, a helper, a routine): group-chat style (avatar + name), or a centered caption
  ("Routine ai-news ran", "scout brought in digger") for system events.

### Composer
- Floating pill docked over the thread's bottom: nothing around the pill is painted, so messages scroll on beneath it
  (no bottom fade); the thread keeps the composer's measured height free below its last message and the scroll-down
  button rides above it. 44px min height, pill radius, composer shadow, 15px text. No model picker: every bot runs one
  model (decided 2026-10-19). Right: send — 28px blue circle with a white up-arrow, appears enabled only with text; while running it becomes
  a stop square in `--muted`.
- **Quote pills** sit inline before the draft, in one wrapping row with it (Grok Bot): a 24px `--muted` pill with the
  sender (13/510), an excerpt in curly quotes cut to 24 characters (13/400, full ink: muted gray on `--muted` is 4.15:1),
  the whole quote as its tooltip, and a 24px round × ("Remove quote from Scout") flush in its end. The draft takes the
  rest of the row and drops to its own line under 8rem; its 1px pad makes its line the pills' 24px, so the one-line
  composer stays 44px. Backspace in an empty draft drops the last pill. Tab: each ×, draft, send. With no quotes
  nothing renders (no empty list for screen readers).
- **@-mentions** (groups): an `@` starting a word lists the members whose names start with what follows, in a popover
  card (shadow-float, 12px radius, 6px inset) 4px over the pill's start: 32px rows of a 20px face and the name (13/510),
  the active row `--accent`. Arrows move, Return or Tab puts `@name ` in, Escape closes until the next keystroke; the
  draft is a combobox pointing at the active option.
- **"Quote ⌘L"** floats over a selection: popover fill, solid `--muted` on hover; the `<kbd>` hint is caption gray,
  ink on hover, hidden from screen readers (the button carries `aria-keyshortcuts`).

### Side panel
- Inset grouped lists (iOS/macOS Settings at Linear's precision; primitives in `src/components/panel.tsx`). Canvas fill,
  320px, 16px gutter, a 48px header whose title (13/590) sits on the text edge. Each group: a caption title (11/510,
  muted, sentence case) over a surface card (12px radius, hairline edge), an optional caption footnote; groups 24px
  apart, flowing top-down with no pinned footer. Rows: 44px min, 12px inset, label 13/400 leading, value muted trailing
  (`tabular-nums`), hairline dividers inset to the text edge (past the face on rows with one). One text edge for
  everything: gutter + row inset (28px from the panel edge).
- Identity first: a card with the 48px face, the name edited in place (17/590, no box until hover or focus) and one muted
  line (role, member count, or the name's error) with "Saved" at its end. Long text fields (instructions, what a group
  is for) are the card itself: an auto-growing textarea with no box until focus, the focus ring drawn inside the card.
- Empty groups are left out, except Routines, which says how to add one. Role and destructive actions are the last
  group, as ink row buttons that turn red only on hover, then ask inline in the row (same 44px; `DangerRow`). A main
  bot has no such card: a footnote says why it can't be deleted. Footnotes and sentences standing in for a group are
  11/400 (prose, not labels), on the text edge. Routines show their whole prompt (it is the routine), the schedule as a
  caption under the name, the switch trailing; their Delete is a 32px hover-revealed text button that asks under the
  routine. Row actions revealed on hover also show on keyboard focus and always on touch screens.

### Empty states
- Title 22/590, one sentence 15px secondary, one primary action. For a new bot: its avatar large (56px), name, and three
  suggestion chips that send a first message ("Research …", "Every morning, …", "Build me a table of …").

## 7. Motion

One ladder and one easing family. Enters take 150ms (rows, menus, hover-revealed things), 200ms (fades, arrivals) or
300ms (your message, staged entrances); exits are one step shorter (100ms after a 150ms enter, else 150ms) or instant
where motion adds nothing. Everything eases out (`ease-out`, the panel's `cubic-bezier(0.2,0,0,1)`, springs with
`bounce: 0`); bare `transition-*` utilities ease out by default (`--default-transition-timing-function`). Transitions or
springs for state (they retarget mid-flight), keyframes only for one-shot fades and loops. Name the properties, never
`transition-all`; animate opacity, transform and filter only (height only through the collapsible's content variable).
State swaps use `initial={false}`, and history, panel lists and the rail on load never animate in. Presets live in
`src/lib/motion.tsx`.

| What | Spec |
|---|---|
| Your message arrives | opacity 0→1, y 12→0, blur 4→0, 300ms ease-out (`SLIDE_UP`) |
| Reply, other senders, system caption, time divider, working row | opacity 200ms in, 150ms out (`FADE`) |
| Reply being written | typing bubble (three dots, gray bubble, each dot breathing opacity .35→1, 1.2s, 150ms apart; still under reduced motion); the finished block replaces it whole with `FADE` |
| Quote chip, "Quote" over a selection | chip fades in 150ms; the button as a popover (opacity + zoom 0.96→1 + 4px, 150ms) |
| "Delivered" ↔ "Working…", who is working | words cross-fade in one grid cell (`CrossFade`, `FADE`), so the line never moves |
| Activity line settles | running line fades out 150ms (popped out of flow) while its outcome fades in 200ms in place |
| Lines fold into a summary | lines leave at once; summary opacity + blur 4→0, 200ms (`BLUR_IN`) |
| Saved report card | opacity + y 4→0, 200ms, 100ms after its line (`RISE`) |
| Send ↔ stop | fill color 150ms; icon scale 0.25→1, opacity, blur 4→0, spring 0.3s bounce 0 (`ICON`) |
| Jump to latest | opacity + scale 0.96→1, 150ms in, 100ms out, no slide |
| Rail face added / removed | opacity + y 4→0, 200ms in; opacity 150ms out (`ARRIVE`) |
| Unread dot | opacity + scale 0.6→1, spring 0.2s bounce 0; fades out 150ms |
| Active ring | always 2px, color only, 150ms |
| Panel open | opacity + x 8→0, 200ms `cubic-bezier(0.2,0,0,1)`; the thread takes its width at once; closes at once |
| Panel sections, report text, search hits | opacity 150ms on mount (replacing the skeleton) |
| Panel list rows, inline confirm swap | opacity 150ms in, 100ms out (`ROW`); trigger row and confirm share 44px (32px confirm + 6px pad) so nothing jumps |
| "Saved" caption | `FADE`, shown 1.5s after a field saves; the status region stays mounted |
| Menus, popover, tooltip, hover card | opacity + zoom 0.96→1 + 4px from the trigger side, 150ms in, 100ms out |
| Empty states, new bot, new group, empty-thread suggestions | chunks 100ms apart, each `SLIDE_UP` (`SETTLE`) |
| Login card | `FADE` |
| Disclosure | height via `--radix-collapsible-content-height`, 200ms |
| Press | scale 0.96, 150ms, buttons only, never disabled |
| Hover | color/background only, ≤150ms |
| Faces | alive on their own while on screen (bloub idle: drift, float, blink), each waking 0–2s late so they never blink as one; a new shape or face morphs, a new color cross-fades 300ms; one still frame under reduced motion and on the look picker's tiles |
| Shimmer | 1.6s loop; none under `prefers-reduced-motion` |

Reduced motion: `<MotionConfig reducedMotion="user">` at the root drops every movement and scale, `useCalm` swaps blur
recipes for `FADE`, `motion-safe:`/`motion-reduce:` gate the CSS ones and tw-animate's zoom and slide, so every change
becomes an opacity fade. Every animated change also leaves a static cue (words, color, the dot, the label).

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
