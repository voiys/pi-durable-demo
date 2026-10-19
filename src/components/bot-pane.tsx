import { Link } from "@tanstack/react-router";
import { ArrowUp, ChevronLeft, Square } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Activity, savedReports, Working, type ToolContext, type ToolResult } from "@/components/ai/activity";
import { agentSender, isEvent, parseAgentMessage, SystemEvent, type AgentMsg, type Sender } from "@/components/ai/agents-message";
import { Markdown } from "@/components/ai/markdown";
import { BotAvatar } from "@/components/bot-avatar";
import { ModelPicker } from "@/components/model-picker";
import { Attachment, AttachmentContent, AttachmentDescription, AttachmentTitle, AttachmentTrigger } from "@/components/ui/attachment";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
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
  useMessageScrollerScrollable,
} from "@/components/ui/message-scroller";
import { Trace } from "@/components/ui/trace";
import type { PiMessagePart } from "@/pi/transcript";
import { usePiSession } from "@/pi/use-pi-session";
import { toTurns, type PiTurn } from "@/pi/view";
import { FADE, SLIDE_UP } from "@/lib/message-animations";
import { cn } from "@/lib/utils";
import { setBotModel } from "@/server/fns";
import { botObjectName, type BotSummary } from "@/shared";

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
        className="hover:bg-accent focus-visible:ring-ring/50 flex max-w-[50%] min-w-0 flex-col items-center gap-0.5 rounded-lg px-2 py-0.5 transition-colors duration-150 outline-none focus-visible:ring-3"
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

/** "Today 12:11", centered caption, no rules; 24px of air on both sides (DESIGN.md §5). */
export function TimeDivider({ id, ts }: { id: string; ts: number }) {
  return (
    <MessageScrollerItem messageId={id} className="pt-6 pb-3 first:pt-2">
      <Marker className="justify-center">
        <MarkerContent className="text-xs font-medium tabular-nums">{dayTime(ts)}</MarkerContent>
      </Marker>
    </MessageScrollerItem>
  );
}

const MotionMessageScrollerItem = motion.create(MessageScrollerItem);

/** A row's scroller item: 12px above a new speaker, 2px inside one speaker's run (DESIGN.md §5). Messages that arrive
 * while the thread is open animate in, yours sliding up, everyone else's fading (§7); history never does. */
