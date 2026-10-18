# Per-bot storage: AI Search, D1, DuckDB (checked 2026-10-19)

Sonnet research pass, primary sources only; inference marked.

## Findings
- **AI Search** (ex AutoRAG): managed hybrid search (vector + keyword, rerank). Data in via built-in storage (default since
  2026-04-16), an R2 bucket, or a website crawl. Bindings `ai_search` / `ai_search_namespaces`; `search()`,
  `chatCompletions()`, `items.upload()`. Per-tenant pattern: one instance per tenant, `env.NS.create({id})` at runtime
  (how-to/per-tenant-search). Limits: 100 instances Free / 5,000 Paid, 1M files per instance (Paid), 5 metadata fields.
  Billing from 2026-11-01. **Does not run locally**: remote-only (miniflare `plugins/ai-search/index.ts:1-55` only builds a
  remote proxy; alchemy maps it to `AiSearch.remote` in dev, `Cloudflare/Workers/RuntimeBindings.ts:71-74`). Alchemy v2
  beta.83 has `Cloudflare.AI.Search`, `SearchInstance`, `SearchNamespace`. Needs a Cloudflare account.
- **D1 per bot**: creatable via REST, but bindings are static (no runtime binding; workerd discussion #3564). 50k DBs on
  Paid. No alchemy resource for runtime per-tenant D1.
- **Durable Object SQLite** (what each Bot DO already has): 10 GB per DO on Paid, FTS5, JSON, window functions (verified
  on local workerd 1.20261002.1); no sqlite-vec. A private per-bot "D1" with no provisioning, and it runs locally.
- **DuckDB**: official duckdb-wasm doesn't target workerd; `tobilg/ducklings` (v1.5.6) does, in-memory only, ~9.3 MiB
  gzipped, no dynamic extensions (no sqlite scanner). 128 MB isolate memory. Feeding it from DO SQL means copying rows in
  (inference). R2 SQL ("Basin SQL") is GA but read-only over Iceberg, needs an account and a pipeline.

## Recommendation
- Now (local, no account): a per-bot `sql` tool over its own DO SQLite (findings table + FTS5; SQL window functions for
  analytics). Semantic search later via embeddings stored as BLOBs (needs an embeddings API).
- With a Cloudflare account: AI Search via a namespace binding, one instance per bot, created when the bot is.
- Skip DuckDB for now: little over SQLite at this size, 128 MB cap.

Sources: developers.cloudflare.com/ai-search/{,usage/workers-binding/,how-to/per-tenant-search/,platform/limits-pricing/},
developers.cloudflare.com/changelog/post/2026-04-16-ai-search-namespace-binding/, developers.cloudflare.com/d1/platform/limits/,
developers.cloudflare.com/durable-objects/{platform/limits/,api/sqlite-storage-api/}, developers.cloudflare.com/workers/platform/limits/,
developers.cloudflare.com/r2-sql/reference/limitations-best-practices/, github.com/cloudflare/workerd/discussions/3564,
github.com/tobilg/ducklings, duckdb.org/docs/current/clients/wasm/extensions.
