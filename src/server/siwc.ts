// Sign in with ChatGPT, open-source dynamic-registration flow.
// Contract: https://developers.openai.com/siwc/token-sharing-open-source/sign-in (research/siwc.md),
// request/refresh shapes mirror pi-source-v1.3.0 packages/ai/src/auth/oauth/openai-chatgpt.ts:16-223.
import type { OAuthAuth, OAuthCredential } from "@earendil-works/pi-ai";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ORIGIN } from "../origin.ts";

const ISSUER = "https://auth.openai.com";
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`;
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`;
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
const RESOURCE = "https://api.openai.com/v1";
const DIRECT_SCOPE = "chatgpt.tokens.use.direct";
const SCOPE = `openid profile email offline_access resource.invoke ${DIRECT_SCOPE}`;
export const REDIRECT_URI = `${ORIGIN}/auth/callback`;
export const AGENT_NAME = "pi-durable-demo";
// Refresh before the real expiry so a request never starts with a dying token (pi does the same).
const EXPIRY_MARGIN_MS = 3 * 60 * 1000;

/** One authorization attempt, kept by the User DO until the callback arrives. */
export type Pending = { state: string; nonce: string; verifier: string; clientId: string | null };

/** What the User DO stores per connection: pi's OAuth credential plus identity. */
export type Connection = OAuthCredential & { clientId: string; email: string; idToken: string };

const random = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function challenge(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Builds the authorize URL. A saved connection re-authorizes with its issued client id. */
export async function authorize(hostId: string, saved: Connection | null): Promise<{ url: string; pending: Pending }> {
  const pending: Pending = { state: random(), nonce: random(), verifier: random(), clientId: saved?.clientId ?? null };
  const params = new URLSearchParams({
    client_id: saved?.clientId ?? "dynamic_agent_client",
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    resource: RESOURCE,
    state: pending.state,
    nonce: pending.nonce,
    code_challenge_method: "S256",
    code_challenge: await challenge(pending.verifier),
  });
  if (saved) {
    params.set("id_token_hint", saved.idToken);
    params.set("login_hint", saved.email);
  } else params.set("agent_name_hint", AGENT_NAME);
  return { url: `${AUTHORIZE_URL}?${params}`, pending };
}

async function token(body: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`OpenAI token request failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; scope: string; id_token?: string };
}

function credential(t: Awaited<ReturnType<typeof token>>, clientId: string) {
  const scopes = t.scope.split(/\s+/);
  if (!scopes.includes(DIRECT_SCOPE)) throw new Error(`ChatGPT plan usage (${DIRECT_SCOPE}) was not granted`);
  return {
    type: "oauth" as const,
    access: t.access_token,
    refresh: t.refresh_token,
    expires: Date.now() + t.expires_in * 1000 - EXPIRY_MARGIN_MS,
    clientId,
    scopes,
  };
}

/** Validates the callback, exchanges the code, verifies the ID token. */
export async function complete(url: URL, pending: Pending): Promise<Connection> {
  const error = url.searchParams.get("error");
  if (error) throw new Error(`ChatGPT sign-in failed: ${error} ${url.searchParams.get("error_description") ?? ""}`);
  if (url.searchParams.get("state") !== pending.state) throw new Error("OAuth state mismatch");
  const code = url.searchParams.get("code");
  if (!code) throw new Error("Callback has no code");
  // New registrations return the issued client id; re-authorizations may omit it but must not change it.
  const returned = url.searchParams.get("client_id");
  const clientId = pending.clientId ?? returned;
  if (!clientId) throw new Error("New registration callback has no issued client_id");
  if (returned && returned !== clientId) throw new Error("Callback client_id differs from the saved registration");
  const t = await token({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: pending.verifier,
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
  });
  if (!t.id_token) throw new Error("Token response has no id_token");
  const { payload } = await jwtVerify(t.id_token, JWKS, { issuer: ISSUER, audience: clientId });
  if (payload.nonce !== pending.nonce) throw new Error("ID token nonce mismatch");
  if (typeof payload.email !== "string") throw new Error("ID token has no email");
  return { ...credential(t, clientId), email: payload.email, idToken: t.id_token };
}

export async function refresh(c: Connection): Promise<Connection> {
  const t = await token({ grant_type: "refresh_token", client_id: c.clientId, refresh_token: c.refresh, resource: RESOURCE });
  return { ...c, ...credential(t, c.clientId) };
}

/** pi-ai OAuth for the `openai` provider; refresh happens in the User DO so rotated tokens are never raced. */
export function oauth(refreshInUser: (c: OAuthCredential) => Promise<OAuthCredential>): OAuthAuth {
  return {
    name: "OpenAI (ChatGPT subscription)",
    isSubscription: true,
    login: () => Promise.reject(new Error("Connect ChatGPT from the app, not from pi")),
    refresh: (c) => refreshInUser(c),
    toAuth: async (c) => ({ apiKey: c.access }),
  };
}
