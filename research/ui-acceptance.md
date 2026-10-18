# UI acceptance (from user review, 2026-10-18)

Each item is checked in the browser after the ui-polish workflow lands; none is "done" until seen rendered.

1. Agent messages render markdown: subagent replies ("[subagent X answered…]"), "[message from X]" and cross-chat messages use the same Markdown (Streamdown) as normal replies. No raw `**bold**` anywhere in the thread.
2. Cross-chat messages show the source chat as a chip (shadcn Badge/link) with the chat's title that opens that chat (`?chat=<id>`). No UUID visible anywhere in the thread.
3. Known tools render purpose-built, never raw JSON args:
   - search: `Searched memory for "<text>"` + hit count / "no matches"
   - zoom: `Opened memory <id>–<id+n-1>` (or `message <id>`) with the returned lines as a readable list, collapsed by default
   - date: `Checked the date of message <id>`
   - agents / subagent / sessions: one readable line per action (spawned / sent to / retired / listed …) with the agent or chat as a chip
   Only unknown tools fall back to the generic Tool pattern with a code block.
