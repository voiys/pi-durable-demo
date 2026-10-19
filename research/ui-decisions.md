# Locked UI decisions (the user made these; never override them, even if a shadcn example differs)

- No modals or dialogs anywhere. Confirms, edits and search happen inline in place (InlineConfirm, inline rename, the
  rail's search).
- No model picker: every bot runs gpt-6.1-sol at low reasoning.
- Rail: the bots' faces (main bot on top), a hover card per face, search at the top, the account avatar at the bottom
  (ChatGPT plan, Manage usage, Disconnect, Log out). Faces look at the pointer.
- Thread: shadcn MessageScroller (user message is the scroll anchor, new user messages slide up, history never animates
  in). The composer floats over the thread on a transparent background; @ opens a mention list of the room's bots.
- The page itself never scrolls; only the thread scrolls (no body overscroll).
- Toasts: title + description, shadow elevation, only the icon is red on errors.

## 2026-10-19 (user, after the bots rebuild)

- Follow DESIGN.md (Apple x Linear for messaging, iMessage feel). It overrides shadcn defaults and earlier styling notes.
- No decorative icons: minimal and intentional, "icons everywhere feel like a sticker book for children". Activity lines,
  panel sections, list rows, menus and empty states carry no icons.
- Tools are shown as intent and outcome in editorial words: each call's `intent` (written by the model) and whether it
  succeeded, never tool names, arguments, SQL or JSON on the surface.
- Work in a race phase then a polish phase. Everything must fit together and look professional and complete.

## 2026-10-19 (user, replies + questions)

- Typing then sent replaces streamed replies: a typing
  bubble while a text block is written, then the whole bubble; each text block is its own message.
- A bot's question (`ask`) is an async card in the thread; clicking an option sends it as your next message and never
  blocks the bot.
- Replies: "Reply" on any message, or "Quote" on text selected inside one bubble, puts a chip over the composer. In a
  bot chat the quote travels as "> <sender> said:" lines before your words; in a group, Reply targets that message
  (`replyTo`) and a reply to a bot's message reaches that bot.
- Groups have a description ("What it's for"): set when starting the group, edited in place in its panel, read by every
  member bot as part of its instructions.

## 2026-10-19 — Bot faces are bloubs
- Letter avatars are gone. Every bot is a bloub (bloub-react 1.0.0, MIT) with a
  look the user picks: shape, color, resting face. Picked over grokbot-web on the user's call.
- Faces animate on their own (user: "make the faces autoanimate") and move between looks when one changes, morphs for
  shape and face, a cross-fade for color ("transition between updates, even when I pick different config options").
- A working bot's rail face becomes bloub's thinking dots; the colored working ring is gone.
- Clicking a bot's face in its panel opens its look (shape, color, face) in a popover.
- Group bubbles stack like iMessage: in a run of messages from one sender only the outer corners round.
