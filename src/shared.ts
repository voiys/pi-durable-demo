import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
// Types and helpers shared by the browser and the Durable Objects (no server imports here).
export type ChatSummary = { id: string; title: string; updatedAt: number; agents: { name: string; session: string }[] };
export type SearchHit = { chatId: string; entryId: string; role: string; snippet: string; title: string };
/** FTS5 snippet() wraps each match in these control characters (src/server/user.ts search), so text never collides with them. */
export const MATCH_OPEN = "\u0002";
export const MATCH_CLOSE = "\u0003";
export type UserState = { chats: ChatSummary[]; chatgpt: { email: string } | null };
export type IndexRow = { entryId: string; role: "user" | "assistant"; text: string };

/** Chat DO names are `<userId>--<chatId>`; the Worker gates sockets on that prefix. */
export const chatObjectName = (userId: string, chatId: string) => `${userId}--${chatId}`;
export type ModelOption = { id: string; name: string; levels: ModelThinkingLevel[] };
