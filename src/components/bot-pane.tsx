import { Link } from "@tanstack/react-router";
import { ArrowUp, ChevronLeft, Square } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import { Activity, savedReports, Working, type ToolContext, type ToolResult } from "@/components/ai/activity";
import { agentSender, isEvent, parseAgentMessage, SystemEvent, type AgentMsg, type Sender } from "@/components/ai/agents-message";
import { Markdown } from "@/components/ai/markdown";
import { BotAvatar } from "@/components/bot-avatar";
import { Attachment, AttachmentContent, AttachmentDescription, AttachmentTitle, AttachmentTrigger } from "@/components/ui/attachment";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Message, MessageAvatar, MessageContent, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import { Trace } from "@/components/ui/trace";
import type { PiMessagePart } from "@/pi/transcript";
import { usePiSession } from "@/pi/use-pi-session";
import { toTurns, type PiTurn } from "@/pi/view";
import { CrossFade, FADE, ICON, RISE, SETTLE, SettleEmpty, SLIDE_UP, useCalm } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { compose, parseQuotes, QuoteBlock, QuoteChips, QuoteProvider, Replyable, useQuotes, type Quote } from "@/components/quotes";
import { answerText, botObjectName, parseAnswer, type BotSummary } from "@/shared";

// ---- Shared thread pieces (the group thread is built from the same ones, src/components/group-pane.tsx) ----

/** The header over a thread (Messages' contact header): a small face over the name, which opens the details beside it.
 * `back` leads from a helper's thread to its bot's. */
export function HeaderBar({ face, name, detailsOpen, onToggleDetails, back }: { face: ReactNode; name: string; detailsOpen: boolean; onToggleDetails: () => void; back?: { label: string; onClick: () => void } }) {
  return (
    <header className="relative flex h-12 shrink-0 items-center justify-center px-3">
      {back && (
        <Button variant="ghost" size="sm" className="absolute left-2 px-2" aria-label={`Back to ${back.label}`} onClick={back.onClick}>
          <ChevronLeft />
          <span className="max-w-32 truncate max-sm:hidden">{back.label}</span>
        </Button>
      )}
      <button
        type="button"
        aria-expanded={detailsOpen}
        onClick={onToggleDetails}
        className="hover:bg-accent flex max-w-[50%] min-w-0 flex-col items-center gap-0.5 rounded-lg px-2 py-0.5 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {face}
        <span className="max-w-full truncate text-sm font-medium">
          {name}
          <span className="sr-only">, details</span>
        </span>
      </button>
    </header>
  );
}

/** A speaker's face in the thread: a bot's color, or gray for a helper. */
export function Face({ sender, className }: { sender: Pick<Sender, "name" | "color">; className: string }) {
  return <BotAvatar bot={{ name: sender.name, color: sender.color ?? "var(--muted)" }} className={cn("rounded-full", !sender.color && "text-muted-foreground", className)} />;
}

/** When a gap this long separates two messages, a time divider goes between them (iMessage). */
const GAP = 30 * 60 * 1000;
export const breaksTime = (prev: number | undefined, ts: number) => prev === undefined || ts - prev > GAP;

function dayTime(ts: number) {
  const date = new Date(ts);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86_400_000);
  const day = days === 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? date.toLocaleDateString([], { weekday: "long" }) : date.toLocaleDateString([], { month: "short", day: "numeric", year: days > 300 ? "numeric" : undefined });
  return `${day} ${time}`;
}

const MotionMessageScrollerItem = motion.create(MessageScrollerItem);

/** "Today 12:11", centered caption, no rules; 24px of air on both sides (DESIGN.md §5). It fades in with the message it
 * dates (`enter`). */
export function TimeDivider({ id, ts, enter }: { id: string; ts: number; enter: boolean }) {
  return (
    <MotionMessageScrollerItem messageId={id} className="pt-6 pb-3 first:pt-2" variants={FADE} initial={enter ? "initial" : false} animate="animate">
      <Marker className="justify-center">
        <MarkerContent>{dayTime(ts)}</MarkerContent>
      </Marker>
    </MotionMessageScrollerItem>
  );
}

/** A row's scroller item: 12px above a new speaker, 2px inside one speaker's run (DESIGN.md §5). Messages that arrive
 * while the thread is open animate in, yours sliding up, everyone else's fading (§7); history never does. */
