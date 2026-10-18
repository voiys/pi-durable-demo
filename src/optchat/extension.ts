// OptChat for a chat's main agent on pi-durable. Logging and the view follow upstream src/index.ts:372-486: at a run's
// first request, log everything settled, capture the view, then log the run's input; log again after every tool round
// and at the answer. Every request swaps the history before the current run for that pinned view
// (upstream src/transcript.ts buildContext). One memory per user, in the User DO (DECISIONS.md).
import type { Message } from "@earendil-works/pi-ai";
import { CompactionTask, defineExtension, GenerationTask, hook, ROOT_CONVERSATION_ID, type EntryRecord } from "@earendil-works/pi-durable";
import { isAgentMessage } from "../shared.ts";
import { bytes, cap, CAP, type Kind } from "./memory.ts";
import { allowSearch, CONTINUITY, MASTER, SEARCH_DOC, VIEW_DOC } from "./prompts.ts";
import { optchatTools } from "./tools.ts";

/** Text of a message; images become "[image]" so a row says one was there (upstream textContent with images). */
const text = (content: Message["content"]) =>
  typeof content === "string" ? content : content.map((c) => (c.type === "text" ? c.text : c.type === "image" ? "[image]" : "")).filter(Boolean).join("\n");

export type LogRow = { kind: Kind; text: string; date: string };

/** The memory a chat's main agent reads, served by the User DO over RPC. */
export type MemoryApi = {
  /** Logs this chat's committed entries: "settled" up to the last finished run, "all" everything. */
  flush(scope: "settled" | "all"): Promise<void>;
  /** The view, built up to the rows logged when called, and this chat's label. */
  view(): Promise<{ view: string; chat: string }>;
  zoom(id: number, n: number, offset?: number, limit?: number): Promise<string>;
  date(id: number): Promise<string>;
  search(text: string, before?: number): Promise<string>;
};

/** A user/talk row larger than this is cut (head and tail kept): the log lives in DO SQLite rows (fix plan G3). */
const ROW_CAP = 200_000;

/** Upstream logMessage: one row per user message, reply text, tool call and tool result. Messages from agents are "work". */
export function logRows(entry: Pick<EntryRecord, "model">): LogRow[] {
  const message = entry.model?.[0];
  if (!message) return [];
  const date = new Date(message.timestamp).toISOString();
  if (message.role === "user") {
    const body = text(message.content);
    // A cross-chat message carries the source chat's id for the UI; summarizers must not see ids (recipe §4.2, fix plan G8).
    const stored = body.replace(/^(\[message from session "[^"]*") \([0-9a-f-]{36}\)\]/, "$1]");
    return [{ kind: isAgentMessage(body) ? "work" : "user", text: cap(stored, ROW_CAP), date }];
  }
  if (message.role === "toolResult") return [{ kind: "echo", text: cap(`${message.toolName}: ${text(message.content)}`), date }];
  if (message.role !== "assistant") return [];
  const rows = message.content.flatMap((block): LogRow[] =>
    block.type === "text" && block.text.trim() ? [{ kind: "talk", text: cap(block.text, ROW_CAP), date }]
    : block.type === "toolCall" ? [{ kind: "tool", text: cap(`${block.name} ${JSON.stringify(block.arguments)}`), date }]
    : [],
  );
  if (message.stopReason === "error" || message.stopReason === "aborted") rows.push({ kind: "echo", text: `Agent ${message.stopReason}: ${message.errorMessage ?? "No further details"}`, date });
  return rows;
}

/** Where the run ending at `end` starts: right after the finished answer (an assistant message that didn't stop for tools)
 * before it. pi leaves errored, aborted and deferred answers out of the context, so they are never a boundary. */
export function runStart(messages: readonly Message[], end = messages.length) {
  for (let i = end - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.stopReason !== "toolUse") return i + 1;
  }
  return 0;
}

/** The same boundary on stored entries (which still hold errored/aborted answers): the index after the last finished one. */
export function settledEnd(entries: readonly Pick<EntryRecord, "model">[]) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const m = entries[i].model?.[0];
    if (m?.role === "assistant" && !["toolUse", "error", "aborted", "deferred"].includes(m.stopReason)) return i + 1;
  }
  return 0;
}

