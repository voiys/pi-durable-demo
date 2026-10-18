# pi durable demo

Local-only demo: email/password accounts, each user connects their ChatGPT plan (Sign in with ChatGPT), and every chat is a pi-durable session in its own Durable Object. See PLAN.md, RESEARCH.md, DECISIONS.md, PAPERCUTS.md.

## Run

`mise install && pnpm install && echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" > .env && pnpm dev`, then open **http://127.0.0.1:1455** (not `localhost`: the ChatGPT callback is pinned to 127.0.0.1).

## Slices

1. Sign up / sign in, "Continue with ChatGPT", New chat, send a message, pi streams the reply.
2. Several chats in the sidebar, click one to reopen it; log out and sign in as another user: their sidebar is empty and `/agents/*` returns 403 for the other user's objects.
3. "Search messages" runs FTS5 bm25 over your own user + assistant messages in your User DO; a hit opens its chat.
4. ChatGPT connection card (account, Manage usage, Disconnect) and a per-chat model + reasoning-effort picker limited to what your plan offers.

## Checks

- `pnpm check:optchat-spec`: our OptChat code (labels, cursor, logging plan, pinned view, previous exchange, caps, compactor) against research/optchat-fix-plan.md Part 3, with fakes; no network.
- `pnpm check:optchat-e2e`: live, on the dev server as a@test.dev (ChatGPT connected; ~8 turns of the plan): logging once per entry, previous exchange, cross-chat recall, compression at a 2K budget, no label leaks.
- `pnpm check:optchat-upstream`: upstream pi-optchat's own memory test suite (vendored unchanged in `tests/optchat/test/`) run against our `src/optchat/memory.ts`; tests for modules we don't port are listed as n/a.

With `pnpm dev` running: `node scripts/infra-map.ts` (regenerates ARCHITECTURE.md; `--check` only verifies), `node scripts/isolation.ts` (user B vs user A's objects), `node scripts/lineage.ts` (traces one tagged message through every local SQLite file; needs ChatGPT connected for a@test.dev). Exit 0 = pass.
