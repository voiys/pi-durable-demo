# Research (2026-10-18)

Full notes with file:line citations are in `research/<topic>.md`, and the adversarial fact-check for each topic is in `research/<topic>.verify.md`. ctx labels: `alchemy-v2-beta83`, `cloudflare-agents-main` (agents 0.28.1 @7dd51c5), `pi-source-v1.3.0` (@71023ae), `pi-durable-cloudflare`, `siwc-devkit`, `better-auth-1710-source`, `shadcn-ui-source`, `tanstack-db-0150`, `optchat-durable`, `batty`.

## Alchemy local dev (research/stack.md)
- `alchemy dev` runs Workers and DOs, including DO SQLite, in local workerd, and D1 in a local simulator. Website.Vite runs TanStack Start's own Vite dev server behind a proxy (`website/src/content/docs/cloudflare/local-development.mdx:99-113`, `cloudflare/frontend/tanstack-start.mdx:37-121`).
- **No Cloudflare login needed.** With no profile and no env vars, the account id falls back to `000…0` (`packages/alchemy/src/Cloudflare/LocalAccount.ts:8-44`). Use `Alchemy.localState()`, because `Cloudflare.state()` bootstraps into a real account (`state-store/index.mdx:70-90`).
- Run end to end with HOME pointed at an empty dir: TanStack Start + 2 DO classes + D1 + FTS5 `bm25()` in DO SQLite + better-auth on raw D1 all worked.
- `dev: {host: "127.0.0.1", port, strictPort: true}` binds IPv4 only (`Worker.ts:933-956`, `WorkerProxy.ts:370-396`). The log still prints `localhost`.
- `@alchemy.run/better-auth` is Effect-native with no TanStack Start wiring, so we use plain `betterAuth({database: env.DB})` (`packages/better-auth/README.md:37-77`).

## Sign in with ChatGPT (research/siwc.md, terms read in browser)
- Docs: https://developers.openai.com/siwc, the cookbook https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt, and the terms https://openai.com/policies/sign-in-with-chatgpt-terms/ (dated 2026-09-29).
- **Flow (open-source / local):** GET `https://auth.openai.com/api/accounts/authorize`.
  - First time: `client_id=dynamic_agent_client`, `agent_name_hint`, and `ext_agent_host_id` (`urn:uuid:…`). OpenAI registers the client and the callback returns the issued `client_id` (`oaiapp_…`).
  - Scopes: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, with `resource=https://api.openai.com/v1`. S256 PKCE, state and nonce. No client secret.
  - `redirect_uri` must be `http://127.0.0.1:<port>/auth/callback`. Only the port may vary, and `localhost` isn't allowed (`/siwc/token-sharing-open-source/sign-in`).
  - Token exchange: POST `https://auth.openai.com/api/accounts/oauth/token` with the issued client_id.
  - Tokens: access lasts 1 h, refresh lasts 30 d and rotates. Validate the id_token against `https://auth.openai.com/.well-known/jwks.json` with `aud` = the issued client_id.
- **Inference:** POST `https://api.openai.com/v1/responses` with the bearer token. Rules:
  - `store:false` and `stream:true` are required, the full history goes in `input`, and there's no `previous_response_id`.
  - No `role:system` items: use instructions or developer messages.
  - `temperature`, `max_output_tokens`, `metadata` and other fields aren't supported.
  - Models come from `GET /v1/models` (`/siwc/token-sharing-open-source/preview-limitations`, `models-and-inference`).
