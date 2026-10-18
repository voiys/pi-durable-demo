# pi durable demo

Local-only demo: email/password accounts, each user connects their ChatGPT plan (Sign in with ChatGPT) and creates bots. A bot is one endless pi-durable conversation in its own Durable Object, with its own OptChat memory, subagents and routines. See PLAN.md, RESEARCH.md, DECISIONS.md, PAPERCUTS.md.

## Run

`mise install && pnpm install && printf "BETTER_AUTH_SECRET=%s\nSEARXNG_SECRET=%s\n" $(openssl rand -hex 32) $(openssl rand -hex 32) > .env && pnpm dev` (Docker running), then open **http://127.0.0.1:1455** (not `localhost`: the ChatGPT callback is pinned to 127.0.0.1).

## Slices

1. Sign up / sign in, "Continue with ChatGPT", New bot (name + instructions), message it, pi streams the reply.
2. Several bots in the rail, each its own conversation; log out and sign in as another user: their rail is empty and `/agents/*` returns 403 for the other user's objects.
3. Search (rail) runs FTS5 bm25 over every bot's user + assistant messages in your User DO; a hit opens that bot at the message.
4. ChatGPT connection in the account menu (Manage usage, Disconnect) and a per-bot model + reasoning-effort picker limited to what your plan offers.
5. Bot details (click its name): instructions, subagents, routines (ask the bot "every weekday at 8 do X"), memory budget and reset, delete. Bots message each other with the `bots` tool.
6. Research: bots search the web through a local SearXNG container (started by `pnpm dev` via alchemy; needs Docker), read pages, keep data in their own SQL workspace and save reports to their library (details panel).
7. Main bot: the first bot (or the one you pick) manages the rest: "make me a bot that…", rename, re-instruct, delete.
8. Group chats: + → New group, pick bots; @mention to route; disband from the group's details.

## Checks

- `pnpm check:optchat-spec`: our OptChat code (cursor, logging plan, pinned view, previous exchange, caps, work rows for bot/routine/subagent messages, compactor) against research/optchat-fix-plan.md Part 3, with fakes; no network.
- `pnpm check:optchat-e2e`: live, on the dev server as a@test.dev (ChatGPT connected; ~12 turns of the plan): logging once per entry, previous exchange, per-bot memory (bot Y doesn't know bot X's secret until told via the `bots` tool), compression at a 2K budget, recall after compression. Creates and deletes two bots.
- `pnpm check:optchat-upstream`: upstream pi-optchat's own memory test suite (vendored unchanged in `tests/optchat/test/`) run against our `src/optchat/memory.ts`; tests for modules we don't port are listed as n/a.

With `pnpm dev` running: `node scripts/infra-map.ts` (regenerates ARCHITECTURE.md; `--check` only verifies), `node scripts/isolation.ts` (user B vs user A's bots, on a throwaway victim bot), `node scripts/lineage.ts` (traces one tagged message through every local SQLite file and checks deleteBot removes it; one real turn of a@test.dev's plan). Exit 0 = pass.
