import { DurableObject } from "cloudflare:workers";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type, type AssistantMessage } from "@earendil-works/pi-ai";
import { createRegistry, defineExtension, defineTool, GenerationTask, Harness, hook, ROOT_CONVERSATION_ID, type EntryRecord } from "@earendil-works/pi-durable";
import { PiHarness, ROOT_SESSION } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { Scheduler } from "agents/schedules";
import { WebSockets } from "agents/websockets";
import type { Env } from "../env.ts";
import { PiSessionSockets } from "../pi/sockets.ts";
import { agentExtensions, lastOf, retireSubagent, sessionAgents, type AgentHost } from "./agents.ts";
import { createCompressor } from "../optchat/compactor.ts";
import { planLog, type LogCursor } from "../optchat/cursor.ts";
import { logRows, optchatExtension, settledEnd } from "../optchat/extension.ts";
import { Memory } from "../optchat/memory.ts";
import { sqliteStore } from "../optchat/store.ts";
import { searchPage } from "../optchat/tools.ts";
import { MODEL, pickerOptions, planModels } from "./models.ts";
import { DEFAULT_MODEL, VIEW_BUDGETS, type BotDetails, type IndexRow, type MemoryStats, type ModelOption, type Routine } from "../shared.ts";

/** The summarizer model: cheap, and checked against the plan before each call (fix plan G11). */
const COMPACTOR = "gpt-6-luna";
const say = (text: string) => ({ output: [{ type: "text" as const, text }] });

function text(entry: EntryRecord): string {
  const message = entry.model?.[0];
  if (!message || (message.role !== "user" && message.role !== "assistant")) return "";
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
}

/**
 * One bot (name = `<userId>--<botId>`): a single endless conversation running pi through PiHarness, with its own
 * OptChat memory, subagents and routines, all in this object's SQLite. The model runs on the owner's ChatGPT plan, read
 * from and refreshed by their User DO.
 */
export class Bot extends DurableObject<Env> {
  readonly #name = this.ctx.id.name ?? "";
  readonly userId = this.#name.split("--")[0];
  readonly botId = this.#name.split("--")[1];
  readonly #user = () => this.env.User.getByName(this.userId);

  readonly scheduler = new Scheduler({
    callbacks: {
      // Keeps summarizing alive across eviction while work is pending (fix plan G7).
      pumpMemory: () => {
        const m = this.#openMemory();
        if (m.pending > 0 || m.active > 0) this.#keepPumping();
      },
      runRoutine: async ({ id }: { id: string }) => {
        const routine = this.#routines().find((r) => r.id === id);
        if (!routine?.enabled) return;
        await this.harness.session().submit(`[routine "${routine.name}"] ${routine.prompt}`, { whenBusy: "followUp" });
      },
    },
  });

