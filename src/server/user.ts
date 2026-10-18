import type { OAuthCredential } from "@earendil-works/pi-ai";
import { Agent } from "agents";
import type { Env } from "../env.ts";
import { authorize, complete, refresh, type Connection, type Pending } from "./siwc.ts";

import { createCompressor } from "../optchat/compactor.ts";
import type { LogRow } from "../optchat/extension.ts";
import { Memory } from "../optchat/memory.ts";
import { sqliteStore } from "../optchat/store.ts";
import { searchPage } from "../optchat/tools.ts";
import { chatObjectName, DEFAULT_DEBUG, VIEW_BUDGETS, type ChatSummary, type DebugSettings, type IndexRow, type MemoryStats, type SearchHit, type UserState } from "../shared.ts";
import { MODEL, planModels } from "./models.ts";

/**
 * One per better-auth user (name = user id). Owns the chat list (synced to the
 * sidebar as agent state), the FTS5 search index, and the ChatGPT connection.
 * Every method here is Durable Object RPC only; nothing is `@callable`, so a
 * browser can read state but never write it.
 */
export class User extends Agent<Env, UserState> {
  initialState: UserState = { chats: [], chatgpt: null, debug: DEFAULT_DEBUG };
  #refreshing: Promise<Connection> | null = null;
  #memory: Memory | undefined;

  /** The user's one OptChat memory (DECISIONS.md: per user), in this DO's SQLite; reopened when the Debug budget changes. */
  #openMemory(): Memory {
    const { viewBytes } = this.state.debug;
    if (this.#memory?.budget === viewBytes) return this.#memory;
    void this.#memory?.close();
    const store = sqliteStore(this.ctx.storage.sql);
    const models = planModels(async () => this.credential(), (c) => this.refreshCredential(c));
    const compress = createCompressor(() => models, () => ({ provider: MODEL.provider, model: MODEL.id, thinking: "medium" }));
    this.#memory = new Memory({ store, saved: store.load() }, compress, console.error, viewBytes);
    return this.#memory;
  }

  onStart() {
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
    this.sql`DELETE FROM chats WHERE id = ${chatId}`;
    this.#publish();
  }

  debugSettings(): DebugSettings {
    return this.state.debug;
  }

  setDebug(debug: DebugSettings) {
    if (!VIEW_BUDGETS.includes(debug.viewBytes as (typeof VIEW_BUDGETS)[number])) throw new Error(`Unsupported view budget ${debug.viewBytes}`);
    this.setState({ ...this.state, debug });
  }

  // --- OptChat memory, shared by all of this user's chats ---

  /** Appends a chat's finished turn, tagged with the chat (id in metadata, title in the text), then summarizes in the background. */
  memoryLog(chatId: string, rows: LogRow[]) {
    const chat = this.state.chats.find((c) => c.id === chatId);
    if (!chat) throw new Error(`Unknown chat ${chatId}`);
    const memory = this.#openMemory();
    for (const r of rows) memory.append(r.kind, `[chat: ${chat.title}] ${r.text}`, r.date, undefined, undefined, chatId);
    this.ctx.waitUntil(memory.settle(undefined, "tree"));
  }

  /** The view a turn starts from, once every line in it is a summary. */
  async memoryView() {
    const memory = this.#openMemory();
    await memory.settle();
    return memory.render();
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
    if (first) this.sql`UPDATE chats SET title = ${first.text.slice(0, 60)} WHERE id = ${chatId} AND title = 'New chat'`;
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
