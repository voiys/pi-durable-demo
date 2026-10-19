// Adaptation of jonaslsaa/pi-optchat src/tools.ts (MIT): zoom, date and search as pi-durable tools.
// Dropped: zoom("<run id>") into subagent runs and image loading (subagents here are pi-durable conversations).
import { intent } from "../server/intent.ts";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import type { MemoryApi } from "./extension.ts";
import { flat, PAGE, start, type Memory } from "./memory.ts";

const say = (text: string) => ({ output: [{ type: "text" as const, text }] });
export const SEARCH_PAGE = 20;
const SNIPPET = 200;

/** One page of hits, each with its id, the view line holding it, its date and a snippet around the first match. */
export function searchPage(memory: Memory, text: string, before?: number) {
  const hits = memory.search(text, before), older = before === undefined ? "" : "older ";
  if (!hits.length) return `No ${older}messages contain "${text}".`;
  const page = hits.slice(0, SEARCH_PAGE), needle = text.toLowerCase();
  const lines = page.map((entry) => {
    const at = Math.max(0, entry.text.toLowerCase().indexOf(needle) - SNIPPET / 4);
    const snippet = flat(entry.text.slice(at, at + SNIPPET).replace(/^[\udc00-\udfff]|[\ud800-\udbff]$/g, ""));
    const line = memory.covering(entry.i);
    return `${entry.i}${line?.l ? ` (in ${start(line)}+${2 ** line.l})` : ""} · ${new Date(entry.date).toString().slice(0, 21)} · ${entry.kind}: ${at ? "…" : ""}${snippet}${at + SNIPPET < entry.text.length ? "…" : ""}`;
  });
  const more = hits.length > page.length ? `\nOlder matches: search again with before: ${page[page.length - 1].i}.` : "";
  return `${hits.length} ${older}${hits.length === 1 ? "message contains" : "messages contain"} "${text}", newest first:\n${lines.join("\n")}${more}`;
}

export function optchatTools(memory: MemoryApi) {
  const zoom = defineTool({
    name: "zoom",
    description: `Open the line id+n of the view into the two lines of n/2 under it; n = 1 (the default) gives the message whole. A message over ${PAGE.toLocaleString("en-US")} characters comes in pages; offset and limit (characters) read any part of it.`,
    parameters: Type.Object({ intent, id: Type.Integer({ minimum: 0 }), n: Type.Optional(Type.Integer({ minimum: 1 })), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: PAGE })) }),
    replay: "safe",
    execute: async ({ id, n = 1, offset, limit }) => say(await memory.zoom(id, n, offset, limit)),
  });
  const date = defineTool({
    name: "date",
    description: "The date and time of message id.",
    parameters: Type.Object({ intent, id: Type.Integer({ minimum: 0 }) }),
    replay: "safe",
    execute: async ({ id }) => say(await memory.date(id)),
  });
  const search = defineTool({
    name: "search",
    description: `Find the original messages that contain text (plain text, any case), newest first, ${SEARCH_PAGE} at a time; before: id continues with older ones. zoom(id, 1) gives a hit whole.`,
    parameters: Type.Object({ intent, text: Type.String({ minLength: 1 }), before: Type.Optional(Type.Integer({ minimum: 0 })) }),
    replay: "safe",
    execute: async ({ text, before }) => say(await memory.search(text, before)),
  });
  return [zoom, date, search];
}
