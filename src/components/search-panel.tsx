import { Fragment, useEffect, useState } from "react";
import { BotAvatar } from "@/components/bot-avatar";
import { Input } from "@/components/ui/input";
import { fail } from "@/lib/utils";
import { searchMessages } from "@/server/fns";
import { MATCH_CLOSE, MATCH_OPEN, type BotSummary, type SearchHit } from "@/shared";

/** Renders an FTS5 snippet with its matches highlighted. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split(MATCH_OPEN).map((chunk, i) => {
        const [match, rest] = i === 0 ? ["", chunk] : chunk.split(MATCH_CLOSE);
        return (
          <Fragment key={i}>
            {match && <mark className="bg-highlight text-foreground rounded-sm">{match}</mark>}
            {rest}
          </Fragment>
        );
      })}
    </>
  );
}

/** bm25 search over every bot's conversation; a hit opens that bot at the message. `hits` is undefined while a search
 * for the current query is on its way, so the panel says "Searching…" instead of a stale or empty answer. */
export function SearchPanel({ bots, onOpen }: { bots: BotSummary[]; onOpen: (hit: SearchHit) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | "failed" | undefined>([]);
  const q = query.trim();
  useEffect(() => {
    if (!q) return setHits([]);
    setHits(undefined);
    let current = true;
    const t = setTimeout(() => searchMessages({ data: q }).then((h) => current && setHits(h), (e: Error) => current && (setHits("failed"), fail("search")(e))), 150);
    return () => ((current = false), clearTimeout(t));
  }, [q]);
  const status = !q ? "Finds words in every bot's conversation, best match first." : hits === undefined ? "Searching…" : hits === "failed" ? "Couldn't search just now. Edit the words to try again." : hits.length === 0 ? `Nothing matches “${q}”.` : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
      <Input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all bots" aria-label="Search all bots" className="bg-surface dark:bg-surface shadow-none" />
      <p role="status" className={status ? "text-muted-foreground px-1 text-sm" : "sr-only"}>
        {status ?? `${hits!.length} ${hits!.length === 1 ? "match" : "matches"}`}
      </p>
      {Array.isArray(hits) && hits.length > 0 && (
        <ul className="-mx-2 flex min-h-0 flex-col gap-px overflow-y-auto overscroll-contain">
          {hits.map((h) => {
            const bot = bots.find((b) => b.id === h.botId);
            return (
              <li key={`${h.botId}:${h.entryId}`}>
                <button className="hover:bg-sidebar-accent focus-visible:ring-ring flex w-full gap-2.5 rounded-md p-2 text-left transition-colors duration-150 outline-none focus-visible:ring-2" onClick={() => onOpen(h)}>
                  {bot && <BotAvatar bot={bot} size="sm" className="mt-px" />}
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">
                      {h.name}
                      <span className="text-muted-foreground font-normal">{h.role === "user" ? " · you wrote" : ""}</span>
                    </span>
                    <span className="text-muted-foreground line-clamp-3 text-sm break-words">
                      <Snippet text={h.snippet} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
