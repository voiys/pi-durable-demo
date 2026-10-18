// Helpers shared by the check scripts in scripts/ (sign-in, agent sockets, server fns, local SQLite, result table).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import WebSocket from "ws";
import type { UserState } from "../src/shared.ts";

export const ROOT = new URL("..", import.meta.url).pathname;
const users = JSON.parse(readFileSync(`${ROOT}scripts/test-users.json`, "utf8")) as Record<"a" | "b", { email: string; password: string }> & { origin: string };
export const origin = users.origin;
export const wsOrigin = origin.replace(/^http/, "ws");

export type Actor = { name: string; id: string; cookie: string };

export async function signIn(key: "a" | "b"): Promise<Actor> {
  const res = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ email: users[key].email, password: users[key].password }),
  });
  assert.equal(res.status, 200, `sign-in ${users[key].email}: ${res.status} ${await res.clone().text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  assert.ok(cookie, `sign-in ${users[key].email} set no cookie`);
  const { user } = (await res.json()) as { user: { id: string } };
  assert.ok(user.id);
  return { name: key.toUpperCase(), id: user.id, cookie };
}

/** Opens an agent socket; rejects if the server refuses the upgrade. */
export const openSocket = (path: string, cookie: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(wsOrigin + path, { headers: { cookie, origin } });
    ws.once("open", () => resolve(ws));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`${path} refused: ${res.statusCode}`)));
    ws.once("error", reject);
  });

/** The User agent pushes its state (`cf_agent_state`) right after connect. */
export async function userState(actor: Actor): Promise<UserState> {
  const ws = await openSocket(`/agents/user/${actor.id}`, actor.cookie);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => (ws.close(), reject(new Error(`no cf_agent_state for ${actor.name} within 10s`))), 10_000);
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data));
      if (msg.type !== "cf_agent_state") return;
      clearTimeout(timer);
      ws.close();
      resolve(msg.state);
    });
  });
}

// Server fns are TanStack RPC. The dev server's client build of src/server/fns.ts names each fn's id in createClientRpc("...").
let fnsModule: string | undefined;
async function fnId(name: string) {
  fnsModule ??= await (await fetch(`${origin}/src/server/fns.ts`)).text();
  const m = fnsModule.match(new RegExp(`export const ${name} = [^\\n]*?createClientRpc\\("([^"]+)"\\)`));
  assert.ok(m, `server fn ${name} not found in the dev client module`);
  return m[1];
}
// seroval wire format of `{ data }`, only for the value shapes these fns take (undefined, boolean, number, string, flat object).
const enc = (v: unknown, i = { n: 0 }): unknown =>
  v === undefined ? { t: 2, s: 1 }
  : typeof v === "boolean" ? { t: 2, s: v ? 2 : 3 }
  : typeof v === "number" ? { t: 0, s: v }
  : typeof v === "string" ? { t: 1, s: v }
  : { t: 10, i: ++i.n, p: { k: Object.keys(v as object), v: Object.values(v as object).map((x) => enc(x, i)) }, o: 0 };
const payload = (data: unknown) => JSON.stringify({ t: { t: 10, i: 0, p: { k: ["data"], v: [enc(data)] }, o: 0 }, f: 127, m: [] });

export async function serverFn(who: Actor | null, name: string, method: "GET" | "POST", data: unknown) {
  const url = `${origin}/_serverFn/${await fnId(name)}` + (method === "GET" ? `?payload=${encodeURIComponent(payload(data))}` : "");
  const res = await fetch(url, {
    method,
    headers: { origin, "x-tsr-serverFn": "true", ...(who && { cookie: who.cookie }), ...(method === "POST" && { "content-type": "application/json" }) },
    body: method === "POST" ? payload(data) : undefined,
  });
  return { status: res.status, body: await res.text() };
}

// ---- local SQLite (read-only) ----
export const LOCAL = `${ROOT}.alchemy/local`;
export type Kind = "User" | "Chat" | "D1" | "metadata" | "other";
/** DO/D1 files are named by id hash; metadata.sqlite is workerd bookkeeping. */
export const kindOf = (file: string): Kind =>
  file.endsWith("/metadata.sqlite") ? "metadata" : file.includes("-User/") ? "User" : file.includes("-Chat/") ? "Chat" : file.includes("/d1/") ? "D1" : "other";
export const sqliteFiles = (dir = LOCAL): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sqliteFiles(join(dir, e.name)) : e.name.endsWith(".sqlite") ? [join(dir, e.name)] : [])).sort();

export function query<T>(file: string, sql: string, ...args: string[]): T[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare(sql).all(...args) as T[];
  } finally {
    db.close();
  }
}

// ---- result table ----
export type Status = "PASS" | "FAIL" | "PENDING";
export type Row = { status: Status; name: string; detail: string };

/** Prints the table and exits 1 if any row failed. PENDING never fails a run. */
export function finish(rows: Row[]): never {
  assert.ok(rows.length, "no checks ran");
  const w = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) console.log(`${r.status.padEnd(8)} ${r.name.padEnd(w)}  ${r.detail}`);
  const failed = rows.filter((r) => r.status === "FAIL").length;
  const pending = rows.filter((r) => r.status === "PENDING").length;
  console.log(`\n${failed ? "FAIL" : "PASS"}: ${rows.length - failed - pending} pass, ${failed} fail, ${pending} pending`);
  process.exit(failed ? 1 : 0);
}

/** Sends one message to a chat over its socket and resolves with the run's final answer text (the last assistant message
 * committed before run_end). */
export async function ask(actor: Actor, chatId: string, input: string, timeoutMs = 180_000): Promise<string> {
  const ws = await openSocket(`/agents/chat/${actor.id}--${chatId}`, actor.cookie);
  const id = `ask-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => (ws.close(), reject(new Error(`no run_end within ${timeoutMs / 1000}s for "${input.slice(0, 40)}"`))), timeoutMs);
    let submitted = false;
    let last = "";
    ws.on("message", (data) => {
      const m = JSON.parse(String(data));
      if (m.type === "error") return clearTimeout(timer), ws.close(), reject(new Error(m.message));
      if (m.type === "result" && m.id === id) submitted = true;
      if (m.type !== "events" || !submitted) return;
      for (const e of m.events) {
        const msg = e.type === "message_end" ? e.entry?.model?.[0] : undefined;
        if (msg?.role === "assistant") last = msg.content.flatMap((c: { type: string; text?: string }) => (c.type === "text" ? [c.text] : [])).join("");
        if (e.type === "run_end") return clearTimeout(timer), ws.close(), resolve(last);
      }
    });
    ws.send(JSON.stringify({ type: "submit", id, input }));
  });
}
