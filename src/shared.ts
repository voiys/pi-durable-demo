// Types and helpers shared by the browser and the Durable Objects (no server imports here).
import type { ColorId, ExpressionId, ShapeId } from "bloub-react";

/** A bot: one endless conversation with its own OptChat memory (DECISIONS.md). `agents` are its subagents. The glance
 * layer: `working` while a run of its main conversation is live, `unread` when it changed since the user last looked. */
export type BotSummary = { id: string; name: string; instructions: string; look: BotLook; updatedAt: number; agents: { name: string; session: string }[]; working: boolean; unread: boolean };
export type SearchHit = { botId: string; entryId: string; role: string; snippet: string; name: string };
/** FTS5 snippet() wraps each match in these control characters (src/server/user.ts search), so text never collides with them. */
export const MATCH_OPEN = "\u0002";
export const MATCH_CLOSE = "\u0003";
/** A group chat in the user's catalog: the room's title and member bot ids. */
export type GroupSummary = { id: string; title: string; members: string[] };
/** One message in a group: `from` is a member bot's id, or null for the user. `replyTo`: the id of the room message a
 * user message replies to. Its text is the bare reply: the Group DO quotes the replied-to message for the bots itself. */
export type GroupMessage = { id: string; from: string | null; text: string; ts: number; replyTo?: string };
/** A group's synced state (Group DO): `purpose` is what the group is for and who owns what (every member's instructions
 * include it); `typing` are the bots working on what they just heard. */
export type GroupState = { title: string; purpose: string; members: { id: string; name: string }[]; messages: GroupMessage[]; typing: string[] };
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

/** A bot's face (bloub-react): its body shape, its ink and its resting expression. The color is identity, never UI. */
export type BotLook = { shape: ShapeId; color: ColorId; expression: ExpressionId };
/** What the look picker offers, in order, with English names (bloub's ids are French). Ink and cream are left out: each
 * vanishes on one theme's canvas. */
export const LOOK_SHAPES: [ShapeId, string][] = [["cercle", "Circle"], ["galet", "Pebble"], ["squircle", "Squircle"], ["capsule", "Capsule"], ["triangle", "Triangle"], ["hexagone", "Hexagon"], ["nuage", "Cloud"], ["goutte", "Drop"]];
export const LOOK_COLORS: [ColorId, string][] = [["orange", "Orange"], ["bleu", "Blue"], ["violet", "Violet"], ["rouge", "Red"], ["turquoise", "Teal"], ["vert", "Green"], ["ambre", "Amber"], ["rose", "Pink"], ["brun", "Brown"], ["gris", "Gray"]];
export const LOOK_EXPRESSIONS: [ExpressionId, string][] = [
  ["neutre", "Neutral"], ["attentif", "Attentive"], ["heureux", "Happy"], ["hilare", "Laughing"], ["excite", "Excited"], ["fier", "Proud"], ["curieux", "Curious"], ["surpris", "Surprised"],
  ["timide", "Shy"], ["confus", "Confused"], ["mefiant", "Suspicious"], ["blase", "Unimpressed"], ["somnolent", "Sleepy"], ["triste", "Sad"], ["effraye", "Scared"], ["colere", "Angry"],
];
/** The look the user's next bot starts with, given how many bots they have: shapes and colors walk their lists. */
export const nextLook = (count: number): BotLook => ({ shape: LOOK_SHAPES[count % LOOK_SHAPES.length][0], color: LOOK_COLORS[count % LOOK_COLORS.length][0], expression: "neutre" });
/** A look from outside (a form, a server fn): each part must be one the picker offers. */
export function assertLook(look: BotLook): BotLook {
  if (!LOOK_SHAPES.some(([id]) => id === look.shape)) throw new Error(`Unknown shape ${look.shape}`);
  if (!LOOK_COLORS.some(([id]) => id === look.color)) throw new Error(`Unknown color ${look.color}`);
  if (!LOOK_EXPRESSIONS.some(([id]) => id === look.expression)) throw new Error(`Unknown expression ${look.expression}`);
  return look;
}

/** Bot DO names are `<userId>--<botId>`; the Worker gates sockets on that prefix. */
export const botObjectName = (userId: string, botId: string) => `${userId}--${botId}`;
/** What a new bot starts with. */
export const DEFAULT_MODEL = { id: "gpt-6.1-sol", thinkingLevel: "low" } as const;

/** How messages that are not the user's own words start: subagent reports, other agents and bots, routines firing.
 * Memory logs them as "work" and the UI renders them as agent messages. */
export const AGENT_PREFIXES = ["[subagent ", "[message from ", "[routine "] as const;
export const isAgentMessage = (text: string) => AGENT_PREFIXES.some((p) => text.startsWith(p));

/** A reply to one message, as plain text (bot DMs): the quoted message as markdown blockquote lines, a blank line, the
 * reply. The model reads it as is; the UI splits it back with parseReply. */
export const replyText = (quoted: string, reply: string) => `${quoted.split("\n").map((l) => `> ${l}`).join("\n")}\n\n${reply}`;
export function parseReply(text: string): { quoted: string; reply: string } | null {
  const m = /^((?:>[^\n]*\n)+)\n([\s\S]*)$/.exec(text);
  return m && { quoted: m[1].trimEnd().split("\n").map((l) => l.replace(/^> ?/, "")).join("\n"), reply: m[2] };
}

/** The user's pick on a bot's `ask` card (src/server/bot.ts), sent as their next message: the user's own words, so it
 * logs as "user" (no AGENT_PREFIXES match). Several picks (`multiple`) are joined with ", ". */
export const answerText = (question: string, picks: string[]) => {
  if (!picks.length) throw new Error("An answer needs at least one pick");
  return `[answer to “${question}”] ${picks.join(", ")}`;
};
export function parseAnswer(text: string): { question: string; answer: string } | null {
  const m = /^\[answer to “([\s\S]*?)”\] ([\s\S]*)$/.exec(text);
  return m && { question: m[1], answer: m[2] };
}
