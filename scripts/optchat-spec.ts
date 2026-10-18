// Executable spec for OUR OptChat code (research/optchat-fix-plan.md Part 3, S1-S14), run against the real modules with
// fakes for the store, the compressor and pi's hook API. No app hooks: everything here is public module API.
// Run: pnpm check:optchat-spec
import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { createCompressor } from "../src/optchat/compactor.ts";
import { planLog, type LogItem } from "../src/optchat/cursor.ts";
import { logRows, optchatExtension, previousExchange, runStart, settledEnd, type MemoryApi } from "../src/optchat/extension.ts";
import { CAP, Memory, NODE, type Compression, type Entry, type Saved, type Store, type Summary } from "../src/optchat/memory.ts";
import { searchPage } from "../src/optchat/tools.ts";

// ---------- fakes ----------
const store = (): Store & { saved: Saved } => {
  const saved: Saved = { entries: [], tree: [] };
  return {
    saved,
    append: (e: Entry) => void saved.entries.push(e),
    appendNode: (n: Summary) => void saved.tree.push(n),
    saveView: (v: string) => void (saved.view = v),
  };
};
const label = (e: Entry) => (e.chat ? `[chat "T"] ` : "");
function memory(compress: (c: Compression) => Promise<string> = async (c) => `S${c.part.l}.${c.part.i}`, budget = 128_000) {
  const inputs: Compression[] = [];
  const s = store();
  const m = new Memory({ store: s, saved: { entries: [], tree: [] } }, async (c) => (inputs.push(c), compress(c)), () => {}, budget, 8, 10, { label });
  return { m, inputs };
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const date = "2026-10-18T12:00:00.000Z";
const user = (content: string, timestamp = 1): UserMessage => ({ role: "user", content, timestamp });
const answer = (text: string, stopReason: AssistantMessage["stopReason"] = "stop", extra: AssistantMessage["content"] = [], timestamp = 2): AssistantMessage =>
  ({ role: "assistant", content: [{ type: "text", text }, ...extra], stopReason, timestamp, api: "openai-responses", provider: "openai", model: "m", usage: {} as AssistantMessage["usage"] }) as AssistantMessage;
const call = (id: string, name = "bash"): AssistantMessage["content"][number] => ({ type: "toolCall", id, name, arguments: { cmd: "ls" } }) as AssistantMessage["content"][number];
const result = (id: string, text: string, toolName = "bash"): ToolResultMessage => ({ role: "toolResult", toolCallId: id, toolName, content: [{ type: "text", text }], isError: false, timestamp: 3 }) as ToolResultMessage;
const sys = (): Message => ({ role: "system", content: "", timestamp: 0 }) as unknown as Message;

/** The extension's beforeRequest, with a fake MemoryApi recording calls and an in-memory memo. */
function harness(view = "<chat>\n0+1|user: old\n</chat>") {
  const calls: string[] = [];
  const api: MemoryApi = {
    flush: async (scope) => void calls.push(`flush:${scope}`),
    view: async () => (calls.push("view"), { view, chat: "This chat" }),
    zoom: async () => "", date: async () => "", search: async () => "",
  };
  const ext = optchatExtension(api);
  const before = ext.hooks![0].handlers.beforeRequest as (r: { messages: Message[] }, a: unknown, c: unknown) => Promise<{ messages: Message[] } | undefined>;
  const memo = new Map<string, unknown>();
  const hookApi = {
    conversationId: ROOT_CONVERSATION_ID,
    memo: async (name: string, ...rest: unknown[]) => (rest.length === 2 && !memo.has(name) && memo.set(name, rest[0]), memo.get(name)),
  };
  return { calls, run: (messages: Message[]) => before({ messages }, hookApi, {}) };
}
const textOf = (m: Message) => (typeof m.content === "string" ? m.content : m.content.map((c) => ("text" in c ? c.text : `[${c.type}]`)).join(""));

// ---------- S1-S3: labels at render time (G1) ----------
test("S1 a tool result's summary still sees its call when entries carry a chat label", async () => {
  const { m, inputs } = memory();
  const big = "x".repeat(2000);
  m.append("user", "go", date, undefined, undefined, "c1");
  m.append("tool", 'bash {"cmd":"ls"}', date, undefined, undefined, "c1");
  m.append("tool", 'read {"p":"a"}', date, undefined, undefined, "c1");
  m.append("echo", `bash: ${big}`, date, undefined, undefined, "c1");
  m.append("echo", `read: ${big}`, date, undefined, undefined, "c1");
  await m.settle(undefined, "tree");
  const leaf = (i: number) => inputs.find((c) => c.part.l === 0 && c.part.i === i)!;
  assert.equal(leaf(3).call?.i, 1);
  assert.equal(leaf(4).call?.i, 2);
  assert.ok(leaf(3).source.startsWith('echo: [chat "T"] bash: '));
  assert.ok(!m.root[3].text.startsWith("[chat"), "stored text stays raw");
});

test("S2 search skips the memory's own zoom/search rows and never matches a label", async () => {
  const { m } = memory();
  m.append("tool", 'zoom {"id":0}', date, undefined, undefined, "c1");
  m.append("echo", "zoom: 0+1|user: banana", date, undefined, undefined, "c1");
  m.append("user", "banana bread", date, undefined, undefined, "c1");
  assert.match(searchPage(m, "banana"), /^1 message contains "banana"/);
  assert.match(searchPage(m, "chat"), /^No messages contain/);
});

test("S3 zoom shows the label; paging counts raw text only", () => {
  const { m } = memory();
  m.append("user", "hello", date, undefined, undefined, "c1");
  assert.equal(m.zoom(0, 1), '0+1|user: [chat "T"] hello');
  assert.match(m.zoom(0, 1, 1, 2), /^0\+1\|user: \[chat "T"\] el\n\[showing characters 1-3 of 5/);
});

// ---------- S4: bounded settle (G5) ----------
test("S4 a turn waits only for rows logged before it, not for rows logged after", async () => {
  let release!: () => void;
  const stuck = new Promise<string>((r) => (release = () => r("big")));
  const { m } = memory(async (c) => (c.source.length > NODE ? stuck : `S${c.part.i}`));
  m.append("user", "a", date); m.append("user", "b", date); m.append("user", "c", date);
  await m.settle(undefined, "turn", 3);
  m.append("user", "y".repeat(3000), date);
  await m.settle(undefined, "turn", 3); // resolves although row 3 is unbuilt
  const unbounded = await Promise.race([m.settle().then(() => "done"), tick(50).then(() => "waiting")]);
  assert.equal(unbounded, "waiting");
  await assert.rejects(m.settle(undefined, "turn", 99), /past the log/);
  release();
  await m.close();
});

// ---------- S5, S9, S11: the request hook ----------
test("S5 the view is pinned per run: flush settled, view, flush all, once", async () => {
  const h = harness();
  const msgs = [user("hi")];
  await h.run(msgs);
  await h.run([...msgs, answer("", "toolUse", [call("1")]), result("1", "ok")]);
  assert.deepEqual(h.calls, ["flush:settled", "view", "flush:all"]);
});

test("S9 a request with no current user message is refused", async () => {
  await assert.rejects(harness().run([sys(), user("old"), answer("done")]), /no current user message/);
});

test("S11 a huge tool result in the current run is capped, images kept", async () => {
  const big: ToolResultMessage = { ...result("1", "z".repeat(100_000)), content: [{ type: "text", text: "z".repeat(100_000) }, { type: "image", data: "AAAA", mimeType: "image/png" }] } as ToolResultMessage;
  const out = (await harness().run([user("go"), answer("", "toolUse", [call("1")]), big]))!.messages;
  const tr = out.find((m) => m.role === "toolResult") as ToolResultMessage;
  assert.ok((tr.content[0] as { text: string }).text.length <= CAP);
  assert.equal(tr.content[1].type, "image");
});

// ---------- S6-S8: previous exchange (G12) ----------
test("S6 the last exchange is replayed word for word after the view, inputs untouched", async () => {
  const msgs: Message[] = [sys(), user("first"), answer("old"), user("q1"), user("steer"), answer("exact reply", "stop", [{ type: "thinking", thinking: "secret" } as AssistantMessage["content"][number]]), user("now")];
  const frozen = JSON.stringify(msgs);
  const out = (await harness().run(msgs))!.messages;
  assert.deepEqual(out.map((m) => m.role), ["system", "user", "user", "assistant", "user"]);
  assert.match(textOf(out[1]), /^\[You are in chat "This chat"\.\]\n<chat>[\s\S]*<\/chat>\n\nq1$/);
  assert.equal(textOf(out[2]), "steer");
  assert.equal(textOf(out[3]), "exact reply");
  assert.equal(JSON.stringify(msgs), frozen);
});

test("S7 runs that didn't end in a plain answer, or only came from agents, are skipped", () => {
  const msgs: Message[] = [user("real q"), answer("real a"), user("cut"), answer("partial", "length"), user("[subagent s answered, no reply needed] hi"), answer("noted"), user("now")];
  const ex = previousExchange(msgs, runStart(msgs));
  assert.deepEqual(ex.map(textOf), ["real q", "real a"]);
});

test("S8 16000 bytes are replayed, 16001 are left out (not swapped for an older one)", () => {
  const at = (n: number) => [user("old q"), answer("old a"), user("q"), answer("a".repeat(n - 1)), user("now")] as Message[];
  assert.equal(previousExchange(at(16_000), 4).length, 2);
  assert.equal(previousExchange(at(16_001), 4).length, 0);
});

// ---------- S10: log rows (G8, G14) ----------
test("S10 log rows: kinds, agent messages are work, ids stripped, caps, images", () => {
  const rows = (m: Message) => logRows({ model: [m] });
  assert.deepEqual(rows(user("hi")).map((r) => r.kind), ["user"]);
  assert.equal(rows(user("[subagent s answered, no reply needed] x"))[0].kind, "work");
  const cross = rows(user('[message from session "T" (0ede04cb-d291-495f-bb43-fbb0e015c4b1)] hi'))[0];
  assert.equal(cross.kind, "work");
  assert.equal(cross.text, '[message from session "T"] hi');
  assert.deepEqual(rows(answer("t", "toolUse", [call("1")])).map((r) => r.kind), ["talk", "tool"]);
  assert.deepEqual(rows(answer("t", "error")).map((r) => r.kind), ["talk", "echo"]);
  assert.equal(rows(result("1", "out"))[0].text, "bash: out");
  assert.ok(rows(user("q".repeat(300_000)))[0].text.length <= 200_000);
  assert.equal(rows({ role: "user", content: [{ type: "image", data: "A", mimeType: "image/png" }], timestamp: 1 } as UserMessage)[0].text, "[image]");
});

// ---------- S12: cursor (G3) ----------
test("S12 planLog: each entry once, an early answer once, decreasing ids refused", () => {
  const row = (t: string) => ({ kind: "user" as const, text: t, date });
  const items: LogItem[] = [{ entryId: 5, role: "user", ts: 1, rows: [row("q")] }, { entryId: 7, role: "assistant", ts: 9, rows: [row("a")] }];
  const first = planLog({ entry: -1, answerTs: null }, items);
  assert.deepEqual(first.rows.map((r) => r.text), ["q", "a"]);
  assert.deepEqual(planLog(first.cursor, items).rows, []);
  const early = planLog({ entry: -1, answerTs: null }, [items[0]], { ts: 9, rows: [row("a")] });
  assert.deepEqual(early.rows.map((r) => r.text), ["q", "a"]);
  assert.deepEqual(planLog(early.cursor, items).rows, []);
  assert.throws(() => planLog({ entry: -1, answerTs: null }, [items[1], items[0]]), /out of order/);
});

// ---------- S13: one boundary ----------
test("S13 settledEnd on entries and runStart on context agree", () => {
  const msgs: Message[] = [user("a"), answer("x", "error"), answer("", "toolUse", [call("1")]), result("1", "r"), answer("done", "stop"), user("b"), answer("cut", "aborted")];
  const ctx = msgs.filter((m) => !(m.role === "assistant" && ["error", "aborted"].includes(m.stopReason)));
  assert.equal(settledEnd(msgs.map((m) => ({ model: [m] }))), 5);
  assert.equal(runStart(ctx), 4);
  assert.equal(textOf(msgs[settledEnd(msgs.map((m) => ({ model: [m] }))) - 1]), textOf(ctx[runStart(ctx) - 1]));
});

// ---------- S14: compactor ----------
test("S14 compactor: accept <= 640 bytes, retry too long / length / tool calls, strip id head, give up after 5", async () => {
  const replies: AssistantMessage[] = [];
  const models = { getModel: () => ({ id: "m", reasoning: true }), completeSimple: async () => replies.shift()! };
  const compress = createCompressor(() => models as never, async () => ({ provider: "openai", model: "m", thinking: "low" }), []);
  const input = (source: string): Compression => ({ context: "<chat>\n</chat>", source, part: { l: 0, i: 0 } });
  const signal = new AbortController().signal;
  replies.push(answer("a".repeat(640)));
  assert.equal((await compress(input("s".repeat(5000)), signal)).length, 640);
  replies.push(answer("b".repeat(641)), answer("12+4|short"));
  assert.equal(await compress(input("s".repeat(5000)), signal), "short");
  replies.push(answer("x", "length"), answer("", "toolUse", [call("1")]), answer("ok"));
  assert.equal(await compress(input("s".repeat(5000)), signal), "ok");
  replies.push(...Array.from({ length: 5 }, () => answer("", "length")));
  await assert.rejects(compress(input("s".repeat(5000)), signal), /no whole line in 5 tries/);
  replies.push(answer("long merge ".repeat(3)), answer("m"));
  assert.equal(await compress(input("tiny"), signal), "m"); // a line must be shorter than its source
});
