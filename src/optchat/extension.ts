// OptChat for a session's main agent on pi-durable: log at the end of each turn, and before each request swap the
// history before the current run for the view (upstream src/transcript.ts buildContext, src/index.ts:446-464).
import type { Message } from "@earendil-works/pi-ai";
import { defineExtension, GenerationTask, hook, ROOT_CONVERSATION_ID, type EntryRecord } from "@earendil-works/pi-durable";
import { cap, type Memory } from "./memory.ts";
import { allowSearch, MASTER, SEARCH_DOC, VIEW_DOC } from "./prompts.ts";
import { optchatTools } from "./tools.ts";

const text = (content: Message["content"]) =>
  typeof content === "string" ? content : content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");

/** Upstream logMessage: one log entry per user message, reply text, tool call and tool result. Reports from subagents are "work". */
export function logEntry(memory: Memory, entry: EntryRecord) {
  const message = entry.model?.[0];
  if (!message) return;
  const date = new Date(message.timestamp).toISOString();
  if (message.role === "user") {
    const body = text(message.content);
    memory.append(body.startsWith("[subagent ") ? "work" : "user", body, date);
  } else if (message.role === "assistant") {
    for (const block of message.content) {
      if (block.type === "text" && block.text.trim()) memory.append("talk", block.text, date);
      if (block.type === "toolCall") memory.append("tool", `${block.name} ${JSON.stringify(block.arguments)}`, date);
    }
    if (message.stopReason === "error" || message.stopReason === "aborted") memory.append("echo", `Agent ${message.stopReason}: ${message.errorMessage ?? "No further details"}`, date);
  } else if (message.role === "toolResult") memory.append("echo", cap(`${message.toolName}: ${text(message.content)}`), date);
}

/** The current run: everything after the last finished answer (an assistant message that didn't stop for tools). */
function runStart(messages: readonly Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.stopReason !== "toolUse") return i + 1;
  }
  return 0;
}

export function optchatExtension(memory: () => Memory) {
  return defineExtension({
    name: "optchat",
    sections: [{ key: "optchat", render: () => `${MASTER}\n\n${allowSearch(VIEW_DOC, true)}${SEARCH_DOC}`, tag: false }],
    tools: optchatTools(memory),
    hooks: [
      hook(GenerationTask, {
        beforeRequest: async ({ messages }, api) => {
          if (api.conversationId !== ROOT_CONVERSATION_ID) return;
          await memory().settle(); // never show a turn a placeholder line (recipe §6)
          const view = memory().render();
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
