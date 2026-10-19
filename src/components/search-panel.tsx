import { Link } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";
import { InlineMarkdown } from "@/components/ai/inline-markdown";
import { BotAvatar } from "@/components/bot-avatar";
import { Input } from "@/components/ui/input";
import { CAPTION, CARD, LINE, PanelBody, TAP } from "@/components/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, fail } from "@/lib/utils";
import { searchMessages } from "@/server/fns";
import type { BotSummary, SearchHit } from "@/shared";

/** The shape of a few hits while a search runs: a face, a name, two lines of snippet, on the results' card. */
function HitsSkeleton() {
  return (
    <div aria-hidden className={CARD}>
      {["w-4/5", "w-3/5", "w-2/3"].map((w) => (
        <div key={w} className={cn(LINE, "not-first:before:left-11 flex gap-3 px-3 py-2.5")}>
          <Skeleton className="size-5 shrink-0 rounded-md" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
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
 * for the current query is on its way, so the panel shows the shape of results instead of a stale or empty answer.
 * The field stays put; the answer scrolls under it: a caption (what it found, or why nothing), then the hits' card. */
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-1 pb-3">
        <Input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all bots" aria-label="Search all bots" className="bg-surface px-3" />
      </div>
      <PanelBody className="gap-1.5 pt-0">
        {/* One polite region, always mounted, so every change of answer is announced: a sentence when there's nothing to
            list, the count as the results' caption when there is. */}
        <p role="status" className={cn("px-3", status ? "text-muted-foreground text-sm text-pretty" : CAPTION)}>
          {status ?? (hits === undefined ? "Searching…" : `${hits.length} ${hits.length === 1 ? "match" : "matches"}`)}
        </p>
        {hits === undefined && <HitsSkeleton />}
        {/* Mounts with each answer, so the hits fade in (150ms) where the skeleton was. */}
        {Array.isArray(hits) && hits.length > 0 && (
          <ul className={cn(CARD, "animate-in fade-in shrink-0 duration-150 ease-out")}>
            {hits.map((h) => {
              const bot = bots.find((b) => b.id === h.botId);
              return (
                <li key={`${h.botId}:${h.entryId}`} className={cn(LINE, "not-first:before:left-11")}>
                  <Link to="/" search={{ bot: h.botId, entry: h.entryId, panel: "search" }} className={cn(TAP, "flex items-start gap-3 px-3 py-2.5 text-sm")}>
                    {bot && <BotAvatar look={bot.look} size={20} className="mt-px" />}
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-medium break-words">
                        {h.name}
                        {h.role === "user" && <span className="text-muted-foreground font-normal"> · you wrote</span>}
                      </span>
                      <span className="text-muted-foreground line-clamp-3 break-words">
                        <InlineMarkdown text={h.snippet} />
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </PanelBody>
    </div>
  );
}
