import { ArchiveIcon, EyeIcon, ListIcon, SendIcon, SquareIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { agentTarget, botChip, botChipProps, Chip } from "@/components/ai/chips";
import { Markdown } from "@/components/ai/markdown";
import type { BotSummary } from "@/shared";

/** How one tool call reads in the trace: a line (icon, title, description), what opens under it, and the transcript it touches as a linked chip. */
export type Step = { icon: ReactNode; title: ReactNode; description?: ReactNode; body?: ReactNode; link?: ComponentProps<typeof Chip> };

type Args = { action: string; name?: string; message?: string; followUp?: boolean };

const Chips = ({ chips }: { chips: ReactNode[] }) => chips.length > 0 && <div className="flex flex-wrap gap-1.5">{chips}</div>;

/**
 * The `subagent`, `agents` and `bots` calls (subagent-details): one line per action with the agent or bot as a chip,
 * the message sent and any answer underneath. `bot` is the bot this conversation belongs to and `bots` all of the user's
 * bots, so chips link to conversations. Undefined for any other tool.
 */
export function agentStep(tool: string, a: Args, output: string, running: boolean, bot: BotSummary, bots: BotSummary[]): Step | undefined {
  if (tool !== "subagent" && tool !== "agents" && tool !== "bots") return;
  const v = (ing: string, ed: string) => (running ? ing : ed);
  // While the call streams in, its arguments are partial JSON and may not name the action or its target yet.
  if (!a.action || (a.action !== "list" && !a.name)) return { icon: <UsersIcon />, title: `Calling ${tool}` };
  const sent = a.message && <Markdown>{a.message}</Markdown>;
  const answer = !running && output && <Markdown>{output}</Markdown>;
  if (a.action === "list") {
    // bots: one name per line; agents: "<name>[ (you)]: working|idle" per agent.
    const chips = output.split("\n").flatMap((line) => {
      if (tool === "bots") return line && !line.startsWith("No other") ? [<span key={line}>{botChip(bots, line)}</span>] : [];
      const m = /^(\S+)(?: \(you\))?: (.*)$/.exec(line);
      return m ? [<Chip key={m[1]} label={`${m[1]} · ${m[2]}`} to={agentTarget(bot, m[1])} />] : [];
    });
    return {
      icon: tool === "bots" ? <ListIcon /> : <UsersIcon />,
      title: `${v("Listing", "Listed")} ${tool === "bots" ? "your other bots" : "agents"}`,
      description: running || chips.length ? undefined : "none",
      body: <Chips chips={chips} />,
    };
  }
  if (tool === "bots") {
    const target = botChip(bots, a.name!, false);
    const props = botChipProps(bots, a.name!);
    const link = props.to && { ...props, to: props.to };
    if (a.action === "send") return { icon: <SendIcon />, title: <>{v("Sending", "Sent")} a message to {target}</>, body: sent, link };
    return { icon: <EyeIcon />, title: <>{v("Reading", "Read")} the last answer of {target}</>, body: answer, link };
  }
  const agent = <Chip label={a.name!} />;
  const to = agentTarget(bot, a.name!);
  const link = to && { label: a.name!, to };
  switch (a.action) {
    case "spawn":
      return { icon: <UserPlusIcon />, title: <>{v("Starting", "Started")} subagent {agent}</>, body: sent, link };
    case "send":
      return {
        icon: <SendIcon />,
        title: <>{v("Sending", "Sent")} a message to {agent}</>,
        // A subagent message either steers its current work or queues behind it.
        description: tool === "subagent" ? (a.followUp ? "queued" : "steered") : undefined,
        body: sent,
        link,
      };
    case "stop":
      return { icon: <SquareIcon />, title: <>{v("Stopping", "Stopped")} subagent {agent}</>, link };
    case "retire":
      return { icon: <ArchiveIcon />, title: <>{v("Retiring", "Retired")} subagent {agent}</> };
    case "last":
      return { icon: <EyeIcon />, title: <>{v("Reading", "Read")} the last answer of {agent}</>, body: answer, link };
    case "inspect":
      return { icon: <EyeIcon />, title: <>{v("Inspecting", "Inspected")} {agent}</>, body: answer, link };
  }
  throw new Error(`unknown ${tool} action ${a.action}`);
}
