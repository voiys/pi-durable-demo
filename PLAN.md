# Plan

## Shape
- One Worker (alchemy `Cloudflare.Website.Vite`, TanStack Start) on **http://127.0.0.1:1455**. This port matches the SIWC callback `http://127.0.0.1:1455/auth/callback`, the same port pi and the devkit use.
- **D1**: better-auth tables only (email/password).
- **`User` DO** (agents `Agent`, name = better-auth user id):
  - chat catalog in agent state, so the sidebar syncs live
  - SIWC credentials (issued client_id, tokens, host id) and the pending OAuth attempt
  - FTS5 `messages` index with `bm25()` search
- **`Chat` DO** (plain DO + `Lifecycle` + `PiHarness`, name = `<userId>--<chatId>`):
  - one pi-durable root session holds the transcript in its SQLite
  - streams `session.events()` over hibernatable WebSockets
  - pushes each committed user/assistant message to its `User` DO
- **Model:** pi-ai `openai` provider at `https://api.openai.com/v1` plus a `CredentialStore` that reads and refreshes the user's SIWC token through RPC to their `User` DO. Model id is picked from `GET /v1/models` and must be a reasoning model.
- **Isolation:** the Worker resolves the better-auth session for every `/agents/*` request. `/agents/user/<name>` is allowed only when name == user.id, and `/agents/chat/<name>` only when name starts with `<user.id>--`. Anything else gets a 403.

## Files
- `alchemy.run.ts` — stack: D1, Website (env DB, User, Chat), dev host/port
- `src/worker.ts` — DO exports, `/agents/*` gate + `routeAgentRequest`, TanStack handler
- `src/server/auth.ts` — better-auth, `src/routes/api/auth/$.ts` mounts it
- `src/server/user.ts` — User agent: chats, search, SIWC connect + credentials
- `src/server/chat.ts` — Chat DO with PiHarness, sockets, index push
- `src/server/siwc.ts` — authorize URL, code exchange, id_token check, refresh (fetch + jose)
- `src/routes/auth.callback.ts` — SIWC callback route
- `src/routes/*` + `src/components/*` — login, sidebar, chat pane, search (shadcn)

## Slices (commit each, README gets a "how to run" line)
1. Email/password login → connect ChatGPT → create a chat → send → pi streams the reply.
2. Sidebar with multiple chats, reopening a chat, logout → user B sees nothing of A's.
3. FTS5 bm25 search in the User DO, results link to the chat (and message).
4. SIWC polish: connection card (account email, plan usage on/off), disconnect, refresh, errors (usage limit → Manage usage link).

v1 after v0: agent-messaging pi tools (list / send / last message / inspect, sessions of the same user) + OptChat on top.