export function ThreadItem({ id, first, enter, mine, anchor = false, children }: { id: string; first: boolean; enter: boolean; mine: boolean; anchor?: boolean; children: ReactNode }) {
  const variants = useCalm(mine ? SLIDE_UP : FADE);
  return (
    <MotionMessageScrollerItem messageId={id} scrollAnchor={anchor} className={first ? "pt-3" : "pt-0.5"} variants={variants} initial={enter ? "initial" : false} animate="animate">
      {children}
    </MotionMessageScrollerItem>
  );
}

/** One row: your words on the right; someone else's on the left. A `sender` gets a face column (the face on the last
 * of their run) and their name over the first; a thread's own bot gets neither, as in a one-to-one chat. */
export function ThreadRow({ mine = false, sender, first, last, highlight = false, children }: { mine?: boolean; sender?: Sender; first: boolean; last: boolean; highlight?: boolean; children: ReactNode }) {
  return (
    // A background, not a ring: MessageScrollerItem's content-visibility clips anything drawn outside it.
    <Message align={mine ? "end" : "start"} className={cn("rounded-xl transition-colors duration-150", highlight && "bg-highlight")}>
      {sender && <MessageAvatar>{last ? <Face sender={sender} className="size-7 text-xs" /> : <span className="size-7" />}</MessageAvatar>}
      <MessageContent>
        {sender && first && (
          <MessageHeader>
            {sender.to ? (
              <Link to="/" search={sender.to} className="hover:text-foreground truncate transition-colors">
                {sender.name}
              </Link>
            ) : (
              <span className="truncate">{sender.name}</span>
            )}
          </MessageHeader>
        )}
        {children}
      </MessageContent>
    </Message>
  );
}

/** Where a bubble sits in its sender's run: the run's outer corners stay round, the corners where its bubbles meet
 * tuck in on the sender's side (DESIGN.md §6). A bubble alone is round all over. */
type Run = { first?: boolean; last?: boolean };
const runCorners = (mine: boolean, { first = true, last = true }: Run) => cn(!first && (mine ? "rounded-tr-sm" : "rounded-tl-sm"), !last && (mine ? "rounded-br-sm" : "rounded-bl-sm"));

/** A bubble (DESIGN.md §6): yours blue, theirs gray, an error red with words. A `reply` bubble offers "Reply" beside it,
 * and its text can be quoted. */
export function Said({ mine = false, run = {}, error = false, reply, children }: { mine?: boolean; run?: Run; error?: boolean; reply?: Quote; children: ReactNode }) {
  const bubble = (
    <Bubble align={mine ? "end" : "start"} variant={error ? "destructive" : mine ? "default" : "muted"} role={error ? "alert" : undefined}>
      <BubbleContent className={cn(mine && "whitespace-pre-wrap", runCorners(mine, run))}>{children}</BubbleContent>
    </Bubble>
  );
  return reply ? (
    <Replyable quote={reply} mine={mine}>
      {bubble}
    </Replyable>
  ) : (
    bubble
  );
}

/** Your message as its bubble: any quotes it opens with as excerpts on top (`replied`: the group message it replies
 * to), then your words; an answer to a bot's question as the option you picked, captioned. `id` is its group message id. */
export function YourSaid({ text, run, replied, id }: { text: string; run: Run; replied?: { sender: string; text: string }; id?: string }) {
  const answer = parseAnswer(text);
  if (answer)
    return (
      <Said mine run={run} reply={{ sender: "You", text: answer.answer, replyTo: id }}>
        {answer.answer}
        <span className="block pt-0.5 text-xs font-medium">Answered</span>
      </Said>
    );
  const { quotes, body } = parseQuotes(text);
  return (
    <Said mine run={run} reply={{ sender: "You", text: body, replyTo: id }}>
      {[...(replied ? [replied] : []), ...quotes].map((q, i) => (
        <QuoteBlock key={i} {...q} />
      ))}
      {body}
    </Said>
  );
}

/** The bot writing its next message: three dots in a gray bubble, breathing in turn (still under reduced motion). The
 * words replace it whole once the block is written. */
function Typing({ run }: { run: Run }) {
  return (
    <Bubble variant="muted" role="status">
      <BubbleContent className={cn("flex h-lh box-content items-center gap-1", runCorners(false, run))}>
        <span className="sr-only">Typing…</span>
        {["", "[animation-delay:150ms]", "[animation-delay:300ms]"].map((delay) => (
          <span key={delay} aria-hidden className={cn("bg-muted-foreground size-2 rounded-full opacity-60 motion-safe:animate-typing", delay)} />
        ))}
      </BubbleContent>
    </Bubble>
  );
}

