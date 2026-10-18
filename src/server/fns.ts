import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { env } from "../env.ts";
import { botObjectName, type BotDetails } from "../shared.ts";
import { auth, requireUser } from "./auth.ts";
import { pickerOptions } from "./models.ts";

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
/** The picker's models for the caller's ChatGPT plan; account-level, so it works before a bot exists. */
export const modelOptions = createServerFn({ method: "GET" }).handler(async () => pickerOptions(await (await user()).availableModels()));

export const createBot = createServerFn({ method: "POST" })
  .validator((d: { name: string; instructions: string }) => d)
  .handler(async ({ data }) => ({ id: (await (await user()).createBot(data.name, data.instructions)).id }));
export const updateBot = createServerFn({ method: "POST" })
  .validator((d: { botId: string; name?: string; instructions?: string }) => d)
  .handler(async ({ data: { botId, ...patch } }) => env.User.getByName(await owner(botId)).updateBot(botId, patch));
export const deleteBot = createServerFn({ method: "POST" })
  .validator((botId: string) => botId)
  .handler(async ({ data }) => env.User.getByName(await owner(data)).deleteBot(data));
export const setBotModel = createServerFn({ method: "POST" })
  .validator((d: { botId: string; model: string; thinkingLevel: string }) => d)
  .handler(async ({ data }) => (await bot(data.botId)).configureModel(data.model, data.thinkingLevel));
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
