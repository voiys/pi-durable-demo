import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
// Types and helpers shared by the browser and the Durable Objects (no server imports here).

/** A bot: one endless conversation with its own OptChat memory (DECISIONS.md). `agents` are its subagents. The glance
 * layer: `working` while a run of its main conversation is live, `unread` when it changed since the user last looked. */
export type BotSummary = { id: string; name: string; instructions: string; color: string; updatedAt: number; agents: { name: string; session: string }[]; working: boolean; unread: boolean };
export type SearchHit = { botId: string; entryId: string; role: string; snippet: string; name: string };
/** FTS5 snippet() wraps each match in these control characters (src/server/user.ts search), so text never collides with them. */
export const MATCH_OPEN = "\u0002";
export const MATCH_CLOSE = "\u0003";
/** A group chat in the user's catalog: the room's title and member bot ids. */
export type GroupSummary = { id: string; title: string; members: string[] };
/** One message in a group: `from` is a member bot's id, or null for the user. */
export type GroupMessage = { id: string; from: string | null; text: string; ts: number };
/** A group's synced state (Group DO): `typing` are the bots working on what they just heard. */
export type GroupState = { title: string; members: { id: string; name: string }[]; messages: GroupMessage[]; typing: string[] };
/** `mainBot`: the orchestrator bot, the only one that can create, rename and delete bots (`fleet` tool). */
export type UserState = { bots: BotSummary[]; groups: GroupSummary[]; mainBot: string | null; chatgpt: { email: string } | null };
export type IndexRow = { entryId: string; role: "user" | "assistant"; text: string };

/** OptChat view budgets the memory slider offers; 128 KB is the recipe's default (src/optchat/memory.ts VIEW). */
export const VIEW_BUDGETS = [2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000] as const;
export type MemoryStats = { entries: number; nodes: number; lines: number; viewBytes: number; budget: number; pending: number; building: number };
/** A prompt the bot gets on a cron schedule, in its own conversation. */
export type Routine = { id: string; name: string; prompt: string; cron: string; enabled: boolean };
/** A report the bot saved to its library (BotData DO). */
export type LibraryItem = { id: number; title: string; createdAt: number };
/** What a bot's details panel shows, read from its Bot DO and BotData DO. */
export type BotDetails = { memory: MemoryStats; routines: Routine[]; library: LibraryItem[]; tables: { name: string; rows: number }[] };

/** Avatar colors a new bot picks from (Tailwind palette, so they read on both themes). */
export const BOT_COLORS = ["#f97316", "#3b82f6", "#a855f7", "#ef4444", "#14b8a6", "#22c55e", "#eab308", "#ec4899"] as const;
/** The color the user's next bot gets, given how many bots they have (src/server/user.ts createBot). */
export const botColor = (count: number) => BOT_COLORS[count % BOT_COLORS.length];

/** Bot DO names are `<userId>--<botId>`; the Worker gates sockets on that prefix. */
export const botObjectName = (userId: string, botId: string) => `${userId}--${botId}`;
/** What a new bot starts with. */
export const DEFAULT_MODEL = { id: "gpt-6.1-sol", thinkingLevel: "low" } as const;
export type ModelOption = { id: string; name: string; levels: ModelThinkingLevel[] };

/** How messages that are not the user's own words start: subagent reports, other agents and bots, routines firing.
 * Memory logs them as "work" and the UI renders them as agent messages. */
export const AGENT_PREFIXES = ["[subagent ", "[message from ", "[routine "] as const;
export const isAgentMessage = (text: string) => AGENT_PREFIXES.some((p) => text.startsWith(p));
