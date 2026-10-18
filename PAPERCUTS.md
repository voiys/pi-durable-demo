# Papercuts & shortcuts

Things done quickly on the way to v0. Fix if we decide they matter.

- `src/env.ts` hand-writes `Env` instead of `Cloudflare.InferEnv<typeof Website>`: the inferred type is circular once DO classes are typed with it. Must be kept in sync with `alchemy.run.ts` by hand.
- shadcn `init` hung on an interactive prompt, so `components.json`, the zinc tokens in `src/styles.css` (from `_legacy-base-colors.ts`), `src/lib/utils.ts` and component deps were set up by hand. Worth re-checking against a clean `shadcn init` output.
- `src/pi/*` is copied from cloudflare/agents `examples/next/harnesses/pi` (MIT). `sockets.ts` got one addition (`onSubmitted`). Upstream fixes won't flow in automatically.
- Bot DO's `CredentialStore.modify` doesn't write: the User DO already persisted the refreshed token. Works because pi only calls `modify` to refresh, but it bends the interface contract.
- Search index sync is "push everything after the last pushed count" from the Bot DO, triggered after submit and on each final answer (`onYield`). A crash between the push and the counter write re-sends rows; the User DO dedupes on `(bot_id, entry_id)`. A failed generation leaves the user message unindexed until the next answer.
- One `ext_agent_host_id` per app user (User DO), not per machine. The SIWC docs define it per installation; for a local demo every app user is effectively one "host".
- New bots default to `gpt-6.1-sol` (low effort) without checking the account has it; the picker only lists catalog reasoning models ∩ `GET /v1/models`. The list is cached in the User DO (kv `siwc:models`, refreshed in the background after 1 h) and once per page load in the browser.
- The User DO's `availableModels` refreshes an expired token itself before calling `/v1/models`; there's no proactive refresh otherwise.
- `pnpm-workspace.yaml` has `minimumReleaseAgeExclude` for `@cloudflare/workers-types@5.20261018.1` (pnpm added it because that version was too new).
- AI Elements: `trace` and `code-block` aren't in the new-york registry, so they were pulled by hand from the radix-vega registry JSON (placeholder icons swapped for lucide).
- v1 agent tools are `replay: "unsafe"`: if the DO is evicted mid-call the model sees "interrupted". `agents.send` doesn't wait for or route the reply back; use `last`/`inspect`.
- OptChat is a port of jonaslsaa/pi-optchat's memory core (`src/optchat/`). Dropped: Anthropic cache priming/marks, zoom into subagent runs, images, imports, profiles, connected windows, the "[OptChat status]" line. Each bot's main agent is an OptChat on that bot's memory (Bot DO); subagents don't get it. The compactor runs in the Bot DO, so heavy summarizing serializes with that bot's other calls; a Scheduler job (`pumpMemory`, every 15 s while summaries are pending) reopens it after eviction. No mid-turn refresh yet (upstream TURN_REFRESHED): a very long run grows until the provider refuses it. Dates render in the Worker's zone (UTC), not the user's.
- Routines are cron in UTC and are only created by the bot's `routines` tool; the panel can toggle and delete but not create or edit them. A bot can message another bot that messages it back, and nothing stops two bots from ping-ponging except the models' judgment.
- Check scripts: `--check` must be rerun after a new library table first appears locally; lineage spends one real turn of the ChatGPT plan and adds a chat to a@test.dev each run; isolation creates chats for the test users when they have none. Agent tools (subagent/agents/sessions) were exercised live by hand on 2026-10-18 and work, but no script covers them.

- shadcn@4.22.1 (npm, only for shadcn/tailwind.css) was published 2026-10-18, the day we installed it, so pnpm added it to minimumReleaseAgeExclude in pnpm-workspace.yaml. It matches the registry source our components were copied from. Drop the exclusion once it is older than the release-age window.
- `web_fetch` fetches any http(s) URL, including 127.0.0.1 (the app itself, SearXNG). Fine for a local demo; a deployed version needs an allowlist or a private-address block.
- SearXNG's default engines get throttled (Brave "too many requests", DuckDuckGo CAPTCHA); Google/Bing results still come back. No engine tuning yet.
- Group chats: a member whose turn errors or is aborted stays in the room's "typing" list until its next reply; no retry. Bots in a group have no memory view in their group conversation (only their DM does); what they saw is logged to memory and recalled from the DM.
- Report cards are found by parsing "Saved report <id>:" from the library tool's output.

