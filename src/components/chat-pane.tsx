import { ArrowUp, MessageCircleDashedIcon, Square } from "lucide-react";
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
import { createChat, setChatModel } from "@/server/fns";
import { chatObjectName, DEFAULT_MODEL, type ChatSummary } from "@/shared";

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

export function Row({ turn, ctx, highlight, enter, reduceMotion }: { turn: PiTurn; ctx: ToolContext; highlight: boolean; enter: boolean; reduceMotion: boolean }) {
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
          <AgentMessage msg={agent} chat={ctx.chat} />
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

/** First messages of chats created by DraftPane, waiting for the new chat's socket. */
const firstMessages = new Map<string, string>();

/** AI Elements prompt input: Enter sends, Shift+Enter is a new line, stop while running; `tools` sit left of send. */
function Composer({ onSend, ready, running, onAbort, tools }: { onSend: (text: string) => void; ready: boolean; running: boolean; onAbort: () => void; tools?: ReactNode }) {
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
          placeholder={ready ? "Message pi…" : "Connecting…"}
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

/** "New chat": nothing exists until the first message, which creates the chat and is sent by its ChatPane. */
export function DraftPane({ onCreated }: { onCreated: (chatId: string) => void }) {
  const [choice, setChoice] = useState<{ model: string; thinkingLevel: string }>({ model: DEFAULT_MODEL.id, thinkingLevel: DEFAULT_MODEL.thinkingLevel });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageCircleDashedIcon />
          </EmptyMedia>
          <EmptyTitle>What's on your mind?</EmptyTitle>
          <EmptyDescription>Your first message starts the chat. Pick the model and reasoning with the brain button.</EmptyDescription>
        </EmptyHeader>
      </Empty>
      <Composer
        ready
        running={false}
        onAbort={() => {}}
        tools={<ModelPicker model={choice.model} thinkingLevel={choice.thinkingLevel} onChange={async (model, thinkingLevel) => setChoice({ model, thinkingLevel })} />}
        onSend={async (text) => {
          const { id } = await createChat();
          // The draft's model choice becomes the new chat's before its first message goes out.
          if (choice.model !== DEFAULT_MODEL.id || choice.thinkingLevel !== DEFAULT_MODEL.thinkingLevel)
            await setChatModel({ data: { chatId: id, ...choice } });
          firstMessages.set(id, text);
          onCreated(id);
        }}
      />
    </div>
  );
}

/** One chat's transcript (main agent, or subagent `session`) with its composer. `chats` are all the user's chats, for agent and chat chips. */
export function ChatPane({ userId, chatId, session: sessionId, entry, chats }: { userId: string; chatId: string; session?: string; entry?: string; chats: ChatSummary[] }) {
  const session = usePiSession(chatObjectName(userId, chatId), sessionId);
  // A chat created by its first message (see DraftPane) sends that message once its socket opens.
  useEffect(() => {
    const first = firstMessages.get(chatId);
    if (first === undefined || session.status !== "open") return;
    firstMessages.delete(chatId);
    session.submit(first);
  }, [chatId, session.status, session.submit]);
  // History doesn't animate in; only messages sent after this pane opened do (pi timestamps them on commit).
  const reduceMotion = useReducedMotion() ?? false;
  const [openedAt] = useState(Date.now);
  const results = new Map<string, ToolResult>();
  for (const m of session.messages)
    for (const p of m.parts) if (p.type === "tool-result") results.set(p.id, p);
  const ctx: ToolContext = { results, running: session.running, chat: chats.find((c) => c.id === chatId), chats };
  const turns = toTurns([...session.messages, ...(session.live ? [session.live] : [])]);
  // A search hit opens the chat at its message, once the transcript snapshot has it, and its highlight fades after a moment.
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
        tools={
          !sessionId && (
            <ModelPicker
              model={session.model?.modelId ?? null}
              thinkingLevel={session.thinkingLevel}
              onChange={(model, thinkingLevel) => setChatModel({ data: { chatId, model, thinkingLevel } })}
            />
          )
        }
      />
    </div>
  );
}
