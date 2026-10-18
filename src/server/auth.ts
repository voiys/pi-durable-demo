import { betterAuth } from "better-auth";
import { env } from "../env.ts";
import { ORIGIN } from "../origin.ts";

// D1 holds better-auth's tables only. better-auth reads a raw D1 binding natively
// (better-auth-1710-source packages/kysely-adapter/src/dialect.ts:184-194).
export const auth = () =>
  betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: ORIGIN,
    emailAndPassword: { enabled: true },
  });

export async function requireUser(headers: Headers) {
  const session = await auth().api.getSession({ headers });
  if (!session) throw new Response("Unauthorized", { status: 401 });
  return session.user;
}
