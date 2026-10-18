// User B (and an anonymous caller) attack user A through every agent door and the server fns.
// Run: node scripts/isolation.ts (dev server up; SEED=n picks another random set). Exit 1 on any leak.
// Creates (and in the end deletes) a victim bot for A that takes every mutating attack, so A's own bots are only ever read;
// B gets a bot if it has none, and A one if it has none. Bots that existed before are never touched.
import assert from "node:assert/strict";
import WebSocket from "ws";
import { createBot, deleteBot, finish, kindOf, origin, query, serverFn, signIn, sqliteFiles, userFileOf, userState, wsOrigin, type Actor, type Row } from "./lib.ts";

// Refused = one of these statuses, or a socket that never opens. Anything else (2xx, open socket, hang) is a leak.
const REFUSED = new Set([400, 401, 403, 404]);
const rows: Row[] = [];
let needles: string[] = []; // what would identify A's data in a response (set once A's bots are known)
const record = (name: string, ok: boolean, detail: string) => rows.push({ status: ok ? "PASS" : "FAIL", name, detail });

function wsOutcome(path: string, cookie?: string): Promise<{ refused: boolean; actual: string }> {
  return new Promise((resolve) => {
    const sock = new WebSocket(wsOrigin + path, { headers: { ...(cookie && { cookie }), origin } });
    const done = (refused: boolean, actual: string) => (clearTimeout(timer), sock.terminate(), resolve({ refused, actual }));
    const timer = setTimeout(() => done(false, "timeout"), 6000);
    sock.on("open", () => done(false, "OPEN"));
    sock.on("unexpected-response", (_r, res) => done(REFUSED.has(res.statusCode!), String(res.statusCode)));
    sock.on("error", (e) => done(true, `error:${e.message}`));
  });
}

/** One attempt as `who` (null = anonymous) on `path` over HTTP or WS; fails if it is not refused or the body names A's data. */
async function probe(label: string, who: Actor | null, path: string, transport: "HTTP" | "WS") {
  const name = `${label}${who?.name ?? "anon"} ${transport.padEnd(4)} ${path}`;
  if (transport === "WS") {
    const w = await wsOutcome(path, who?.cookie);
    return record(name, w.refused, w.actual);
  }
  const res = await fetch(origin + path, { headers: who ? { cookie: who.cookie } : {}, redirect: "manual" });
  const body = await res.text();
  const leak = needles.find((n) => body.includes(n));
  record(name, REFUSED.has(res.status) && !leak, leak ? `${res.status}, body leaks ${leak}` : String(res.status));
}

const tag = Math.random().toString(16).slice(2, 8);
const A = await signIn("a");
const B = await signIn("b");
assert.notEqual(A.id, B.id);
const created: [Actor, string][] = [];
const make = async (who: Actor, name: string, instructions = "") => {
  const id = await createBot(who, `${name}-${tag}`, instructions);
  created.push([who, id]);
  return id;
};
const botFiles = () => sqliteFiles().filter((f) => kindOf(f) === "Bot");

