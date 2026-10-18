// OptChat for a chat's main agent on pi-durable: log each finished turn into the user's one memory (User DO), and before
// each request swap the history before the current run for that memory's view (upstream src/transcript.ts buildContext,
// src/index.ts:446-464).
import type { Message } from "@earendil-works/pi-ai";
import { defineExtension, GenerationTask, hook, ROOT_CONVERSATION_ID, type EntryRecord } from "@earendil-works/pi-durable";
import { cap, type Kind } from "./memory.ts";
import { allowSearch, MASTER, SEARCH_DOC, VIEW_DOC } from "./prompts.ts";
import { optchatTools } from "./tools.ts";

const text = (content: Message["content"]) =>
  typeof content === "string" ? content : content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");

export type LogRow = { kind: Kind; text: string; date: string };

/** The memory a chat's main agent reads, served by the User DO over RPC. */
export type MemoryApi = {
  view(): Promise<string>;
  zoom(id: number, n: number, offset?: number, limit?: number): Promise<string>;
  date(id: number): Promise<string>;
  search(text: string, before?: number): Promise<string>;
};

/** Upstream logMessage: one log row per user message, reply text, tool call and tool result. Reports from subagents are "work". */
export function logRows(entry: EntryRecord): LogRow[] {
  const message = entry.model?.[0];
  if (!message) return [];
  const date = new Date(message.timestamp).toISOString();
  if (message.role === "user") {
    const body = text(message.content);
    return [{ kind: body.startsWith("[subagent ") ? "work" : "user", text: body, date }];
  }
  if (message.role === "toolResult") return [{ kind: "echo", text: cap(`${message.toolName}: ${text(message.content)}`), date }];
  if (message.role !== "assistant") return [];
  const rows = message.content.flatMap((block): LogRow[] =>
    block.type === "text" && block.text.trim() ? [{ kind: "talk", text: block.text, date }]
    : block.type === "toolCall" ? [{ kind: "tool", text: `${block.name} ${JSON.stringify(block.arguments)}`, date }]
    : [],
  );
  if (message.stopReason === "error" || message.stopReason === "aborted") rows.push({ kind: "echo", text: `Agent ${message.stopReason}: ${message.errorMessage ?? "No further details"}`, date });
  return rows;
}

/** The current run: everything after the last finished answer (an assistant message that didn't stop for tools). */
function runStart(messages: readonly Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.stopReason !== "toolUse") return i + 1;
  }
  return 0;
}

export function optchatExtension(memory: MemoryApi) {
  return defineExtension({
    name: "optchat",
    sections: [{ key: "optchat", render: () => `${MASTER}\n\n${allowSearch(VIEW_DOC, true)}${SEARCH_DOC}`, tag: false }],
    tools: optchatTools(memory),
    hooks: [
      hook(GenerationTask, {
        beforeRequest: async ({ messages }, api) => {
          if (api.conversationId !== ROOT_CONVERSATION_ID) return;
          const view = await memory.view(); // settled first: a turn never sees a placeholder line (recipe §6)
          const from = runStart(messages);
          let injected = false;
          const run = messages.slice(from).map((m): Message => {
            if (m.role !== "user" || injected) return m;
            injected = true;
            const [first, ...rest] = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
            return { ...m, content: [{ type: "text", text: view }, ...(first?.type === "text" ? [{ ...first, text: `\n\n${first.text}` }] : first ? [first] : []), ...rest] };
          });
          if (!injected) throw new Error("OptChat has no current user message; refusing to send historical context.");
          return { messages: [...messages.slice(0, from).filter((m) => m.role === "system"), ...run] };
        },
      }),
    ],
  });
}
