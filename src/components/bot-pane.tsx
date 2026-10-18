import { Link } from "@tanstack/react-router";
import { ArrowUp, FileTextIcon, Square } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Activity, savedReports, Working, type ToolContext, type ToolResult } from "@/components/ai/activity";
import { AgentMessage, parseAgentMessage } from "@/components/ai/agents-message";
import { Markdown } from "@/components/ai/markdown";
import { BotAvatar } from "@/components/bot-avatar";
import { ModelPicker } from "@/components/model-picker";
import { Attachment, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle, AttachmentTrigger } from "@/components/ui/attachment";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/components/ui/message-scroller";
import { Trace } from "@/components/ui/trace";
import type { PiMessagePart } from "@/pi/transcript";
import { usePiSession } from "@/pi/use-pi-session";
import { toTurns, type PiTurn } from "@/pi/view";
import { FADE, SLIDE_UP } from "@/lib/message-animations";
import { cn } from "@/lib/utils";
import { setBotModel } from "@/server/fns";
import { botObjectName, type BotSummary } from "@/shared";

/** Bubble corners as in iMessage. */
const ROUND = "rounded-[18px]";

/** Consecutive thinking/tool-call parts form one activity run; text parts are bubbles. */
function groupParts(parts: readonly PiMessagePart[]) {
  const groups: ({ text: string } | { run: PiMessagePart[] })[] = [];
  for (const part of parts) {
    const last = groups.at(-1);
    if (part.type === "text") groups.push({ text: part.text });
    else if (last && "run" in last) last.run.push(part);
    else groups.push({ run: [part] });
  }
  return groups;
}

const MotionMessageScrollerItem = motion.create(MessageScrollerItem);

/** An error in the thread (message-markdown's bubble, destructive variant). */
function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <Bubble variant="destructive" role="alert">
      <BubbleContent className={ROUND}>{children}</BubbleContent>
    </Bubble>
  );
}

/** A report the bot saved: a card that opens it in the details panel. */
function ReportCard({ id, title }: { id: number; title: string }) {
  return (
    <Attachment>
      <AttachmentMedia>
        <FileTextIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{title}</AttachmentTitle>
        <AttachmentDescription>Report · in its library</AttachmentDescription>
      </AttachmentContent>
      <AttachmentTrigger asChild>
        <Link to="/" search={(s) => ({ ...s, panel: "details" as const, report: id })} aria-label={`Open report ${title}`} />
      </AttachmentTrigger>
    </Attachment>
  );
}

