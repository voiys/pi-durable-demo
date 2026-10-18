// Lot trace: as user A, create a fresh OptChat, send one tagged message, then find the tag in every local SQLite file.
// The tag must be exactly where the design says (A's Chat DO pi_* + optchat_*, A's User DO FTS index + title) and nowhere else.
// Run: node scripts/lineage.ts (dev server up). Exit 0 = pass, 1 = fail, 2 = precondition missing (A has no ChatGPT connection).
import assert from "node:assert/strict";
import { finish, kindOf, openSocket, query, serverFn, signIn, sqliteFiles, userState, type Row, type Status } from "./lib.ts";

const SEND_TIMEOUT_MS = 120_000;
const SCAN_TIMEOUT_MS = 60_000;

const A = await signIn("a");
const before = await userState(A);
if (!before.chatgpt) {
  console.log("PRECONDITION: sign in as a@test.dev in the UI and connect ChatGPT (the tagged message needs a real model turn).");
  process.exit(2);
}
const created = await serverFn(A, "createChat", "POST", undefined);
assert.equal(created.status, 200, `createChat: ${created.body}`);
const fresh = (await userState(A)).chats.filter((c) => !before.chats.some((b) => b.id === c.id));
assert.equal(fresh.length, 1, `expected one new chat, got ${fresh.length}`);
const chat = fresh[0];
const tag = `LOT-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
console.log(`user ${A.id}, new OptChat ${chat.id}, tag ${tag}`);

const chatWs = await openSocket(`/agents/chat/${A.id}--${chat.id}`, A.cookie);
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`no run_end within ${SEND_TIMEOUT_MS / 1000}s`)), SEND_TIMEOUT_MS);
  let submitted = false;
  chatWs.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.type === "error") return reject(new Error(`chat socket error: ${m.message}`));
    if (m.type === "result" && m.id === "lot") submitted = true;
    if (m.type === "events" && submitted && m.events.some((e: { type: string }) => e.type === "run_end")) (clearTimeout(t), resolve());
  });
  chatWs.send(JSON.stringify({ type: "submit", id: "lot", input: `Please repeat this code exactly: ${tag}` }));
});
chatWs.close();

// file -> table -> number of rows holding the tag (as UTF-8 or UTF-16 text or blob, in any column).
const needles = [Buffer.from(tag, "utf8"), Buffer.from(tag, "utf16le")];
const has = (v: unknown) => (typeof v === "string" || v instanceof Uint8Array) && needles.some((n) => Buffer.from(v as string).includes(n));
function scan() {
  const out = new Map<string, Map<string, number>>();
  for (const file of sqliteFiles()) {
    // Virtual (FTS5) tables are skipped: their shadow tables (messages_content, ...) hold the text and are scanned.
    for (const { name } of query<{ name: string }>(file, "SELECT name FROM sqlite_master WHERE type = 'table' AND sql NOT LIKE 'CREATE VIRTUAL%'")) {
      const n = query<object>(file, `SELECT * FROM "${name}"`).filter((row) => Object.values(row).some(has)).length;
      if (n) out.set(file, (out.get(file) ?? new Map()).set(name, n));
    }
  }
  return out;
}

function evaluate(hits: Map<string, Map<string, number>>): Row[] {
  const rows: Row[] = [];
  const add = (name: string, ok: boolean, detail: string, otherwise: Status = "FAIL") => rows.push({ status: ok ? "PASS" : otherwise, name, detail });
  const users = sqliteFiles().filter((f) => kindOf(f) === "User" && query(f, "SELECT 1 FROM chats WHERE id = ?", chat.id).length);
  add("A's User DO: exactly one User file lists the chat", users.length === 1, `${users.length} file(s)`);
  const chats = [...hits.keys()].filter((f) => kindOf(f) === "Chat" && hits.get(f)!.has("pi_entries"));
  add("A's Chat DO: exactly one Chat file has the tag in pi_entries", chats.length === 1, `${chats.length} file(s)`);
  const [aUser, aChat] = [users[0], chats[0]];

  // The first user message becomes the chat title, so it lands in the User DO's chats table and agent state too.
  const allowed = (f: string, t: string) =>
    f === aChat ? /^(pi|optchat)_/.test(t) : f === aUser ? /^messages_/.test(t) || t === "chats" || t === "cf_agents_state" : false;
  const stray = [...hits].flatMap(([f, ts]) => [...ts.keys()].filter((t) => !allowed(f, t)).map((t) => `${kindOf(f)}:${f.split("/").pop()!.slice(0, 8)}.${t}`));
  add("tag nowhere else (D1, metadata, kv, other users/chats)", !stray.length, stray.join(", ") || "none");
  if (!aChat || !aUser) return rows;

  const c = hits.get(aChat)!;
  const u = hits.get(aUser) ?? new Map<string, number>();
  add("Chat DO pi_entries: user + assistant", (c.get("pi_entries") ?? 0) >= 2, `${c.get("pi_entries") ?? 0} row(s)`);
  add("Chat DO optchat_log", (c.get("optchat_log") ?? 0) >= 1, `${c.get("optchat_log") ?? 0} row(s)`);
  add("Chat DO optchat_tree (background compaction)", (c.get("optchat_tree") ?? 0) >= 1, `${c.get("optchat_tree") ?? 0} row(s)`, "PENDING");
  add("User DO messages FTS: user + assistant", (u.get("messages_content") ?? 0) >= 2, `${u.get("messages_content") ?? 0} row(s)`);
  // `indexed` holds only (chat_id, entry_id), so match it against the entry ids of the tagged FTS rows.
  const ids = query<{ c2: string }>(aUser, "SELECT c2 FROM messages_content WHERE c1 = ? AND c0 LIKE ?", chat.id, `%${tag}%`).map((r) => r.c2);
  const indexed = ids.filter((id) => query(aUser, "SELECT 1 FROM indexed WHERE chat_id = ? AND entry_id = ?", chat.id, id).length);
  add("User DO indexed: every tagged entry", ids.length >= 2 && indexed.length === ids.length, `${indexed.length}/${ids.length}`);
  const title = query<{ title: string }>(aUser, "SELECT title FROM chats WHERE id = ?", chat.id)[0].title;
  add("User DO chats: title is the tagged message", title.includes(tag), title);
  return rows;
}

// Indexing and OptChat logging finish after run_end (waitUntil), so re-scan until everything passes or time runs out.
const deadline = Date.now() + SCAN_TIMEOUT_MS;
let rows = evaluate(scan());
while (rows.some((r) => r.status !== "PASS") && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 3000));
  rows = evaluate(scan());
}
finish(rows);
