import { SearchIcon, SearchX } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { BotAvatar } from "@/components/bot-avatar";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
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
            {match && <mark className="bg-highlight text-foreground rounded-[2px]">{match}</mark>}
            {rest}
          </Fragment>
        );
      })}
    </>
  );
}

/** bm25 search over every bot's conversation; a hit opens that bot at the message. */
export function SearchPanel({ bots, onOpen }: { bots: BotSummary[]; onOpen: (hit: SearchHit) => void }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    if (!query.trim()) return setHits([]);
    const t = setTimeout(async () => setHits(await searchMessages({ data: query })), 150);
    return () => clearTimeout(t);
  }, [query]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <InputGroup>
        <InputGroupInput autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all bots" aria-label="Search all bots" />
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
      </InputGroup>
      {query.trim() && hits.length === 0 && (
        <Empty className="p-4 md:p-4">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>No matches</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      <ul className="-mx-2 flex min-h-0 flex-col gap-1 overflow-y-auto overscroll-contain">
        {hits.map((h) => {
          const bot = bots.find((b) => b.id === h.botId);
          return (
            <li key={`${h.botId}:${h.entryId}`}>
              <button className="hover:bg-accent flex w-full gap-2 rounded-md p-2 text-left transition-colors" onClick={() => onOpen(h)}>
                {bot && <BotAvatar bot={bot} size="sm" className="mt-0.5" />}
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-xs font-medium">{h.name}</span>
                  <span className="text-muted-foreground line-clamp-3 text-xs">
                    <Snippet text={h.snippet} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
