import { ArchiveIcon, EyeIcon, ListIcon, SendIcon, SquareIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { agentTarget, Chip } from "@/components/ai/chips";
import { Markdown } from "@/components/ai/markdown";
import type { ChatSummary } from "@/shared";

/** How one tool call reads in the trace: a line (icon, title, description), what opens under it, and the transcript it touches as a linked chip. */
export type Step = { icon: ReactNode; title: ReactNode; description?: ReactNode; body?: ReactNode; link?: ComponentProps<typeof Chip> };

type Args = { action: string; name?: string; id?: string; message?: string; followUp?: boolean };

const Chips = ({ chips }: { chips: ReactNode[] }) => chips.length > 0 && <div className="flex flex-wrap gap-1.5">{chips}</div>;

/**
 * The `subagent`, `agents` and `sessions` calls (subagent-details): one line per action with the agent or chat as a
 * chip, the message sent and any answer underneath. `chat` is the chat this transcript belongs to and `chats` all of
 * the user's chats, so chips link to transcripts. Undefined for any other tool.
 */
export function agentStep(tool: string, a: Args, output: string, running: boolean, chat: ChatSummary | undefined, chats: ChatSummary[]): Step | undefined {
  if (tool !== "subagent" && tool !== "agents" && tool !== "sessions") return;
  const v = (ing: string, ed: string) => (running ? ing : ed);
  // While the call streams in, its arguments are partial JSON and may not name the action yet.
  if (!a.action) return { icon: <UsersIcon />, title: `Calling ${tool}` };
  const sent = a.message && <Markdown>{a.message}</Markdown>;
  const answer = !running && output && <Markdown>{output}</Markdown>;
  if (a.action === "list") {
    const sessions = tool === "sessions";
    // sessions: "<id>: <title>" per chat; agents: "<name>[ (you)]: working|idle" per agent.
    const chips = output.split("\n").flatMap((line) => {
      const m = /^(\S+)(?: \(you\))?: (.*)$/.exec(line);
      if (!m) return [];
      return [sessions ? <Chip key={m[1]} kind="chat" label={m[2]} to={{ chat: m[1] }} /> : <Chip key={m[1]} kind="agent" label={`${m[1]} · ${m[2]}`} to={agentTarget(chat, m[1])} />];
    });
    return {
      icon: sessions ? <ListIcon /> : <UsersIcon />,
      title: `${v("Listing", "Listed")} ${sessions ? "your other chats" : "agents"}`,
      description: running || chips.length ? undefined : "none",
      body: <Chips chips={chips} />,
    };
  }
  if (tool === "sessions") {
    const other = chats.find((c) => c.id === a.id);
    const chip = { kind: "chat", label: other?.title ?? "a deleted chat" } as const;
    const target = <Chip {...chip} />;
    const link = other && { ...chip, to: { chat: other.id } };
    if (a.action === "send") return { icon: <SendIcon />, title: <>{v("Sending", "Sent")} a message to {target}</>, body: sent, link };
    return { icon: <EyeIcon />, title: <>{v("Reading", "Read")} the last answer of {target}</>, body: answer, link };
  }
  const chip = { kind: "agent", label: a.name! } as const;
  const agent = <Chip {...chip} />;
  const to = agentTarget(chat, chip.label);
  const link = to && { ...chip, to };
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
