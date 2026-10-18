import { Link } from "@tanstack/react-router";
import { BotIcon, MessagesSquareIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ChatSummary } from "@/shared";

/** Where a chip leads: a chat, or one of its subagents. */
export type ChipTarget = { chat: string; agent?: string };

/**
 * An agent (subagent or peer) or another chat as a badge (badge-link). With `to` it links to that transcript;
 * without it it is plain, e.g. inside a trace trigger, which is already a button.
 */
export function Chip({ kind, label, to }: { kind: "agent" | "chat"; label: string; to?: ChipTarget }) {
  const Icon = kind === "agent" ? BotIcon : MessagesSquareIcon;
  const content = (
    <>
      <Icon className="shrink-0" />
      <span className="truncate" title={label}>
        {label}
      </span>
    </>
  );
  return (
    <Badge asChild={!!to} variant={kind === "agent" ? "secondary" : "outline"} className="max-w-48">
      {to ? (
        <Link to="/" search={to}>
          {content}
        </Link>
      ) : (
        content
      )}
    </Badge>
  );
}

/** Where agent `name` of `chat` lives: main is the chat itself; a retired subagent (or an unknown chat) has no transcript to open. */
export function agentTarget(chat: ChatSummary | undefined, name: string): ChipTarget | undefined {
  if (!chat) return;
  if (name === "main") return { chat: chat.id };
  const found = chat.agents.find((x) => x.name === name);
  return found && { chat: chat.id, agent: found.session };
}
