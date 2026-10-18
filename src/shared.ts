import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
// Types and helpers shared by the browser and the Durable Objects (no server imports here).
export type ChatSummary = { id: string; title: string; updatedAt: number; agents: { name: string; session: string }[] };
export type SearchHit = { chatId: string; entryId: string; role: string; snippet: string; title: string };
/** FTS5 snippet() wraps each match in these control characters (src/server/user.ts search), so text never collides with them. */
export const MATCH_OPEN = "\u0002";
export const MATCH_CLOSE = "\u0003";
/** Debug knobs (sidebar Debug section), per user, applied to all of that user's chats. */
export type DebugSettings = { viewBytes: number };
/** OptChat view budgets the debug slider offers; 128 KB is the recipe's default (src/optchat/memory.ts VIEW). */
export const VIEW_BUDGETS = [2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000] as const;
export const DEFAULT_DEBUG: DebugSettings = { viewBytes: 128_000 };
export type MemoryStats = { entries: number; nodes: number; lines: number; viewBytes: number; budget: number; pending: number; building: number };
export type UserState = { chats: ChatSummary[]; chatgpt: { email: string } | null; debug: DebugSettings };
export type IndexRow = { entryId: string; role: "user" | "assistant"; text: string };

/** Chat DO names are `<userId>--<chatId>`; the Worker gates sockets on that prefix. */
export const chatObjectName = (userId: string, chatId: string) => `${userId}--${chatId}`;
/** What a new chat starts with (and what the draft picker shows before the chat exists). */
export const DEFAULT_MODEL = { id: "gpt-6.1-sol", thinkingLevel: "low" } as const;
export type ModelOption = { id: string; name: string; levels: ModelThinkingLevel[] };

/** How messages from other agents start (subagent reports, peer agents, the user's other chats). They are not the user's
 * own words: memory logs them as "work" and the UI renders them as agent messages. */
export const AGENT_PREFIXES = ["[subagent ", "[message from "] as const;
export const isAgentMessage = (text: string) => AGENT_PREFIXES.some((p) => text.startsWith(p));
