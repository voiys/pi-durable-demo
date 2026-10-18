import { DurableObject } from "cloudflare:workers";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { createRegistry, GenerationTask, Harness, hook, type EntryRecord } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { WebSockets } from "agents/websockets";
import type { Env } from "../env.ts";
import { PiSessionSockets } from "../pi/sockets.ts";
import { oauth } from "./siwc.ts";
import type { IndexRow } from "../shared.ts";

// A reasoning model: pi sends the system prompt as a developer item only for those,
// and SIWC rejects role:system (pi-source-v1.3.0 packages/ai/src/api/openai-responses-shared.ts:231-243).
export const MODEL = { provider: "openai", id: "gpt-6.1-sol" } as const;
const PREAMBLE = "You are a helpful, concise assistant.";

function text(entry: EntryRecord): string {
  const message = entry.model?.[0];
  if (!message || (message.role !== "user" && message.role !== "assistant")) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
}

/**
 * One conversation (name = `<userId>--<chatId>`), running pi through PiHarness.
 * The transcript lives in this object's SQLite (pi_ tables). The model runs on
 * the owner's ChatGPT plan, read from and refreshed by their User DO.
 */
export class Chat extends DurableObject<Env> {
  readonly #name = this.ctx.id.name ?? "";
  readonly userId = this.#name.split("--")[0];
  readonly chatId = this.#name.split("--")[1];
  readonly #user = () => this.env.User.getByName(this.userId);

  // pi-ai asks this for the credential on every request and refreshes it under `modify`.
  // Refresh itself runs in the User DO (see siwc.ts `oauth`), which already persists the result.
  readonly #credentials: CredentialStore = {
    read: async (providerId) => (providerId === MODEL.provider ? await this.#user().credential() : undefined),
    list: async () => [{ providerId: MODEL.provider, type: "oauth" }],
    modify: async (providerId, fn) => fn(await this.#credentials.read(providerId)),
    delete: async () => {
      throw new Error("Disconnect ChatGPT from the User, not from a chat");
    },
  };

  readonly registry = createRegistry();
  readonly harness = new PiHarness({
    harness: ({ storage, context }) => {
      this.registry.install({
        name: "chat",
        sections: [{ key: "preamble", render: () => PREAMBLE, tag: false }],
        hooks: [hook(GenerationTask, { onYield: () => void this.ctx.waitUntil(this.syncIndex()) })],
      });
      const models = createModels({ credentials: this.#credentials });
      const base = openaiProvider();
      models.setProvider({ ...base, auth: { oauth: oauth((c) => this.#user().refreshCredential(c)) } });
      return Harness.open(storage, { models, registry: this.registry }, context);
    },
    defaults: { model: MODEL, thinkingLevel: "low" },
  });

  readonly sockets = new PiSessionSockets(this.harness, this.registry, (tag) => this.ctx.getWebSockets(tag), () => this.syncIndex());
  readonly webSockets = new WebSockets(this.sockets.options());
  readonly lifecycle = Lifecycle.install(this).use(this.webSockets).use(this.harness);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (!this.userId || !this.chatId) throw new Error(`Chat DO needs a <userId>--<chatId> name, got "${this.#name}"`);
  }

  async onStart() {
    await this.sockets.reattach();
  }

  /** Pushes user/assistant entries not yet pushed to the User DO's search index. */
  async syncIndex() {
    const sent = (this.ctx.storage.kv.get("index:sent") as number | undefined) ?? 0;
    const entries = await this.harness.session().messages();
    const rows: IndexRow[] = entries.slice(sent).flatMap((e) => {
      const role = e.model?.[0]?.role;
      const body = text(e);
      return (role === "user" || role === "assistant") && body ? [{ entryId: String(e.id), role, text: body }] : [];
    });
    await this.#user().indexMessages(this.chatId, rows);
    this.ctx.storage.kv.put("index:sent", entries.length);
  }
}
