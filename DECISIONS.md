# Decisions

- 2026-10-18 · Tools pinned with mise (`mise.toml`): node 24.20.0, pnpm 12.6.0 (the versions already installed and working on this machine). Asked for by the user.
- 2026-10-18 · No Cloudflare login for v0: alchemy v2 local dev falls back to a dummy account id when none is configured (`alchemy-v2-beta83: packages/alchemy/src/Cloudflare/LocalAccount.ts`), and nothing in v0 needs a remote resource.
- 2026-10-18 · Auth model (user's call): users sign in with email/password (better-auth). "Sign in with ChatGPT" is a separate *connect your ChatGPT plan* step, and pi runs on that plan's token. One ChatGPT account may be connected to several app users for the demo. No backup model: a user with no connected plan can't chat, and the app says so.
