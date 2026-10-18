import type { OAuthCredential } from "@earendil-works/pi-ai";
import { Agent } from "agents";
import type { Env } from "../env.ts";
import { authorize, complete, refresh, type Connection, type Pending } from "./siwc.ts";

import type { ChatSummary, IndexRow, SearchHit, UserState } from "../shared.ts";

/**
 * One per better-auth user (name = user id). Owns the chat list (synced to the
 * sidebar as agent state), the FTS5 search index, and the ChatGPT connection.
 * Every method here is Durable Object RPC only; nothing is `@callable`, so a
 * browser can read state but never write it.
 */
export class User extends Agent<Env, UserState> {
  initialState: UserState = { chats: [], chatgpt: null };
  #refreshing: Promise<Connection> | null = null;

  onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at INTEGER NOT NULL)`;
    this.sql`CREATE TABLE IF NOT EXISTS indexed (chat_id TEXT NOT NULL, entry_id TEXT NOT NULL, PRIMARY KEY (chat_id, entry_id))`;
    this.sql`CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(text, chat_id UNINDEXED, entry_id UNINDEXED, role UNINDEXED, tokenize = 'porter unicode61')`;
  }

  #publish() {
    const chats = this.sql<{ id: string; title: string; updated_at: number }>`SELECT * FROM chats ORDER BY updated_at DESC`;
    this.setState({ ...this.state, chats: chats.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updated_at })) });
  }

  createChat(): ChatSummary {
    const chat = { id: crypto.randomUUID(), title: "New chat", updatedAt: Date.now() };
    this.sql`INSERT INTO chats (id, title, updated_at) VALUES (${chat.id}, ${chat.title}, ${chat.updatedAt})`;
    this.#publish();
    return chat;
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
             snippet(messages, 0, '[', ']', '…', 12) AS snippet
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
    this.setState({ ...this.state, chatgpt: null });
  }

  /** The credential pi uses. Fails loudly when the user hasn't connected ChatGPT. */
  credential(): OAuthCredential {
    const connection = this.#kv<Connection>("siwc:connection");
    if (!connection) throw new Error("Connect your ChatGPT plan first");
    return connection;
  }

  /** Model slugs this ChatGPT account may use (research/siwc.md: GET /v1/models, visibility "list"). */
  async availableModels(): Promise<string[]> {
    const stored = this.credential();
    const credential = stored.expires > Date.now() ? stored : await this.refreshCredential(stored);
    const res = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${credential.access}` } });
    if (!res.ok) throw new Error(`GET /v1/models failed (${res.status}): ${await res.text()}`);
    const body = (await res.json()) as { models: { slug: string; visibility: string }[] };
    return body.models.filter((m) => m.visibility === "list").map((m) => m.slug);
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
