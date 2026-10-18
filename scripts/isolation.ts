// User B (and an anonymous caller) attack user A through every agent door and the server fns.
// Run: node scripts/isolation.ts (dev server up; SEED=n picks another random set). Exit 1 on any leak.
// Creates chats for the test users when they have fewer than A=2 / B=1.
import assert from "node:assert/strict";
import WebSocket from "ws";
import type { ChatSummary } from "../src/shared.ts";
import { finish, origin, serverFn, signIn, userState, wsOrigin, type Actor, type Row } from "./lib.ts";

// Refused = one of these statuses, or a socket that never opens. Anything else (2xx, open socket, hang) is a leak.
const REFUSED = new Set([400, 401, 403, 404]);
const rows: Row[] = [];
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

const ensureChats = async (who: Actor, n: number): Promise<ChatSummary[]> => {
  for (let i = (await userState(who)).chats.length; i < n; i++) {
    const r = await serverFn(who, "createChat", "POST", false);
    assert.equal(r.status, 200, `createChat as ${who.name}: ${r.body}`);
  }
  return (await userState(who)).chats;
};

const A = await signIn("a");
const B = await signIn("b");
assert.notEqual(A.id, B.id);
const aChats = await ensureChats(A, 2);
const bChats = await ensureChats(B, 1);
console.log(`A=${A.id} chats=${aChats.length}; B=${B.id} chats=${bChats.length}; running...`);
// What would identify A's data in a response. Default titles are shared by everyone, so they don't count.
const needles = [A.id, ...aChats.flatMap((c) => [c.id, ...(/^New (Opt)?[Cc]hat$/.test(c.title) ? [] : [c.title])])];

// Positive control: the test is meaningless if the legit door is shut too.
const control = await wsOutcome(`/agents/user/${A.id}`, A.cookie);
record("control: A opens A's own User socket", control.actual === "OPEN", control.actual);
const chatControl = await wsOutcome(`/agents/chat/${B.id}--${bChats[0].id}`, B.cookie);
record("control: B opens B's own Chat socket", chatControl.actual === "OPEN", chatControl.actual);

const c0 = aChats[0].id;
const attacks = [
  `/agents/user/${A.id}`,
  ...aChats.map((c) => `/agents/chat/${A.id}--${c.id}`),
  ...aChats.map((c) => `/agents/chat/${B.id}--${c.id}`),
  `/agents/chat/${B.id}--random`,
  // path tricks
  `/agents/user/${A.id}%2F`,
  `/agents/user%2F${A.id}`,
  `/agents%2Fuser/${A.id}`,
  `/agents/chat/${A.id}%2D%2D${c0}`,
  `/agents/chat%2F${A.id}--${c0}`,
  `/agents/chat/${A.id}--${c0}/extra`,
  `/agents/chat/${A.id}--${c0}/`,
  `/agents/chat/${A.id}--${c0}.`,
  `/agents/chat/${A.id}.--${c0}`,
  `/agents/user/${A.id}.`,
  `/agents/user/${A.id}/extra`,
  `/agents/User/${A.id}`,
  `/agents/Chat/${A.id}--${c0}`,
  `/agents/CHAT/${A.id}--${c0}`,
  `/agents/chat/${A.id}--${c0}?session=${c0}`,
  `/agents/chat/${A.id}--${c0}?session=x`,
  `/agents/user/${A.id}?session=${c0}`,
  `/agents/chat/${A.id}----${c0}`,
  `/agents/chat/${B.id}--${A.id}--${c0}`,
  `/agents/chat/${B.id}----${c0}`,
  `/agents/chat/${B.id}--${c0}--${c0}`,
  `/agents/chat/${B.id}${A.id}--${c0}`,
  `/agents/chat/${B.id}--../${A.id}--${c0}`,
  `/agents/chat/${B.id}--%2e%2e%2F${A.id}--${c0}`,
  `/agents/chat/${B.id}%2F..%2F${A.id}--${c0}`,
  `/agents/chat/${B.id}--${c0}?name=${A.id}--${c0}`,
  `/agents/user/${B.id}/../${A.id}`,
  `/agents/user/%${A.id}`,
  // empty segments: the gate and routeAgentRequest split the path differently
  `/agents/user//${A.id}`,
  `/agents//user/${A.id}`,
  `/agents/chat//${A.id}--${c0}`,
];
for (const who of [B, null]) for (const p of attacks) for (const t of ["HTTP", "WS"] as const) await probe("", who, p, t);

// FTS: a word from a titled chat of A's (titles are A's first message) must find A's chat for A and nothing of A's for B.
const word = aChats.map((c) => c.title).find((t) => !/^New (Opt)?[Cc]hat$/.test(t))?.match(/[A-Za-z]{4,}/)?.[0];
if (word) {
  const own = await serverFn(A, "searchMessages", "GET", word);
  record(`control: A searchMessages(${word}) finds A's chat`, own.status === 200 && aChats.some((c) => own.body.includes(c.id)), String(own.status));
}
// Server fns as B and anonymous against A's chats and the search index. B may search (own index) but must see nothing of A's.
for (const who of [B, null]) {
  const calls: [string, "GET" | "POST", unknown][] = [
    ...aChats.flatMap((c): [string, "GET" | "POST", unknown][] => [
      ["chatModels", "GET", c.id],
      ["setChatModel", "POST", { chatId: c.id, model: "x", thinkingLevel: "low" }],
    ]),
    ...(who ? [] : [["createChat", "POST", false] as [string, "POST", boolean]]),
    ["searchMessages", "GET", word ?? "chat"],
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
record("B's own User agent state has none of A's ids/titles", !bLeak, bLeak ?? "clean");

// Randomized names/paths mixing A/B ids, chat ids and separators.
let seed = Number(process.env.SEED ?? 1);
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const pool = [A.id, B.id, ...aChats.map((c) => c.id), ...bChats.map((c) => c.id), "random", "", "..", "."];
const seps = ["--", "--", "-", "---", "%2F", "/", "%2D%2D", ".", ""];
const legit = new Set([`/agents/user/${B.id}`, ...bChats.map((c) => `/agents/chat/${B.id}--${c.id}`)]);
for (let n = 1; n <= 200; ) {
  const parts = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(pool));
  const name = parts.slice(1).reduce((acc, p) => acc + pick(seps) + p, parts[0]);
  const path = `/agents/${pick(["user", "chat", "User", "Chat", "chat", "user"])}/${name}${pick(["", "", "", "/", ".", `?session=${pick(pool)}`])}`;
  if (legit.has(path)) continue;
  await probe(`rand#${n++} `, rnd() < 0.8 ? B : null, path, rnd() < 0.5 ? "WS" : "HTTP");
}

if (!word) console.log("NOT COVERED: FTS message text. A has no titled (= messaged) chat, so B's search proves nothing; run scripts/lineage.ts first.\n");
finish(rows);
