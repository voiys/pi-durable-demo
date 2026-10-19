// Replies and quotes (Grok Bot / iMessage): Reply on a message, or "Quote" on text selected inside a bubble, puts a quote
// chip above the composer. Sent quotes are markdown blockquote lines at the start of your message (replyText in
// src/shared.ts), each opening with "<sender> said:"; in a group, Reply instead passes the room message's id (`replyTo`)
// and the Group DO quotes it for the bots.
import { X } from "lucide-react";
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { parseReply, replyText } from "@/shared";

/** What a chip quotes: who said it and their words. `replyTo` is a group message's id (groups only). */
export type Quote = { sender: string; text: string; replyTo?: string };

/** Longer messages are quoted by their opening; the bot has the rest in its context. */
const MAX = 280;
const excerpt = (text: string) => (text.length > MAX ? `${text.slice(0, MAX - 1).trimEnd()}…` : text);

const QuoteContext = createContext<{ quotes: Quote[]; add: (q: Quote) => void; remove: (q: Quote) => void; clear: () => void; input: React.RefObject<HTMLTextAreaElement | null> } | null>(null);

export function useQuotes() {
  const ctx = use(QuoteContext);
  if (!ctx) throw new Error("useQuotes outside a QuoteProvider");
  return ctx;
}

/** One pane's quotes, shared by its thread (Reply, Quote) and its composer (the chips). */
export function QuoteProvider({ children }: { children: ReactNode }) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const add = (q: Quote) => {
    const quote = { ...q, text: excerpt(q.text.trim()) };
    // One reply target at a time (a group message reaches one bot); a quote already there isn't added twice.
    setQuotes((qs) => [...qs.filter((x) => !(quote.replyTo && x.replyTo) && !(x.sender === quote.sender && x.text === quote.text)), quote]);
    input.current!.focus();
  };
  return (
    <QuoteContext value={{ quotes, add, remove: (q) => setQuotes((qs) => qs.filter((x) => x !== q)), clear: () => setQuotes([]), input }}>
      {children}
      <SelectionQuote onQuote={add} />
    </QuoteContext>
  );
}

/** Your text with the chips' quotes before it ("Scout said:" over each quote's lines), and the reply target if any. */
export function compose(quotes: Quote[], text: string) {
  const quoted = quotes.filter((q) => !q.replyTo);
  return {
    text: quoted.length ? replyText(quoted.map((q) => `${q.sender} said:\n${q.text}`).join("\n\n"), text) : text,
    replyTo: quotes.find((q) => q.replyTo)?.replyTo,
  };
}

/** Splits your message back into its quotes and your words. A quote typed by hand has no sender. */
export function parseQuotes(text: string): { quotes: { sender?: string; text: string }[]; body: string } {
  const reply = parseReply(text);
  if (!reply) return { quotes: [], body: text };
  const quotes: { sender?: string; text: string }[] = [];
  for (const line of reply.quoted.split("\n")) {
    const said = /^(.+) said:$/.exec(line);
    if (said) quotes.push({ sender: said[1], text: "" });
    else if (!quotes.length) quotes.push({ text: line });
    else quotes.at(-1)!.text += `${quotes.at(-1)!.text ? "\n" : ""}${line}`;
  }
  return { quotes: quotes.map((q) => ({ ...q, text: q.text.trim() })), body: reply.reply };
}

/** A quote at the top of a bubble: a rule, the sender, two lines of their words. Ink stays the bubble's own (white on
 * blue keeps 4.7:1); size and the rule make it secondary. */
export function QuoteBlock({ sender, text }: { sender?: string; text: string }) {
  return (
    <span className="mb-1.5 block border-l-2 border-current/50 pl-2 text-sm whitespace-normal">
      {sender && <span className="block text-xs font-medium">{sender}</span>}
      <span className="line-clamp-2">{text}</span>
    </span>
  );
}

