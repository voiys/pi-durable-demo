import { Fragment } from "react";
import { MATCH_CLOSE, MATCH_OPEN } from "@/shared";

/** Renders an FTS5 snippet with its matches highlighted. */
export function Snippet({ text }: { text: string }) {
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
