// Web research tools for every agent of a bot: search through the local SearXNG (alchemy.run.ts) and fetch a page as
// readable text. SearXNG only returns links and snippets, so opening a result is web_fetch.
import { intent } from "./intent.ts";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";

const say = (text: string) => ({ output: [{ type: "text" as const, text }] });
/** Characters of a page per web_fetch call; longer pages are read in pages via `offset`. */
const PAGE = 20_000;
const SKIP = "script, style, noscript, svg, iframe, template, nav, footer, form, button";
const BLOCK = "p, div, section, article, main, br, li, tr, h1, h2, h3, h4, h5, h6, pre, blockquote, table, ul, ol, dd, dt";

// HTMLRewriter's text chunks are the raw source, entities still encoded ("Limits &amp; pricing").
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (raw, e: string) => (e[0] !== "#" ? (NAMED[e.toLowerCase()] ?? raw) : String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)))));

/** A page as plain text (block elements on their own lines, headings marked) plus its numbered links, via HTMLRewriter. */
async function readable(response: Response): Promise<string> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("html")) return (await response.text()).trim();
  let text = "";
  let title = "";
  let skipping = 0;
  const links: string[] = [];
  const base = response.url;
  await new HTMLRewriter()
    .on("title", { text: (t) => void (title += t.text) })
    .on(SKIP, { element: (e) => (skipping++, e.onEndTag(() => void skipping--)) })
    .on(BLOCK, { element: (e) => void (text += e.tagName.startsWith("h") && e.tagName.length === 2 ? `\n\n${"#".repeat(Number(e.tagName[1]))} ` : "\n") })
    .on("a[href]", {
      element: (e) => {
        if (skipping) return;
        const href = e.getAttribute("href")!;
        if (!/^https?:|^\//.test(href)) return;
        links.push(new URL(href, base).href);
        e.onEndTag(() => void (text += ` [${links.length}]`));
      },
    })
    .on("body *", { text: (t) => void (skipping || (text += t.text)) })
    .transform(response)
    .arrayBuffer();
  const body = decode(text).replace(/[ \t\f\v]+/g, " ").replace(/ *\n[\n ]*/g, (m) => (m.split("\n").length > 2 ? "\n\n" : "\n")).trim();
  return `# ${decode(title).trim()}\n\n${body}${links.length ? `\n\nLinks:\n${links.map((l, i) => `[${i + 1}] ${l}`).join("\n")}` : ""}`;
}

export function webExtension(searxngUrl: string) {
  return defineExtension({
    name: "web",
    tools: [
      defineTool({
        name: "web_search",
        description: "Search the web (SearXNG). Returns numbered results with title, url and snippet; open one with web_fetch.",
        parameters: Type.Object({ intent, query: Type.String(), page: Type.Optional(Type.Integer({ minimum: 1, description: "Result page, from 1" })) }),
        replay: "safe",
        execute: async ({ query, page }) => {
          const url = `${searxngUrl}/search?${new URLSearchParams({ q: query, format: "json", pageno: String(page ?? 1) })}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`SearXNG ${res.status}: ${await res.text()}`);
          const { results } = (await res.json()) as { results: { title: string; url: string; content?: string; publishedDate?: string }[] };
          if (!results.length) return say(`No results for "${query}".`);
          return say(results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.publishedDate ? ` (${r.publishedDate.slice(0, 10)})` : ""}\n   ${r.content ?? ""}`).join("\n"));
        },
      }),
      defineTool({
        name: "web_fetch",
        description: `Open a web page as readable text with its links numbered at the end. Long pages come ${PAGE} characters at a time: pass offset to read on.`,
        parameters: Type.Object({ intent, url: Type.String(), offset: Type.Optional(Type.Integer({ minimum: 0 })) }),
        replay: "safe",
        execute: async ({ url, offset = 0 }) => {
          if (!/^https?:\/\//.test(url)) return { ...say("Only http(s) URLs."), isError: true };
          const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (pi-durable research bot)", accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" }, redirect: "follow" });
          if (!res.ok) return { ...say(`${res.status} ${res.statusText} for ${url}`), isError: true };
          const text = await readable(res);
          const page = text.slice(offset, offset + PAGE);
          const more = offset + PAGE < text.length ? `\n\n[characters ${offset}-${offset + page.length} of ${text.length}; next page: offset ${offset + PAGE}]` : "";
          return say(`${res.url}\n\n${page}${more}`);
        },
      }),
    ],
  });
}
