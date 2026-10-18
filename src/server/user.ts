import type { OAuthCredential } from "@earendil-works/pi-ai";
import { Agent } from "agents";
import type { Env } from "../env.ts";
import { authorize, complete, refresh, type Connection, type Pending } from "./siwc.ts";

import { createCompressor } from "../optchat/compactor.ts";
import { planLog, type Answer, type LogCursor, type LogItem } from "../optchat/cursor.ts";
import { Memory } from "../optchat/memory.ts";
import { sqliteStore } from "../optchat/store.ts";
import { searchPage } from "../optchat/tools.ts";
import { chatObjectName, DEFAULT_DEBUG, VIEW_BUDGETS, type ChatSummary, type DebugSettings, type IndexRow, type MemoryStats, type SearchHit, type UserState } from "../shared.ts";
import { MODEL, planModels } from "./models.ts";

/** The summarizer model: cheap, and checked against the plan before each call (fix plan G11). */
const COMPACTOR = "gpt-6-luna";

/**
 * One per better-auth user (name = user id). Owns the chat list (synced to the
 * sidebar as agent state), the FTS5 search index, and the ChatGPT connection.
 * Every method here is Durable Object RPC only; nothing is `@callable`, so a
 * browser can read state but never write it.
 */
/** A chat's default title: its first message, cut at a word boundary with "…" so a cut never reads as data (e.g. "port 643"). */
function titleFrom(text: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= 60) return flat;
  const cut = flat.slice(0, 57);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 20 ? cut.lastIndexOf(" ") : 57)}…`;
}

export class User extends Agent<Env, UserState> {
  initialState: UserState = { chats: [], chatgpt: null, debug: DEFAULT_DEBUG };
  #refreshing: Promise<Connection> | null = null;
  #memory: Memory | undefined;

  /** The user's one OptChat memory (DECISIONS.md: per user), in this DO's SQLite. Opened once; a budget change or a
   * reset swaps it out (fix plan G6), so readers never get a closed instance. Summarizing runs on the user's plan, so a
   * user without a ChatGPT connection gets the same loud error as a chat would (G7). */
  #openMemory(): Memory {
    if (this.#memory) return this.#memory;
    this.credential();
    const store = sqliteStore(this.ctx.storage.sql);
    const models = planModels(async () => this.credential(), (c) => this.refreshCredential(c));
    const compress = createCompressor(() => models, async () => {
      if (!(await this.availableModels()).includes(COMPACTOR)) throw new Error(`Compactor model ${COMPACTOR} is not on this ChatGPT plan`);
      return { provider: MODEL.provider, model: COMPACTOR, thinking: "low" };
    });
    // 3 summaries at once: they share the user's plan with the chat turns (G11).
    this.#memory = new Memory({ store, saved: store.load() }, compress, console.error, this.state.debug.viewBytes, 3, 10_000, {
      label: (e) => (e.chat ? `[chat "${this.#chatLabel(e.chat)}"] ` : ""),
    });
    return this.#memory;
  }

  /** The chat's current title as a label: no quotes or newlines; deleted chats are named as such (G1). */
  #chatLabel(chatId: string) {
    const row = this.sql<{ title: string }>`SELECT title FROM chats WHERE id = ${chatId}`[0];
    return row ? row.title.replace(/["\n\r]+/g, " ") : "deleted chat";
  }

  /** Keeps summarizing alive across DO eviction: an alarm reopens the memory while work is pending (G7). */
  #keepPumping() {
    this.ctx.waitUntil(this.schedule(15, "pumpMemory", undefined, { idempotent: true }));
  }

  async pumpMemory() {
    const m = this.#openMemory();
    if (m.pending > 0 || m.active > 0) this.#keepPumping();
  }

  onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS optchat_cursor (chat_id TEXT PRIMARY KEY, entry INTEGER NOT NULL, answer_ts INTEGER)`;
    // A log with pending summaries resumes after eviction (G7).
    const logged = this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name = 'optchat_log'").toArray().length > 0;
    if (logged && this.#kv("siwc:connection")) this.#keepPumping();
    // State saved before the debug settings existed gets them once.
    if (!this.state.debug) this.setState({ ...this.state, debug: DEFAULT_DEBUG });
    this.sql`CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL)`;
    this.sql`CREATE TABLE IF NOT EXISTS chat_agents (chat_id TEXT NOT NULL, name TEXT NOT NULL, session TEXT NOT NULL, PRIMARY KEY (chat_id, name))`;
    this.sql`CREATE TABLE IF NOT EXISTS indexed (chat_id TEXT NOT NULL, entry_id TEXT NOT NULL, PRIMARY KEY (chat_id, entry_id))`;
    this.sql`CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(text, chat_id UNINDEXED, entry_id UNINDEXED, role UNINDEXED, tokenize = 'porter unicode61')`;
  }

  #publish() {
    const chats = this.sql<{ id: string; title: string; updated_at: number }>`SELECT * FROM chats ORDER BY updated_at DESC`;
    const agents = this.sql<{ chat_id: string; name: string; session: string }>`SELECT * FROM chat_agents ORDER BY rowid`;
    this.setState({
      ...this.state,
      chats: chats.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updated_at,
        agents: agents.filter((a) => a.chat_id === c.id).map(({ name, session }) => ({ name, session })),
      })),
    });
  }

  createChat(): ChatSummary {
    const chat = { id: crypto.randomUUID(), title: "New chat", updatedAt: Date.now(), agents: [] };
    this.sql`INSERT INTO chats (id, title, updated_at) VALUES (${chat.id}, ${chat.title}, ${chat.updatedAt})`;
    this.#publish();
    return chat;
  }

  listChats(): ChatSummary[] {
    return this.state.chats;
  }

  /** A Chat DO reports its subagents (v1) so the sidebar can list them under the chat. */
  setAgents(chatId: string, agents: { name: string; session: string }[]) {
    if (!this.hasChat(chatId)) throw new Error(`Unknown chat ${chatId}`);
    this.sql`DELETE FROM chat_agents WHERE chat_id = ${chatId}`;
    this.sql`DELETE FROM optchat_cursor WHERE chat_id = ${chatId}`;
    for (const a of agents) this.sql`INSERT INTO chat_agents (chat_id, name, session) VALUES (${chatId}, ${a.name}, ${a.session})`;
    this.#publish();
  }

  renameChat(chatId: string, title: string) {
    const trimmed = title.trim();
    if (!this.hasChat(chatId)) throw new Error(`Unknown chat ${chatId}`);
    if (!trimmed) throw new Error("A chat title can't be empty");
    this.sql`UPDATE chats SET title = ${trimmed.slice(0, 120)} WHERE id = ${chatId}`;
    this.#publish();
  }

  /** Wipes the Chat DO (transcript, OptChat memory, subagents), then every trace of it here: catalog, subagents, search index. */
  async deleteChat(chatId: string) {
    if (!this.hasChat(chatId)) throw new Error(`Unknown chat ${chatId}`);
    await this.env.Chat.getByName(chatObjectName(this.name, chatId)).wipe();
    this.sql`DELETE FROM messages WHERE chat_id = ${chatId}`;
    this.sql`DELETE FROM indexed WHERE chat_id = ${chatId}`;
    this.sql`DELETE FROM chat_agents WHERE chat_id = ${chatId}`;
    this.sql`DELETE FROM optchat_cursor WHERE chat_id = ${chatId}`;
    this.sql`DELETE FROM chats WHERE id = ${chatId}`;
    this.#publish();
  }

  debugSettings(): DebugSettings {
    return this.state.debug;
  }

  async setDebug(debug: DebugSettings) {
    if (!VIEW_BUDGETS.includes(debug.viewBytes as (typeof VIEW_BUDGETS)[number])) throw new Error(`Unsupported view budget ${debug.viewBytes}`);
    const old = this.#memory;
    this.#memory = undefined; // the next reader opens it with the new budget (G6)
    this.setState({ ...this.state, debug });
    await old?.close();
  }

  // --- OptChat memory, shared by all of this user's chats ---

  /** Where a chat's logging stands (its last logged entry id), so the Chat DO sends only what's new (G3). */
  memoryCursor(chatId: string): number {
    return this.#cursor(chatId).entry;
  }

  #cursor(chatId: string): LogCursor {
    const row = this.sql<{ entry: number; answer_ts: number | null }>`SELECT entry, answer_ts FROM optchat_cursor WHERE chat_id = ${chatId}`[0];
    return row ? { entry: row.entry, answerTs: row.answer_ts } : { entry: -1, answerTs: null };
  }

  /** Logs a chat's new entries (and an answer not committed yet) exactly once. Synchronous: one DO turn, so the rows and
   * the cursor commit together, and concurrent calls can't interleave (G2/G3). Returns the new cursor. */
  memoryLog(chatId: string, items: LogItem[], answer?: Answer): number {
    if (!this.hasChat(chatId)) throw new Error(`Unknown chat ${chatId}`);
    const plan = planLog(this.#cursor(chatId), items, answer);
    const memory = this.#openMemory();
    try {
      for (const r of plan.rows) memory.append(r.kind, r.text, r.date, undefined, undefined, chatId);
    } catch (e) {
      this.#memory = undefined; // the in-RAM log may be ahead of SQLite now; reload it from storage
      throw e;
    }
    this.sql`INSERT OR REPLACE INTO optchat_cursor (chat_id, entry, answer_ts) VALUES (${chatId}, ${plan.cursor.entry}, ${plan.cursor.answerTs})`;
    if (plan.rows.length) this.#keepPumping();
    return plan.cursor.entry;
  }

  /** The view a turn starts from, built up to the rows logged so far, so other chats' new rows never hold it up (G5).
   * A swap (budget change, reset) while waiting retries on the new memory; any other failure surfaces. */
  async memoryView(chatId: string): Promise<{ view: string; chat: string }> {
    for (;;) {
      const m = this.#openMemory();
      try {
        await m.settle(undefined, "turn", m.root.length);
        return { view: m.render(), chat: this.#chatLabel(chatId) };
      } catch (e) {
        if (this.#memory === m) throw e;
      }
    }
  }

  memoryZoom(id: number, n: number, offset?: number, limit?: number) {
    return this.#openMemory().zoom(id, n, offset, limit);
  }

  memoryDate(id: number) {
    return this.#openMemory().date(id);
  }

  memorySearch(text: string, before?: number) {
    return searchPage(this.#openMemory(), text, before);
  }

  /** Forgets everything: stops the compactor and drops the log, tree and view. Chats keep their transcripts; their
   * already-logged turns are not logged again, so the memory starts empty from the next turn. */
  async resetMemory() {
    const old = this.#memory;
    this.#memory = undefined;
    await old?.close();
    for (const t of ["optchat_log", "optchat_tree", "optchat_view"]) this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS ${t}`);
    this.sql`UPDATE optchat_cursor SET answer_ts = NULL`; // cursors stay: logged turns are not logged again
  }

  memoryStats(): MemoryStats {
    const m = this.#openMemory();
    return { entries: m.root.length, nodes: m.tree.size, lines: m.view.length, viewBytes: m.size, budget: m.budget, pending: m.pending, building: m.active };
  }

  hasChat(chatId: string) {
    return this.sql`SELECT 1 FROM chats WHERE id = ${chatId}`.length === 1;
  }

  /** Called by a Chat DO after each commit: indexes new user/assistant messages and bumps the chat. */
  indexMessages(chatId: string, rows: IndexRow[]) {
    if (!this.hasChat(chatId)) throw new Error(`Unknown chat ${chatId}`);
    const sql = this.ctx.storage.sql;
    for (const row of rows) {
      const fresh = sql.exec("INSERT OR IGNORE INTO indexed (chat_id, entry_id) VALUES (?, ?)", chatId, row.entryId).rowsWritten;
      if (fresh) sql.exec("INSERT INTO messages (text, chat_id, entry_id, role) VALUES (?, ?, ?, ?)", row.text, chatId, row.entryId, row.role);
    }
    const first = rows.find((r) => r.role === "user");
    if (first) this.sql`UPDATE chats SET title = ${titleFrom(first.text)} WHERE id = ${chatId} AND title = 'New chat'`;
    this.sql`UPDATE chats SET updated_at = ${Date.now()} WHERE id = ${chatId}`;
    this.#publish();
  }

  /** bm25-ranked search over this user's own messages. Each term is quoted so user input is never FTS syntax. */
  search(query: string): SearchHit[] {
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const match = terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(" ");
    return this.sql<SearchHit>`
      SELECT m.chat_id AS chatId, m.entry_id AS entryId, m.role AS role, c.title AS title,
             snippet(messages, 0, char(2), char(3), '…', 12) AS snippet
      FROM messages m JOIN chats c ON c.id = m.chat_id
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

  /** Refresh tokens rotate, so all chats refresh through here, one at a time. */
  async refreshCredential(stale: OAuthCredential): Promise<OAuthCredential> {
    while (this.#refreshing) await this.#refreshing;
    const current = this.#kv<Connection>("siwc:connection");
    if (!current) throw new Error("ChatGPT was disconnected");
    if (current.access !== stale.access) return current; // another chat refreshed first
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
