import handler from "@tanstack/react-start/server-entry";
import { routeAgentRequest } from "agents";
import type { Env } from "./env.ts";
import { auth } from "./server/auth.ts";

export { Bot } from "./server/bot.ts";
export { BotData } from "./server/bot-data.ts";
export { Group } from "./server/group.ts";
export { User } from "./server/user.ts";

/**
 * Every agent socket/request is resolved to the better-auth user first.
 * `/agents/user/<name>` must be the caller's own id, `/agents/bot/<name>` must
 * be `<id>--<botId>` for a bot in the caller's catalog, `/agents/group/<name>` `<id>--<groupId>` for one of the caller's
 * groups, so one user can never reach another user's objects.
 */
async function routeAgent(request: Request, env: Env): Promise<Response> {
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const segments = new URL(request.url).pathname.split("/");
  // Exactly /agents/<kind>/<name>: no sub-paths, so nothing past the gate is addressed by a path it didn't check.
  if (segments.length !== 4) return new Response("Not found", { status: 404 });
  const [, , kind, name] = segments;
  const id = session.user.id;
  const own = name?.startsWith(`${id}--`) ? name.slice(id.length + 2) : undefined;
  // A bot or group must also be in the caller's own catalog, so nobody can mint objects outside it.
  const user = env.User.getByName(id);
  const allowed =
    (kind === "user" && name === id) ||
    (kind === "bot" && own !== undefined && (await user.hasBot(own))) ||
    (kind === "group" && own !== undefined && (await user.hasGroup(own)));
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