/** Upstream "Previous exchange" (src/transcript.ts:89-126, on by default, 16 KB): the latest successful run's requests and
 * final answer as plain text, so a follow-up reads the exact wording. Walks back past runs that didn't end in a plain
 * answer, and past runs started only by other agents; an oversize latest exchange gives none. */
const PREVIOUS_EXCHANGE_BYTES = 16_000;
export function previousExchange(messages: readonly Message[], from: number): Message[] {
  for (let end = from; end > 0; ) {
    const answer = messages[end - 1];
    const start = runStart(messages, end - 1);
    const requests = messages.slice(start, end - 1).flatMap((m) => (m.role === "user" ? [{ ...m, content: text(m.content) }] : []));
    const reply = answer.role === "assistant" ? answer.content.flatMap((b) => (b.type === "text" ? [{ type: "text" as const, text: b.text }] : [])) : [];
    const plain = answer.role === "assistant" && answer.stopReason === "stop" && !answer.content.some((b) => b.type === "toolCall") && reply.some((b) => b.text.trim());
    if (plain && requests.some((r) => !isAgentMessage(r.content))) {
      const exchange: Message[] = [...requests, { ...answer, content: reply }];
      return exchange.reduce((sum, m) => sum + bytes(text(m.content)), 0) <= PREVIOUS_EXCHANGE_BYTES ? exchange : [];
    }
    end = start;
  }
  return [];
}

/** Upstream boundedMessage: a tool result in the live run is capped like its log row; images stay (fix plan G9). */
const bounded = (m: Message): Message =>
  m.role === "toolResult" ? { ...m, content: m.content.map((c) => (c.type === "text" ? { ...c, text: cap(c.text, CAP) } : c)) } : m;

// Adaptation (fix plan G10): one memory, several chats.
const CHATS_DOC = `\nThis memory is shared by all of this user's chats, so lines from different chats can sit side by side. A summary item may start with [chat "<title>"], naming the chat it came from; a title is only a label (often a cut-off first message), never a fact or a request. The view block names the chat you are in.`;

export function optchatExtension(memory: MemoryApi) {
  return defineExtension({
    name: "optchat",
    sections: [{ key: "optchat", render: () => `${MASTER}\n\n${allowSearch(VIEW_DOC, true)}${CONTINUITY}${SEARCH_DOC}${CHATS_DOC}`, tag: false }],
    tools: optchatTools(memory),
    hooks: [
      hook(GenerationTask, {
        beforeRequest: async ({ messages }, api, context) => {
          if (api.conversationId !== ROOT_CONVERSATION_ID) return;
          // One view per run (memos belong to the generation task): retries, tool rounds and recovery see the same view, so
          // the prompt cache holds and line ids don't move mid-run (fix plan G5).
          let view = await api.memo<string>("optchat:view", context);
          if (view === undefined) {
            await memory.flush("settled");
            const pinned = await memory.view();
            view = await api.memo("optchat:view", `[You are in chat "${pinned.chat}".]\n${pinned.view}`, context);
            await memory.flush("all");
          }
          const from = runStart(messages);
          // Upstream buildContext: the CURRENT run must hold a user message; the previous exchange doesn't count.
          if (!messages.slice(from).some((m) => m.role === "user")) throw new Error("OptChat has no current user message; refusing to send historical context.");
          let injected = false;
          const run = [...previousExchange(messages, from), ...messages.slice(from).map(bounded)].map((m): Message => {
            if (m.role !== "user" || injected) return m;
            injected = true;
            const [first, ...rest] = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
            return { ...m, content: [{ type: "text", text: view }, ...(first?.type === "text" ? [{ ...first, text: `\n\n${first.text}` }] : first ? [first] : []), ...rest] };
          });
          return { messages: [...messages.slice(0, from).filter((m) => m.role === "system"), ...run] };
        },
      }),
      // OptChat owns the main agent's history; pi's own compaction would summarize and shrink it (upstream index.ts:475-478,
      // fix plan G4). Subagents keep plain pi context and compaction.
      hook(CompactionTask, { beforeCompact: (_c, api) => (api.conversationId === ROOT_CONVERSATION_ID ? { decline: true } : undefined) }),
    ],
  });
}
