import { DurableObject } from "cloudflare:workers";
import type { Credential, CredentialStore } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels, getSupportedThinkingLevels, type Models } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { createRegistry, GenerationTask, Harness, hook, ROOT_CONVERSATION_ID, type EntryRecord } from "@earendil-works/pi-durable";
import { PiHarness, ROOT_SESSION } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { WebSockets } from "agents/websockets";
import type { Env } from "../env.ts";
import { PiSessionSockets } from "../pi/sockets.ts";
import { agentExtensions, lastOf, sessionAgents, type AgentHost } from "./agents.ts";
import { createCompressor } from "../optchat/compactor.ts";
import { logEntry, optchatExtension } from "../optchat/extension.ts";
import { Memory } from "../optchat/memory.ts";
import { sqliteStore } from "../optchat/store.ts";
import { oauth } from "./siwc.ts";
import type { IndexRow, ModelOption } from "../shared.ts";

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
  #models: Models | undefined;
  #memory: Memory | undefined;
  /** OptChat memory of the main agent (v1.2), opened from this DO's SQLite on first use. */
  readonly memory = () => {
    if (!this.#memory) {
      const store = sqliteStore(this.ctx.storage.sql);
      const compress = createCompressor(() => this.#models!, () => ({ provider: MODEL.provider, model: MODEL.id, thinking: "medium" }));
      this.#memory = new Memory({ store, saved: store.load() }, compress);
    }
    return this.#memory;
  };
  readonly #optchat = optchatExtension(this.memory);
  get optchat() {
    return this.ctx.storage.kv.get("optchat") === true;
  }
  readonly harness = new PiHarness({
    harness: ({ storage, context }) => {
      this.registry.install({
        name: "chat",
        sections: [{ key: "preamble", render: () => PREAMBLE, tag: false }],
        hooks: [
          hook(GenerationTask, {
            onYield: (_answer, api) => {
              if (api.conversationId !== ROOT_CONVERSATION_ID) return;
              this.ctx.waitUntil(this.syncIndex());
              if (this.optchat) this.logTurn();
            },
          }),
        ],
      });
      const { MainTools, PeerTools } = agentExtensions(this.#agentHost);
      this.registry.install(MainTools);
      this.registry.install(PeerTools);
      if (this.optchat) this.registry.install(this.#optchat);
      const models = (this.#models = createModels({ credentials: this.#credentials }));
      const base = openaiProvider();
      models.setProvider({ ...base, auth: { oauth: oauth((c) => this.#user().refreshCredential(c)) } });
      return Harness.open(storage, { models, registry: this.registry }, context);
    },
    defaults: { model: MODEL, thinkingLevel: "low" },
  });

  // Declared after `harness`; the harness factory only reads it once pi opens.
  readonly #agentHost: AgentHost = {
    harness: this.harness,
    chatId: this.chatId,
    sessions: async () => (await this.#user().listChats()).map((c) => ({ id: c.id, title: c.title })),
    sendToSession: (chatId, from, message) => this.env.Chat.getByName(`${this.userId}--${chatId}`).receive(from, message),
    childExcluded: () => [this.#optchat],
    lastOfSession: (chatId) => this.env.Chat.getByName(`${this.userId}--${chatId}`).lastAnswer(),
    agentsChanged: async () =>
      this.#user().setAgents(this.chatId, (await sessionAgents(this.#agentHost)).filter((a) => a.name !== "main").map(({ name, session }) => ({ name, session }))),
  };
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

  /** Reasoning models the owner's ChatGPT account can use, with each one's thinking levels. */
  async modelOptions(): Promise<ModelOption[]> {
    const available = new Set(await this.#user().availableModels());
    return openaiProvider()
      .getModels()
      .filter((m) => m.reasoning && available.has(m.id))
      .map((m) => ({ id: m.id, name: m.name, levels: getSupportedThinkingLevels(m) }));
  }

  async configureModel(id: string, thinkingLevel: string) {
    const option = (await this.modelOptions()).find((m) => m.id === id);
    if (!option) throw new Error(`Model ${id} is not available on this ChatGPT plan`);
    const level = option.levels.find((l) => l === thinkingLevel);
    if (!level) throw new Error(`${id} has no thinking level "${thinkingLevel}"`);
    const conversation = await this.harness.conversation(ROOT_SESSION);
    await conversation.configure({ model: { provider: MODEL.provider, modelId: id }, thinkingLevel: level }, BACKGROUND_CONTEXT);
  }

  /** Another session of the same user messages this session's main agent (v1 `sessions` tool). */
  async receive(fromChatId: string, message: string) {
    const from = (await this.#user().listChats()).find((c) => c.id === fromChatId);
    if (!from) throw new Error(`Unknown session ${fromChatId}`);
    await this.harness.session().submit(`[message from session "${from.title}" (${from.id})] ${message}`, { whenBusy: "followUp" });
  }

  async lastAnswer() {
    return (await lastOf(this.harness, ROOT_SESSION)).text;
  }

  /** Makes this chat's main agent an OptChat (called once, when the chat is created). */
  enableOptChat() {
    this.ctx.storage.kv.put("optchat", true);
    this.registry.install(this.#optchat);
  }

  /** Logs the root conversation's finished turn into the OptChat memory; it summarizes in the background. */
  async logTurn() {
    const logged = (this.ctx.storage.kv.get("optchat:logged") as number | undefined) ?? 0;
    const entries = await this.harness.session().messages();
    for (const entry of entries.slice(logged)) logEntry(this.memory(), entry);
    this.ctx.storage.kv.put("optchat:logged", entries.length);
    this.ctx.waitUntil(this.memory().settle(undefined, "tree"));
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