- **Terms:**
  - Token storage must be "local and under the user's control".
  - Requests must come from the user's runtime.
  - Using one user's plan for another user is banned.
  - Paid or hosted apps go to an interest-form waitlist (cookbook, last section).
  - OpenAI staff on X: open for OSS, waitlist for commercial (https://x.com/vigyso/status/2105723318322254331).
- **Devkit** (`openai/sign-in-with-chatgpt-devkit`): not on npm, carries a noncommercial licence, and its listener and storage are Node-only. We don't depend on it and implement the documented HTTP contract ourselves.
- **better-auth:** no SIWC provider exists (better-auth issue #11472). genericOAuth can't carry the per-registration `client_id`, so the connect flow is our own route, and better-auth only does email/password identity.

## pi durable / PiHarness (research/pidurable.md)
- PiHarness is `agents/harness/pi` in npm `agents` 0.28.1. It's beta, added in 0.25/0.26 on 2026-10-02 (`docs/agents/harnesses/pi.md:2-7`). It hosts `@earendil-works/pi-durable` 1.3.0, which persists everything in the DO's SQLite under `pi_` tables (`src/harness/pi/session-store.ts:9-39`).
- There's no chat protocol: stream `session.events()` (a snapshot, then one batch per commit) over `agents/websockets` and use `useAgent` on the client (`examples/next/harnesses/pi/src/{server,sockets,use-pi-session}.ts`).
- **SIWC constraints are handled in pi-ai, not by us.** In provider `openai` with baseUrl `https://api.openai.com/v1` and a non-`sk-` key, pi sends `store:false` and `stream:true` and drops `max_output_tokens`, `temperature` and `prompt_cache_retention` (`packages/ai/src/api/openai-responses.ts:42-49,357-374`). It never sends `previous_response_id`. The system prompt goes out as a `developer` item only for reasoning models (`openai-responses-shared.ts:231-243`), so we must use a reasoning model.
- **Per-user token:** pi-ai `CredentialStore` → `createModels({credentials})`, which refreshes within 5 min of expiry under `modify` (`packages/ai/src/models.ts:373-408,849-914`, `auth/resolve.ts:102-191`). pi's own ChatGPT OAuth module is Node-only and loaded through a variable import (`auth/oauth/load.ts:1-12`). So we supply a small fetch-based `OAuthAuth` (refresh + `toAuth`).
- **Topology:** Cloudflare advises one top-level DO per chat plus a per-user index DO, not facets, for many chats per user. Facets have no own alarm, and PiHarness needs Lifecycle wake alarms (`docs/agents/sub-agents.md:5-7,99,445-483`, `docs/think/multi-chat.md` "Known limits").

## Custom tools for pi durable (research/pitools.md)
- A tool is `defineTool({name, description, parameters: TypeBox, replay: "safe"|"unsafe", execute(args, api, ctx)})`. Tools are bundled with `defineExtension` and installed with `registry.install(...)` before `Harness.open` (`packages/durable/README.md` Tools/Extensions).
- Tools run inside the DO as closures, so they reach other DOs through `this.env` RPC.
- The intent is committed before execute. After eviction, a `replay:"unsafe"` call returns `interrupted`. Use `replay:"safe"`, `api.memo`, and a requestId derived from `api.taskId` for idempotency.
- Sub-agents are conversations owned by a tool task (`test/examples/22-subagent-foreground.ts`, `23-subagent-background.ts`).

## shadcn (research/stack.md §4)
- shadcn 4.22.1, Tailwind v4. `new-york` + `zinc` are still valid in `components.json` (`apps/v4/content/docs/components-json.mdx`).
- Chat components (changelog 2026-06 and 2026-10):
  - `pnpm dlx shadcn@4.22.1 add message-scroller message bubble attachment marker input-group`
  - plus `trace code-block`
  - plus `sidebar button input card`
- "AI Elements" are copy-paste patterns, not a package.

## TanStack DB
Skip it. The User DO's `useAgent` state already gives a reactive, persisted chat list across tabs, and pi's `session.events()` gives the transcript. TanStack DB would need a hand-written sync adapter for the agents socket, which has no integration (`tanstack-db` docs: `collection-options-creator.md`). Its strengths are cross-collection live joins, optimistic mutations over REST and offline use, and v0 needs none of them.

## v1: Mario's model + OptChat (research/v1.md)
- **Mario** (https://x.com/badlogicgames/status/2111871414714183808) posted a design sketch only, no code. A session is a main agent plus sub-agents. Every agent can list, send to and get the last message of its siblings. A main agent can do the same for the other sessions' main agents.
- **OptChat** is Victor Taelin's design (https://x.com/VictorTaelin/status/2106569004454219875, gist https://gist.github.com/VictorTaelin/91837951a5ce5b38f341ec1ba1df6449): "the chat history itself is the memory, stored as a compressed tree."
  - There's one endless chat with a log of every message.
  - A cheap model folds old messages into a tree of one-line summaries.
  - Each turn sees a fixed-size view, and the agent can `zoom` a summary back into detail.
  - Optional subagents report back as one `[id] report` message, and `tell(id, msg)` steers a running subagent. That's David Nilsson's "one main by design".
  - pi-durable reference implementation: `kevinqz/optchat-durable`. David's app: `jeffton/batty`.