/** A caption under the last bubble: "Delivered", or the live "Working…" while the work runs; a new word cross-fades over
 * the old in the same line box (right-aligned under your bubble, so neither width shifts it). */
export function Status({ working = false, children }: { working?: boolean; children: string }) {
  return (
    <p data-slot="message-status" className="text-muted-foreground grid w-fit justify-items-end px-1 pt-0.5 text-xs font-medium">
      <CrossFade text={children} className={cn(working && "shimmer motion-reduce:shimmer-none")} />
    </p>
  );
}

/** A left-aligned line saying someone is at work, after a message that isn't yours; it fades in like a reply. */
export function WorkingRow({ label }: { label?: string }) {
  return (
    <MotionMessageScrollerItem messageId="working" className="pt-3" variants={FADE} initial="initial" animate="animate">
      <Trace>
        <Working label={label} />
      </Trace>
    </MotionMessageScrollerItem>
  );
}

const MotionButton = motion.create(Button);

/** A thread with nothing in it yet: the face large, the name, one sentence, and optional first messages to send, which
 * stagger in (an empty state is rare enough for a staged entrance). */
export function ThreadEmpty({ face, title, description, suggestions = [], onPick }: { face: ReactNode; title: string; description: string; suggestions?: string[]; onPick?: (text: string) => void }) {
  const chip = useCalm(SLIDE_UP);
  return (
    <MessageScrollerItem messageId="empty" className="flex flex-1 flex-col">
      <Empty className="gap-5 px-2">
        <EmptyHeader className="gap-1.5">
          <EmptyMedia className="mb-2">{face}</EmptyMedia>
          <EmptyTitle className="max-w-full truncate">{title}</EmptyTitle>
          <EmptyDescription className="line-clamp-3">{description}</EmptyDescription>
        </EmptyHeader>
        {suggestions.length > 0 && (
          <SettleEmpty.Content className="flex-row flex-wrap justify-center gap-2" {...SETTLE}>
            {suggestions.map((s) => (
              <MotionButton key={s} variants={chip} variant="secondary" size="sm" className="h-auto min-h-8 rounded-full px-3.5 py-1.5 font-normal whitespace-normal" onClick={() => onPick!(s)}>
                {s}
              </MotionButton>
            ))}
          </SettleEmpty.Content>
        )}
      </Empty>
    </MessageScrollerItem>
  );
}

/** A thread on its way (the connection opening, nothing on screen yet): a few bubbles' shapes, theirs left and yours
 * right, at the bubble radius. */
export function ThreadSkeleton() {
  return (
    <MessageScrollerItem messageId="loading" role="status" className="flex flex-col gap-3 pt-3">
      <span className="sr-only">Opening the conversation…</span>
      {["self-end w-40", "w-64", "w-48", "self-end w-56"].map((c) => (
        <Skeleton key={c} aria-hidden className={cn("h-10 max-w-[75%] rounded-xl", c)} />
      ))}
    </MessageScrollerItem>
  );
}

