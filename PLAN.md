# Plan

## Shape (since 2026-10-19: bots)
- One Worker (alchemy `Cloudflare.Website.Vite`, TanStack Start) on **http://127.0.0.1:1455**. This port matches the SIWC callback `http://127.0.0.1:1455/auth/callback`, the same port pi and the devkit use.
- **D1**: better-auth tables only (email/password).
- **`User` DO** (agents `Agent`, name = better-auth user id): bot catalog in agent state (the rail syncs live), SIWC credentials, FTS5 `messages` index over every bot with `bm25()` search.
- **`Bot` DO** (plain DO + `Lifecycle` + `PiHarness` + `Scheduler`, name = `<userId>--<botId>`): one endless pi conversation, its own OptChat memory, subagents, routines; streams `session.events()` over hibernatable WebSockets; pushes committed user/assistant messages to the `User` DO's index.
- **Model:** pi-ai `openai` provider on the user's SIWC token, read and refreshed through RPC to their `User` DO.
- **Isolation:** the Worker resolves the better-auth session for every `/agents/*` request: `/agents/user/<id>` only for the caller, `/agents/bot/<id>--<botId>` only for a bot in the caller's catalog; server functions check ownership (403).

## Files
- `alchemy.run.ts` — stack: D1, Website (env DB, User, Bot), dev host/port
- `src/worker.ts` — DO exports, `/agents/*` gate + `routeAgentRequest`, TanStack handler
- `src/server/auth.ts` — better-auth, `src/routes/api/auth/$.ts` mounts it
- `src/server/user.ts` — User agent: bots, search, SIWC connect + credentials
- `src/server/bot.ts` — Bot DO: PiHarness, OptChat memory, routines, sockets, index push
- `src/server/agents.ts` — subagent, agents and bots tools
- `src/optchat/*` — OptChat memory (port of jonaslsaa/pi-optchat)
- `src/server/siwc.ts` — authorize URL, code exchange, id_token check, refresh (fetch + jose)
- `src/routes/auth.callback.ts` — SIWC callback route
- `src/routes/*` + `src/components/*` — login, bot rail, thread, details/search panels (shadcn + AI Elements)

## Slices (commit each, README gets a "how to run" line)
1. Email/password login → connect ChatGPT → create a chat → send → pi streams the reply.
2. Sidebar with multiple chats, reopening a chat, logout → user B sees nothing of A's.
3. FTS5 bm25 search in the User DO, results link to the chat (and message).
4. SIWC polish: connection card (account email, plan usage on/off), disconnect, refresh, errors (usage limit → Manage usage link).

v1 after v0: agent-messaging pi tools (list / send / last message / inspect, sessions of the same user) + OptChat on top.

## Next (after bots)
1. Group chats: the user starts a room with a few bots; they collaborate in it (each bot posts as itself, @-addressed turns), the room is disbanded when done. The room keeps only its transcript; every member logs what it saw to its own memory. Needs: a Group DO (or rooms in the User DO), a turn-taking rule so bots don't loop, and room UI in the rail.
2. Per-bot research store: a `sql` tool over the Bot DO's SQLite (findings + FTS5), shown in the details panel; AI Search per bot once there's a Cloudflare account (research/bot-storage.md).
