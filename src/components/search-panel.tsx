import { Link } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";
import { BotAvatar } from "@/components/bot-avatar";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, fail } from "@/lib/utils";
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

/** The shape of a few hits while a search runs: a face, a name, two lines of snippet. */
function HitsSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4 px-1 pt-1">
      {["w-4/5", "w-3/5", "w-2/3"].map((w) => (
        <div key={w} className="flex gap-2.5">
          <Skeleton className="size-5 shrink-0 rounded-md" />
          <div className="flex flex-1 flex-col gap-2 pt-0.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className={cn("h-3", w)} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** bm25 search over every bot's conversation; a hit opens that bot at the message. `hits` is undefined while a search
 * for the current query is on its way, so the panel shows the shape of results instead of a stale or empty answer. */
export function SearchPanel({ bots }: { bots: BotSummary[] }) {
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
  const status = !q ? "Finds words in every bot's conversation, best match first." : hits === "failed" ? "Couldn't search just now. Edit the words to try again." : hits?.length === 0 ? `Nothing matches “${q}”.` : null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
      <Input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all bots" aria-label="Search all bots" className="bg-surface" />
      {/* One polite region, always mounted, so every change of answer is announced. */}
      <p role="status" className={status ? "text-muted-foreground px-1 text-sm" : "sr-only"}>
        {status ?? (hits === undefined ? "Searching…" : `${hits.length} ${hits.length === 1 ? "match" : "matches"}`)}
      </p>
      {hits === undefined && <HitsSkeleton />}
      {/* Mounts with each answer, so the hits fade in (150ms) where the skeleton was. */}
      {Array.isArray(hits) && hits.length > 0 && (
        <ItemGroup className="animate-in fade-in -mx-2 min-h-0 gap-px overflow-y-auto overscroll-contain duration-150 ease-out">
          {hits.map((h) => {
            const bot = bots.find((b) => b.id === h.botId);
            return (
              <li key={`${h.botId}:${h.entryId}`}>
                <Item asChild size="sm" className="items-start p-2">
                  <Link to="/" search={{ bot: h.botId, entry: h.entryId, panel: "search" }}>
                    {bot && (
                      <ItemMedia className="pt-px">
                        <BotAvatar bot={bot} size="sm" />
                      </ItemMedia>
                    )}
                    <ItemContent>
                      <ItemTitle>
                        {h.name}
                        {h.role === "user" && <span className="text-muted-foreground font-normal"> · you wrote</span>}
                      </ItemTitle>
                      <ItemDescription className="line-clamp-3">
                        <Snippet text={h.snippet} />
                      </ItemDescription>
                    </ItemContent>
                  </Link>
                </Item>
              </li>
            );
          })}
        </ItemGroup>
      )}
    </div>
  );
}
