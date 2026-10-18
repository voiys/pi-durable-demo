import * as cf from "cloudflare:workers";
import type { Bot } from "./server/bot.ts";
import type { BotData } from "./server/bot-data.ts";
import type { Group } from "./server/group.ts";
import type { User } from "./server/user.ts";

// Hand-written to mirror alchemy.run.ts: Cloudflare.InferEnv<typeof Website> is circular
// once the DO classes themselves are typed with Env (PAPERCUTS.md).
export type Env = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  SEARXNG_URL: string;
  User: DurableObjectNamespace<User>;
  Bot: DurableObjectNamespace<Bot>;
  BotData: DurableObjectNamespace<BotData>;
  Group: DurableObjectNamespace<Group>;
};

// TanStack Start's dev server evaluates route modules outside the Worker request context,
// so env is read lazily (alchemy-v2-beta83 website/src/content/docs/cloudflare/frontend/tanstack-start.mdx:125-149).
export const env = new Proxy({} as Env, {
  get(_, prop) {
    return cf.env[prop as keyof typeof cf.env];
  },
});
