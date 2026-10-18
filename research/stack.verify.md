# stack verify (2026-10-18)
Re-ran alchemy dev in alch/ with empty HOME: listens 127.0.0.1:3111 IPv4; SSR returned DO user ok, FTS5 bm25 score, D1 row; sign-up/email 200. Confirmed.
npm latest confirmed: better-auth 1.7.10, shadcn 4.22.1, tailwindcss 4.3.3, react-start 1.169.3, agents 0.28.1, @tanstack/db 0.15.0.
Confirmed in source: Worker.ts dev host/port/strictPort; WorkerProxy default host 127.0.0.1; LocalAccount fallback id; tanstack-start.mdx:181-185 contradicts local-development.mdx table; link-account.ts and allowDifferentEmails; oauth.mdx accountId rule; shadcn cli/changelog/schema; CF docs FTS5 lines (DO md:171, D1 md:25).
Nits: alchemy better-auth README says migrations also run against local simulator under alchemy dev (researcher said deploy only). components-json.mdx still tells users to use new-york (not marked legacy); schema keeps it. multi-chat.md says chat-as-facet is reference but top-level DO per chat also works (answers open question). Production bm25 untested.