/** The chips over the composer: who, one line of what, and × to drop it. */
/** Markdown as one line of plain words, for an excerpt. */
const plain = (text: string) => text.replace(/```[\s\S]*?```/g, " ").replace(/[*_`~#>|]+/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();

/** What you're replying to, as the composer's top rows (Grok Bot): who, a one-line excerpt in quotes, and Cancel reply. */
export function QuoteChips() {
  const { quotes, remove } = useQuotes();
  if (!quotes.length) return null;
  return (
    <ul aria-label="Replying to" className="flex w-full flex-col">
      {quotes.map((q) => (
        <li key={`${q.sender}:${q.text}`} className="animate-in fade-in flex h-7 min-w-0 items-center gap-1.5 text-sm duration-150">
          <span className="shrink-0 font-medium">{q.sender}</span>
          <span className="text-muted-foreground min-w-0 flex-1 truncate">“{plain(q.text)}”</span>
          <button
            type="button"
            aria-label={`Cancel reply to ${q.sender}`}
            onClick={() => remove(q)}
            className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline-2"
          >
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Replyable({ quote, mine, children }: { quote: Quote; mine: boolean; children: ReactNode }) {
  const { add } = useQuotes();
  const [shown, setShown] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const press = useRef<ReturnType<typeof setTimeout>>(undefined);
  const release = () => clearTimeout(press.current);
  useEffect(() => {
    if (!shown) return;
    const hide = (e: PointerEvent) => !row.current!.contains(e.target as Node) && setShown(false);
    document.addEventListener("pointerdown", hide);
    return () => document.removeEventListener("pointerdown", hide);
  }, [shown]);
  return (
    <div
      ref={row}
      data-quote-sender={quote.sender}
      data-shown={shown || undefined}
      className={cn("group/said flex w-full min-w-0 items-center gap-2", mine && "flex-row-reverse")}
      onPointerDown={(e) => e.pointerType === "touch" && (press.current = setTimeout(() => setShown(true), 450))}
      onPointerUp={release}
      onPointerMove={release}
      onPointerCancel={release}
    >
      {children}
      <button
        type="button"
        onClick={() => (add(quote), setShown(false))}
        className="text-muted-foreground hover:text-foreground min-h-6 shrink-0 rounded-sm px-1 text-xs font-medium opacity-0 transition-opacity duration-150 group-hover/said:opacity-100 group-data-shown/said:opacity-100 focus-visible:opacity-100 focus-visible:outline-2"
      >
        Reply<span className="sr-only"> to {quote.sender}</span>
      </button>
    </div>
  );
}

/** Text selected inside one bubble gets a small "Quote" button over it; it hides when the selection goes or the thread
 * scrolls. Portaled, since the thread's rows are transformed while they animate. */
function SelectionQuote({ onQuote }: { onQuote: (q: Quote) => void }) {
  const [at, setAt] = useState<{ x: number; y: number; quote: Quote }>();
  useEffect(() => {
    const read = () => {
      const sel = getSelection();
      const text = sel?.toString().trim();
      const bubble = (n: Node | null | undefined) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[data-quote-sender]");
      const from = bubble(sel?.anchorNode);
      if (!sel || !text || !from || from !== bubble(sel.focusNode)) return setAt(undefined);
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setAt({ x: rect.left + rect.width / 2, y: rect.top, quote: { sender: from.dataset.quoteSender!, text } });
    };
    const clear = () => setAt(undefined);
    const collapsed = () => getSelection()?.isCollapsed && clear();
    document.addEventListener("pointerup", read);
    document.addEventListener("keyup", read);
    document.addEventListener("selectionchange", collapsed);
    addEventListener("scroll", clear, true);
    return () => {
      document.removeEventListener("pointerup", read);
      document.removeEventListener("keyup", read);
      document.removeEventListener("selectionchange", collapsed);
      removeEventListener("scroll", clear, true);
    };
  }, []);
  if (!at) return null;
  return createPortal(
    <button
      type="button"
      style={{ left: at.x, top: at.y }}
      // Keep the selection while the button is pressed.
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => (onQuote(at.quote), getSelection()!.removeAllRanges(), setAt(undefined))}
      className="bg-popover text-popover-foreground shadow-float hover:bg-muted animate-in fade-in motion-safe:zoom-in-96 motion-safe:slide-in-from-bottom-1 fixed z-50 h-7 -translate-x-1/2 -translate-y-[calc(100%+6px)] rounded-md px-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-2"
    >
      Quote<span className="sr-only"> {at.quote.sender}</span>
    </button>,
    document.body,
  );
}
