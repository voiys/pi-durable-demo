import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { env } from "../env.ts";
import { chatObjectName } from "../shared.ts";
import { auth, requireUser } from "./auth.ts";

const user = async () => env.User.getByName((await requireUser(getRequestHeaders())).id);
const chat = async (chatId: string) => {
  const { id } = await requireUser(getRequestHeaders());
  if (!(await env.User.getByName(id).hasChat(chatId))) throw new Response("Forbidden", { status: 403 });
  return env.Chat.getByName(chatObjectName(id, chatId));
};

export const getSession = createServerFn({ method: "GET" }).handler(() => auth().api.getSession({ headers: getRequestHeaders() }));
export const createChat = createServerFn({ method: "POST" })
  .validator((optchat: boolean) => optchat)
  .handler(async ({ data }) => ({ id: (await (await user()).createChat(data)).id }));
export const connectChatGPT = createServerFn({ method: "POST" }).handler(async () => (await user()).beginConnect());
export const disconnectChatGPT = createServerFn({ method: "POST" }).handler(async () => (await user()).disconnect());
export const searchMessages = createServerFn({ method: "GET" })
  .validator((q: string) => q)
  .handler(async ({ data }) => (await (await user()).search(data)).map((h) => ({ ...h })));
export const chatModels = createServerFn({ method: "GET" })
  .validator((chatId: string) => chatId)
  .handler(async ({ data }) => (await (await chat(data)).modelOptions()).map((m) => ({ ...m, levels: [...m.levels] })));
export const setChatModel = createServerFn({ method: "POST" })
  .validator((d: { chatId: string; model: string; thinkingLevel: string }) => d)
  .handler(async ({ data }) => (await chat(data.chatId)).configureModel(data.model, data.thinkingLevel));