try {
  const victim = await make(A, "iso-victim", `Private instructions of A ${tag}`);
  if (!(await userState(A)).bots.some((b) => b.id !== victim)) await make(A, "iso-a");
  if (!(await userState(B)).bots.length) await make(B, "iso-b");
  const aBots = (await userState(A)).bots;
  const bBots = (await userState(B)).bots;
  const victimBefore = JSON.stringify(aBots.find((b) => b.id === victim));
  console.log(`A=${A.id} bots=${aBots.length}; B=${B.id} bots=${bBots.length}; running...`);
  needles = [A.id, ...aBots.flatMap((b) => [b.id, b.name, ...(b.instructions.length >= 8 ? [b.instructions] : [])])];

  // Positive control: the test is meaningless if the legit door is shut too.
  const control = await wsOutcome(`/agents/user/${A.id}`, A.cookie);
  record("control: A opens A's own User socket", control.actual === "OPEN", control.actual);
  const botControl = await wsOutcome(`/agents/bot/${B.id}--${bBots[0].id}`, B.cookie);
  record("control: B opens B's own Bot socket", botControl.actual === "OPEN", botControl.actual);
  const detailsControl = await serverFn(A, "botDetails", "GET", victim);
  record("control: A reads A's own bot details", detailsControl.status === 200, String(detailsControl.status));

  const botsBefore = botFiles().length;
  const b0 = aBots[0].id;
  const attacks = [
    `/agents/user/${A.id}`,
    ...aBots.map((b) => `/agents/bot/${A.id}--${b.id}`),
    ...aBots.map((b) => `/agents/bot/${B.id}--${b.id}`),
    `/agents/bot/${B.id}--random`,
    // path tricks
    `/agents/user/${A.id}%2F`,
    `/agents/user%2F${A.id}`,
    `/agents%2Fuser/${A.id}`,
    `/agents/bot/${A.id}%2D%2D${b0}`,
    `/agents/bot%2F${A.id}--${b0}`,
    `/agents/bot/${A.id}--${b0}/extra`,
    `/agents/bot/${A.id}--${b0}/`,
    `/agents/bot/${A.id}--${b0}.`,
    `/agents/bot/${A.id}.--${b0}`,
    `/agents/user/${A.id}.`,
    `/agents/user/${A.id}/extra`,
    `/agents/User/${A.id}`,
    `/agents/Bot/${A.id}--${b0}`,
    `/agents/BOT/${A.id}--${b0}`,
    `/agents/bot/${A.id}--${b0}?session=${b0}`,
    `/agents/bot/${A.id}--${b0}?session=x`,
    `/agents/user/${A.id}?session=${b0}`,
    `/agents/bot/${A.id}----${b0}`,
    `/agents/bot/${B.id}--${A.id}--${b0}`,
    `/agents/bot/${B.id}----${b0}`,
    `/agents/bot/${B.id}--${b0}--${b0}`,
    `/agents/bot/${B.id}${A.id}--${b0}`,
    `/agents/bot/${B.id}--../${A.id}--${b0}`,
    `/agents/bot/${B.id}--%2e%2e%2F${A.id}--${b0}`,
    `/agents/bot/${B.id}%2F..%2F${A.id}--${b0}`,
    `/agents/bot/${B.id}--${b0}?name=${A.id}--${b0}`,
    `/agents/user/${B.id}/../${A.id}`,
    `/agents/user/%${A.id}`,
    // empty segments: the gate and routeAgentRequest split the path differently
    `/agents/user//${A.id}`,
    `/agents//user/${A.id}`,
    `/agents/bot//${A.id}--${b0}`,
    // a bot id that is not in the catalog (minting): own prefix, A's prefix, a victim-looking id
    `/agents/bot/${B.id}--${crypto.randomUUID()}`,
    `/agents/bot/${A.id}--${crypto.randomUUID()}`,
  ];
  for (const who of [B, null]) for (const p of attacks) for (const t of ["HTTP", "WS"] as const) await probe("", who, p, t);

  // FTS: a word from A's indexed messages must find A's bot for A and nothing of A's for B.
  const aIds = aBots.map((b) => b.id);
  const userFile = userFileOf(aIds[0]);
  const word = userFile && query<{ c0: string }>(userFile, `SELECT c0 FROM messages_content WHERE c1 IN (${aIds.map(() => "?").join(",")})`, ...aIds).map((r) => r.c0.match(/[A-Za-z]{5,}/)?.[0]).find(Boolean);
  if (word) {
    const own = await serverFn(A, "searchMessages", "GET", word);
    record(`control: A searchMessages(${word}) finds one of A's bots`, own.status === 200 && aIds.some((id) => own.body.includes(id)), String(own.status));
  }
  // Server fns as B and anonymous. Every fn that takes a botId is aimed at the victim (and one unknown id): 4xx and no A data.
  // B may search (its own index) but must see nothing of A's.
  const withBot = (id: string): [string, "GET" | "POST", unknown][] => [
    ["updateBot", "POST", { botId: id, name: "pwned", instructions: "pwned" }],
    ["deleteBot", "POST", id],
    ["setBotModel", "POST", { botId: id, model: "x", thinkingLevel: "low" }],
    ["botDetails", "GET", id],
    ["setMemoryBudget", "POST", { botId: id, bytes: 2000 }],
    ["resetMemory", "POST", id],
    ["setRoutineEnabled", "POST", { botId: id, id: "r", enabled: false }],
    ["deleteRoutine", "POST", { botId: id, id: "r" }],
    ["retireSubagent", "POST", { botId: id, name: "x" }],
  ];
  for (const who of [B, null]) {
    const calls: [string, "GET" | "POST", unknown][] = [
      ...withBot(victim),
      ...withBot(crypto.randomUUID()).slice(0, 4),
      ...(who ? [] : ([["createBot", "POST", { name: "pwned", instructions: "" }], ["modelOptions", "GET", undefined], ["connectChatGPT", "POST", undefined], ["disconnectChatGPT", "POST", undefined]] as [string, "GET" | "POST", unknown][])),
      ["searchMessages", "GET", word ?? "bot"],
    ];
    for (const [name, method, data] of calls) {
      const r = await serverFn(who, name, method, data);
      const leak = needles.find((n) => r.body.includes(n));
      const mustFail = !(who && name === "searchMessages");
      record(`${who?.name ?? "anon"} serverFn ${name}(${typeof data === "string" ? data.slice(0, 8) : "..."})`, !leak && (!mustFail || r.status >= 400), leak ? `${r.status}, leaks ${leak}` : String(r.status));
    }
  }
  const bState = JSON.stringify(await userState(B));
  const bLeak = needles.find((n) => bState.includes(n));
  record("B's own User agent state has none of A's ids/names/instructions", !bLeak, bLeak ?? "clean");

  // Randomized names/paths mixing A/B ids, bot ids and separators.
  let seed = Number(process.env.SEED ?? 1);
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const pool = [A.id, B.id, ...aBots.map((b) => b.id), ...bBots.map((b) => b.id), "random", "", "..", "."];
  const seps = ["--", "--", "-", "---", "%2F", "/", "%2D%2D", ".", ""];
  const legit = new Set([`/agents/user/${B.id}`, ...bBots.map((b) => `/agents/bot/${B.id}--${b.id}`)]);
  for (let n = 1; n <= 200; ) {
    const parts = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(pool));
    const name = parts.slice(1).reduce((acc, p) => acc + pick(seps) + p, parts[0]);
    const path = `/agents/${pick(["user", "bot", "User", "Bot", "bot", "user"])}/${name}${pick(["", "", "", "/", ".", `?session=${pick(pool)}`])}`;
    if (legit.has(path.split("?")[0])) continue;
    await probe(`rand#${n++} `, rnd() < 0.8 ? B : null, path, rnd() < 0.5 ? "WS" : "HTTP");
  }

  // Nothing above may have minted a Bot object (its SQLite file) or changed the victim.
  const minted = botFiles().length - botsBefore;
  record("attacks minted no Bot objects", minted === 0, `${minted} new Bot file(s)`);
  const victimAfter = JSON.stringify((await userState(A)).bots.find((b) => b.id === victim));
  record("victim bot unchanged after every mutating attack", victimAfter === victimBefore, victimAfter === victimBefore ? "same name/instructions" : `${victimBefore} -> ${victimAfter}`);

  if (!word) console.log("NOT COVERED: FTS message text. None of A's bots has an indexed message, so B's search proves nothing; message a bot of A's first (scripts/lineage.ts does).\n");
} finally {
  for (const [who, id] of created.reverse()) await deleteBot(who, id);
}
finish(rows);
