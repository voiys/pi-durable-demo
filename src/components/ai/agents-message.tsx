import { BotIcon, CalendarClockIcon, CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { agentTarget, botChip, Chip } from "@/components/ai/chips";
import { Markdown } from "@/components/ai/markdown";
import { BotAvatar } from "@/components/bot-avatar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { MessageAvatar, MessageContent, MessageHeader } from "@/components/ui/message";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import type { BotSummary } from "@/shared";

/** A message that is not the user's own words: user-role text the harness prefixes with where it came from
 * (src/server/agents.ts, bot.ts). */
export type AgentMsg = { kind: "bot" | "peer" | "report" | "failed" | "routine"; from: string; body: string };

// The bot pattern is first: its prefix also matches the peer one.
const PREFIXES: [AgentMsg["kind"], RegExp][] = [
  ["bot", /^\[message from bot "([^"]*)"\] ([\s\S]*)$/],
  ["peer", /^\[message from ([^\]]+)\] ([\s\S]*)$/],
  ["report", /^\[subagent (\S+) answered, no reply needed\] ([\s\S]*)$/],
  ["failed", /^\[subagent (\S+) failed: ([\s\S]*)\]$/],
  ["routine", /^\[routine "([^"]*)"\] ([\s\S]*)$/],
];

/** Parses an agent message; undefined for the user's own text. */
export function parseAgentMessage(text: string): AgentMsg | undefined {
  for (const [kind, re] of PREFIXES) {
    const m = re.exec(text);
    if (m) return { kind, from: m[1], body: m[2] };
  }
}

/**
 * The content of an agent message, for a start-aligned Message. Other bots and subagents (message-scroller-group-chat):
 * avatar, the sender as a chip linking to its conversation, a markdown bubble. Subagent reports, failures and routines
 * firing (subagent-demo): one event line with the body on demand; a failure opens by default.
 */
export function AgentMessage({ msg, bot, bots }: { msg: AgentMsg; bot: BotSummary; bots: BotSummary[] }) {
  if (msg.kind === "report" || msg.kind === "failed" || msg.kind === "routine") {
    const failed = msg.kind === "failed";
    return (
      <MessageContent>
        <Trace>
          <TraceCollapsible defaultOpen={failed}>
            <TraceCollapsibleTrigger>
              <TraceLine status={failed ? "error" : undefined}>
                <TraceIcon>{failed ? <CircleAlertIcon /> : msg.kind === "routine" ? <CalendarClockIcon /> : <CircleCheckIcon />}</TraceIcon>
                <TraceTitle className="whitespace-normal">
                  {msg.kind === "routine" ? (
                    <>Routine {msg.from}</>
                  ) : (
                    <>
                      Subagent <Chip label={msg.from} /> {failed ? "failed" : "answered"}
                    </>
                  )}
                </TraceTitle>
                {msg.kind === "report" && <TraceDescription>no reply needed</TraceDescription>}
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
  const sender = msg.kind === "bot" ? bots.find((b) => b.name.toLowerCase() === msg.from.toLowerCase()) : undefined;
  return (
    <>
      <MessageAvatar>
        {sender ? (
          <BotAvatar bot={sender} size="sm" className="size-6 rounded-lg text-[10px]" />
        ) : (
          <Avatar size="sm">
            <AvatarFallback>
              <BotIcon className="size-3.5" />
            </AvatarFallback>
          </Avatar>
        )}
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>{msg.kind === "bot" ? botChip(bots, msg.from) : <Chip label={msg.from} to={agentTarget(bot, msg.from)} />}</MessageHeader>
        <Bubble variant={msg.kind === "bot" ? "outline" : "tinted"}>
          <BubbleContent>
            <Markdown>{msg.body}</Markdown>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </>
  );
}