/** Index of the user's own latest message (not an agent's), the thread's only scroll anchor. */
const lastHuman = (turns: PiTurn[]) =>
  turns.findLastIndex((t) => t.role === "user" && !parseAgentMessage(t.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n")));

/** When a gap this long separates two messages, a time divider goes between them (iMessage). */
const GAP = 30 * 60 * 1000;

function dayTime(ts: number) {
  const date = new Date(ts);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 86_400_000);
  const day = days === 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? date.toLocaleDateString([], { weekday: "long" }) : date.toLocaleDateString([], { month: "short", day: "numeric", year: days > 300 ? "numeric" : undefined });
  return `${day} ${time}`;
}

function Row({ turn, ctx, highlight, enter, anchor, reduceMotion }: { turn: PiTurn; ctx: ToolContext; highlight: boolean; enter: boolean; anchor: boolean; reduceMotion: boolean }) {
  const text = turn.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(turn.role === "user" ? "\n" : "\n\n");
  const agent = turn.role === "user" ? parseAgentMessage(text) : undefined;
  const human = turn.role === "user" && !agent;
  const groups = groupParts(turn.parts);
  const content =
    turn.role === "user" ? (
      <Bubble align="end" variant="default">
        <BubbleContent className={cn(ROUND, "whitespace-pre-wrap")}>{text}</BubbleContent>
      </Bubble>
    ) : turn.live && !turn.parts.length ? (
      <Trace>
        <Working />
      </Trace>
    ) : (
      groups.map((g, i) =>
        "text" in g ? (
          <Bubble key={i} variant="muted">
            <BubbleContent className={ROUND}>
              <Markdown streaming={turn.live && i === groups.length - 1}>{g.text}</Markdown>
            </BubbleContent>
          </Bubble>
        ) : (
          <div key={i} className="flex flex-col gap-2">
            <Activity parts={g.run} ctx={ctx} live={turn.live && i === groups.length - 1} />
            {savedReports(g.run, ctx).map((r) => (
              <ReportCard key={r.id} {...r} />
            ))}
          </div>
        ),
      )
    );
  return (
    <MotionMessageScrollerItem
      messageId={turn.ids[0]}
      // Only the latest of the user's own messages anchors the scroll (chat-demo): the scroller jumps to the first anchor
      // it hasn't handled whenever a row is swapped, and anchors loaded with the history are never marked handled.
      scrollAnchor={anchor && human}
      variants={reduceMotion ? FADE : SLIDE_UP}
      initial={enter && human ? "initial" : false}
      animate="animate"
    >
      <Message
        align={human ? "end" : "start"}
        // A background, not a ring: MessageScrollerItem's content-visibility clips anything drawn outside it.
        className={cn("rounded-[22px] transition-colors duration-150", highlight && "bg-highlight")}
      >
        {agent ? (
          <AgentMessage msg={agent} bot={ctx.bot} bots={ctx.bots} />
        ) : (
          <MessageContent className="gap-2">
            {content}
            {turn.error && <ErrorMessage>{turn.error}</ErrorMessage>}
          </MessageContent>
        )}
      </Message>
    </MotionMessageScrollerItem>
  );
}

/** Between sending and pi's first token: the same running line as a reply at work (chat-demo). */
function Pending() {
  return (
    <MessageScrollerItem messageId="pending">
      <Message>
        <MessageContent>
          <Trace>
            <Working />
          </Trace>
        </MessageContent>
      </Message>
    </MessageScrollerItem>
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

/** The prompt input (AI Elements prompt-input on InputGroup), shaped like iMessage's: one rounded field, the model
 * picker inside it on the left, a round send (or stop) button on the right. Enter sends, Shift+Enter is a new line. */
export function Composer({ onSend, ready, running, onAbort, placeholder, tools }: { onSend: (text: string) => void; ready: boolean; running: boolean; onAbort: () => void; placeholder: string; tools?: ReactNode }) {
  const [draft, setDraft] = useState("");
  const send = () => {
    if (!draft.trim() || !ready) return;
    onSend(draft);
    setDraft("");
  };
  return (
    <form
      className="mx-auto w-full max-w-3xl px-4 pt-2 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <InputGroup className="min-h-11 items-end rounded-[22px] has-[[data-slot=input-group-control]:focus-visible]:ring-[3px]">
        {tools && (
          <InputGroupAddon align="inline-start" className="pb-2">
            {tools}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          value={draft}
          autoFocus
          rows={1}
          placeholder={ready ? placeholder : "Connecting…"}
          aria-label="Message"
          className="max-h-48 min-h-0 py-3"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <InputGroupAddon align="inline-end" className="pb-1.5">
          {running ? (
            <InputGroupButton type="button" variant="secondary" size="icon-sm" className="rounded-full" aria-label="Stop" onClick={onAbort}>
              <Square className="fill-current" />
            </InputGroupButton>
          ) : (
            <InputGroupButton type="submit" variant="default" size="icon-sm" className="rounded-full" aria-label="Send" disabled={!ready || !draft.trim()}>
              <ArrowUp />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

/** A bot's conversation (its main agent, or subagent `session`) with its composer. `bots` are all the user's bots, for chips. */
export function BotPane({ userId, bot, session: sessionId, entry, bots }: { userId: string; bot: BotSummary; session?: string; entry?: string; bots: BotSummary[] }) {
  const session = usePiSession(botObjectName(userId, bot.id), sessionId);
  // History doesn't animate in; only messages sent after this pane opened do (pi timestamps them on commit).
  const reduceMotion = useReducedMotion() ?? false;
  const [openedAt] = useState(Date.now);
  const results = new Map<string, ToolResult>();
  for (const m of session.messages)
    for (const p of m.parts) if (p.type === "tool-result") results.set(p.id, p);
  const ctx: ToolContext = { results, running: session.running, bot, bots };
  const turns = toTurns([...session.messages, ...(session.live ? [session.live] : [])]);
  // A search hit opens the bot at its message, once the transcript snapshot has it, and its highlight fades after a moment.
  const hit = turns.find((t) => entry && t.ids.includes(entry));
  const [cleared, setCleared] = useState<string>();
  useEffect(() => {
    if (!hit) return;
    const timer = setTimeout(() => setCleared(entry), 1500);
    return () => clearTimeout(timer);
  }, [hit !== undefined, entry]);
  // Keyed by role and position: the streamed reply keeps its row when pi commits it under its entry id.
  const seen = { user: 0, assistant: 0 };
  const anchorAt = lastHuman(turns);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider autoScroll>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent aria-busy={session.running} className="mx-auto w-full max-w-3xl gap-4 px-4 pt-4 pb-6">
              {turns.length === 0 && session.status === "open" && !session.running && (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia>
                      <BotAvatar bot={bot} size="lg" />
                    </EmptyMedia>
                    <EmptyTitle>{bot.name}</EmptyTitle>
                    <EmptyDescription>{bot.instructions || "Assign it something to research. It keeps one conversation and remembers all of it."}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
              {turns.map((t, i) => {
                const key = `${t.role}:${seen[t.role]++}`;
                return (
                  <Fragment key={key}>
                    {(i === 0 || t.timestamp - turns[i - 1].timestamp > GAP) && (
                      <MessageScrollerItem messageId={`time:${key}`}>
                        <Marker variant="separator" className="text-xs">
                          <MarkerContent>{dayTime(t.timestamp)}</MarkerContent>
                        </Marker>
                      </MessageScrollerItem>
                    )}
                    <Row turn={t} ctx={ctx} highlight={hit === t && entry !== cleared} enter={t.timestamp >= openedAt} anchor={i === anchorAt} reduceMotion={reduceMotion} />
                  </Fragment>
                );
              })}
              {session.running && !session.live && turns.at(-1)?.role === "user" && <Pending />}
              {session.error && (
                <Message>
                  <MessageContent>
                    <ErrorMessage>{session.error}</ErrorMessage>
                  </MessageContent>
                </Message>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          {/* new-york's secondary button has no border, so over text it reads as a bare arrow. */}
          <MessageScrollerButton variant="outline" />
          <ScrollToMessage id={hit?.ids[0]} />
        </MessageScroller>
      </MessageScrollerProvider>
      <Composer
        onSend={session.submit}
        ready={session.status === "open"}
        running={session.running}
        onAbort={session.abort}
        placeholder={`Message ${sessionId ? (bot.agents.find((a) => a.session === sessionId)?.name ?? "subagent") : bot.name}…`}
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
