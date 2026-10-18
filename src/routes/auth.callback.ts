import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "../server/auth.ts";
import { env } from "../env.ts";

// Sign in with ChatGPT redirects here (http://127.0.0.1:1455/auth/callback); the user's DO finishes the exchange.
export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { id } = await requireUser(request.headers);
        await env.User.getByName(id).completeConnect(request.url);
        return Response.redirect(new URL("/", request.url), 302);
      },
    },
  },
});
