import type { OAuthCredential } from "@earendil-works/pi-ai";
import { Agent } from "agents";
import type { Env } from "../env.ts";
import { authorize, complete, refresh, type Connection, type Pending } from "./siwc.ts";
import { assertLook, botObjectName, nextLook, type BotLook, type BotSummary, type IndexRow, type SearchHit, type UserState } from "../shared.ts";

/**
 * One per better-auth user (name = user id). Owns the bot list (synced to the sidebar as agent state), the FTS5 search
 * index over every bot's conversation, and the ChatGPT connection the bots run on. Memory is per bot, in its Bot DO.
 * Every method here is Durable Object RPC only; nothing is `@callable`, so a browser can read state but never write it.
 */
export class User extends Agent<Env, UserState> {
  initialState: UserState = { bots: [], groups: [], mainBot: null, chatgpt: null };
  #refreshing: Promise<Connection> | null = null;

  onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, instructions TEXT NOT NULL, color TEXT NOT NULL, updated_at INTEGER NOT NULL, shape TEXT NOT NULL, expression TEXT NOT NULL)`;
    // Bots from before looks: their color was a hex from the old palette (same order as LOOK_COLORS), now bloub's id.
    if (!this.sql`SELECT 1 FROM pragma_table_info('bots') WHERE name = 'shape'`.length) {
      this.sql`ALTER TABLE bots ADD COLUMN shape TEXT NOT NULL DEFAULT 'cercle'`;
      this.sql`ALTER TABLE bots ADD COLUMN expression TEXT NOT NULL DEFAULT 'neutre'`;
      ["#f97316", "#3b82f6", "#a855f7", "#ef4444", "#14b8a6", "#22c55e", "#eab308", "#ec4899"].forEach((hex, i) => this.sql`UPDATE bots SET color = ${nextLook(i).color} WHERE color = ${hex}`);
    }
    this.sql`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, title TEXT NOT NULL, members TEXT NOT NULL)`;
    this.sql`CREATE TABLE IF NOT EXISTS bot_agents (bot_id TEXT NOT NULL, name TEXT NOT NULL, session TEXT NOT NULL, PRIMARY KEY (bot_id, name))`;
    this.sql`CREATE TABLE IF NOT EXISTS indexed (bot_id TEXT NOT NULL, entry_id TEXT NOT NULL, PRIMARY KEY (bot_id, entry_id))`;
    this.sql`CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(text, bot_id UNINDEXED, entry_id UNINDEXED, role UNINDEXED, tokenize = 'porter unicode61')`;
    // The rail's glance layer: when the user last looked at each bot, and whether its main conversation is running.
    this.sql`CREATE TABLE IF NOT EXISTS glance (bot_id TEXT PRIMARY KEY, seen INTEGER NOT NULL, working INTEGER NOT NULL DEFAULT 0)`;
    this.sql`INSERT OR IGNORE INTO glance (bot_id, seen) SELECT id, updated_at FROM bots`; // bots from before the glance layer
    this.#publish(); // the synced state is derived from these tables, so it follows their shape after a migration
  }

  #publish() {
    const bots = this.sql<{ id: string; name: string; instructions: string; color: BotLook["color"]; shape: BotLook["shape"]; expression: BotLook["expression"]; updated_at: number; seen: number; working: number }>`
      SELECT b.*, g.seen, g.working FROM bots b JOIN glance g ON g.bot_id = b.id ORDER BY b.rowid`;
    const agents = this.sql<{ bot_id: string; name: string; session: string }>`SELECT * FROM bot_agents ORDER BY rowid`;
    const groups = this.sql<{ id: string; title: string; members: string }>`SELECT * FROM groups ORDER BY rowid`;
    this.setState({
      ...this.state,
      groups: groups.map((g) => ({ id: g.id, title: g.title, members: JSON.parse(g.members) as string[] })),
      bots: bots.map((b) => ({
        id: b.id,
        name: b.name,
        instructions: b.instructions,
        look: assertLook({ shape: b.shape, color: b.color, expression: b.expression }),
        updatedAt: b.updated_at,
        agents: agents.filter((a) => a.bot_id === b.id).map(({ name, session }) => ({ name, session })),
        working: b.working === 1,
        unread: b.updated_at > b.seen,
      })),
    });
  }

  /** A name is how bots address each other (`bots` tool), so it is unique per user, case-insensitively. */
  #checkName(name: string, except?: string) {
    if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,31}$/u.test(name)) throw new Error("A bot name is 1-32 letters, digits, spaces, - or _");
    if (this.sql`SELECT 1 FROM bots WHERE name = ${name} AND id != ${except ?? ""}`.length) throw new Error(`You already have a bot named ${name}`);
  }

  /** `look`: the one picked in the new-bot form; the fleet tool leaves it to `nextLook`. */
  async createBot(name: string, instructions: string, look: BotLook = nextLook(this.sql`SELECT 1 FROM bots`.length)): Promise<BotSummary> {
    const trimmed = name.trim();
    this.#checkName(trimmed);
    const { shape, color, expression } = assertLook(look);
    const id = crypto.randomUUID();
    const now = Date.now();
    this.sql`INSERT INTO bots (id, name, instructions, color, updated_at, shape, expression) VALUES (${id}, ${trimmed}, ${instructions.trim()}, ${color}, ${now}, ${shape}, ${expression})`;
    this.sql`INSERT INTO glance (bot_id, seen) VALUES (${id}, ${now})`;
    this.#publish();
    await this.#sendProfile(id);
    // The first bot is the main bot until the user picks another.
    if (!this.state.mainBot) await this.setMainBot(id);
    else await this.#botDO(id).setMain(false);
    return this.bot(id);
  }

  listBots(): BotSummary[] {
    return this.state.bots;
  }

  bot(botId: string): BotSummary {
    const bot = this.state.bots.find((b) => b.id === botId);
    if (!bot) throw new Error(`Unknown bot ${botId}`);
    return bot;
  }

  hasBot(botId: string) {
    return this.sql`SELECT 1 FROM bots WHERE id = ${botId}`.length === 1;
  }

  #botDO(botId: string) {
    return this.env.Bot.getByName(botObjectName(this.name, botId));
  }

  /** The Bot DO keeps its own copy of its name and instructions: its prompt is rendered synchronously. */
  #sendProfile(botId: string) {
    const { name, instructions } = this.bot(botId);
    return this.#botDO(botId).setProfile(name, instructions);
  }

  /** Makes `botId` the orchestrator: it gets the `fleet` tool, the previous main bot loses it. */
  async setMainBot(botId: string) {
    this.bot(botId);
    const previous = this.state.mainBot;
    this.setState({ ...this.state, mainBot: botId });
    if (previous && previous !== botId && this.hasBot(previous)) await this.#botDO(previous).setMain(false);
    await this.#botDO(botId).setMain(true);
  }

  /** The bot named `name` (case-insensitive), for the main bot's `fleet` tool. */
  botByName(name: string): BotSummary {
    const bot = this.state.bots.find((b) => b.name.toLowerCase() === name.trim().toLowerCase());
    if (!bot) throw new Error(`No bot named ${name}`);
    return bot;
  }

  async updateBot(botId: string, patch: { name?: string; instructions?: string; look?: Partial<BotLook> }) {
    const bot = this.bot(botId);
    if (patch.look) {
      const { shape, color, expression } = assertLook({ ...bot.look, ...patch.look });
      this.sql`UPDATE bots SET shape = ${shape}, color = ${color}, expression = ${expression} WHERE id = ${botId}`;
    }
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      this.#checkName(name, botId);
      this.sql`UPDATE bots SET name = ${name} WHERE id = ${botId}`;
    }
    if (patch.instructions !== undefined) this.sql`UPDATE bots SET instructions = ${patch.instructions.trim()} WHERE id = ${botId}`;
    this.#publish();
    await this.#sendProfile(botId);
  }

  /** A Bot DO reports its subagents so the details panel can list them. */
  setAgents(botId: string, agents: { name: string; session: string }[]) {
    this.bot(botId);
    this.sql`DELETE FROM bot_agents WHERE bot_id = ${botId}`;
    for (const a of agents) this.sql`INSERT INTO bot_agents (bot_id, name, session) VALUES (${botId}, ${a.name}, ${a.session})`;
    this.#publish();
  }

  /** The Bot DO reports when a run of its main conversation starts and ends (src/server/bot.ts #watchRuns). */
  setWorking(botId: string, working: boolean) {
    this.bot(botId);
    this.sql`UPDATE glance SET working = ${working ? 1 : 0} WHERE bot_id = ${botId}`;
    this.#publish();
  }

  /** The user is looking at the bot's conversation: what it said so far is read. */
  markSeen(botId: string) {
    if (!this.bot(botId).unread) return;
    this.sql`UPDATE glance SET seen = ${Date.now()} WHERE bot_id = ${botId}`;
    this.#publish();
  }

  /** Wipes the Bot DO (conversation, memory, subagents, routines) and its BotData DO, then every trace of it here. */
  async deleteBot(botId: string) {
    this.bot(botId);
    if (this.state.mainBot === botId) throw new Error("This is your main bot: make another bot main before deleting it");
    const group = this.state.groups.find((g) => g.members.includes(botId));
    if (group) throw new Error(`This bot is in the group "${group.title}": disband it first`);
    await this.env.Bot.getByName(botObjectName(this.name, botId)).wipe();
    await this.env.BotData.getByName(botObjectName(this.name, botId)).wipe();
    this.sql`DELETE FROM messages WHERE bot_id = ${botId}`;
    this.sql`DELETE FROM indexed WHERE bot_id = ${botId}`;
    this.sql`DELETE FROM bot_agents WHERE bot_id = ${botId}`;
    this.sql`DELETE FROM glance WHERE bot_id = ${botId}`;
    this.sql`DELETE FROM bots WHERE id = ${botId}`;
    this.#publish();
  }

  // --- groups ---

  /** A room for some of the user's bots, with what it is for; it lives until the user disbands it. */
  async createGroup(title: string, botIds: string[], purpose: string) {
    const members = [...new Set(botIds)].map((id) => this.bot(id));
    const id = crypto.randomUUID();
    const name = title.trim() || members.map((m) => m.name).join(", ");
    await this.env.Group.getByName(botObjectName(this.name, id)).init(name, purpose.trim(), members.map(({ id, name }) => ({ id, name })));
    this.sql`INSERT INTO groups (id, title, members) VALUES (${id}, ${name}, ${JSON.stringify(members.map((m) => m.id))})`;
    this.#publish();
    return id;
  }

  hasGroup(groupId: string) {
    return this.sql`SELECT 1 FROM groups WHERE id = ${groupId}`.length === 1;
  }

  /** Renames the room or changes its purpose; the catalog keeps the title in sync. */
  async updateGroup(groupId: string, patch: { title?: string; purpose?: string }) {
    if (!this.hasGroup(groupId)) throw new Error(`Unknown group ${groupId}`);
    const title = patch.title?.trim();
    if (title === "") throw new Error("A group needs a title");
    await this.env.Group.getByName(botObjectName(this.name, groupId)).update({ ...(title !== undefined && { title }), ...(patch.purpose !== undefined && { purpose: patch.purpose.trim() }) });
    if (title !== undefined) this.sql`UPDATE groups SET title = ${title} WHERE id = ${groupId}`;
    this.#publish();
  }

  /** Deletes the room and its transcript. Each member keeps what it remembers of it (its own memory). */
  async disbandGroup(groupId: string) {
    if (!this.hasGroup(groupId)) throw new Error(`Unknown group ${groupId}`);
    await this.env.Group.getByName(botObjectName(this.name, groupId)).wipe();
    this.sql`DELETE FROM groups WHERE id = ${groupId}`;
    this.#publish();
  }

  /** Called by a Bot DO after each commit: indexes new user/assistant messages and bumps the bot. */
  indexMessages(botId: string, rows: IndexRow[]) {
    this.bot(botId);
    const sql = this.ctx.storage.sql;
    for (const row of rows) {
      const fresh = sql.exec("INSERT OR IGNORE INTO indexed (bot_id, entry_id) VALUES (?, ?)", botId, row.entryId).rowsWritten;
      if (fresh) sql.exec("INSERT INTO messages (text, bot_id, entry_id, role) VALUES (?, ?, ?, ?)", row.text, botId, row.entryId, row.role);
    }
    this.sql`UPDATE bots SET updated_at = ${Date.now()} WHERE id = ${botId}`;
    this.#publish();
  }

  /** bm25-ranked search over every bot's conversation. Each term is quoted so user input is never FTS syntax. */
  search(query: string): SearchHit[] {
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const match = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" ");
    return this.sql<SearchHit>`
      SELECT m.bot_id AS botId, m.entry_id AS entryId, m.role AS role, b.name AS name,
             snippet(messages, 0, char(2), char(3), '…', 12) AS snippet
      FROM messages m JOIN bots b ON b.id = m.bot_id
      WHERE messages MATCH ${match}
      ORDER BY bm25(messages) LIMIT 20`;
  }

  // --- ChatGPT connection (Sign in with ChatGPT) ---

  #kv<T>(key: string): T | null {
    return (this.ctx.storage.kv.get(key) as T | undefined) ?? null;
  }

  /** Stable host id for this user's "installation" (research/siwc.md: one urn:uuid per host). */
  #hostId(): string {
    const id = this.#kv<string>("siwc:host") ?? `urn:uuid:${crypto.randomUUID()}`;
    this.ctx.storage.kv.put("siwc:host", id);
    return id;
  }

  async beginConnect(): Promise<string> {
    const { url, pending } = await authorize(this.#hostId(), this.#kv<Connection>("siwc:connection"));
    this.ctx.storage.kv.put("siwc:pending", pending);
    return url;
  }

  async completeConnect(callbackUrl: string) {
    const pending = this.#kv<Pending>("siwc:pending");
    if (!pending) throw new Error("No ChatGPT sign-in in progress for this user");
    this.ctx.storage.kv.delete("siwc:pending");
    const connection = await complete(new URL(callbackUrl), pending);
    this.ctx.storage.kv.put("siwc:connection", connection);
    this.setState({ ...this.state, chatgpt: { email: connection.email } });
  }

  disconnect() {
    this.ctx.storage.kv.delete("siwc:connection");
    this.ctx.storage.kv.delete("siwc:models");
    this.setState({ ...this.state, chatgpt: null });
  }

  /** The credential pi uses. Fails loudly when the user hasn't connected ChatGPT. */
  credential(): OAuthCredential {
    const connection = this.#kv<Connection>("siwc:connection");
    if (!connection) throw new Error("Connect your ChatGPT plan first");
    return connection;
  }

  /** Model slugs this ChatGPT account may use, stale-while-revalidate: cached in kv, refreshed in the background after an hour. */
  async availableModels(): Promise<string[]> {
    const cached = this.#kv<{ at: number; slugs: string[] }>("siwc:models");
    if (!cached) return this.#fetchModels();
    if (Date.now() - cached.at > 60 * 60 * 1000) this.ctx.waitUntil(this.#fetchModels());
    return cached.slugs;
  }

  /** GET /v1/models (research/siwc.md: visibility "list" are the usable ones). */
  async #fetchModels(): Promise<string[]> {
    const stored = this.credential();
    const credential = stored.expires > Date.now() ? stored : await this.refreshCredential(stored);
    const res = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${credential.access}` } });
    if (!res.ok) throw new Error(`GET /v1/models failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { models: { slug: string; visibility: string }[] };
    const slugs = body.models.filter((m) => m.visibility === "list").map((m) => m.slug);
    this.ctx.storage.kv.put("siwc:models", { at: Date.now(), slugs });
    return slugs;
  }

  /** Refresh tokens rotate, so all bots refresh through here, one at a time. */
  async refreshCredential(stale: OAuthCredential): Promise<OAuthCredential> {
    while (this.#refreshing) await this.#refreshing;
    const current = this.#kv<Connection>("siwc:connection");
    if (!current) throw new Error("ChatGPT was disconnected");
    if (current.access !== stale.access) return current; // another bot refreshed first
    this.#refreshing = refresh(current);
    try {
      const next = await this.#refreshing;
      this.ctx.storage.kv.put("siwc:connection", next);
      return next;
    } finally {
      this.#refreshing = null;
    }
  }
}
