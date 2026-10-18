import { Fragment, useState } from "react";
import { MATCH_CLOSE, MATCH_OPEN, type SearchHit } from "@/shared";

/** Renders an FTS5 snippet with its matches highlighted. */
function Snippet({ text }: { text: string }) {
  return (
    <>
      {text.split(MATCH_OPEN).map((chunk, i) => {
        const [match, rest] = i === 0 ? ["", chunk] : chunk.split(MATCH_CLOSE);
        return (
          <Fragment key={i}>
            {match && <mark className="bg-yellow-200/70 text-foreground rounded-[2px] dark:bg-yellow-500/30">{match}</mark>}
            {rest}
          </Fragment>
        );
      })}
    </>
  );
}

/** A chat's search hits under its title: static text (the title row opens the chat at the best hit), the best one
 * first and the rest behind a "+N more" toggle. */
export function ChatHits({ hits }: { hits: SearchHit[] }) {
  const [open, setOpen] = useState(false);
  if (hits.length === 0) return null;
  const shown = open ? hits : hits.slice(0, 1);
  return (
    <div className="ml-2 grid gap-1 border-l px-2 pb-1">
      {shown.map((h) => (
        <p key={h.entryId} className="text-muted-foreground line-clamp-2 text-xs">
          <Snippet text={h.snippet} />
        </p>
      ))}
      {hits.length > 1 && (
        <button type="button" className="text-muted-foreground hover:text-foreground w-fit text-[11px] transition-colors duration-150" onClick={() => setOpen(!open)}>
          {open ? "Show less" : `+${hits.length - 1} more`}
        </button>
      )}
    </div>
  );
}
