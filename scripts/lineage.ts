// Lot trace: as user A, create a fresh bot, send one tagged message, then find the tag in every local SQLite file.
// The tag must be exactly where the design says (A's Bot DO pi_* + its own OptChat memory, A's User DO FTS index) and nowhere
// else, and gone from every file once the bot is deleted. Deletes the bot it made; never touches A's other bots.
// Run: node scripts/lineage.ts (dev server up). Exit 0 = pass, 1 = fail, 2 = precondition missing (A has no ChatGPT connection).
import assert from "node:assert/strict";
import { createBot, deleteBot, finish, kindOf, openSocket, query, signIn, sqliteFiles, userFileOf, userState, type Row, type Status } from "./lib.ts";

const SEND_TIMEOUT_MS = 120_000;
const SCAN_TIMEOUT_MS = 60_000;

const A = await signIn("a");
if (!(await userState(A)).chatgpt) {
  console.log("PRECONDITION: sign in as a@test.dev in the UI and connect ChatGPT (the tagged message needs a real model turn).");
  process.exit(2);
}
const tag = `LOT-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const botId = await createBot(A, `lineage-${tag.slice(4)}`);
console.log(`user ${A.id}, new bot ${botId}, tag ${tag}`);

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
  const users = sqliteFiles().filter((f) => kindOf(f) === "User" && f === userFileOf(botId));
  add("A's User DO: exactly one User file lists the bot", users.length === 1, `${users.length} file(s)`);
  const bots = [...hits.keys()].filter((f) => kindOf(f) === "Bot" && hits.get(f)!.has("pi_entries"));
  add("A's Bot DO: exactly one Bot file has the tag in pi_entries", bots.length === 1, `${bots.length} file(s)`);
  const [aUser, aBot] = [users[0], bots[0]];

  // The conversation lives in the Bot DO, its memory beside it; the User DO only indexes the text for search.
  const allowed = (f: string, t: string) => (f === aBot ? /^(pi|optchat)_/.test(t) : f === aUser ? /^messages_/.test(t) : false);
  const stray = [...hits].flatMap(([f, ts]) => [...ts.keys()].filter((t) => !allowed(f, t)).map((t) => `${kindOf(f)}:${f.split("/").pop()!.slice(0, 8)}.${t}`));
  add("tag nowhere else (D1, metadata, kv, other users/bots)", !stray.length, stray.join(", ") || "none");
  if (!aBot || !aUser) return rows;

  const c = hits.get(aBot)!;
  const u = hits.get(aUser) ?? new Map<string, number>();
  add("Bot DO pi_entries: user + assistant", (c.get("pi_entries") ?? 0) >= 2, `${c.get("pi_entries") ?? 0} row(s)`);
  add("Bot DO optchat_log (this bot's own memory)", (c.get("optchat_log") ?? 0) >= 1, `${c.get("optchat_log") ?? 0} row(s)`);
  add("Bot DO optchat_tree (background compaction)", (c.get("optchat_tree") ?? 0) >= 1, `${c.get("optchat_tree") ?? 0} row(s)`, "PENDING");
  add("User DO has no OptChat memory tables", query(aUser, "SELECT 1 FROM sqlite_master WHERE name LIKE 'optchat%'").length === 0, "memory is per bot");
  add("User DO messages FTS: user + assistant", (u.get("messages_content") ?? 0) >= 2, `${u.get("messages_content") ?? 0} row(s)`);
  // `indexed` holds only (bot_id, entry_id), so match it against the entry ids of the tagged FTS rows.
  const ids = query<{ c2: string }>(aUser, "SELECT c2 FROM messages_content WHERE c1 = ? AND c0 LIKE ?", botId, `%${tag}%`).map((r) => r.c2);
  const indexed = ids.filter((id) => query(aUser, "SELECT 1 FROM indexed WHERE bot_id = ? AND entry_id = ?", botId, id).length);
  add("User DO indexed: every tagged entry", ids.length >= 2 && indexed.length === ids.length, `${indexed.length}/${ids.length}`);
  return rows;
}

let rows: Row[];
try {
  const ws = await openSocket(`/agents/bot/${A.id}--${botId}`, A.cookie);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`no run_end within ${SEND_TIMEOUT_MS / 1000}s`)), SEND_TIMEOUT_MS);
    let submitted = false;
    ws.on("message", (d) => {
      const m = JSON.parse(String(d));
      if (m.type === "error") return reject(new Error(`bot socket error: ${m.message}`));
      if (m.type === "result" && m.id === "lot") submitted = true;
      if (m.type === "events" && submitted && m.events.some((e: { type: string }) => e.type === "run_end")) (clearTimeout(t), resolve());
    });
    ws.send(JSON.stringify({ type: "submit", id: "lot", input: `Please repeat this code exactly: ${tag}` }));
  });
  ws.close();

  // Indexing and OptChat logging finish after run_end (waitUntil), so re-scan until everything passes or time runs out.
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  rows = evaluate(scan());
  while (rows.some((r) => r.status !== "PASS") && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    rows = evaluate(scan());
  }
} finally {
  await deleteBot(A, botId);
}
const left = [...scan()].flatMap(([f, ts]) => [...ts.keys()].map((t) => `${kindOf(f)}.${t}`));
assert.ok(rows);
rows.push({ status: left.length ? "FAIL" : "PASS", name: "deleteBot: the tag is gone from every file", detail: left.join(", ") || "none" });
finish(rows);
