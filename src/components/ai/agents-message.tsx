import { BotIcon, CircleAlertIcon, CircleCheckIcon, MessagesSquareIcon } from "lucide-react";
import { agentTarget, Chip } from "@/components/ai/chips";
import { Markdown } from "@/components/ai/markdown";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { MessageAvatar, MessageContent, MessageHeader } from "@/components/ui/message";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import type { ChatSummary } from "@/shared";

/** An inter-agent message: user-role text the harness prefixes with who sent it (src/server/agents.ts, chat.ts). */
export type AgentMsg = { kind: "peer" | "report" | "failed" | "session"; from: string; sessionId?: string; body: string };

// The session pattern is first: its prefix also matches the peer one. Titles may contain `]`, so they match greedily.
const PREFIXES: [AgentMsg["kind"], RegExp][] = [
  ["session", /^\[message from session "(.*)" \(([^)]+)\)\] ([\s\S]*)$/],
  ["peer", /^\[message from ([^\]]+)\] ([\s\S]*)$/],
  ["report", /^\[subagent (\S+) answered, no reply needed\] ([\s\S]*)$/],
  ["failed", /^\[subagent (\S+) failed: ([\s\S]*)\]$/],
];

/** Parses an inter-agent message; undefined for human text. */
export function parseAgentMessage(text: string): AgentMsg | undefined {
  for (const [kind, re] of PREFIXES) {
    const m = re.exec(text);
    if (!m) continue;
    return kind === "session" ? { kind, from: m[1], sessionId: m[2], body: m[3] } : { kind, from: m[1], body: m[2] };
  }
}

/**
 * The content of an inter-agent message, for a start-aligned Message. Peers and other chats (message-scroller-group-chat):
 * avatar, the sender as a chip linking to its transcript, a markdown bubble. Subagent reports and failures (subagent-demo):
 * one event line with the body on demand; a failure opens by default. `chat` is the chat this transcript belongs to.
 */
export function AgentMessage({ msg, chat }: { msg: AgentMsg; chat?: ChatSummary }) {
  if (msg.kind === "report" || msg.kind === "failed") {
    const failed = msg.kind === "failed";
    return (
      <MessageContent>
        <Trace>
          <TraceCollapsible defaultOpen={failed}>
            <TraceCollapsibleTrigger>
              <TraceLine status={failed ? "error" : undefined}>
                <TraceIcon>{failed ? <CircleAlertIcon /> : <CircleCheckIcon />}</TraceIcon>
                <TraceTitle>
                  Subagent <Chip kind="agent" label={msg.from} /> {failed ? "failed" : "answered"}
                </TraceTitle>
                {!failed && <TraceDescription>no reply needed</TraceDescription>}
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <Markdown>{msg.body}</Markdown>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      </MessageContent>
    );
  }
  const session = msg.kind === "session";
  return (
    <>
      <MessageAvatar>
        <Avatar size="sm">
          <AvatarFallback>{session ? <MessagesSquareIcon className="size-3.5" /> : <BotIcon className="size-3.5" />}</AvatarFallback>
        </Avatar>
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>
          {session ? <Chip kind="chat" label={msg.from} to={{ chat: msg.sessionId! }} /> : <Chip kind="agent" label={msg.from} to={agentTarget(chat, msg.from)} />}
        </MessageHeader>
        <Bubble variant={session ? "outline" : "tinted"}>
          <BubbleContent>
            <Markdown>{msg.body}</Markdown>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </>
  );
}
