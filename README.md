# pi durable demo

Local-only demo: email/password accounts, each user connects their ChatGPT plan (Sign in with ChatGPT), and every chat is a pi-durable session in its own Durable Object. See PLAN.md, RESEARCH.md, DECISIONS.md, PAPERCUTS.md.

## Run

`mise install && pnpm install && echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)" > .env && pnpm dev`, then open **http://127.0.0.1:1455** (not `localhost`: the ChatGPT callback is pinned to 127.0.0.1).

## Slices

1. Sign up / sign in, "Continue with ChatGPT", New chat, send a message, pi streams the reply.
2. Several chats in the sidebar, click one to reopen it; log out and sign in as another user: their sidebar is empty and `/agents/*` returns 403 for the other user's objects.
3. "Search messages" runs FTS5 bm25 over your own user + assistant messages in your User DO; a hit opens its chat.
4. ChatGPT connection card (account, Manage usage, Disconnect) and a per-chat model + reasoning-effort picker limited to what your plan offers.
