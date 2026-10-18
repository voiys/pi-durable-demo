// Types and helpers shared by the browser and the Durable Objects (no server imports here).
export type ChatSummary = { id: string; title: string; updatedAt: number };
export type SearchHit = { chatId: string; entryId: string; role: string; snippet: string; title: string };
export type UserState = { chats: ChatSummary[]; chatgpt: { email: string } | null };
export type IndexRow = { entryId: string; role: "user" | "assistant"; text: string };

/** Chat DO names are `<userId>--<chatId>`; the Worker gates sockets on that prefix. */
export const chatObjectName = (userId: string, chatId: string) => `${userId}--${chatId}`;
