# Topic: stack (2026-10-18)
Paths: ALCH=ctx alchemy-v2-beta83 (tag v2.0.0-beta.83, commit db20b54e...), BA=ctx better-auth-1710-source (v1.7.10 b734a418), SH=ctx shadcn-ui-source (shadcn@4.22.1), AG=ctx cf-agents-source (7dd51c5, agents 0.28.1), DB=ctx tanstack-db-0150 (main db0ac815, db 0.15.1).

## Empirical test (verified by running, not just reading)
Scratch project $R/alch: alchemy 2.0.0-beta.83 + Cloudflare.Website.Vite (TanStack Start) with custom main exporting 2 DO classes (User, Chat), D1, Alchemy.localState(), dev {host:"127.0.0.1", port:3111, strictPort:true}. Ran `alchemy dev` with HOME=fake dir (no profile, no CLOUDFLARE_* env). Result: plan "[DB] create (local) [Website] create (local)", listening 127.0.0.1:3111 (lsof IPv4 only), SSR page returned DO RPC result, FTS5 bm25 from DO SQLite, D1 select. Then better-auth 1.7.10 with raw env.DB: getMigrations created user/session/account/verification, sign-up/sign-in email, get-session via cookie, link-social with genericOAuth returned authorize URL whose redirect_uri = http://127.0.0.1:3111/auth/callback.
Caveats: dev log prints http://localhost:3111 (proxy label) though bound to 127.0.0.1; use 127.0.0.1 in browser for cookie host consistency. npm needs `npm rebuild workerd esbuild` (pnpm: allowBuilds workerd/esbuild).

## 1 alchemy
- Website.Vite works with TanStack Start; remove @cloudflare/vite-plugin: ALCH website/src/content/docs/cloudflare/frontend/tanstack-start.mdx:37-66; Website decl :68-97; stack :99-121; env proxy :128-149.
- Custom entry hosting DO classes: packages/alchemy/src/Cloudflare/Website/Vite.ts:93-110 (`main` wins over vite config entry).
- Async worker DO binding `Cloudflare.DurableObject<Class>("Class")` in env/bindings: packages/alchemy/src/Cloudflare/Workers/DurableObject.ts:~991-1020 (doc shows `bindings:`, workers.mdx:54-67 shows `env:`; Worker.ts:792 `env?: Bindings`). Used `env` in my test; works.
- D1: website/.../cloudflare/data/d1.mdx:15-24, migrations :49-59; local sim: cloudflare/local-development.mdx:99-111 table.
- Local: local-development.mdx:7-12, Websites run own dev server :60-70; emulated table :99-113. Cli dev doc cli/dev.mdx:1-37 (stage dev_$USER; its prose says "resources deploy to cloud" but local-development.mdx says emulatable ones are local - contradiction; test confirms local).
- tanstack-start.mdx:181-185 claims dev bindings attach to REAL R2 - stale vs local-development.mdx:41-47; test shows D1/DO local (`dev:` ids).
- Login: LocalAccount.ts:8-44 falls back to LOCAL_ACCOUNT_ID 000..0 with no profile/env. Cloudflare.state() needs first-run bootstrap into your CF account (state-store/index.mdx:70-90) so use Alchemy.localState() (State/LocalState.ts:16; used in examples/cloudflare-better-auth/alchemy.run.ts:10).
- Port/host: Worker.ts:933-956 dev.host/port/strictPort; LocalWorkerProvider.ts:253-262,1375-1391 (Vite sits behind stable proxy honoring props.dev); ViteChildRunner.ts:81-85 vite child on 127.0.0.1 port 0; WorkerProxy.ts:370-396 (host default 127.0.0.1, strictPort fails if busy, otherwise falls to next free port with warning :92-96). Doc comment says host default "localhost" but proxy default is "127.0.0.1": set explicitly.
- DO SQLite+FTS5 in local workerd: verified via miniflare 4.20260730.0/workerd 1.20260730.1 ($R/fts5test/t.mjs) and via alchemy dev.
- Raw agents-SDK DO classes (non-Effect) are supported as async DO classes; Effect-native DO (Cloudflare.DurableObject()(...)) is the other form (durable-objects.mdx:37-47).

## 2 @alchemy.run/better-auth (2.0.0-beta.83)
- packages/better-auth/README.md:37-61: Effect-native BetterAuth(options), auth.fetch, auth.getSession, auto migrations at deploy, auto Random secret; D1 layer :63-77. src/CloudflareD1.ts:68-116 (native binding at runtime, HTTP/local-sim migration at deploy). BetterAuth.ts:141-143 requires Database layer, RuntimeContext/HttpServerRequest from alchemy Effect Worker.
- Docs: website/.../better-auth/databases/cloudflare-d1.mdx; sign-in-providers/custom-oauth.mdx (genericOAuth + D1 + Worker, 1.7.5).
- No TanStack Start wiring anywhere (grep -i tanstack in packages/better-auth and docs/better-auth: no hits). INFERRED: unusable inside Website.Vite async worker; use plain betterAuth({database: env.DB}) (verified works).
- peers: better-auth catalog ^1.7.5, kysely.

