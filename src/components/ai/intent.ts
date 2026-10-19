// Wording for how a bot's work reads in the thread (DESIGN.md §6 "Intent and outcome", §8 Words): intents turn past
// tense once done, outcomes are short clauses after an en dash, lists are prose.

/** A URL as its host ("developers.cloudflare.com"); text that isn't a URL as written. */
export const host = (url: string) => (URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, "") : url);

/** "1 source", "3 sources". */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a, b, and c". */
export const prose = (items: string[]) => new Intl.ListFormat("en", { type: "conjunction" }).format(items);

/** Lowercases an opening plain word ("Sent to Scout" → "sent to Scout"), never a name or acronym ("SearXNG", "I"). */
export const lower = (s: string) => (/^[A-Z][a-z']+\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** A tool's own short sentence or an error's first sentence, as a clause: no "Error:"/"D1_ERROR:" prefix or SQLite code,
 * URLs as hosts, no final period, at most 140 characters ("didn't work: 404 Not Found for example.com"). */
export function clause(text: string) {
  const first = text.trim().replace(/^\w*error:\s*/i, "").split(/\n|(?<=[.!?])\s/)[0].replace(/https?:\/\/\S+/g, host).replace(/:\s*SQLITE_\w+$|\.$/, "");
  return lower(first.length > 140 ? `${first.slice(0, 139).trimEnd()}…` : first);
}

const IRREGULAR: Record<string, string> = {
  becoming: "became", beginning: "began", breaking: "broke", bringing: "brought", building: "built", buying: "bought",
  catching: "caught", choosing: "chose", coming: "came", cutting: "cut", digging: "dug", doing: "did", drawing: "drew",
  feeding: "fed", finding: "found", forgetting: "forgot", getting: "got", giving: "gave", going: "went", having: "had",
  hearing: "heard", holding: "held", keeping: "kept", laying: "laid", leaving: "left", letting: "let", making: "made",
  meeting: "met", paying: "paid", putting: "put", reading: "read", rereading: "reread", rerunning: "reran",
  rewriting: "rewrote", running: "ran", saying: "said", seeing: "saw", seeking: "sought", sending: "sent", setting: "set",
  shutting: "shut", sitting: "sat", spinning: "spun", splitting: "split", spreading: "spread", standing: "stood",
  sweeping: "swept", taking: "took", teaching: "taught", telling: "told", thinking: "thought", understanding: "understood",
  winning: "won", writing: "wrote",
};

/** The intent's opening -ing verb in the past tense ("Checking the limits page" → "Checked the limits page",
 * "Double-checking" → "Double-checked", "Verifying" → "Verified"). An intent that opens otherwise stays as written. */
export const past = (intent: string) =>
  intent.replace(/^((?:\w+-)?)([A-Za-z]{3,})ing\b/, (_, pre: string, stem: string) => {
    const done = IRREGULAR[`${stem}ing`.toLowerCase()] ?? (/[^aeiou]y$/i.test(stem) ? `${stem.slice(0, -1)}ied` : `${stem}ed`);
    return pre + (stem[0] === stem[0].toUpperCase() ? done[0].toUpperCase() : done[0]) + done.slice(1);
  });
