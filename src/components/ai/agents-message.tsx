import { Link } from "@tanstack/react-router";
import { BotIcon, CalendarClockIcon, CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { Markdown } from "@/components/ai/markdown";
import { BotAvatar } from "@/components/bot-avatar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { MessageAvatar, MessageContent, MessageHeader } from "@/components/ui/message";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
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
 * An agent message in the thread, iMessage group-chat style. Another bot or a helper speaks like a person in a group:
 * its face, its name above a gray bubble. A helper's report, a failure and a routine firing are one quiet line that
 * opens to the text.
 */
export function AgentMessage({ msg, bot, bots }: { msg: AgentMsg; bot: BotSummary; bots: BotSummary[] }) {
  if (msg.kind === "report" || msg.kind === "failed" || msg.kind === "routine") {
    const failed = msg.kind === "failed";
    const title = msg.kind === "routine" ? `Routine: ${msg.from}` : failed ? `${msg.from} couldn't finish` : `${msg.from} reported back`;
    return (
      <MessageContent>
        <Trace>
          <TraceCollapsible defaultOpen={failed}>
            <TraceCollapsibleTrigger>
              <TraceLine status={failed ? "error" : undefined}>
                <TraceIcon>{failed ? <CircleAlertIcon /> : msg.kind === "routine" ? <CalendarClockIcon /> : <CircleCheckIcon />}</TraceIcon>
                <TraceTitle className="whitespace-normal">{title}</TraceTitle>
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
  const helper = msg.kind === "peer" ? bot.agents.find((a) => a.name === msg.from) : undefined;
  const to = sender ? { bot: sender.id } : helper ? { bot: bot.id, agent: helper.session } : undefined;
  return (
    <>
      <MessageAvatar className="self-end">
        {sender ? (
          <BotAvatar bot={sender} className="size-7 rounded-full text-xs" />
        ) : (
          <Avatar className="size-7">
            <AvatarFallback>
              <BotIcon className="size-3.5" />
            </AvatarFallback>
          </Avatar>
        )}
      </MessageAvatar>
      <MessageContent>
        <MessageHeader className="text-muted-foreground px-3 text-xs">
          {to ? (
            <Link to="/" search={to} className="hover:text-foreground transition-colors">
              {sender?.name ?? msg.from}
            </Link>
          ) : (
            msg.from
          )}
        </MessageHeader>
        <Bubble variant="muted">
          <BubbleContent className="rounded-[18px]">
            <Markdown>{msg.body}</Markdown>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </>
  );
}
