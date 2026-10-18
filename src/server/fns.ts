import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { env } from "../env.ts";
import { auth, requireUser } from "./auth.ts";

const user = async () => env.User.getByName((await requireUser(getRequestHeaders())).id);

export const getSession = createServerFn({ method: "GET" }).handler(() => auth().api.getSession({ headers: getRequestHeaders() }));
export const createChat = createServerFn({ method: "POST" }).handler(async () => ({ id: (await (await user()).createChat()).id }));
export const connectChatGPT = createServerFn({ method: "POST" }).handler(async () => (await user()).beginConnect());
export const disconnectChatGPT = createServerFn({ method: "POST" }).handler(async () => (await user()).disconnect());
export const searchMessages = createServerFn({ method: "GET" })
  .validator((q: string) => q)
  .handler(async ({ data }) => (await (await user()).search(data)).map((h) => ({ ...h })));
