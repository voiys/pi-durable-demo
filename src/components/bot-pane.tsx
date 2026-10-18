import { ArrowUp, Square } from "lucide-react";
import { BotAvatar } from "@/components/bot-avatar";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { AgentMessage, parseAgentMessage } from "@/components/ai/agents-message";
import { Markdown } from "@/components/ai/markdown";
import { Reasoning, TraceGroup, type ToolContext, type ToolResult } from "@/components/ai/parts";
import { ModelPicker } from "@/components/model-picker";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { CodeBlockCopyButton } from "@/components/ui/code-block";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
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

/** Consecutive thinking/tool-call parts form one Trace; text parts are markdown. */
function groupParts(parts: readonly PiMessagePart[]) {
  const groups: ({ text: string } | { trace: PiMessagePart[] })[] = [];
  for (const part of parts) {
    const last = groups.at(-1);
    if (part.type === "text") groups.push({ text: part.text });
    else if (last && "trace" in last) last.trace.push(part);
    else groups.push({ trace: [part] });
  }
  return groups;
}

const MotionMessageScrollerItem = motion.create(MessageScrollerItem);

/** An error in the thread (message-markdown's bubble, destructive variant). */
function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <Bubble variant="destructive" role="alert">
      <BubbleContent>{children}</BubbleContent>
    </Bubble>
  );
}

function Row({ turn, ctx, highlight, enter, reduceMotion }: { turn: PiTurn; ctx: ToolContext; highlight: boolean; enter: boolean; reduceMotion: boolean }) {
  const text = turn.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(turn.role === "user" ? "\n" : "\n\n");
  const agent = turn.role === "user" ? parseAgentMessage(text) : undefined;
  const human = turn.role === "user" && !agent;
  const content =
    turn.role === "user" ? (
      <Bubble align="end" variant="muted">
        <BubbleContent className="whitespace-pre-wrap">{text}</BubbleContent>
      </Bubble>
    ) : turn.live && !turn.parts.length ? (
      THINKING
    ) : (
      groupParts(turn.parts).map((g, i, groups) =>
        "text" in g ? (
          <Bubble key={i} variant="ghost">
            <BubbleContent>
              <Markdown streaming={turn.live && i === groups.length - 1}>{g.text}</Markdown>
            </BubbleContent>
          </Bubble>
        ) : (
          <TraceGroup key={i} parts={g.trace} ctx={ctx} live={turn.live && i === groups.length - 1} />
        ),
      )
    );
  return (
    <MotionMessageScrollerItem
      messageId={turn.ids[0]}
      // Only the human's own messages anchor the scroll and slide in (chat-demo); agent messages arrive like replies.
      scrollAnchor={human}
      variants={reduceMotion ? FADE : SLIDE_UP}
      initial={enter && human ? "initial" : false}
      animate="animate"
    >
      <Message
        align={human ? "end" : "start"}
        // A background, not a ring: MessageScrollerItem's content-visibility clips anything drawn outside it.
        className={cn("rounded-lg transition-colors duration-150", highlight && "bg-highlight")}
      >
        {agent ? (
          <AgentMessage msg={agent} bot={ctx.bot} bots={ctx.bots} />
        ) : (
          <MessageContent className={cn(turn.role === "assistant" && "max-w-2xl gap-3")}>
            {content}
            {turn.error && <ErrorMessage>{turn.error}</ErrorMessage>}
            {!turn.live && text && (
              <MessageFooter className="gap-2 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
                <time dateTime={new Date(turn.timestamp).toISOString()}>{new Date(turn.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                <CodeBlockCopyButton value={text} />
              </MessageFooter>
            )}
          </MessageContent>
        )}
      </Message>
    </MotionMessageScrollerItem>
  );
}

/** Between sending and pi's first token: the same running "Thinking" line as reasoning (chat-demo). */
const THINKING = (
  <Trace>
    <Reasoning text="" running />
  </Trace>
);

function Pending() {
  return (
    <MessageScrollerItem messageId="pending">
      <Message>
        <MessageContent>{THINKING}</MessageContent>
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

/** AI Elements prompt input: Enter sends, Shift+Enter is a new line, stop while running; `tools` sit left of send. */
function Composer({ onSend, ready, running, onAbort, placeholder, tools }: { onSend: (text: string) => void; ready: boolean; running: boolean; onAbort: () => void; placeholder: string; tools?: ReactNode }) {
  const [draft, setDraft] = useState("");
  const send = () => {
    if (!draft.trim() || !ready) return;
    onSend(draft);
    setDraft("");
  };
  return (
    <form
      className="mx-auto w-full max-w-3xl p-4"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <InputGroup>
        <InputGroupTextarea
          value={draft}
          autoFocus
          placeholder={ready ? placeholder : "Connecting…"}
          aria-label="Message"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <InputGroupAddon align="block-end" className="p-2">
          {tools}
          <span className="flex-1" />
          {running ? (
            <InputGroupButton type="button" variant="outline" size="icon-sm" aria-label="Stop" onClick={onAbort}>
              <Square />
            </InputGroupButton>
          ) : (
            <InputGroupButton type="submit" variant="default" size="icon-sm" aria-label="Send" disabled={!ready || !draft.trim()}>
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
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider autoScroll>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent aria-busy={session.running} className="mx-auto w-full max-w-3xl gap-6 px-4 pt-4 pb-8">
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
              {turns.map((t) => (
                <Row key={`${t.role}:${seen[t.role]++}`} turn={t} ctx={ctx} highlight={hit === t && entry !== cleared} enter={t.timestamp >= openedAt} reduceMotion={reduceMotion} />
              ))}
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
