import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { env } from "../env.ts";
import { botObjectName, type BotDetails, type BotLook } from "../shared.ts";
import { auth, requireUser } from "./auth.ts";

const user = async () => env.User.getByName((await requireUser(getRequestHeaders())).id);
/** The caller's id, after checking `botId` is in the caller's own catalog (403 otherwise). */
const owner = async (botId: string) => {
  const { id } = await requireUser(getRequestHeaders());
  if (!(await env.User.getByName(id).hasBot(botId))) throw new Response("Forbidden", { status: 403 });
  return id;
};
const bot = async (botId: string) => env.Bot.getByName(botObjectName(await owner(botId), botId));

export const getSession = createServerFn({ method: "GET" }).handler(() => auth().api.getSession({ headers: getRequestHeaders() }));
export const connectChatGPT = createServerFn({ method: "POST" }).handler(async () => (await user()).beginConnect());
export const disconnectChatGPT = createServerFn({ method: "POST" }).handler(async () => (await user()).disconnect());
export const searchMessages = createServerFn({ method: "GET" })
  .validator((q: string) => q)
  .handler(async ({ data }) => (await (await user()).search(data)).map((h) => ({ ...h })));

export const createBot = createServerFn({ method: "POST" })
  .validator((d: { name: string; instructions: string; look: BotLook }) => d)
  .handler(async ({ data }) => ({ id: (await (await user()).createBot(data.name, data.instructions, data.look)).id }));
export const updateBot = createServerFn({ method: "POST" })
  .validator((d: { botId: string; name?: string; instructions?: string; look?: Partial<BotLook> }) => d)
  .handler(async ({ data: { botId, ...patch } }) => env.User.getByName(await owner(botId)).updateBot(botId, patch));
export const setMainBot = createServerFn({ method: "POST" })
  .validator((botId: string) => botId)
  .handler(async ({ data }) => env.User.getByName(await owner(data)).setMainBot(data));
export const deleteBot = createServerFn({ method: "POST" })
  .validator((botId: string) => botId)
  .handler(async ({ data }) => env.User.getByName(await owner(data)).deleteBot(data));
/** The UI calls this while the bot's conversation is on screen; it clears the rail's unread dot. */
export const markSeen = createServerFn({ method: "POST" })
  .validator((botId: string) => botId)
  .handler(async ({ data }) => env.User.getByName(await owner(data)).markSeen(data));
export const botDetails = createServerFn({ method: "GET" })
  .validator((botId: string) => botId)
  .handler(async ({ data }): Promise<BotDetails> => {
    const d = await (await bot(data)).details();
    return { memory: { ...d.memory }, routines: d.routines.map((r) => ({ ...r })), library: d.library.map((r) => ({ ...r })), tables: d.tables.map((t) => ({ ...t })) };
  });
const botData = async (botId: string) => env.BotData.getByName(botObjectName(await owner(botId), botId));
export const readReport = createServerFn({ method: "GET" })
  .validator((d: { botId: string; id: number }) => d)
  .handler(async ({ data }) => (await botData(data.botId)).report(data.id));
export const deleteReport = createServerFn({ method: "POST" })
  .validator((d: { botId: string; id: number }) => d)
  .handler(async ({ data }) => (await botData(data.botId)).deleteReport(data.id));
export const setMemoryBudget = createServerFn({ method: "POST" })
  .validator((d: { botId: string; bytes: number }) => d)
  .handler(async ({ data }) => (await bot(data.botId)).setMemoryBudget(data.bytes));
export const resetMemory = createServerFn({ method: "POST" })
  .validator((botId: string) => botId)
  .handler(async ({ data }) => (await bot(data)).resetMemory());
export const setRoutineEnabled = createServerFn({ method: "POST" })
  .validator((d: { botId: string; id: string; enabled: boolean }) => d)
  .handler(async ({ data }) => (await bot(data.botId)).setRoutineEnabled(data.id, data.enabled));
export const deleteRoutine = createServerFn({ method: "POST" })
  .validator((d: { botId: string; id: string }) => d)
  .handler(async ({ data }) => (await bot(data.botId)).deleteRoutine(data.id));
export const retireSubagent = createServerFn({ method: "POST" })
  .validator((d: { botId: string; name: string }) => d)
  .handler(async ({ data }) => (await bot(data.botId)).retireSubagent(data.name));

/** The caller's group `groupId` (403 unless it is in the caller's catalog). */
const group = async (groupId: string) => {
  const { id } = await requireUser(getRequestHeaders());
  if (!(await env.User.getByName(id).hasGroup(groupId))) throw new Response("Forbidden", { status: 403 });
  return { user: env.User.getByName(id), room: env.Group.getByName(botObjectName(id, groupId)) };
};
export const createGroup = createServerFn({ method: "POST" })
  .validator((d: { title: string; botIds: string[]; purpose: string }) => d)
  .handler(async ({ data }) => {
    // Every member must be the caller's own bot (403 otherwise), like every other bot-scoped call.
    for (const botId of data.botIds) await owner(botId);
    return { id: await (await user()).createGroup(data.title, data.botIds, data.purpose) };
  });
export const updateGroup = createServerFn({ method: "POST" })
  .validator((d: { groupId: string; title?: string; purpose?: string }) => d)
  .handler(async ({ data: { groupId, ...patch } }) => (await group(groupId)).user.updateGroup(groupId, patch));
/** `replyTo`: the id of the room message this replies to (a bot's message also reaches that bot). */
export const postToGroup = createServerFn({ method: "POST" })
  .validator((d: { groupId: string; text: string; replyTo?: string }) => d)
  .handler(async ({ data }) => (await group(data.groupId)).room.userPost(data.text, data.replyTo));
export const disbandGroup = createServerFn({ method: "POST" })
  .validator((groupId: string) => groupId)
  .handler(async ({ data }) => (await group(data)).user.disbandGroup(data));
