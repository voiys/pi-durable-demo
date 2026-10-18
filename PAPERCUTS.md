# Papercuts & shortcuts

Things done quickly on the way to v0. Fix if we decide they matter.

- `src/env.ts` hand-writes `Env` instead of `Cloudflare.InferEnv<typeof Website>`: the inferred type is circular once DO classes are typed with it. Must be kept in sync with `alchemy.run.ts` by hand.
- shadcn `init` hung on an interactive prompt, so `components.json`, the zinc tokens in `src/styles.css` (from `_legacy-base-colors.ts`), `src/lib/utils.ts` and component deps were set up by hand. Worth re-checking against a clean `shadcn init` output.
- `src/pi/*` is copied from cloudflare/agents `examples/next/harnesses/pi` (MIT). `sockets.ts` got one addition (`onSubmitted`). Upstream fixes won't flow in automatically.
- Chat DO's `CredentialStore.modify` doesn't write: the User DO already persisted the refreshed token. Works because pi only calls `modify` to refresh, but it bends the interface contract.
- Search index sync is "push everything after the last pushed count" from the Chat DO, triggered after submit and on each final answer (`onYield`). A crash between the push and the counter write re-sends rows; the User DO dedupes on `(chat_id, entry_id)`. A failed generation leaves the user message unindexed until the next answer.
- One `ext_agent_host_id` per app user (User DO), not per machine. The SIWC docs define it per installation; for a local demo every app user is effectively one "host".
- New chats default to `gpt-6.1-sol` (low effort) without checking the account has it; the picker only lists catalog reasoning models ∩ `GET /v1/models`. The model list is fetched on every picker mount (no cache).
- The User DO's `availableModels` refreshes an expired token itself before calling `/v1/models`; there's no proactive refresh otherwise.
- Search results link to `?chat=<id>&entry=<id>`, but the chat pane doesn't scroll to or highlight the entry yet.
- No markdown rendering in assistant bubbles (plain `whitespace-pre-wrap`).
- `pnpm-workspace.yaml` has `minimumReleaseAgeExclude` for `@cloudflare/workers-types@5.20261018.1` (pnpm added it because that version was too new).
