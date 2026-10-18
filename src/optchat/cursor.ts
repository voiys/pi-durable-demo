// Which of a chat's entries go into the user's memory, decided once, in the User DO (fix plan G3). Entry ids are
// pi-durable's monotonic ids, so the cursor survives a context reset that shrinks the visible transcript. An answer is
// logged from the generation hook before pi commits it (G2); `answerTs` remembers it so its committed entry is skipped.
import type { LogRow } from "./extension.ts";

export type LogItem = { entryId: number; role: string; ts: number; rows: LogRow[] };
export type Answer = { ts: number; rows: LogRow[] };
export type LogCursor = { entry: number; answerTs: number | null };

export function planLog(cursor: LogCursor, items: LogItem[], answer?: Answer): { rows: LogRow[]; cursor: LogCursor } {
  const fresh = items.filter((i) => i.entryId > cursor.entry);
  fresh.forEach((item, k) => {
    if (k > 0 && item.entryId <= fresh[k - 1].entryId) throw new Error(`log items out of order: ${fresh[k - 1].entryId} then ${item.entryId}`);
  });
  const rows: LogRow[] = [];
  let answerTs = cursor.answerTs;
  for (const item of fresh) {
    if (item.role === "assistant" && answerTs !== null && item.ts === answerTs) {
      answerTs = null; // already logged from the hook
      continue;
    }
    rows.push(...item.rows);
  }
  if (answer && !fresh.some((i) => i.role === "assistant" && i.ts === answer.ts) && answerTs !== answer.ts) {
    rows.push(...answer.rows);
    answerTs = answer.ts;
  }
  return { rows, cursor: { entry: fresh.at(-1)?.entryId ?? cursor.entry, answerTs } };
}
