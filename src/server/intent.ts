import { Type } from "@earendil-works/pi-ai";

/**
 * Every tool call carries its intent: one sentence the model writes for the user about what it is doing and why. The
 * thread shows the intent while the call runs and the outcome (done, or why not) when it settles, never the tool, its
 * arguments or its raw output (DESIGN.md §8).
 */
export const intent = Type.String({
  description:
    "One short sentence for the person you work for, in plain words, saying what you are doing and why, e.g. \"Checking " +
    "Cloudflare's official limits page for the row-size cap\". No tool names, no jargon, no IDs.",
});
