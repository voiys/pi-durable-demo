import { useState } from "react";
import { Markdown } from "@/components/ai/markdown";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { cn } from "@/lib/utils";
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

/** Someone speaking in a thread besides the user: a bot (its color is its face) or a helper (a gray face), and where its
 * own conversation is. `key` groups consecutive messages from them. */
export type Sender = { key: string; name: string; color?: string; to?: { bot: string; agent?: string } };

/** Another bot or a helper talking in this bot's thread, as a group-chat sender. Events are not senders. */
export function agentSender(msg: AgentMsg, bot: BotSummary, bots: BotSummary[]): Sender {
  if (msg.kind === "bot") {
    const sender = bots.find((b) => b.name.toLowerCase() === msg.from.toLowerCase());
    return { key: `bot:${msg.from.toLowerCase()}`, name: sender?.name ?? msg.from, color: sender?.color, to: sender && { bot: sender.id } };
  }
  const helper = bot.agents.find((a) => a.name === msg.from);
  return { key: `helper:${msg.from}`, name: msg.from, to: helper && { bot: bot.id, agent: helper.session } };
}

/** True for what happens in the thread rather than someone saying it: a helper reporting back or failing, a routine firing. */
export const isEvent = (msg: AgentMsg) => msg.kind === "report" || msg.kind === "failed" || msg.kind === "routine";

const EVENT_TITLE: Record<"report" | "failed" | "routine", (from: string) => string> = {
  report: (from) => `${from} reported back`,
  failed: (from) => `${from} couldn't finish`,
  routine: (from) => `Routine ${from} ran`,
};

/** A thread event as one centered caption ("Routine ai-news ran"); it opens to what was said, a failure starts open. */
export function SystemEvent({ msg }: { msg: AgentMsg }) {
  if (msg.kind !== "report" && msg.kind !== "failed" && msg.kind !== "routine") throw new Error(`not an event: ${msg.kind}`);
  const failed = msg.kind === "failed";
  const [open, setOpen] = useState(failed);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col items-center gap-2">
      <Marker className="justify-center">
        <MarkerContent>
          <CollapsibleTrigger
            className={cn(
              "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-sm px-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3",
              failed && "text-destructive hover:text-destructive",
            )}
          >
            {EVENT_TITLE[msg.kind](msg.from)}
          </CollapsibleTrigger>
        </MarkerContent>
      </Marker>
      <CollapsibleContent className="data-open:animate-accordion-down data-closed:animate-accordion-up w-full max-w-[520px] overflow-hidden duration-200 [--radix-accordion-content-height:var(--radix-collapsible-content-height)] motion-reduce:animate-none">
        <div className="bg-canvas rounded-lg px-3.5 py-2.5 text-sm">
          <Markdown>{msg.body}</Markdown>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
