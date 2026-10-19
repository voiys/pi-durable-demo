# AGENTS.md

## Coding policy

I value robustness, minimizing total lines of code, avoiding bloat, avoiding duplication. I hate fallbacks, useless if-else statements (things like "elif code is broken then repair it" should not exist, it should fail loudly), and I love asserts, which allow to catch early bugs. Fallbacks hide bugs and bloat the code. (source: https://x.com/gabriberton/status/2109750152563187950)

## Grounding rule

Before you write code against any of these libs (cloudflare agents sdk incl. PiHarness, pi + pi-durable, alchemy v2, tanstack start/form/virtual/db, better-auth, shadcn/ui, effect v4, sign in with chatgpt), pin its source with `ctx add <repo-url> --label <name>` and its docs with `ctx add <docs-url> --label <name>-docs`, then read the real code with `rg` under `ctx path <name>`. Use `ctx query "<question>" --label <name>-docs` only as a fallback. If you're not sure about an API, go read the source, don't guess. Cite the file you used in the commit message.

## Commands

- Tool versions are pinned in `mise.toml` (node, pnpm). Run `mise install` once.
- Package manager: pnpm.

## Layout

- `AGENTS.md` this file. `DECISIONS.md` decisions made without asking. `RESEARCH.md` cited research. `PLAN.md` slices.
- `DESIGN.md` the design system (tokens, components, motion, words). Read it before any UI change; it overrides shadcn defaults and taste. `research/ui-decisions.md` holds the user's locked UI calls.
