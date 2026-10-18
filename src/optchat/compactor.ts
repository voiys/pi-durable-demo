// Adaptation of jonaslsaa/pi-optchat src/compactor.ts (MIT): same prompt, size retry loop and transient-error retries,
// on pi-ai `Models` instead of pi-coding-agent's ModelRegistry. Dropped: Anthropic cache priming (we run on OpenAI).
import { clampThinkingLevel, isRetryableAssistantError, type Message, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import { bytes, NODE, type Compressor } from "./memory.ts";
import { COMPACT, compaction, IMPORT_GUIDANCE, tooLong } from "./prompts.ts";

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const abort = () => (clearTimeout(t), reject(signal.reason));
    const t = setTimeout(() => (signal.removeEventListener("abort", abort), resolve()), ms);
    signal.addEventListener("abort", abort, { once: true });
  });

/** Upstream default "summary size tolerance" (src/settings.ts:23 summaryAcceptBytes). */
const ACCEPT_BYTES = NODE * 1.25;

/** `choice` is async: the User DO checks the model against the plan's list before each call (fix plan G11). */
export function createCompressor(models: () => Models, choice: () => Promise<{ provider: string; model: string; thinking: ModelThinkingLevel }>, retryDelays: readonly number[] = [1000, 2000]): Compressor {
  return async (input, signal) => {
    const selected = await choice();
    const model = models().getModel(selected.provider, selected.model);
    if (!model) throw new Error(`Compactor model unavailable: ${selected.provider}/${selected.model}`);
    const level = clampThinkingLevel(model, selected.thinking);
    const step = `${input.historical ? IMPORT_GUIDANCE + "\n\n" : ""}${compaction(input)}`;
    // OpenAI joins text blocks with nothing between them, so the task starts its own paragraph after the view.
    const messages: Message[] = [{ role: "user", content: [{ type: "text", text: input.context }, { type: "text", text: `\n\n${step}` }], timestamp: Date.now() }];
    // A hung request must not block a turn in settle forever (fix plan G11).
    const ask = () => models().completeSimple(model, { systemPrompt: COMPACT, messages }, { sessionId: "optchat-compactor", reasoning: level === "off" ? undefined : level, signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]) });
    const answer = async () => {
      for (let retry = 0; ; retry++) {
        const reply = await ask();
        if (retry >= retryDelays.length || !isRetryableAssistantError(reply)) return reply;
        await sleep(retryDelays[retry], signal);
      }
    };
    const tries: string[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const reply = await answer();
      if (reply.stopReason === "error" || reply.stopReason === "aborted") throw new Error(reply.errorMessage ?? `Compactor ${reply.stopReason}`);
      if (reply.stopReason === "length" || reply.content.some((c) => c.type === "toolCall")) continue;
      const line = reply.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("").trim().replace(/^\d+\+\d+\|\s*/, "");
      if (!line) throw new Error("Compactor returned no text.");
      tries.push(line);
      if (bytes(line) <= ACCEPT_BYTES && bytes(line) < bytes(input.source)) break;
      messages.push(reply);
      const cut = new TextDecoder().decode(new TextEncoder().encode(line).subarray(0, NODE)).replace(/�$/, "");
      messages.push({ role: "user", content: tooLong(bytes(line), cut), timestamp: Date.now() });
    }
    if (!tries.length) throw new Error("Compactor returned no whole line in 5 tries.");
    return tries.reduce((a, b) => (bytes(a) <= bytes(b) ? a : b));
  };
}
