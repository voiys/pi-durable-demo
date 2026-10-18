import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { DEFAULT_MODEL, type ModelOption } from "../shared.ts";

// A reasoning model: pi sends the system prompt as a developer item only for those,
// and SIWC rejects role:system (pi-source-v1.3.0 packages/ai/src/api/openai-responses-shared.ts:231-243).
export const MODEL = { provider: "openai", id: DEFAULT_MODEL.id } as const;
/** The models the picker offers, in this order (user's pick, DECISIONS.md); each must also be on the ChatGPT plan. */
const PICKER = ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"];

/** The picker's options among the slugs the user's ChatGPT plan lists. */
export function pickerOptions(available: string[]): ModelOption[] {
  const catalog = openaiProvider().getModels();
  return PICKER.filter((id) => available.includes(id)).map((id) => {
    const m = catalog.find((c) => c.id === id);
    if (!m?.reasoning) throw new Error(`${id} is not a reasoning model in pi's catalog`);
    return { id, name: m.name, levels: getSupportedThinkingLevels(m) };
  });
}
