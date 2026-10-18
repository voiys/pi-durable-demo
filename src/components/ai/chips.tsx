import { Link } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";
import { BotAvatar } from "@/components/bot-avatar";
import { Badge } from "@/components/ui/badge";
import type { BotSummary } from "@/shared";

/** Where a chip leads: a bot, or one of its subagents. */
export type ChipTarget = { bot: string; agent?: string };

/**
 * A subagent or another bot as a badge (badge-link). With `to` it links to that conversation; without it it is plain,
 * e.g. inside a trace trigger, which is already a button. A bot chip carries the bot's face.
 */
export function Chip({ label, bot, to }: { label: string; bot?: Pick<BotSummary, "name" | "color">; to?: ChipTarget }) {
  const content = (
    <>
      {bot ? <BotAvatar bot={bot} size="sm" className="size-3.5 rounded-[4px] text-[8px]" /> : <BotIcon className="shrink-0" />}
      <span className="truncate" title={label}>
        {label}
      </span>
    </>
  );
  return (
    <Badge asChild={!!to} variant={bot ? "outline" : "secondary"} className="max-w-48">
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

/** Where subagent `name` of `bot` lives: main is the bot itself; a retired subagent has no conversation to open. */
export function agentTarget(bot: BotSummary, name: string): ChipTarget | undefined {
  if (name === "main") return { bot: bot.id };
  const found = bot.agents.find((x) => x.name === name);
  return found && { bot: bot.id, agent: found.session };
}

/** A bot's chip props by name (bots address each other by name), linked while the bot exists. */
export function botChipProps(bots: BotSummary[], name: string) {
  const bot = bots.find((b) => b.name.toLowerCase() === name.toLowerCase());
  return { label: bot?.name ?? name, bot: bot ?? { name, color: "var(--muted-foreground)" }, to: bot && { bot: bot.id } };
}

/** A bot chip by name; `linked: false` inside a trace line, which is already a button. */
export function botChip(bots: BotSummary[], name: string, linked = true) {
  const { to, ...props } = botChipProps(bots, name);
  return <Chip {...props} to={linked ? to : undefined} />;
}