export function ThreadItem({ id, first, enter, mine, anchor = false, children }: { id: string; first: boolean; enter: boolean; mine: boolean; anchor?: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <MotionMessageScrollerItem messageId={id} scrollAnchor={anchor} className={first ? "pt-3" : "pt-0.5"} variants={mine && !reduceMotion ? SLIDE_UP : FADE} initial={enter ? "initial" : false} animate="animate">
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
      {sender && <MessageAvatar className="min-w-7 bg-transparent">{last ? <Face sender={sender} className="size-7 text-xs" /> : <span className="size-7" />}</MessageAvatar>}
      <MessageContent className="gap-0.5">
        {sender && first && (
          <MessageHeader className="px-3.5 pb-0.5 text-xs font-medium">
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

/** A bubble (DESIGN.md §6): yours blue, theirs gray, an error red with words. The last of a run tucks its outer bottom
 * corner in, as iMessage's tail does. */
export function Said({ mine = false, tail, error = false, children }: { mine?: boolean; tail: boolean; error?: boolean; children: ReactNode }) {
  return (
    <Bubble align={mine ? "end" : "start"} variant={error ? "destructive" : mine ? "default" : "muted"} role={error ? "alert" : undefined} className="max-w-[min(85%,520px)] sm:max-w-[min(75%,520px)]">
      <BubbleContent className={cn("rounded-xl px-3.5 py-2.5 text-base", mine && "whitespace-pre-wrap", tail && (mine ? "rounded-br-sm" : "rounded-bl-sm"))}>{children}</BubbleContent>
    </Bubble>
  );
}

/** A caption under the last bubble: "Delivered", or the live "Working…" while the work runs. */
export function Status({ working = false, children }: { working?: boolean; children: ReactNode }) {
  return (
    <p data-slot="message-status" className={cn("text-muted-foreground w-fit px-1 pt-0.5 text-xs font-medium", working && "shimmer motion-reduce:shimmer-none")}>
      {children}
    </p>
  );
}

/** A left-aligned line saying someone is at work, after a message that isn't yours. */
export function WorkingRow({ label }: { label?: string }) {
  return (
    <MessageScrollerItem messageId="working" className="pt-3">
      <Trace>
        <Working label={label} />
      </Trace>
    </MessageScrollerItem>
  );
}

/** A thread with nothing in it yet: the face large, the name, one sentence, and optional first messages to send. */
export function ThreadEmpty({ face, title, description, suggestions = [], onPick }: { face: ReactNode; title: string; description: string; suggestions?: string[]; onPick?: (text: string) => void }) {
  return (
    <MessageScrollerItem messageId="empty" className="flex flex-1 flex-col">
      <Empty className="gap-5 px-2">
        <EmptyHeader className="gap-1.5">
          <EmptyMedia className="mb-2">{face}</EmptyMedia>
          <EmptyTitle className="max-w-full truncate text-2xl font-semibold">{title}</EmptyTitle>
          <EmptyDescription className="line-clamp-3 text-base">{description}</EmptyDescription>
        </EmptyHeader>
        {suggestions.length > 0 && (
          <EmptyContent className="flex-row flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <Button key={s} variant="secondary" size="sm" className="h-auto min-h-8 rounded-full px-3.5 py-1.5 text-sm font-normal whitespace-normal" onClick={() => onPick!(s)}>
                {s}
              </Button>
            ))}
          </EmptyContent>
        )}
      </Empty>
    </MessageScrollerItem>
  );
}

/** Once the thread scrolls, a hairline under the header separates it from the content beneath (DESIGN.md §6). */
function ScrolledHairline() {
  const { start } = useMessageScrollerScrollable();
  return <div aria-hidden className={cn("bg-border pointer-events-none absolute inset-x-0 top-0 z-10 h-px transition-opacity duration-150", start ? "opacity-100" : "opacity-0")} />;
}

/** The scrolling thread on the white canvas, 720px wide at most: follows the live edge and jumps back to it. */
export function Thread({ busy = false, children }: { busy?: boolean; children: ReactNode }) {
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller>
        <ScrolledHairline />
        <MessageScrollerViewport>
          <MessageScrollerContent aria-busy={busy} className="mx-auto w-full max-w-[720px] gap-0 px-3 pt-2 pb-6 sm:px-4">
            {children}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton variant="ghost" className="shadow-float rounded-full" />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

/** The floating pill composer (DESIGN.md §6, AI Elements prompt-input on InputGroup): the model brain on the left, a
 * blue send circle on the right that wakes up with text, a stop square while the bot works and nothing is typed.
 * `onStop` is set while there is work to stop. Enter sends (queued behind running work), Shift+Enter is a new line. */
export function Composer({ onSend, ready, onStop, placeholder, tools }: { onSend: (text: string) => void; ready: boolean; onStop?: () => void; placeholder: string; tools?: ReactNode }) {
  const [draft, setDraft] = useState("");
  const typed = draft.trim() !== "";
  const send = () => {
    if (!typed || !ready) return;
    onSend(draft);
    setDraft("");
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
      <InputGroup className="bg-background shadow-composer min-h-11 items-end rounded-[22px] border-0 has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/20">
        {tools && (
          <InputGroupAddon align="inline-start" className="py-2.5 pl-2 has-[>button]:ml-0 [&>button]:size-6 [&>button]:rounded-full">
            {tools}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          value={draft}
          autoFocus
          rows={1}
          placeholder={placeholder}
          aria-label="Message"
          className={cn("placeholder:text-faint max-h-48 min-h-0 py-2.5", tools ? "pl-1.5" : "pl-4")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <InputGroupAddon align="inline-end" className="py-2 pr-2 has-[>button]:mr-0">
          {onStop && !typed ? (
            <InputGroupButton type="button" variant="secondary" size="icon-xs" className="bg-muted hover:bg-muted size-7 rounded-full" aria-label="Stop" onClick={onStop}>
              <Square className="size-2.5 fill-current" />
            </InputGroupButton>
          ) : (
            <InputGroupButton type="submit" variant="default" size="icon-xs" className="disabled:bg-muted disabled:text-faint size-7 rounded-full disabled:opacity-100" aria-label="Send" disabled={!ready || !typed}>
              <ArrowUp className="size-4" strokeWidth={2.5} />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

// ---- The bot thread ----

/** Consecutive thinking/tool-call parts form one activity run; text parts are bubbles. */
function groupParts(parts: readonly PiMessagePart[]) {
  const groups: ({ text: string } | { run: PiMessagePart[] })[] = [];
  for (const part of parts) {
    const last = groups.at(-1);
    if (part.type === "text") part.text.trim() && groups.push({ text: part.text });
    else if (last && "run" in last) last.run.push(part);
    else groups.push({ run: [part] });
  }
  return groups;
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

/** The bot's turn: what it set out to do and how it went (activity), its words, saved reports, and how the turn ended. */
function BotTurn({ turn, ctx }: { turn: PiTurn; ctx: ToolContext }) {
  const groups = groupParts(turn.parts);
  return (
    <>
      {groups.map((g, i) =>
        "text" in g ? (
          <Said key={i} tail={!groups[i + 1] || !("text" in groups[i + 1])}>
            <Markdown streaming={turn.live && i === groups.length - 1}>{g.text}</Markdown>
          </Said>
        ) : (
          <div key={i} className="flex flex-col gap-2 py-1 empty:hidden">
            <Activity parts={g.run} ctx={ctx} live={turn.live && i === groups.length - 1} />
            {savedReports(g.run, ctx).map((r) => (
              <ReportCard key={r.id} {...r} />
            ))}
          </div>
        ),
      )}
      {turn.stopReason === "aborted" ? (
        <Status>Stopped</Status>
      ) : (
        turn.error && (
          <Said tail error>
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
  const working = session.running && views.at(-1)?.turn.role !== "assistant";
  const workingLabel = session.retry ? "Retrying…" : "Working…";
  const name = sessionId ? (bot.agents.find((a) => a.session === sessionId)?.name ?? "Helper") : bot.name;
  // Keyed by role and position: the streamed reply keeps its row when pi commits it under its entry id.
  const seen = { user: 0, assistant: 0 };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Thread busy={session.running}>
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
          return (
            <Fragment key={id}>
              {divides[i] && <TimeDivider id={`time:${id}`} ts={v.turn.timestamp} />}
              <ThreadItem id={v.turn.ids[0]} first={first} enter={v.turn.timestamp >= openedAt} mine={mine} anchor={i === anchorAt}>
                {v.agent && isEvent(v.agent) ? (
                  <SystemEvent msg={v.agent} />
                ) : (
                  <ThreadRow mine={mine} sender={v.sender} first={first} last={last} highlight={highlight}>
                    {v.turn.role === "assistant" ? (
                      <BotTurn turn={v.turn} ctx={ctx} />
                    ) : (
                      <Said mine={mine} tail={last}>
                        {v.agent ? <Markdown>{v.agent.body}</Markdown> : v.text}
                      </Said>
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
              <Said tail error>
                {session.error}
              </Said>
            </ThreadRow>
          </MessageScrollerItem>
        )}
        <ScrollToMessage id={hit?.ids[0]} />
      </Thread>
      <Composer
        onSend={session.submit}
        ready={session.status === "open"}
        onStop={session.running ? session.abort : undefined}
        placeholder={{ open: `Message ${name}`, connecting: "Connecting…", closed: "Offline, reconnecting…" }[session.status]}
        tools={
          !sessionId && (
            <ModelPicker
              model={session.model?.modelId ?? null}
              thinkingLevel={session.thinkingLevel}
              onChange={(model, thinkingLevel) => setBotModel({ data: { botId: bot.id, model, thinkingLevel } })}
            />
          )
        }
      />
    </div>
  );
}
