import { DurableObject } from "cloudflare:workers";
import { intent } from "./intent.ts";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type, type AssistantMessage } from "@earendil-works/pi-ai";
import { createRegistry, defineExtension, defineTool, GenerationTask, Harness, hook, ROOT_CONVERSATION_ID, type AgentEventStream, type EntryRecord } from "@earendil-works/pi-durable";
import { PiHarness, ROOT_SESSION } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { Scheduler } from "agents/schedules";
import { WebSockets } from "agents/websockets";
import type { Env } from "../env.ts";
import { PiSessionSockets } from "../pi/sockets.ts";
import { agentExtensions, lastOf, retireSubagent, sessionAgents, type AgentHost } from "./agents.ts";
import { webExtension } from "./web.ts";
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
              const group = this.#groupOf(String(api.conversationId));
              if (group) return void this.ctx.waitUntil(this.#replyToGroup(group, answer));
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
      this.registry.install(webExtension(this.env.SEARXNG_URL));
      this.registry.install(this.#dataTools);
      this.registry.install(this.#fleet); // offered only to the main bot's conversation (setMain)
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
    childExcluded: () => [this.#optchat, this.#routineTools, this.#fleet],
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
    await this.#watchRuns();
    // A log with pending summaries resumes after eviction (G7).
    if (this.ctx.storage.sql.exec("SELECT 1 FROM sqlite_master WHERE name = 'optchat_log'").toArray().length) this.#keepPumping();
  }

  // --- glance: the rail shows whether this bot is working ---

  #runs: AgentEventStream | undefined;
  #working: boolean | undefined;

  /** Follows the main conversation's runs and tells the User DO when one starts and ends. The run events cover every
   * way a run ends (answer, abort, model error), and the snapshot corrects what the User DO had after a restart. */
  async #watchRuns() {
    const stream = await this.harness.session().events();
    this.#runs = stream;
    await this.#setWorking(stream.snapshot.run !== undefined);
    stream.start(async (events) => {
      for (const e of events) {
        if (e.type === "snapshot") await this.#setWorking(e.run !== undefined);
        if (e.type === "run_start" || e.type === "run_end") await this.#setWorking(e.type === "run_start");
      }
    });
  }

  async #setWorking(working: boolean) {
    if (working === this.#working) return;
    this.#working = working;
    await this.#user().setWorking(this.botId, working);
  }

  // --- profile ---

  #profile(): { name: string; instructions: string } {
    const profile = this.ctx.storage.kv.get("bot:profile") as { name: string; instructions: string } | undefined;
    if (!profile) throw new Error(`Bot ${this.botId} has no profile yet`);
    return profile;
  }

  #profileSection() {
    const { name, instructions } = this.#profile();
    const main = this.ctx.storage.kv.get("bot:main") === true;
    const role = main
      ? `You are "${name}", the user's main bot: you run their team of bots. Create, rename, re-instruct and delete bots with the fleet tool when the user asks (or when a new specialist would clearly help, after asking), and hand work to them with the bots tool.`
      : `You are the bot "${name}", one of the user's bots. Each bot is its own agent with its own conversation and memory; reach the others with the bots tool.`;
    return `${role}${instructions ? `\n\nThe user's instructions for you:\n${instructions}` : ""}`;
  }

  /** Set by the User DO: the main bot's conversation gets the fleet tool, every other bot's has it removed. */
  async setMain(main: boolean) {
    this.ctx.storage.kv.put("bot:main", main);
    const conversation = await this.harness.conversation(ROOT_SESSION);
    await conversation.configure({ extensions: main ? { add: [this.#fleet] } : { remove: [this.#fleet] } }, BACKGROUND_CONTEXT);
  }

  /** The main bot's tool for managing the user's bots in natural language. */
  readonly #fleet = defineExtension({
    name: "fleet",
    tools: [
      defineTool({
        name: "fleet",
        description:
          "Manage the user's bots (you are the main bot). Actions: list (names and instructions), create (name, instructions: " +
          "what the bot is for, in the user's words), rename (name, newName), instruct (name, instructions: replaces them), " +
          "delete (name: deletes the bot with its conversation, memory and data for good; only when the user asked).",
        parameters: Type.Object({ intent,
          action: Type.Union([Type.Literal("list"), Type.Literal("create"), Type.Literal("rename"), Type.Literal("instruct"), Type.Literal("delete")]),
          name: Type.Optional(Type.String()),
          newName: Type.Optional(Type.String()),
          instructions: Type.Optional(Type.String()),
        }),
        replay: "unsafe",
        execute: async ({ action, name, newName, instructions }) => {
          const user = this.#user();
          if (action === "list") return say((await user.listBots()).map((b) => `${b.name}${b.id === this.botId ? " (you)" : ""}: ${b.instructions || "(no instructions)"}`).join("\n"));
          if (!name) return { ...say(`${action} needs a name`), isError: true };
          if (action === "create") return say(`Created ${(await user.createBot(name, instructions ?? "")).name}.`);
          const target = await user.botByName(name);
          if (action === "rename") {
            if (!newName) return { ...say("rename needs newName"), isError: true };
            await user.updateBot(target.id, { name: newName });
            return say(`Renamed ${target.name} to ${newName}.`);
          }
          if (action === "instruct") {
            await user.updateBot(target.id, { instructions: instructions ?? "" });
            return say(`Updated ${target.name}'s instructions.`);
          }
          if (target.id === this.botId) return { ...say("You can't delete yourself"), isError: true };
          await user.deleteBot(target.id);
          return say(`Deleted ${target.name}.`);
        },
      }),
    ],
  });

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

  // --- group chats: each group runs in its own conversation of this bot, so the DM stays the DM ---

  #groupOf(conversation: string): string | undefined {
    return this.ctx.storage.kv.get(`group:of:${conversation}`) as string | undefined;
  }

  #group(groupId: string) {
    return this.env.Group.getByName(`${this.userId}--${groupId}`);
  }

  /** A message in one of the user's groups this bot is in: answered in the group's own conversation (created on first
   * use, without memory, routines or fleet tools), and logged to this bot's memory so it remembers the group. */
  async receiveGroup(groupId: string, title: string, members: string[], from: string, text: string) {
    let session = this.ctx.storage.kv.get(`group:session:${groupId}`) as string | undefined;
    if (!session) {
      session = (await this.harness.sessions.create()).id;
      const conversation = await this.harness.conversation(session);
      const { name, instructions } = this.#profile();
      await conversation.configure(
        {
          extensions: { remove: [this.#optchat, this.#routineTools, this.#fleet] },
          instructions:
            `You are the bot "${name}" in the group chat "${title}" with the user and the bots ${members.filter((m) => m !== name).join(", ")}. ` +
            `Messages come as "<sender>: <text>". Your final answer is posted to the group as your message, so write it for everyone; ` +
            `mention a bot as @name to hand it something (only mentioned bots hear a bot's message). If you have nothing useful to add, ` +
            `answer exactly PASS and nothing is posted.${instructions ? `\n\nThe user's instructions for you:\n${instructions}` : ""}`,
        },
        BACKGROUND_CONTEXT,
      );
      this.ctx.storage.kv.put(`group:session:${groupId}`, session);
      this.ctx.storage.kv.put(`group:of:${session}`, groupId);
      this.ctx.storage.kv.put(`group:title:${groupId}`, title);
    }
    this.#openMemory().append("work", `[group "${title}"] ${from}: ${text}`, new Date().toISOString());
    this.#keepPumping();
    await this.harness.session(session).submit(`${from}: ${text}`, { whenBusy: "followUp" });
  }

  async #replyToGroup(groupId: string, answer: AssistantMessage) {
    const text = answer.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n").trim();
    const pass = !text || /^PASS\W*$/i.test(text);
    if (!pass) {
      const title = this.ctx.storage.kv.get(`group:title:${groupId}`) as string;
      this.#openMemory().append("work", `[group "${title}"] you (${this.#profile().name}): ${text}`, new Date().toISOString());
      this.#keepPumping();
    }
    await this.#group(groupId).botReply(this.botId, pass ? null : text);
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
        parameters: Type.Object({ intent,
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

  // --- research workspace: SQL and a library of reports, in this bot's BotData DO; every agent of the bot gets it ---

  readonly #data = () => this.env.BotData.getByName(this.#name);

  readonly #dataTools = defineExtension({
    name: "workspace",
    tools: [
      defineTool({
        name: "sql",
        description:
          "Your private SQLite database for research data: create tables for what you collect, insert rows, and analyze with " +
          "SQL (JSON functions, window functions, FTS5 virtual tables all work). Runs any statements; the last one's rows come " +
          "back as a table (200 rows max). Pass `schema: true` instead of a query to see your tables.",
        parameters: Type.Object({ intent, query: Type.Optional(Type.String()), schema: Type.Optional(Type.Boolean()) }),
        replay: "unsafe",
        execute: async ({ query, schema }) => {
          if (schema) return say(await this.#data().schema());
          if (!query) return { ...say("Pass a query, or schema: true"), isError: true };
          return say(await this.#data().sql(query));
        },
      }),
      defineTool({
        name: "library",
        description:
          "Your library of reports, which the user reads in the bot's details panel. Actions: save (title, body: markdown; " +
          "use it for finished research write-ups), list, read (id).",
        parameters: Type.Object({ intent,
          action: Type.Union([Type.Literal("save"), Type.Literal("list"), Type.Literal("read")]),
          title: Type.Optional(Type.String()),
          body: Type.Optional(Type.String()),
          id: Type.Optional(Type.Integer()),
        }),
        replay: "unsafe",
        execute: async ({ action, title, body, id }) => {
          if (action === "list") return say((await this.#data().library()).map((r) => `${r.id}: ${r.title}`).join("\n") || "Library is empty.");
          if (action === "read") return id === undefined ? { ...say("read needs an id"), isError: true } : say(await this.#data().report(id));
          if (!title || !body) return { ...say("save needs a title and a body"), isError: true };
          const saved = await this.#data().saveReport(title, body);
          return say(`Saved report ${saved.id}: ${saved.title}`);
        },
      }),
    ],
  });

  /** What the details panel shows. */
  async details(): Promise<BotDetails> {
    const data = this.#data();
    const [library, tables] = await Promise.all([data.library(), data.tables()]);
    return { memory: this.#stats(), routines: this.#routines(), library: library.map((r) => ({ ...r })), tables: tables.map((t) => ({ ...t })) };
  }

  // --- lifecycle ---

  /** Stops any running turn, then deletes all of this bot's storage and its alarm. The User DO drops it from the
   * catalog right after, so the gate never routes to this name again. */
  async wipe() {
    await this.harness.session().abort();
    await this.#runs?.stop(); // after the abort's run_end: the User DO drops this bot next, nothing may report on it after
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
