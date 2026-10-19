# Locked UI decisions (the user made these; never override them, even if a shadcn example differs)

- No modals or dialogs anywhere. Confirms, edits and search happen inline in place (InlineConfirm, inline rename input, sidebar search box).
- Model + reasoning: ONE brain icon button in the composer opening a Popover with the model list and a stepped reasoning slider (StepSlider). Never two dropdowns. Only gpt-6.1-sol / gpt-6-astra / gpt-6-luna.
- The brain picker also shows on the New chat draft; a chat is created only by its first message.
- Sidebar: search box at the top filters chats; hits are static text under the chat title (best hit + "+N more"), not hoverable rows. Chat rows: double-click/F2 rename inline, trash appears instantly on hover (only its color transitions), inline delete confirm. Subagent rows run full width to the right edge, retire on hover with inline confirm.
- Footer: shadcn sidebar-07 nav-user (avatar + email, menu with ChatGPT plan, Manage usage, Disconnect, Log out). Debug section is an inline collapsible above it.
- Thread: shadcn chat-demo motion (MessageScroller autoScroll, user message is the scroll anchor, slide-up enter for new user messages only, Streamdown animated streaming with caret). History never animates in.
- The page itself never scrolls; only the thread scrolls (no body overscroll).
- Toasts: title + description, shadow elevation, only the icon is red on errors.
- See research/ui-acceptance.md for the review criteria that must also hold.

## 2026-10-19 (user, after the bots rebuild)

- Follow DESIGN.md (Apple x Linear for messaging, iMessage feel). It overrides shadcn defaults and earlier styling notes.
- No decorative icons: minimal and intentional, "icons everywhere feel like a sticker book for children". Activity lines,
  panel sections, list rows, menus and empty states carry no icons.
- Tools are shown as intent and outcome in editorial words: each call's `intent` (written by the model) and whether it
  succeeded, never tool names, arguments, SQL or JSON on the surface.
- Work in a race phase then a polish phase. Everything must fit together and look professional and complete.

## 2026-10-19 (user, replies + questions)

- Typing then sent replaces streamed replies (supersedes "Streamdown animated streaming with caret" above): a typing
  bubble while a text block is written, then the whole bubble; each text block is its own message.
- A bot's question (`ask`) is an async card in the thread; clicking an option sends it as your next message and never
  blocks the bot.
- Replies: "Reply" on any message, or "Quote" on text selected inside one bubble, puts a chip over the composer. In a
  bot chat the quote travels as "> <sender> said:" lines before your words; in a group, Reply targets that message
  (`replyTo`) and a reply to a bot's message reaches that bot.
- Groups have a description ("What it's for"): set when starting the group, edited in place in its panel, read by every
  member bot as part of its instructions.
