import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Docker from "alchemy/Docker";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { resolve } from "node:path";
import type { Bot, BotData, User } from "./src/worker.ts";
import { PORT } from "./src/origin.ts";

process.loadEnvFile();
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
if (!BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET missing from .env");
const SEARXNG_SECRET = process.env.SEARXNG_SECRET;
if (!SEARXNG_SECRET) throw new Error("SEARXNG_SECRET missing from .env");
/** Local SearXNG (Docker) for the bots' web_search tool; the Worker reaches it on this host port. */
const SEARXNG_PORT = 8888;

export const DB = Cloudflare.D1.Database("DB", { migrations: "./migrations" });
export const Website = Cloudflare.Website.Vite("Website", {
  main: "src/worker.ts",
  env: {
    DB,
    BETTER_AUTH_SECRET,
    SEARXNG_URL: `http://127.0.0.1:${SEARXNG_PORT}`,
    User: Cloudflare.DurableObject<User>("User"),
    Bot: Cloudflare.DurableObject<Bot>("Bot"),
    BotData: Cloudflare.DurableObject<BotData>("BotData"),
  },
  compatibility: { date: "2026-10-01", flags: ["nodejs_compat"] },
  dev: { host: "127.0.0.1", port: PORT, strictPort: true },
});

export default Alchemy.Stack(
  "PiDurableDemo",
  { providers: Layer.merge(Cloudflare.providers(), Docker.providers()), state: Alchemy.localState() },
  Effect.gen(function* () {
    // Pinned: tag published 2026-10-04 (hub.docker.com/r/searxng/searxng/tags).
    const image = yield* Docker.RemoteImage("SearxngImage", { name: "searxng/searxng", tag: "2026.10.4-d48c4b555", alwaysPull: false });
    yield* Docker.Container("Searxng", {
      name: "pi-durable-searxng",
      image,
      environment: { SEARXNG_SECRET, SEARXNG_BASE_URL: `http://127.0.0.1:${SEARXNG_PORT}/` },
      ports: [{ external: SEARXNG_PORT, internal: 8080 }],
      volumes: [{ hostPath: resolve("searxng/settings.yml"), containerPath: "/etc/searxng/settings.yml", readOnly: true }],
      restart: "unless-stopped",
      start: true,
    });
    const web = yield* Website;
    return { url: web.url.as<string>() };
  }),
);