/** The scrolling thread on the white canvas, 720px wide at most: follows the live edge and jumps back to it. */
export function Thread({ busy = false, children }: { busy?: boolean; children: ReactNode }) {
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        {/* No bar under the header (user's call): messages just fade as they pass beneath it. */}
        <MessageScrollerViewport className="scroll-fade-t">
          <MessageScrollerContent aria-busy={busy} className="mx-auto w-full max-w-[720px] gap-0 px-3 pt-2 pb-6 sm:px-4">
            {children}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

/** The floating pill composer (DESIGN.md §6, AI Elements prompt-input on InputGroup): a
 * blue send circle on the right that wakes up with text, a stop square while the bot works and nothing is typed. Send
 * and stop are one button, so its fill changes color (150ms) and its icon cross-fades (better-ui icon-transitions).
 * `onStop` is set while there is work to stop. Enter sends (queued behind running work), Shift+Enter is a new line.
 * Quotes sit inline before the draft as pills (Grok Bot); the draft takes the rest of their row, or the next one when
 * under 8rem is left; Backspace in an empty draft drops the last pill. */
export function Composer({ onSend, ready, onStop, placeholder }: { onSend: (text: string, replyTo?: string) => void; ready: boolean; onStop?: () => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const { quotes, remove, clear, input } = useQuotes();
  const typed = draft.trim() !== "";
  const stop = onStop !== undefined && !typed;
  const icon = useCalm(ICON);
  const send = () => {
    if (!typed || !ready) return;
    const { text, replyTo } = compose(quotes, draft);
    onSend(text, replyTo);
    setDraft("");
    clear();
  };
  return (
    <form
      className="mx-auto w-full max-w-[720px] px-3 pt-2 pb-4 sm:px-4"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {/* 22px is the pill at the 44px one-line height; it stays that radius as the draft grows. */}
      <InputGroup className="bg-background shadow-composer h-auto min-h-11 items-end rounded-[22px] border-transparent">
        {/* Clicks on the row's padding land in the draft. A 1px pad makes the draft's line the pills' 24px. */}
        <div className={"flex min-w-0 flex-1 cursor-text flex-wrap items-start gap-1 py-2.5 pr-2.5 pl-4"} onClick={(e) => e.target === e.currentTarget && input.current!.focus()}>
          <QuoteChips />
          <InputGroupTextarea
            ref={input}
            value={draft}
            autoFocus
            rows={1}
            placeholder={placeholder}
            aria-label="Message"
            className="placeholder:text-faint max-h-48 min-h-0 min-w-0 basis-32 px-0 py-px"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && draft === "" && quotes.length) remove(quotes.at(-1)!);
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
        </div>
        <InputGroupAddon align="inline-end" className="py-2 pr-2 has-[>button]:mr-0">
          <InputGroupButton
            type={stop ? "button" : "submit"}
            variant={stop ? "secondary" : "default"}
            size="icon-sm"
            className="disabled:bg-muted disabled:text-faint rounded-full disabled:opacity-100"
            aria-label={stop ? "Stop" : "Send"}
            disabled={!stop && (!ready || !typed)}
            onClick={stop ? onStop : undefined}
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span key={stop ? "stop" : "send"} className="flex" variants={icon} initial="initial" animate="animate" exit="exit">
                {stop ? <Square className="size-2.5 fill-current" /> : <ArrowUp className="size-4" strokeWidth={2.5} />}
              </motion.span>
            </AnimatePresence>
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

// ---- The bot thread ----

type AskCall = Extract<PiMessagePart, { type: "tool-call" }>;

/** Consecutive thinking/tool-call parts form one activity run; each text part is a bubble (`writing` is the one the bot
 * is still writing, shown as typing even before its first word); an `ask` call is a question card. */
function groupParts(parts: readonly PiMessagePart[], writing: PiMessagePart | undefined) {
  const groups: ({ text: string; part: PiMessagePart } | { ask: AskCall } | { run: PiMessagePart[] })[] = [];
  for (const part of parts) {
    const last = groups.at(-1);
    if (part.type === "text") (part.text.trim() || part === writing) && groups.push({ text: part.text, part });
    else if (part.type === "tool-call" && part.name === "ask") groups.push({ ask: part });
    else if (last && "run" in last) last.run.push(part);
    else groups.push({ run: [part] });
  }
  return groups;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A bot's question (its `ask` tool), posted without stopping its work: the question, then lettered options. Picking
 * one sends it as your next message; a `multiple` question collects picks and sends them together. Once answered (or
 * picked here, while the answer waits its turn) the picks stay selected, the rest dim, and nothing is clickable. */
function QuestionCard({ call, answer, onAnswer }: { call: AskCall; answer?: string; onAnswer: (text: string) => void }) {
  const [picks, setPicks] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  const titleId = useId();
  const { question, options, multiple = false } = call.arguments as { question: string; options: string[]; multiple?: boolean };
  if (!Array.isArray(options) || !options.length) throw new Error(`ask call ${call.id} has no options`);
  const chosen = answer === undefined ? (sent ? picks : undefined) : options.filter((o) => `, ${answer}, `.includes(`, ${o}, `));
  const send = (list: string[]) => (setPicks(list), setSent(true), onAnswer(answerText(question, list)));
  return (
    <section aria-labelledby={titleId} className="bg-surface flex w-full max-w-[min(85%,520px)] flex-col rounded-lg border p-1.5 sm:max-w-[min(75%,520px)]">
      <p id={titleId} className="px-2.5 pt-1.5 pb-2 text-base font-medium text-balance">
        {question}
      </p>
      <ul className="flex flex-col">
        {options.map((o, i) => {
          const on = (chosen ?? picks).includes(o);
          return (
            <li key={o}>
              <button
                type="button"
                aria-pressed={on}
                disabled={chosen !== undefined}
                onClick={() => (multiple ? setPicks((p) => (on ? p.filter((x) => x !== o) : [...p, o])) : send([o]))}
                className={cn(
                  "hover:bg-accent flex min-h-8 w-full items-baseline gap-3 rounded-md px-2.5 py-1.5 text-left text-sm transition-[background-color,opacity] duration-150 focus-visible:-outline-offset-2 focus-visible:outline-2 disabled:hover:bg-transparent",
                  on && "bg-muted disabled:hover:bg-muted font-medium",
                  chosen && !on && "opacity-50",
                )}
              >
                <span aria-hidden className={cn("w-3 shrink-0 text-xs font-medium tabular-nums", on ? "text-foreground" : "text-muted-foreground")}>
                  {LETTERS[i]}
                </span>
                {o}
              </button>
            </li>
          );
        })}
      </ul>
      {multiple && chosen === undefined && (
        <Button size="sm" className="mx-1 mt-1.5 mb-0.5 self-end" disabled={!picks.length} onClick={() => send(picks)}>
          Send
        </Button>
      )}
    </section>
  );
}

/** A report the bot saved: a card (title, then what it is; no icon tile, DESIGN.md §2.0) that opens it in the details panel. */
function ReportCard({ id, title }: { id: number; title: string }) {
  return (
    <Attachment className="bg-surface rounded-lg">
      <AttachmentContent>
        <AttachmentTitle className="text-sm font-medium">{title}</AttachmentTitle>
        <AttachmentDescription className="text-xs">Report, saved to the library</AttachmentDescription>
      </AttachmentContent>
      <AttachmentTrigger asChild>
        <Link to="/" search={(s) => ({ ...s, panel: "details" as const, report: id })} aria-label={`Open report ${title}`} />
      </AttachmentTrigger>
    </Attachment>
  );
}

/** The bot's turn: what it set out to do and how it went (activity), its words, its questions, saved reports, and how
 * the turn ended. Each text block is its own message: typing while it is written, then the whole bubble fades in.
 * `between`: the run goes on with nothing live (see BotPane). `answerOf` is the answer you gave to a question after this turn. */
function BotTurn({ turn, ctx, name, writing, between, answerOf, onAnswer }: { turn: PiTurn; ctx: ToolContext; name: string; writing?: PiMessagePart; between: boolean; answerOf: (question: string) => string | undefined; onAnswer: (text: string) => void }) {
  const groups = groupParts(turn.parts, writing);
  // The turn's words are one run, whatever activity sits between them.
  const said = groups.flatMap((g, i) => ("text" in g ? [i] : []));
  const run = (i: number) => ({ first: i === said[0], last: i === said.at(-1) });
  const rise = useCalm(RISE);
  return (
    <>
      {/* What appears while you watch fades in (FADE); what the turn first rendered with doesn't. Nothing has an exit: a
          typing bubble gives its place to the words at once. */}
      <AnimatePresence initial={false}>
        {groups.map((g, i) =>
          "text" in g ? (
            g.part === writing ? (
              <motion.div key={`typing:${i}`} className="flex flex-col" variants={FADE} initial="initial" animate="animate">
                <Typing run={run(i)} />
              </motion.div>
            ) : (
              <motion.div key={`text:${i}`} className="flex flex-col" variants={FADE} initial="initial" animate="animate">
                <Said run={run(i)} reply={{ sender: name, text: g.text }}>
                  <Markdown>{g.text}</Markdown>
                </Said>
              </motion.div>
            )
          ) : "ask" in g ? (
            <motion.div key={`ask:${i}`} className="py-1" variants={FADE} initial="initial" animate="animate">
              <QuestionCard call={g.ask} answer={answerOf((g.ask.arguments as { question: string }).question)} onAnswer={onAnswer} />
            </motion.div>
          ) : (
            <div key={`run:${i}`} className="flex flex-col gap-2 py-1 empty:hidden">
              <Activity parts={g.run} ctx={ctx} live={(turn.live || between) && i === groups.length - 1} />
              {/* A card saved while you watch rises in after its line; history's cards are just there. */}
              <AnimatePresence initial={false}>
                {savedReports(g.run, ctx).map((r) => (
                  <motion.div key={r.id} variants={rise} initial="initial" animate="animate">
                    <ReportCard {...r} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ),
        )}
      </AnimatePresence>
      {turn.stopReason === "aborted" ? (
        <Status>Stopped</Status>
      ) : (
        turn.error && (
          <Said error>
            Couldn't finish: {turn.error}
          </Said>
        )
      )}
    </>
  );
}

/** Opens the thread at a search hit (message-scroller-opening-position). */
function ScrollToMessage({ id }: { id?: string }) {
  const { scrollToMessage } = useMessageScroller();
  useEffect(() => {
    if (!id) return;
    const frame = requestAnimationFrame(() => scrollToMessage(id, { align: "center", behavior: "auto" }));
    return () => cancelAnimationFrame(frame);
  }, [id, scrollToMessage]);
  return null;
}

/** First messages a new bot offers (DESIGN.md §6 empty states): a one-off, a routine, a table. */
const SUGGESTIONS = ["Research the biggest news in your field this week", "Every morning, brief me on what's new", "Build me a table of the key players"];

/** One turn as the thread shows it: who speaks (`key` groups a run of one speaker), and an agent message's parse. */
type View = { turn: PiTurn; text: string; key: string; agent?: AgentMsg; sender?: Sender };

/** The header over a bot's thread, or over one of its helpers' (`subagent`) with a way back to the bot. */
export function ThreadHeader({ bot, subagent, detailsOpen, onToggleDetails, onBack }: { bot: BotSummary; subagent?: { name: string }; detailsOpen: boolean; onToggleDetails: () => void; onBack: () => void }) {
  return (
    <HeaderBar
      face={<Face sender={subagent ? { name: subagent.name } : bot} className="size-6 text-xs" />}
      name={subagent?.name ?? bot.name}
      detailsOpen={detailsOpen}
      onToggleDetails={onToggleDetails}
      back={subagent && { label: bot.name, onClick: onBack }}
    />
  );
}

/** A bot's conversation (its main agent, or subagent `session`) with its composer. `bots` are all the user's bots, for
 * senders. */
export function BotPane({ userId, bot, session: sessionId, entry, bots }: { userId: string; bot: BotSummary; session?: string; entry?: string; bots: BotSummary[] }) {
  const session = usePiSession(botObjectName(userId, bot.id), sessionId);
  // History doesn't animate in; only messages that arrive after this pane opened do (pi timestamps them on commit).
  const [openedAt] = useState(Date.now);
  const results = new Map<string, ToolResult>();
  for (const m of session.messages) for (const p of m.parts) if (p.type === "tool-result") results.set(p.id, p);
  const ctx: ToolContext = { results, running: session.running, bot, bots };
  // A streamed reply with nothing in it yet is the "Working…" under your message, not a row of its own.
  const turns = toTurns([...session.messages, ...(session.live ? [session.live] : [])]).filter((t) => t.parts.length || !t.live || t.error);
  const views = turns.map((turn, i): View => {
    const text = turn.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(turn.role === "user" ? "\n" : "\n\n");
    const agent = turn.role === "user" ? parseAgentMessage(text) : undefined;
    const sender = agent && !isEvent(agent) ? agentSender(agent, bot, bots) : undefined;
    // Every event stands alone, so it always gets a new speaker's spacing.
    const key = turn.role === "assistant" ? "bot" : !agent ? "you" : sender ? sender.key : `event:${i}`;
    return { turn, text, key, agent, sender };
  });
  const divides = turns.map((t, i) => breaksTime(turns[i - 1]?.timestamp, t.timestamp));
  // A search hit opens the bot at its message, once the transcript snapshot has it, and its highlight fades after a moment.
  const hit = turns.find((t) => entry && t.ids.includes(entry));
  const [cleared, setCleared] = useState<string>();
  useEffect(() => {
    if (!hit) return;
    const timer = setTimeout(() => setCleared(entry), 1500);
    return () => clearTimeout(timer);
  }, [hit !== undefined, entry]);
  // Only the latest of the user's own messages anchors the scroll (chat-demo): the scroller jumps to the first anchor it
  // hasn't handled whenever a row is swapped, and anchors loaded with the history are never marked handled.
  const anchorAt = views.findLastIndex((v) => v.key === "you");
  // The bot is at work with nothing of its reply on screen yet: said under your message, or on its own line after
  // someone else's (a routine, a helper reporting back).
  // Between a run's steps (its tools done, its next reply not begun) nothing is live: the run's line says "Thinking…"
  // again, or after a question card the working line does.
  const end = turns.at(-1)?.parts.at(-1);
  const between = session.running && end?.type === "tool-call" && !turns.at(-1)!.live;
  const working = session.running && (views.at(-1)?.turn.role !== "assistant" || (between && end.name === "ask"));
  const workingLabel = session.retry ? "Retrying…" : "Working…";
  const name = sessionId ? (bot.agents.find((a) => a.session === sessionId)?.name ?? "Helper") : bot.name;
  // Keyed by role and position: the streamed reply keeps its row when pi commits it under its entry id.
  const seen = { user: 0, assistant: 0 };
  // Your answers to the bots' questions, by where they sit in the thread: a question card is answered by a later one.
  const answers = views.map((v) => (v.key === "you" ? parseAnswer(v.text) : null));
  const answerAfter = (i: number) => (question: string) => answers.slice(i + 1).find((a) => a?.question === question)?.answer;
  // An answer steers the run still going (pi places steers at its next boundary, not after the run: pi
  // packages/durable/src/harness/inbox.ts), so the bot hears it while it works.
  const answer = (text: string) => session.submit(text, "steer");
  // The text block the bot is writing now, shown as typing until it's done.
  const writing = session.live?.parts.at(-1)?.type === "text" ? session.live.parts.at(-1) : undefined;
  return (
    <QuoteProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        <Thread busy={session.running}>
          {turns.length === 0 && session.status !== "open" && <ThreadSkeleton />}
          {turns.length === 0 && session.status === "open" && !session.running && (
            <ThreadEmpty
              face={<Face sender={sessionId ? { name } : bot} className="size-14 text-2xl" />}
              title={name}
              description={sessionId ? `A helper ${bot.name} brought in. What it works on shows up here.` : bot.instructions || "Hand it something to research. It keeps one conversation and remembers all of it."}
              suggestions={sessionId ? [] : SUGGESTIONS}
              onPick={session.submit}
            />
          )}
          {views.map((v, i) => {
            const id = `${v.turn.role}:${seen[v.turn.role]++}`;
            const next = views[i + 1];
            const first = divides[i] || views[i - 1].key !== v.key;
            const last = !next || divides[i + 1] || next.key !== v.key;
            const mine = v.key === "you";
            const highlight = hit === v.turn && entry !== cleared;
            const enter = v.turn.timestamp >= openedAt;
            return (
              <Fragment key={id}>
                {divides[i] && <TimeDivider id={`time:${id}`} ts={v.turn.timestamp} enter={enter} />}
                <ThreadItem id={v.turn.ids[0]} first={first} enter={enter} mine={mine} anchor={i === anchorAt}>
                  {v.agent && isEvent(v.agent) ? (
                    <SystemEvent msg={v.agent} />
                  ) : (
                    <ThreadRow mine={mine} sender={v.sender} first={first} last={last} highlight={highlight}>
                      {v.turn.role === "assistant" ? (
                        <BotTurn turn={v.turn} ctx={ctx} name={name} writing={v.turn.live ? writing : undefined} between={between && !next} answerOf={answerAfter(i)} onAnswer={answer} />
                      ) : v.agent ? (
                        <Said run={{ first, last }} reply={{ sender: v.sender!.name, text: v.agent.body }}>
                          <Markdown>{v.agent.body}</Markdown>
                        </Said>
                      ) : (
                        <YourSaid text={v.text} run={{ first, last }} />
                      )}
                      {mine && !next && <Status working={working}>{working ? workingLabel : "Delivered"}</Status>}
                    </ThreadRow>
                  )}
                </ThreadItem>
              </Fragment>
            );
          })}
          {working && views.at(-1)?.key !== "you" && <WorkingRow label={workingLabel} />}
          {session.error && (
            <MessageScrollerItem messageId="error" className="pt-3">
              <ThreadRow first last>
                <Said error>
                  {session.error}
                </Said>
              </ThreadRow>
            </MessageScrollerItem>
          )}
          <ScrollToMessage id={hit?.ids[0]} />
        </Thread>
        <Composer
          onSend={(text) => session.submit(text)}
          ready={session.status === "open"}
          onStop={session.running ? session.abort : undefined}
          placeholder={{ open: `Message ${name}`, connecting: "Connecting…", closed: "Offline, reconnecting…" }[session.status]}
        />
      </div>
    </QuoteProvider>
  );
}
