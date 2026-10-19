# Limits and shortcuts

What the demo doesn't do, and corners cut on the way. Fix if they start to matter.

## Product limits

- Local only. Sign in with ChatGPT's terms allow plan usage for open-source and locally run apps; a hosted version needs OpenAI's commercial waitlist and its own token storage story (DECISIONS.md).
- Every bot runs gpt-6.1-sol at low reasoning, and the summarizer runs gpt-6-luna. A plan without them can't chat (the summarizer checks and fails loudly; the main model isn't checked up front).
- Routines are cron in UTC and are created only by a bot's `routines` tool; the details panel can toggle and delete them but not create or edit them.
- Nothing stops two bots from ping-ponging messages except the models' judgment (groups cap it at 6 bot posts per user message; direct `bots` messages have no cap).
- Group chats: a member whose turn errors or is aborted stays in the room's "typing" list until its next reply; no retry. Bots have no memory view inside their group conversation (only their DM has one); what they saw there is logged to memory and recalled from the DM.
- Questions (`ask` cards) work in a bot's own chat only, not in groups.
- `web_fetch` fetches any http(s) URL, including 127.0.0.1 and your LAN, and reads the whole body before cutting it to 20,000 characters. Fine for a local demo; a deployed version needs a private-address block and a byte cap. A page a bot reads can try to steer it (prompt injection); the bot's tools act without asking.
- SearXNG's default engines get throttled (Brave "too many requests", DuckDuckGo CAPTCHA); Google and Bing results still come back. No engine tuning.
- OptChat has no mid-turn refresh (upstream TURN_REFRESHED): a very long single run grows until the provider refuses it. Dates in memory render in UTC, not your zone.
- OptChat port drops: Anthropic cache priming, zoom into subagent runs, images, imports, profiles, connected windows. Subagents keep plain pi context.

## Shortcuts in the code

- `src/env.ts` hand-writes `Env` instead of `Cloudflare.InferEnv<typeof Website>`: the inferred type is circular once DO classes are typed with it. Keep it in sync with `alchemy.run.ts` by hand.
- shadcn `init` hung on an interactive prompt, so `components.json`, the tokens in `src/styles.css`, `src/lib/utils.ts` and component deps were set up by hand. `trace` and `code-block` aren't in the new-york registry and were pulled from the radix-vega registry JSON.
- `src/pi/*` is copied from cloudflare/agents `examples/next/harnesses/pi` (NOTICE); `sockets.ts` adds `onSubmitted`. Upstream fixes won't flow in.
- The Bot DO's `CredentialStore.modify` doesn't write: the User DO already persisted the refreshed token. Works because pi only calls `modify` to refresh, but it bends the interface contract.
- One `ext_agent_host_id` per app user (User DO), not per machine as the SIWC docs define it.
- Search index sync pushes everything after the last pushed count from the Bot DO, after submit and on each final answer. A crash between the push and the counter write re-sends rows (the User DO dedupes on `(bot_id, entry_id)`); a failed generation leaves the user message unindexed until the next answer.
- Agent tools are `replay: "unsafe"`: if the DO is evicted mid-call the model sees "interrupted". `bots` send doesn't wait for the reply.
- The compactor runs in the Bot DO, so heavy summarizing serializes with that bot's other calls; a Scheduler job (`pumpMemory`, every 15 s while summaries are pending) restarts it after eviction.
- Report cards are found by parsing "Saved report <id>:" from the library tool's output.
- `pnpm-workspace.yaml` excludes `@cloudflare/workers-types@5.20261018.1` and `shadcn@4.22.1` from pnpm's release-age check (both were days old at install). Drop the exclusions once they age out.
- Check scripts: `infra-map --check` must be rerun after a new library table first appears locally; `lineage` spends one real turn of the ChatGPT plan; `isolation` creates bots for the test users when they have none.
