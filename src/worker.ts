import handler from "@tanstack/react-start/server-entry";
import { routeAgentRequest } from "agents";
import type { Env } from "./env.ts";
import { auth } from "./server/auth.ts";

export { Chat } from "./server/chat.ts";
export { User } from "./server/user.ts";

/**
 * Every agent socket/request is resolved to the better-auth user first.
 * `/agents/user/<name>` must be the caller's own id, `/agents/chat/<name>` must
 * start with `<id>--`, so one user can never reach another user's objects.
 */
async function routeAgent(request: Request, env: Env): Promise<Response> {
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const [, , kind, name] = new URL(request.url).pathname.split("/");
  const id = session.user.id;
  const allowed = (kind === "user" && name === id) || (kind === "chat" && name?.startsWith(`${id}--`));
  if (!allowed) return new Response("Forbidden", { status: 403 });
  const response = await routeAgentRequest(request, env);
  if (!response) throw new Error(`routeAgentRequest did not route ${request.url}`);
  return response;
}

export default {
  fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname.startsWith("/agents/")) return routeAgent(request, env);
    return handler.fetch(request);
  },
};
