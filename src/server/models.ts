import type { CredentialStore, OAuthCredential } from "@earendil-works/pi-ai";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { DEFAULT_MODEL } from "../shared.ts";
import { oauth } from "./siwc.ts";

// A reasoning model: pi sends the system prompt as a developer item only for those,
// and SIWC rejects role:system (pi-source-v1.3.0 packages/ai/src/api/openai-responses-shared.ts:231-243).
export const MODEL = { provider: "openai", id: DEFAULT_MODEL.id } as const;
/** pi-ai Models on the user's ChatGPT plan. pi-ai reads the credential on every request and refreshes it under
 * `modify`; the refresh itself runs in the User DO (siwc.ts `oauth`), which already persists the result. */
export function planModels(credential: () => Promise<OAuthCredential>, refresh: (stale: OAuthCredential) => Promise<OAuthCredential>): Models {
  const credentials: CredentialStore = {
    read: async (providerId) => (providerId === MODEL.provider ? await credential() : undefined),
    list: async () => [{ providerId: MODEL.provider, type: "oauth" }],
    modify: async (providerId, fn) => fn(await credentials.read(providerId)),
    delete: async () => {
      throw new Error("Disconnect ChatGPT from the app, not from pi");
    },
  };
  const models = createModels({ credentials });
  models.setProvider({ ...openaiProvider(), auth: { oauth: oauth(refresh) } });
  return models;
}
