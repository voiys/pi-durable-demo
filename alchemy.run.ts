import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import type { Bot, User } from "./src/worker.ts";
import { PORT } from "./src/origin.ts";

process.loadEnvFile();
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
if (!BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET missing from .env");

export const DB = Cloudflare.D1.Database("DB", { migrations: "./migrations" });
export const Website = Cloudflare.Website.Vite("Website", {
  main: "src/worker.ts",
  env: {
    DB,
    BETTER_AUTH_SECRET,
    User: Cloudflare.DurableObject<User>("User"),
    Bot: Cloudflare.DurableObject<Bot>("Bot"),
  },
  compatibility: { date: "2026-10-01", flags: ["nodejs_compat"] },
  dev: { host: "127.0.0.1", port: PORT, strictPort: true },
});

export default Alchemy.Stack(
  "PiDurableDemo",
  { providers: Cloudflare.providers(), state: Alchemy.localState() },
  Effect.gen(function* () {
    const web = yield* Website;
    return { url: web.url.as<string>() };
  }),
);