  readonly registry = createRegistry();
  readonly #optchat = optchatExtension({
    flush: (scope) => this.#log(scope),
    view: () => this.#view(),
    zoom: async (id, n, offset, limit) => this.#openMemory().zoom(id, n, offset, limit),
    date: async (id) => this.#openMemory().date(id),
    search: async (text, before) => searchPage(this.#openMemory(), text, before),
  });

  readonly harness = new PiHarness({
    harness: ({ storage, context }) => {
      this.registry.install({
        name: "bot",
        // Who this bot is: its name and the user's instructions, for the main agent only; subagents get their own.
        sections: [{ key: "bot", render: (input) => (input.conversationId === ROOT_CONVERSATION_ID ? this.#profileSection() : undefined), tag: false }],
        hooks: [
          hook(GenerationTask, {
            // Log as the run goes, as upstream logs each message on message_end (fix plan G2).
            afterTools: (_assistant, _results, api) => (api.conversationId === ROOT_CONVERSATION_ID ? this.#log("all") : undefined),
            // The answer comes from the hook argument: pi commits it right after this hook runs.
            onYield: (answer, api) => {
              if (api.conversationId !== ROOT_CONVERSATION_ID) return;
              this.ctx.waitUntil(this.syncIndex());
              this.ctx.waitUntil(this.#log("all", answer));
            },
          }),
        ],
      });
      const { MainTools, PeerTools } = agentExtensions(this.#agentHost);
      this.registry.install(MainTools);
      this.registry.install(PeerTools);
      this.registry.install(this.#routineTools);
      this.registry.install(this.#optchat);
      const models = planModels(() => this.#user().credential(), (c) => this.#user().refreshCredential(c));
      return Harness.open(storage, { models, registry: this.registry }, context);
    },
    defaults: { model: MODEL, thinkingLevel: DEFAULT_MODEL.thinkingLevel },
  });

  // Declared after `harness`; the harness factory only reads it once pi opens.
  readonly #agentHost: AgentHost = {
    harness: this.harness,
    botId: this.botId,
    bots: async () => (await this.#user().listBots()).map((b) => ({ id: b.id, name: b.name })),
    sendToBot: (botId, message) => this.env.Bot.getByName(`${this.userId}--${botId}`).receive(this.#profile().name, message),
    lastOfBot: (botId) => this.env.Bot.getByName(`${this.userId}--${botId}`).lastAnswer(),
    childExcluded: () => [this.#optchat, this.#routineTools],
    agentsChanged: async () =>
      this.#user().setAgents(this.botId, (await sessionAgents(this.#agentHost)).filter((a) => a.name !== "main").map(({ name, session }) => ({ name, session }))),
  };
  readonly sockets = new PiSessionSockets(this.harness, this.registry, (tag) => this.ctx.getWebSockets(tag), () => this.syncIndex());
  readonly webSockets = new WebSockets(this.sockets.options());
  readonly lifecycle = Lifecycle.install(this).use(this.webSockets).use(this.harness).use(this.scheduler);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (!this.userId || !this.botId) throw new Error(`Bot DO needs a <userId>--<botId> name, got "${this.#name}"`);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS routines (id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL, cron TEXT NOT NULL, enabled INTEGER NOT NULL, schedule TEXT)");
  }

  async onStart() {
    await this.sockets.reattach();
    // A log with pending summaries resumes after eviction (G7).
    if (this.ctx.storage.sql.exec("SELECT 1 FROM sqlite_master WHERE name = 'optchat_log'").toArray().length) this.#keepPumping();
  }

  // --- profile ---

  #profile(): { name: string; instructions: string } {
    const profile = this.ctx.storage.kv.get("bot:profile") as { name: string; instructions: string } | undefined;
    if (!profile) throw new Error(`Bot ${this.botId} has no profile yet`);
    return profile;
  }

  #profileSection() {
    const { name, instructions } = this.#profile();
    return `You are the bot "${name}", one of the user's bots. Each bot is its own agent with its own conversation and memory; reach the others with the bots tool.${instructions ? `\n\nThe user's instructions for you:\n${instructions}` : ""}`;
  }

  /** Set by the User DO when the bot is created or edited. */
  setProfile(name: string, instructions: string) {
    this.ctx.storage.kv.put("bot:profile", { name, instructions });
  }

  // --- model ---

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

  // --- other bots ---

  /** Another bot of the same user messages this bot (`bots` tool). */
  async receive(from: string, message: string) {
    await this.harness.session().submit(`[message from bot "${from}"] ${message}`, { whenBusy: "followUp" });
  }

  async lastAnswer() {
    return (await lastOf(this.harness, ROOT_SESSION)).text;
  }

  retireSubagent(name: string) {
    return retireSubagent(this.#agentHost, name);
  }

  // --- memory: this bot's OptChat, in this object's SQLite ---

  #memory: Memory | undefined;

  /** Opened once; a budget change or a reset swaps it out (fix plan G6), so readers never get a closed instance.
   * Summarizing runs on the user's plan, so it fails as loudly as a turn would without a ChatGPT connection (G7). */
  #openMemory(): Memory {
    if (this.#memory) return this.#memory;
    const store = sqliteStore(this.ctx.storage.sql);
    const models = planModels(() => this.#user().credential(), (c) => this.#user().refreshCredential(c));
    const compress = createCompressor(() => models, async () => {
      if (!(await this.#user().availableModels()).includes(COMPACTOR)) throw new Error(`Compactor model ${COMPACTOR} is not on this ChatGPT plan`);
      return { provider: MODEL.provider, model: COMPACTOR, thinking: "low" };
    });
    // 3 summaries at once: they share the user's plan with the turns (G11).
    this.#memory = new Memory({ store, saved: store.load() }, compress, console.error, this.#budget(), 3, 10_000);
    return this.#memory;
  }

  #budget(): number {
    return (this.ctx.storage.kv.get("memory:budget") as number | undefined) ?? 128_000;
  }

  #keepPumping() {
    this.ctx.waitUntil(this.scheduler.set(15, "pumpMemory", undefined, { idempotent: true }));
  }

  /** The view a turn starts from, built up to the rows logged so far (G5). A swap (budget change, reset) while waiting
   * retries on the new memory; any other failure surfaces. */
  async #view(): Promise<string> {
    for (;;) {
      const m = this.#openMemory();
      try {
        await m.settle(undefined, "turn", m.root.length);
        return m.render();
      } catch (e) {
        if (this.#memory === m) throw e;
      }
    }
  }

  #logging: Promise<unknown> = Promise.resolve();

  /** Logs committed root entries past the cursor into memory, one call at a time. "settled" stops at the last finished
   * run (the view must not hold the run it is built for); `answer` is a final answer pi hasn't committed yet. */
  #log(scope: "settled" | "all", answer?: AssistantMessage): Promise<void> {
    const run = async () => {
      const cursor = (this.ctx.storage.kv.get("optchat:cursor") as LogCursor | undefined) ?? { entry: -1, answerTs: null };
      const entries = (await this.harness.session().messages()).filter((e) => Number(e.id) > cursor.entry);
      const items = entries.slice(0, scope === "all" ? entries.length : settledEnd(entries)).map((e) => ({
        entryId: Number(e.id),
        role: e.model?.[0]?.role ?? "",
        ts: e.model?.[0]?.timestamp ?? 0,
        rows: logRows(e),
      }));
      const plan = planLog(cursor, items, answer && { ts: answer.timestamp, rows: logRows({ model: [answer] }) });
      const memory = this.#openMemory();
      try {
        for (const r of plan.rows) memory.append(r.kind, r.text, r.date);
      } catch (e) {
        this.#memory = undefined; // the in-RAM log may be ahead of SQLite now; reload it from storage
        throw e;
      }
      this.ctx.storage.kv.put("optchat:cursor", plan.cursor);
      if (plan.rows.length) this.#keepPumping();
    };
    const next = this.#logging.then(run, run);
    this.#logging = next;
    return next;
  }

  #stats(): MemoryStats {
    const m = this.#openMemory();
    return { entries: m.root.length, nodes: m.tree.size, lines: m.view.length, viewBytes: m.size, budget: m.budget, pending: m.pending, building: m.active };
  }

  async setMemoryBudget(bytes: number) {
    if (!VIEW_BUDGETS.includes(bytes as (typeof VIEW_BUDGETS)[number])) throw new Error(`Unsupported view budget ${bytes}`);
    this.ctx.storage.kv.put("memory:budget", bytes);
    const old = this.#memory;
    this.#memory = undefined; // the next reader opens it with the new budget (G6)
    await old?.close();
  }

  /** Forgets everything: stops the compactor and drops the log, tree and view. The conversation stays; turns already
   * logged are not logged again, so the memory starts empty from the next turn. */
  async resetMemory() {
    const old = this.#memory;
    this.#memory = undefined;
    await old?.close();
    for (const t of ["optchat_log", "optchat_tree", "optchat_view"]) this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS ${t}`);
    const cursor = this.ctx.storage.kv.get("optchat:cursor") as LogCursor | undefined;
    if (cursor) this.ctx.storage.kv.put("optchat:cursor", { ...cursor, answerTs: null });
  }

  // --- routines ---

  #routines(): Routine[] {
    return this.ctx.storage.sql
      .exec<{ id: string; name: string; prompt: string; cron: string; enabled: number }>("SELECT id, name, prompt, cron, enabled FROM routines ORDER BY rowid")
      .toArray()
      .map((r) => ({ ...r, enabled: r.enabled === 1 }));
  }

  async #schedule(id: string, cron: string) {
    const schedule = await this.scheduler.set(cron, "runRoutine", { id });
    this.ctx.storage.sql.exec("UPDATE routines SET schedule = ? WHERE id = ?", schedule.id, id);
  }

  async addRoutine(name: string, prompt: string, cron: string): Promise<Routine> {
    if (!name.trim() || !prompt.trim()) throw new Error("A routine needs a name and a prompt");
    const id = crypto.randomUUID();
    // Scheduled first: the Scheduler rejects a bad cron before any row exists.
    const schedule = await this.scheduler.set(cron.trim(), "runRoutine", { id });
    this.ctx.storage.sql.exec("INSERT INTO routines (id, name, prompt, cron, enabled, schedule) VALUES (?, ?, ?, ?, 1, ?)", id, name.trim(), prompt.trim(), cron.trim(), schedule.id);
    return this.#routines().find((r) => r.id === id)!;
  }

  #scheduleOf(id: string) {
    const row = this.ctx.storage.sql.exec<{ schedule: string | null }>("SELECT schedule FROM routines WHERE id = ?", id).toArray()[0];
    if (!row) throw new Error(`No routine ${id}`);
    return row.schedule;
  }

  async setRoutineEnabled(id: string, enabled: boolean) {
    const schedule = this.#scheduleOf(id);
    if (schedule) await this.scheduler.cancel(schedule);
    this.ctx.storage.sql.exec("UPDATE routines SET enabled = ?, schedule = NULL WHERE id = ?", enabled ? 1 : 0, id);
    if (enabled) await this.#schedule(id, this.#routines().find((r) => r.id === id)!.cron);
  }

  async deleteRoutine(id: string) {
    const schedule = this.#scheduleOf(id);
    if (schedule) await this.scheduler.cancel(schedule);
    this.ctx.storage.sql.exec("DELETE FROM routines WHERE id = ?", id);
  }

  /** The bot's own tool for routines, so "check X every morning" sets one up. Main agent only. */
  readonly #routineTools = defineExtension({
    name: "routines",
    tools: [
      defineTool({
        name: "routines",
        description:
          "Prompts you get on a schedule, in this conversation. Actions: list, add (name, prompt, cron: 5-field cron in UTC, " +
          'e.g. "0 7 * * 1-5" for weekdays at 07:00 UTC), remove (name).',
        parameters: Type.Object({
          action: Type.Union([Type.Literal("list"), Type.Literal("add"), Type.Literal("remove")]),
          name: Type.Optional(Type.String()),
          prompt: Type.Optional(Type.String()),
          cron: Type.Optional(Type.String()),
        }),
        replay: "unsafe",
        execute: async ({ action, name, prompt, cron }) => {
          if (action === "list") return say(this.#routines().map((r) => `${r.name} (${r.cron}${r.enabled ? "" : ", off"}): ${r.prompt}`).join("\n") || "No routines.");
          if (action === "add") {
            if (!name || !prompt || !cron) return { ...say("add needs name, prompt and cron"), isError: true };
            const r = await this.addRoutine(name, prompt, cron);
            return say(`Added routine ${r.name} (${r.cron}).`);
          }
          const target = this.#routines().find((r) => r.name === name);
          if (!target) return { ...say(`No routine named ${name}`), isError: true };
          await this.deleteRoutine(target.id);
          return say(`Removed routine ${target.name}.`);
        },
      }),
    ],
  });

  /** What the details panel shows. */
  details(): BotDetails {
    return { memory: this.#stats(), routines: this.#routines() };
  }

  // --- lifecycle ---

  /** Stops any running turn, then deletes all of this bot's storage and its alarm. The User DO drops it from the
   * catalog right after, so the gate never routes to this name again. */
  async wipe() {
    await this.harness.session().abort();
    await this.#memory?.close();
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
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
    await this.#user().indexMessages(this.botId, rows);
    this.ctx.storage.kv.put("index:sent", entries.length);
  }
}
