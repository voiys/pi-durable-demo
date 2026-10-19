# pi durable demo

Bespoke bots that work for you, on your own ChatGPT plan. Make specialists (a researcher, an analyst, a writer), give them schedules, and put them together in group chats that work like projects. Each bot is always on: it lives in its own Cloudflare Durable Object, runs on [pi-durable](https://github.com/earendil-works/pi-durable-cloudflare) (a run that gets cut off resumes where it was), and remembers everything with [OptChat](https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449) memory.

It runs entirely on your machine. No Cloudflare account, no hosted backend.

## What works

- **Accounts and your plan.** Email/password sign-up, then "Continue with ChatGPT" connects your plan (Sign in with ChatGPT). Every bot runs gpt-6.1-sol at low reasoning on it.
- **Bots.** Each bot is one endless conversation with its own memory, instructions and look (an animated bloub face). The first bot is your main bot: ask it to create, rename, re-instruct or delete the others in plain words.
- **Memory.** OptChat folds old messages into a tree of summaries, so a bot's chat never ends and never forgets; it can zoom back into detail and search its past.
- **Research.** Bots search the web through a local SearXNG, read pages, keep tables in their own SQL database and save markdown reports to a library. All of it shows in the bot's details panel.
- **Routines.** "Every weekday at 7:00, do X": cron schedules per bot that run with the tab closed. Made in a group chat, a routine posts to the group.
- **Group chats.** A room with a purpose every member reads. Every bot sees the whole room; @mentions decide who answers. Bots hand work to each other, and you can reply to or quote any message.
- **Bots talk to each other** by name, and spin up subagents for side work.
- **Search** across every bot's messages, from the rail.
- **Questions.** A bot can ask you to pick an option mid-task, as a card in the thread.

## Run it

You need Docker (for the local search engine), [mise](https://mise.jdx.dev) (or Node 24 and pnpm 12) and a ChatGPT plan. Sign in with ChatGPT lets open-source and locally run apps use your plan; each user connects their own.

```bash
mise install && pnpm install
printf "BETTER_AUTH_SECRET=%s\nSEARXNG_SECRET=%s\n" $(openssl rand -hex 32) $(openssl rand -hex 32) > .env
pnpm dev
```

Open **http://127.0.0.1:1455** (not `localhost`: the ChatGPT callback is pinned to 127.0.0.1), create an account, connect ChatGPT and make your first bot.

## How it's built

- One Worker (TanStack Start via [alchemy](https://alchemy.run) v2, local workerd) and five Durable Object classes:
  - **User**: the bot catalog (synced live to the rail), the ChatGPT connection, and an FTS5 search index over every bot.
  - **Bot**: a pi-durable harness (`agents/harness/pi`) with OptChat memory, subagents, routines (agents SDK `Scheduler`) and the bot's tools.
  - **BotData**: the bot's own SQLite for its tables and report library, kept apart from pi's tables.
  - **Group**: one room's transcript, purpose and who has heard what.
  - D1 holds better-auth's tables.
- Every `/agents/*` socket and server function checks the session and ownership; `scripts/isolation.ts` attacks it as another user.
- `ARCHITECTURE.md` maps every table and who owns it (generated from the code and the local SQLite files).

## Docs

- `DECISIONS.md`: what we settled on and why.
- `PAPERCUTS.md`: limits and shortcuts.
- `RESEARCH.md` and `research/`: what we checked before building, with citations into the pinned sources.
- `DESIGN.md` and `research/ui-decisions.md`: the design system and the UI calls.

## Checks

- `pnpm typecheck`
- `pnpm check:optchat-spec`: the OptChat code (cursor, logging, view, caps, compactor) against fakes; no network.
- `pnpm check:optchat-upstream`: upstream pi-optchat's own memory test suite (vendored in `tests/optchat/test/`) against our `src/optchat/memory.ts`.

With `pnpm dev` running and the test users from `scripts/test-users.json` created in the app (a@test.dev with ChatGPT connected):

- `node scripts/infra-map.ts --check`: ARCHITECTURE.md, ownership rules and the local SQLite agree (drop `--check` to regenerate).
- `node scripts/isolation.ts`: user B (and an anonymous caller) attack user A through every door.
- `node scripts/lineage.ts`: one tagged message lands exactly where the design says and is gone after the bot is deleted (one real turn).
- `pnpm check:optchat-e2e`: per-bot memory end to end, about 12 real turns.

Exit 0 = pass.

## Licence

MIT (LICENSE). Code from cloudflare/agents, pi-optchat and shadcn/ui is credited in NOTICE.
