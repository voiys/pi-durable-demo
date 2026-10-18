// Live end-to-end check of per-user OptChat on the running dev server, as a@test.dev (needs ChatGPT connected; spends ~8
// turns of the plan). Every assertion reads what really happened: the replies, and the User DO's SQLite log.
// Run: pnpm check:optchat-e2e
import { ask, finish, LOCAL, query, serverFn, signIn, sqliteFiles, userState, type Row } from "./lib.ts";

const rows: Row[] = [];
const check = (name: string, ok: boolean, detail = "") => rows.push({ status: ok ? "PASS" : "FAIL", name, detail });
const A = await signIn("a");
const state = await userState(A);
if (!state.chatgpt) {
  console.log("PRECONDITION: a@test.dev needs ChatGPT connected (sign in as a@test.dev in the UI, Continue with ChatGPT).");
  process.exit(2);
}
const budget = state.debug.viewBytes;
const tag = `E2E-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
const newChat = async () => {
  const before = (await userState(A)).chats.map((c) => c.id);
  const r = await serverFn(A, "createChat", "POST", undefined);
  if (r.status !== 200) throw new Error(`createChat: ${r.body}`);
  return (await userState(A)).chats.find((c) => !before.includes(c.id))!.id;
};
const userFile = (chatId: string) => sqliteFiles().find((f) => f.includes("-User/") && query(f, "SELECT 1 FROM sqlite_master WHERE name = 'chats'").length && query(f, "SELECT 1 FROM chats WHERE id = ?", chatId).length)!;
type LogRow = { kind: string; text: string; chat: string | null; date: string };
const logOf = (file: string): LogRow[] =>
  query<{ entry: string }>(file, "SELECT entry FROM optchat_log ORDER BY i").map((r) => JSON.parse(r.entry));

// 1. a fact told in chat X is logged once, raw, tagged with X
const X = await newChat();
const r1 = await ask(A, X, `Remember this code word for later: ${tag}. Reply with just: noted`);
await new Promise((r) => setTimeout(r, 3000));
const file = userFile(X);
const xs = logOf(file).filter((r) => r.chat === X);
check("chat X turn logged: one user row with the tag", xs.filter((r) => r.kind === "user" && r.text.includes(tag)).length === 1, `${xs.length} rows for X`);
check("chat X answer logged once", xs.filter((r) => r.kind === "talk").length === 1, xs.map((r) => r.kind).join(","));
check("stored text carries no chat label", xs.every((r) => !r.text.startsWith("[chat")));
check("reply has no internal label", !/\[chat |\[You are in chat/.test(r1), JSON.stringify(r1.slice(0, 80)));

// 2. a follow-up reads the exact previous reply
const r2 = await ask(A, X, "Quote your previous reply to me exactly, inside double quotes, nothing else.");
check("previous exchange: follow-up quotes the last reply", r2.toLowerCase().includes(r1.trim().toLowerCase().replace(/[."]/g, "").slice(0, 20)), `last=${JSON.stringify(r1)} quote=${JSON.stringify(r2)}`);

// 3. a different chat recalls it from the shared memory
const Y = await newChat();
const r3 = await ask(A, Y, "What was the code word I asked you to remember in another chat? Answer with the code word only.");
check("cross-chat recall from the shared memory", r3.includes(tag), JSON.stringify(r3.slice(0, 120)));

// 4. no duplicates anywhere: every (chat, kind, text, date) once
const all = logOf(file);
const keys = all.map((r) => `${r.chat}|${r.kind}|${r.date}|${r.text}`);
check("no duplicate log rows", new Set(keys).size === keys.length, `${keys.length - new Set(keys).size} duplicates of ${keys.length}`);

// 5. a small budget really compresses the view
const set = await serverFn(A, "setDebug", "POST", { viewBytes: 2000 });
check("set view budget to 2K", set.status === 200 && !set.body.includes("error"), set.body.slice(0, 120));
for (const n of [1, 2, 3]) await ask(A, Y, `Note ${n}: ${"the harbour lights were dim and the tide was turning slowly over the old stone pier. ".repeat(4)} Reply with just: ok`);
let stats: { entries: number; lines: number; viewBytes: number; budget: number } | undefined;
for (let t = 0; t < 40; t++) {
  const s = await serverFn(A, "memoryStats", "GET", undefined);
  const v = JSON.parse(s.body).p.v[0].p;
  const val = Object.fromEntries(v.k.map((k: string, i: number) => [k, v.v[i].s]));
  stats = val;
  if (val.lines < val.entries && val.viewBytes <= val.budget) break;
  await new Promise((r) => setTimeout(r, 3000));
}
check("view compressed: fewer lines than log entries, within budget", !!stats && stats.lines < stats.entries && stats.viewBytes <= stats.budget, JSON.stringify(stats));
await serverFn(A, "setDebug", "POST", { viewBytes: budget });

// 6. after compression the fact is still reachable (summary or zoom)
const r4 = await ask(A, Y, "What was the code word again? Code word only.");
check("recall after compression", r4.includes(tag), JSON.stringify(r4.slice(0, 120)));
check("no reply leaked an internal label", ![r2, r3, r4].some((r) => /\[chat |\[You are in chat/.test(r)));

console.log(`(chats ${X.slice(0, 8)} and ${Y.slice(0, 8)} created for this run; local dir ${LOCAL})`);
finish(rows);
