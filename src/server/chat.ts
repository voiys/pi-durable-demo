import { DurableObject } from "cloudflare:workers";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, GenerationTask, Harness, hook, ROOT_CONVERSATION_ID, type EntryRecord } from "@earendil-works/pi-durable";
import { PiHarness, ROOT_SESSION } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { WebSockets } from "agents/websockets";
import type { Env } from "../env.ts";
import { PiSessionSockets } from "../pi/sockets.ts";
import { agentExtensions, lastOf, retireSubagent, sessionAgents, type AgentHost } from "./agents.ts";
import { logRows, optchatExtension } from "../optchat/extension.ts";
import { MODEL, pickerOptions, planModels } from "./models.ts";
import { DEFAULT_MODEL, type IndexRow, type ModelOption } from "../shared.ts";

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

  readonly registry = createRegistry();
  // The main agent's OptChat memory is the owner's, shared by all their chats (User DO).
  readonly #optchat = optchatExtension({
    view: () => this.#user().memoryView(),
    zoom: (id, n, offset, limit) => this.#user().memoryZoom(id, n, offset, limit),
    date: (id) => this.#user().memoryDate(id),
    search: (text, before) => this.#user().memorySearch(text, before),
  });

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
              this.ctx.waitUntil(this.logTurn());
            },
          }),
        ],
      });
      const { MainTools, PeerTools } = agentExtensions(this.#agentHost);
      this.registry.install(MainTools);
      this.registry.install(PeerTools);
      this.registry.install(this.#optchat); // every chat's main agent is an OptChat (DECISIONS.md)
      const models = planModels(() => this.#user().credential(), (c) => this.#user().refreshCredential(c));
      return Harness.open(storage, { models, registry: this.registry }, context);
    },
    defaults: { model: MODEL, thinkingLevel: DEFAULT_MODEL.thinkingLevel },
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
    // OptChat memory moved to the User DO (DECISIONS.md); chats from before that drop their old per-chat tables.
    for (const t of ["optchat_log", "optchat_tree", "optchat_view"]) ctx.storage.sql.exec(`DROP TABLE IF EXISTS ${t}`);
  }

  async onStart() {
    await this.sockets.reattach();
  }

  /** Reasoning models the owner's ChatGPT account can use, with each one's thinking levels. */
  async modelOptions(): Promise<ModelOption[]> {
    return pickerOptions(await this.#user().availableModels());
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

  retireSubagent(name: string) {
    return retireSubagent(this.#agentHost, name);
  }

  async lastAnswer() {
    return (await lastOf(this.harness, ROOT_SESSION)).text;
  }

  /** Stops any running turn, then deletes all of this chat's storage and its alarm. The User DO drops it from the
   * catalog right after, so the gate never routes to this name again. */
  async wipe() {
    await this.harness.session().abort();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** Logs the root conversation's finished turn into the OptChat memory; it summarizes in the background. */
  async logTurn() {
    const logged = (this.ctx.storage.kv.get("optchat:logged") as number | undefined) ?? 0;
    const entries = await this.harness.session().messages();
    await this.#user().memoryLog(this.chatId, entries.slice(logged).flatMap(logRows));
    this.ctx.storage.kv.put("optchat:logged", entries.length);
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
