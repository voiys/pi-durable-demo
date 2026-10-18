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
