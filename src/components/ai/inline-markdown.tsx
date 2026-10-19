import { Fragment, type ReactNode } from "react";
import { MATCH_CLOSE, MATCH_OPEN } from "@/shared";

const TOKEN = /(\*\*|\*|`|\u0002|\u0003)/;
const BLOCK = /^[ \t]*(?:#{1,6}[ \t]+|[-*+][ \t]+|\d+\.[ \t]+|>[ \t]*|\|?[ \t]*:?-{3,}[-:| \t]*$)/gm;

/** Markdown as one run of inline text, for an excerpt that is clamped to a line or two (a search hit, a quote): bold,
 * italic and code kept; links as their label; headings, lists, quotes flattened, a table's rows as "cell · cell". A
 * search snippet's matches (MATCH_OPEN/CLOSE) are highlighted. An excerpt cuts the text anywhere, so a delimiter opens
 * only if a partner follows it: unpaired ones are dropped, which is simpler than guessing what the cut-off half was. */
export function InlineMarkdown({ text }: { text: string }) {
  const tokens = text
    .replace(/\[([^\]]*)\]\([^)]*(?:\)|$)/g, "$1") // a link the excerpt cut mid-url ends the text: keep its label
    .replace(BLOCK, "")
    .replace(/^\|(.*?)\|?[ \t]*$/gm, (_, row: string) => row.split("|").map((cell) => cell.trim()).filter(Boolean).join(" · "))
    .replace(/\s*\n\s*/g, " ")
    .split(TOKEN);
  const on: Record<string, boolean> = {};
  return tokens.map((t, i) => {
    if (i % 2 === 0 || (on["`"] && t !== "`" && t !== MATCH_OPEN && t !== MATCH_CLOSE)) {
      // Text, or a `*` inside code, which is literal.
      let node: ReactNode = t;
      if (on["`"]) node = <code className="rounded-sm bg-current/10 px-1 py-0.5 font-mono text-[0.86em]">{node}</code>;
      if (on["*"]) node = <em>{node}</em>;
      if (on["**"]) node = <strong className="font-semibold">{node}</strong>;
      if (on[MATCH_OPEN]) node = <mark className="bg-highlight text-foreground rounded-sm">{node}</mark>;
      return t && <Fragment key={i}>{node}</Fragment>;
    }
    // Marks always toggle; a markdown delimiter only opens if the same one follows.
    on[t === MATCH_CLOSE ? MATCH_OPEN : t] = t === MATCH_CLOSE ? false : !on[t] && (t === MATCH_OPEN || tokens.includes(t, i + 1));
    return null;
  });
}
