// Replies and quotes (Grok Bot / iMessage): Reply on a message, "Quote" on text selected inside a bubble, or ⌘L (Ctrl+L)
// puts a quote pill inline in the composer, before your words. Sent quotes are markdown blockquote lines at the start of
// your message (replyText in src/shared.ts), each opening with "<sender> said:"; in a group, Reply instead passes the
// room message's id (`replyTo`) and the Group DO quotes it for the bots.
import { X } from "lucide-react";
import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { parseReply, replyText } from "@/shared";

/** What a chip quotes: who said it and their words. `replyTo` is a group message's id (groups only). */
export type Quote = { sender: string; text: string; replyTo?: string };

/** Text cut to `max` characters with an ellipsis. Longer messages are quoted by their opening (280); the bot has the rest
 * in its context. */
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** ⌘ on Apple keyboards, Ctrl elsewhere (read on the client only). */
const mac = () => /Mac|iPhone|iPad/.test(navigator.userAgent);

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
    const quote = { ...q, text: clip(q.text.trim(), 280) };
    // One reply target at a time (a group message reaches one bot); a quote already there isn't added twice.
    setQuotes((qs) => [...qs.filter((x) => !(quote.replyTo && x.replyTo) && !(x.sender === quote.sender && x.text === quote.text)), quote]);
    input.current!.focus();
  };
  return (
    <QuoteContext value={{ quotes, add, remove: (q) => setQuotes((qs) => qs.filter((x) => x !== q)), clear: () => setQuotes([]), input }}>
      {children}
      <SelectionQuote onQuote={add} onFocus={() => input.current!.focus()} />
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

/** Markdown as one line of plain words, for an excerpt. */
const plain = (text: string) => text.replace(/```[\s\S]*?```/g, " ").replace(/[*_`~#>|]+/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();

/** What you're replying to, as pills inline before your words (Grok Bot): who, a short excerpt in quotes (the whole of it
 * on hover), and × to drop it. `display: contents` lets the pills flow and wrap with the draft; role="list" keeps the
 * list semantics Safari drops with it. On the gray fill the excerpt keeps full ink (muted gray is 4.15:1 there). */
export function QuoteChips() {
  const { quotes, remove } = useQuotes();
  // No empty "Replying to" list for screen readers to land on.
  if (!quotes.length) return null;
  return (
    <ul role="list" aria-label="Replying to" className="contents">
      {quotes.map((q) => (
        <li
          key={`${q.sender}:${q.text}`}
          title={plain(q.text)}
          className="bg-muted animate-in fade-in flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full pl-2.5 text-sm duration-150"
        >
          <span className="shrink-0 font-medium">{q.sender}</span>
          <span className="truncate">“{clip(plain(q.text), 24)}”</span>
          <button
            type="button"
            aria-label={`Remove quote from ${q.sender}`}
            onClick={() => remove(q)}
            className="text-muted-foreground hover:text-foreground hover:bg-accent flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2"
          >
            <X className="size-3" />
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

/** Text selected inside one bubble, as a quote and where it sits on screen; none when the selection is elsewhere. */
function selected() {
  const sel = getSelection();
  const text = sel?.toString().trim();
  const bubble = (n: Node | null | undefined) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[data-quote-sender]");
  const from = bubble(sel?.anchorNode);
  if (!sel || !text || !from || from !== bubble(sel.focusNode)) return undefined;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top, quote: { sender: from.dataset.quoteSender!, text } };
}

/** Text selected inside one bubble gets a small "Quote ⌘L" button over it; it hides when the selection goes or the thread
 * scrolls. ⌘L (Ctrl+L) quotes the selection too, or with nothing selected just moves to the composer; it overrides the
 * browser's address bar shortcut. Portaled, since the thread's rows are transformed while they animate. The button stays
 * opaque on hover (popover → muted, both solid), and its hint turns to ink there to keep contrast. */
function SelectionQuote({ onQuote, onFocus }: { onQuote: (q: Quote) => void; onFocus: () => void }) {
  const [at, setAt] = useState<ReturnType<typeof selected>>();
  const quote = (q: Quote) => (onQuote(q), getSelection()!.removeAllRanges(), setAt(undefined));
  useEffect(() => {
    const read = () => setAt(selected());
    const clear = () => setAt(undefined);
    const collapsed = () => getSelection()?.isCollapsed && clear();
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "l" || !(mac() ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return;
      e.preventDefault();
      const q = selected()?.quote;
      if (q) quote(q);
      else onFocus();
    };
    document.addEventListener("pointerup", read);
    document.addEventListener("keyup", read);
    document.addEventListener("keydown", key);
    document.addEventListener("selectionchange", collapsed);
    addEventListener("scroll", clear, true);
    return () => {
      document.removeEventListener("pointerup", read);
      document.removeEventListener("keyup", read);
      document.removeEventListener("keydown", key);
      document.removeEventListener("selectionchange", collapsed);
      removeEventListener("scroll", clear, true);
    };
    // The handlers only reach setters and refs, so the first render's are good for the pane's life.
  }, []);
  if (!at) return null;
  return createPortal(
    <button
      type="button"
      style={{ left: at.x, top: at.y }}
      aria-keyshortcuts={mac() ? "Meta+L" : "Control+L"}
      // Keep the selection while the button is pressed.
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => quote(at.quote)}
      className="group/quote bg-popover text-popover-foreground shadow-float hover:bg-muted animate-in fade-in motion-safe:zoom-in-96 motion-safe:slide-in-from-bottom-1 fixed z-50 flex h-7 -translate-x-1/2 -translate-y-[calc(100%+6px)] items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-2"
    >
      Quote<span className="sr-only"> {at.quote.sender}</span>
      <kbd aria-hidden className="text-muted-foreground group-hover/quote:text-foreground font-sans text-xs transition-colors duration-150">
        {mac() ? "⌘L" : "Ctrl L"}
      </kbd>
    </button>,
    document.body,
  );
}
