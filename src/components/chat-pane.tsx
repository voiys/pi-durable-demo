import { ArrowUp, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { Markdown, TraceGroup, type ToolResult } from "@/components/ai/parts";
import { ModelPicker } from "@/components/model-picker";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import type { PiMessage, PiMessagePart } from "@/pi/transcript";
import { usePiSession } from "@/pi/use-pi-session";
import { cn } from "@/lib/utils";
import { chatObjectName } from "@/shared";

// Inter-agent messages arrive as user messages with a bracketed prefix.
const AGENT_PREFIXES = [
  /^\[(message from [^\]]+)\] ([\s\S]*)$/,
  /^\[(subagent \S+) answered, no reply needed\] ([\s\S]*)$/,
  /^\[(subagent \S+) failed: [\s\S]*\]$/,
];

function agentMessage(text: string) {
  for (const re of AGENT_PREFIXES) {
    const m = re.exec(text);
    if (m) return { from: m[1], body: m[2] ?? text };
  }
}

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

function Row({ message, results, highlight }: { message: PiMessage; results: Map<string, ToolResult>; highlight: boolean }) {
  if (message.role !== "user" && message.role !== "assistant") return null;
  const live = message.id === "live";
  let content;
  let align: "start" | "end" = "start";
  if (message.role === "user") {
    const text = message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
    const agent = agentMessage(text);
    align = agent ? "start" : "end";
    content = (
      <>
        {agent && <MessageHeader>{agent.from}</MessageHeader>}
        <Bubble variant={agent ? "outline" : "muted"}>
          <BubbleContent className="whitespace-pre-wrap">{agent?.body ?? text}</BubbleContent>
        </Bubble>
      </>
    );
  } else {
    const groups = groupParts(message.parts);
    content = (
      <>
        {groups.map((g, i) =>
          "text" in g ? (
            <Markdown key={i}>{g.text}</Markdown>
          ) : (
            <TraceGroup key={i} parts={g.trace} results={results} live={live && i === groups.length - 1} />
          ),
        )}
        {message.error && <p className="text-destructive text-xs">{message.error}</p>}
      </>
    );
  }
  return (
    <MessageScrollerItem messageId={message.id} scrollAnchor={message.role === "user"}>
      <Message id={`entry-${message.id}`} align={align} className={cn(highlight && "rounded-lg ring-2 ring-yellow-300 ring-offset-4 ring-offset-background")}>
        <MessageContent>{content}</MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}

export function ChatPane({ userId, chatId, session: sessionId, entry }: { userId: string; chatId: string; session?: string; entry?: string }) {
  const session = usePiSession(chatObjectName(userId, chatId), sessionId);
  // A search hit opens the chat at its message, once the transcript snapshot has it.
  const hasEntry = session.messages.some((m) => m.id === entry);
  useEffect(() => {
    if (hasEntry) document.getElementById(`entry-${entry}`)!.scrollIntoView({ block: "center" });
  }, [entry, hasEntry]);
  const [draft, setDraft] = useState("");
  const results = new Map<string, ToolResult>();
  for (const m of session.messages)
    for (const p of m.parts) if (p.type === "tool-result") results.set(p.id, p);
  const send = () => {
    if (!draft.trim()) return;
    session.submit(draft);
    setDraft("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl p-4">
              {session.messages.map((m) => (
                <Row key={m.id} message={m} results={results} highlight={m.id === entry} />
              ))}
              {session.live && <Row message={session.live} results={results} highlight={false} />}
              {session.error && <p className="text-destructive text-sm">{session.error}</p>}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
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
            placeholder={session.status === "open" ? "Message pi…" : "Connecting…"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <InputGroupAddon align="block-end" className="p-2">
            {!sessionId && <ModelPicker chatId={chatId} model={session.model?.modelId ?? null} thinkingLevel={session.thinkingLevel} />}
            <span className="flex-1" />
            {session.running ? (
              <InputGroupButton type="button" variant="outline" size="icon-sm" onClick={session.abort}>
                <Square />
              </InputGroupButton>
            ) : (
              <InputGroupButton type="submit" variant="default" size="icon-sm" disabled={session.status !== "open"}>
                <ArrowUp />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
