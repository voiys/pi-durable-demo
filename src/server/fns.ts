import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { env } from "../env.ts";
import { chatObjectName } from "../shared.ts";
import { auth, requireUser } from "./auth.ts";
import { pickerOptions } from "./models.ts";

const user = async () => env.User.getByName((await requireUser(getRequestHeaders())).id);
/** The caller's id, after checking `chatId` is in the caller's own catalog (403 otherwise). */
const owner = async (chatId: string) => {
  const { id } = await requireUser(getRequestHeaders());
  if (!(await env.User.getByName(id).hasChat(chatId))) throw new Response("Forbidden", { status: 403 });
  return id;
};
const chat = async (chatId: string) => env.Chat.getByName(chatObjectName(await owner(chatId), chatId));

export const getSession = createServerFn({ method: "GET" }).handler(() => auth().api.getSession({ headers: getRequestHeaders() }));
export const createChat = createServerFn({ method: "POST" }).handler(async () => ({ id: (await (await user()).createChat()).id }));
export const connectChatGPT = createServerFn({ method: "POST" }).handler(async () => (await user()).beginConnect());
export const disconnectChatGPT = createServerFn({ method: "POST" }).handler(async () => (await user()).disconnect());
export const searchMessages = createServerFn({ method: "GET" })
  .validator((q: string) => q)
  .handler(async ({ data }) => (await (await user()).search(data)).map((h) => ({ ...h })));
export const renameChat = createServerFn({ method: "POST" })
  .validator((d: { chatId: string; title: string }) => d)
  .handler(async ({ data }) => env.User.getByName(await owner(data.chatId)).renameChat(data.chatId, data.title));
export const deleteChat = createServerFn({ method: "POST" })
  .validator((chatId: string) => chatId)
  .handler(async ({ data }) => env.User.getByName(await owner(data)).deleteChat(data));
/** The picker's models for the caller's ChatGPT plan; account-level, so it works before a chat exists. */
export const modelOptions = createServerFn({ method: "GET" }).handler(async () =>
  pickerOptions(await (await user()).availableModels()),
);
export const setChatModel = createServerFn({ method: "POST" })
  .validator((d: { chatId: string; model: string; thinkingLevel: string }) => d)
  .handler(async ({ data }) => (await chat(data.chatId)).configureModel(data.model, data.thinkingLevel));
