// Live end-to-end check of per-bot OptChat on the running dev server, as a@test.dev (needs ChatGPT connected; spends ~12
// turns of the plan). Every assertion reads what really happened: the replies, and the Bot DOs' SQLite logs.
// Makes two bots (X and Y) and deletes them at the end; never touches A's other bots.
// Run: pnpm check:optchat-e2e
import { ask, botFileOf, createBot, deleteBot, finish, memoryStats, query, serverFn, signIn, userState, type Row } from "./lib.ts";

const rows: Row[] = [];
const check = (name: string, ok: boolean, detail = "") => rows.push({ status: ok ? "PASS" : "FAIL", name, detail });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const A = await signIn("a");
if (!(await userState(A)).chatgpt) {
  console.log("PRECONDITION: a@test.dev needs ChatGPT connected (sign in as a@test.dev in the UI, Continue with ChatGPT).");
  process.exit(2);
}
const tag = `E2E-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
const nameX = `e2e-x-${tag.slice(4)}`;
const nameY = `e2e-y-${tag.slice(4)}`;
type LogRow = { kind: string; text: string; date: string };
const logOf = (name: string): LogRow[] => {
  const file = botFileOf(name);
  if (!file || !query(file, "SELECT 1 FROM sqlite_master WHERE name = 'optchat_log'").length) return [];
  return query<{ entry: string }>(file, "SELECT entry FROM optchat_log ORDER BY i").map((r) => JSON.parse(r.entry));
};
/** Polls `cond` every 3s (logging and summarizing finish after run_end), up to `ms`. */
const until = async (cond: () => boolean | Promise<boolean>, ms = 90_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(3000)) if (await cond()) return true;
  return false;
};

const X = await createBot(A, nameX, "Be brief.");
const Y = await createBot(A, nameY, "Be brief.");
try {
  // 1. a fact told to X is logged once, raw, in X's own memory
  const prompt1 = `Remember this code word for later: ${tag}. Reply with just: noted`;
  const r1 = await ask(A, X, prompt1);
  await until(() => logOf(nameX).some((r) => r.kind === "talk"), 30_000);
  const xs = logOf(nameX);
  check("X turn logged: one user row, exactly what was sent", xs.filter((r) => r.kind === "user" && r.text === prompt1).length === 1, `${xs.length} rows`);
  check("X answer logged once", xs.filter((r) => r.kind === "talk").length === 1, xs.map((r) => r.kind).join(","));
  check("reply has no internal markup", !/<chat>|\[bot /.test(r1), JSON.stringify(r1.slice(0, 80)));

  // 2. a follow-up reads the exact previous reply
  const r2 = await ask(A, X, "Quote your previous reply to me exactly, inside double quotes, nothing else.");
  check("previous exchange: follow-up quotes the last reply", r2.toLowerCase().includes(r1.trim().toLowerCase().replace(/[."]/g, "").slice(0, 20)), `last=${JSON.stringify(r1)} quote=${JSON.stringify(r2)}`);

  // 3. memory is per bot: Y never heard the code word, so neither its answer nor its memory has it
  const r3 = await ask(A, Y, "Do you know the code word I asked another bot to remember? Answer from your own memory only, do not use any tool. If you don't know, answer UNKNOWN.");
  check("Y does not recall X's code word", !r3.includes(tag), JSON.stringify(r3.slice(0, 120)));
  check("Y's memory log has no trace of the code word", !logOf(nameY).some((r) => r.text.includes(tag)), `${logOf(nameY).length} rows`);

  // 4. ...unless X tells Y through the bots tool: Y logs it as "work" and then knows it
  await ask(A, X, `Use the bots tool to send the bot named "${nameY}" this message: the code word is ${tag}. Then reply with just: sent`);
  const told = await until(() => logOf(nameY).some((r) => r.kind === "work" && r.text.includes(tag) && r.text.startsWith(`[message from bot "${nameX}"]`)));
  check("Y logged X's message as work", told, logOf(nameY).map((r) => r.kind).join(","));
  // Y answers the incoming message by itself; wait for that run to end before asking Y anything.
  await until(() => {
    const log = logOf(nameY);
    const work = log.findIndex((r) => r.kind === "work");
    return work >= 0 && log.slice(work + 1).some((r) => r.kind === "talk");
  });
  await sleep(5000);
  const r4 = await ask(A, Y, `What code word did the bot "${nameX}" send you? Code word only.`);
  check("Y recalls what X told it", r4.includes(tag), JSON.stringify(r4.slice(0, 120)));

  // 5. no duplicates in either log: every (kind, text, date) once
  for (const name of [nameX, nameY]) {
    const keys = logOf(name).map((r) => `${r.kind}|${r.date}|${r.text}`);
    check(`no duplicate log rows [${name.slice(0, 5)}]`, new Set(keys).size === keys.length, `${keys.length - new Set(keys).size} duplicates of ${keys.length}`);
  }

  // 6. a 2K budget really compresses Y's view
  const budget = (await memoryStats(A, Y)).budget;
  const set = await serverFn(A, "setMemoryBudget", "POST", { botId: Y, bytes: 2000 });
  check("set Y's view budget to 2K", set.status === 200 && !set.body.includes("error"), set.body.slice(0, 120));
  for (const n of [1, 2, 3]) await ask(A, Y, `Note ${n}: ${"the harbour lights were dim and the tide was turning slowly over the old stone pier. ".repeat(4)} Reply with just: ok`);
  let stats = await memoryStats(A, Y);
  for (let t = 0; t < 40 && !(stats.lines < stats.entries && stats.viewBytes <= stats.budget); t++) {
    await sleep(3000);
    stats = await memoryStats(A, Y);
  }
  check("view compressed: 2K budget, fewer lines than log entries, within budget", stats.budget === 2000 && stats.lines < stats.entries && stats.viewBytes <= stats.budget, JSON.stringify(stats));
  await serverFn(A, "setMemoryBudget", "POST", { botId: Y, bytes: budget });

  // 7. after compression the fact is still reachable (summary or zoom)
  const r5 = await ask(A, Y, `What code word did the bot "${nameX}" send you earlier? Code word only.`);
  check("recall after compression", r5.includes(tag), JSON.stringify(r5.slice(0, 120)));
  check("no reply leaked internal markup", ![r2, r3, r4, r5].some((r) => /<chat>|\[bot /.test(r)));
} finally {
  await deleteBot(A, X);
  await deleteBot(A, Y);
}
finish(rows);