## 3 better-auth
- npm latest 1.7.10 (2026-10-15); beta 1.8.0-beta.1. Pinned BA = v1.7.10.
- D1 native: packages/kysely-adapter/src/dialect.ts:184-194 (D1SqliteDialect, no interactive tx), core types/database.ts:14-21.
- Session from request: docs/integrations/tanstack.mdx:25-46 (mount /api/auth/$), :98-108 (auth.api.getSession({headers})), tanstackStartCookies plugin :53-77 (must be last plugin). Same call works in any Worker/DO given Headers.
- genericOAuth: docs/content/docs/plugins/generic-oauth.mdx:64-103 (signIn.social, linkSocial), callback /callback/:providerId :101-105; config fields packages/better-auth/src/plugins/generic-oauth/types.ts (redirectURI :~100, getToken, getUserInfo, mapProfileToUser, pkce, refreshTokenParams, accessTokenExpiresIn).
- Linking an OAuth account to an email/password user: oauth2/link-account.ts:94-117 requires provider trusted or email verified AND same email unless account.accountLinking.allowDifferentEmails (init-options.ts:1294); trustedProviders init-options.ts:1258-1270. api/routes/account.ts:307-388 same for id_token path.
- Tokens: concepts/oauth.mdx:105-150 getAccessToken/refreshToken select by accountId (listAccounts), NOT providerId in 1.7.10. encryptOAuthTokens init-options.ts:1325.
- Verified in test: raw D1 + emailAndPassword + genericOAuth(chatgpt, custom redirectURI /auth/callback) + link-social.
- Caveat (INFERRED): custom redirectURI /auth/callback is not Better Auth's own route (/api/auth/callback/chatgpt), so the app must forward that route to the BA handler; untested.

## 4 shadcn
- npm shadcn latest 4.22.1 (tag shadcn@4.22.1). CLI init flags: apps/v4/content/docs/(root)/cli.mdx:20-49 (-t start, -b base|radix|aria, -p preset). TanStack Start guide: content/docs/installation/tanstack.mdx:62-66 `npx shadcn@latest init --preset [CODE] --template start`.
- Base UI is now default (changelog/2026-07-base-ui-default.mdx); Radix `-b radix`.
- Style: components.json style enum public/schema.json:5-30 has default,new-york (legacy) and <base>-<style> for vega,nova,maia,lyra,mira,luma,sera,rhea; components-json.mdx:39-43 "default deprecated, use new-york" (stale-ish). baseColor zinc still valid: components-json.mdx:82, registry/base-colors.ts:4. Tailwind v4 default: (root)/tailwind-v4.mdx. INFERRED: radix-vega ("Clean, neutral, familiar", registry/styles.tsx:3-5) is the closest to old new-york.
- Chat components (June 2026, changelog/2026-06-chat-components.mdx:26-28): `npx shadcn@latest add message-scroller message bubble attachment marker`. Oct 2026 (changelog/2026-10-ai-elements.mdx:29-45,49-58): trace, code-block, plus questionnaire; AI Elements = 21 copy-paste patterns (ai-elements/index.mdx:6) NOT a package; install underlying components: chat: `add message-scroller message bubble input-group` (ai-elements/base/chat.mdx:30); prompt-input: `add input-group attachment dropdown-menu`; message: `add message bubble tooltip`; reasoning: `add trace`; tool: `add trace code-block`; suggestion: `add button`. Pattern code is copied from docs pages (.md available), e.g. https://ui.shadcn.com/docs/ai-elements/base/chat.md (not fetched; local repo read instead). sidebar exists: registry/new-york-v4/ui/sidebar.tsx. Old names conversation/response/prompt-input from elements.ai-sdk.dev are being deprecated (ai-elements/index.mdx:142-173 mapping: conversation.tsx -> Chat).

## 5 TanStack DB verdict
- Versions: npm @tanstack/db 0.15.0, react-db 0.5.10 (main 0.15.1/0.5.11).
- DB docs/overview.md:7-11,36-60: reactive client store over REST/sync engines; collections + live queries + optimistic mutations. Custom sync possible: docs/guides/collection-options-creator.md:70-168, 554-790 (WebSocket collection example). No agents-sdk/useAgent integration (grep in DB docs and packages: none; only @tanstack/cloudflare-durable-objects-db-sqlite-persistence which persists collections in DO storage, README).
- Agents: docs/agents/state.md:3-12 persistent+synced state over WS; react.tsx:242,352-399 useAgent state/setState/onStateUpdate; docs/think/multi-chat.md:6-66 reference pattern = per-user directory DO whose state is the chat list + per-chat DO; `DirectoryState {chats}` broadcast (:101-115).
- Verdict: no added value for chat list + transcript v0: state sync already gives reactive, persisted, multi-tab list; DB's strengths (cross-collection live joins, optimistic mutations, large normalized client sets, offline) are not needed and would require writing a custom sync adapter. Revisit only if transcripts are huge/queried client-side.

## 6 FTS5
- DO SQL API doc: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ (fetched md, line 169-172): "subset of SQLite extensions ... FTS5 module (including fts5vocab)". D1: https://developers.cloudflare.com/d1/sql-api/sql-statements/ line 21-26 same.
- bm25() is not named in CF docs (grep 0 hits). VERIFIED empirically in local workerd: CREATE VIRTUAL TABLE fts5(body, tokenize='porter unicode61'), MATCH, bm25(), snippet() all work. Production DO unverified (inferred same SQLite build). sqlite_version() is blocked (SQLITE_AUTH).
