import { Link } from "@tanstack/react-router";
import { CalendarIcon, CircleCheckIcon, LoaderCircleIcon, SearchIcon, TerminalIcon, ZoomInIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { agentStep, type Step } from "@/components/ai/agents-tools";
import { Chip } from "@/components/ai/chips";
import { Markdown } from "@/components/ai/markdown";
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockTitle } from "@/components/ui/code-block";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import type { PiMessagePart } from "@/pi/transcript";
import type { ChatSummary } from "@/shared";

type ToolCall = Extract<PiMessagePart, { type: "tool-call" }>;
export type ToolResult = Extract<PiMessagePart, { type: "tool-result" }>;

/**
 * What tool rows need beyond their call: the results by call id, whether the session is running (a call without a
 * result in an idle session was interrupted), and the user's chats so agent and chat chips link to transcripts.
 */
export type ToolContext = { results: Map<string, ToolResult>; running: boolean; chat?: ChatSummary; chats: ChatSummary[] };

/** pi reasoning (chat-demo ReasoningRow, reasoning-duration): a collapsible line, open while thinking, with how long it took. */
export function Reasoning({ text, running }: { text: string; running: boolean }) {
  const [open, setOpen] = useState<boolean>();
  const startedAt = useRef<number>(undefined);
  const [seconds, setSeconds] = useState<number>();
  useEffect(() => {
    if (running) startedAt.current = Date.now();
    else if (startedAt.current) setSeconds(Math.round((Date.now() - startedAt.current) / 1000));
  }, [running]);
  const line = (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>{running ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <CircleCheckIcon />}</TraceIcon>
      <TraceTitle>{running ? "Thinking" : "Thought"}</TraceTitle>
      {seconds !== undefined && <TraceDescription>{seconds}s</TraceDescription>}
    </TraceLine>
  );
  if (!text) return line;
  return (
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Markdown streaming={running}>{text}</Markdown>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

type Args = { id?: number; n?: number; text?: string };

const List = ({ items }: { items: string[] }) => (
  <ul className="flex max-h-64 flex-col gap-1 overflow-auto overscroll-contain">
    {items.map((item, i) => (
      <li key={i} className="whitespace-pre-wrap">
        {item}
      </li>
    ))}
  </ul>
);

/** How one tool call reads: purpose-built for our own tools (memory here, agents in agents-tools), a generic tool-states row for the rest. */
function step(call: ToolCall, output: string, running: boolean, ctx: ToolContext): Step {
  const agent = agentStep(call.name, call.arguments as Parameters<typeof agentStep>[1], output, running, ctx.chat, ctx.chats);
  if (agent) return agent;
  const a = call.arguments as Args;
  const v = (ing: string, ed: string) => (running ? ing : ed);
  switch (call.name) {
    case "search": {
      const count = /^(\d+) /.exec(output)?.[1];
      return {
        icon: <SearchIcon />,
        title: `${v("Searching", "Searched")} memory for "${a.text}"`,
        description: running ? undefined : count ? `${count} ${count === "1" ? "hit" : "hits"}` : "no matches",
        // One "<id> · <date> · <kind>: <snippet>" line per hit, under a count header.
        body: count && <List items={output.split("\n").filter((line) => /^\d+ /.test(line)).slice(1)} />,
      };
    }
    case "zoom": {
      const n = a.n ?? 1;
      return {
        icon: <ZoomInIcon />,
        title: `${v("Opening", "Opened")} ${n > 1 ? `memory ${a.id}–${a.id! + n - 1}` : `message ${a.id}`}`,
        body: output && <List items={output.split("\n")} />,
      };
    }
    case "date":
      return { icon: <CalendarIcon />, title: `${v("Checking", "Checked")} the date of message ${a.id}`, description: output };
  }
  return {
    icon: <TerminalIcon />,
    title: `${v("Running", "Ran")} ${call.name}`,
    description: Object.values(a).find((value) => typeof value === "string"),
    body: (
      <div className="flex flex-col gap-2">
        {(["Input", output && "Output"] as const).map(
          (label) =>
            label && (
              <CodeBlock key={label} size="sm">
                <CodeBlockHeader>
                  <CodeBlockTitle>{label}</CodeBlockTitle>
                </CodeBlockHeader>
                <CodeBlockContent wrap className="max-h-64">
                  {label === "Input" ? JSON.stringify(call.arguments, null, 2) : output}
                </CodeBlockContent>
              </CodeBlock>
            ),
        )}
      </div>
    ),
  };
}

/**
 * A tool call with its matching result (chat-demo ToolRow, tool-states). A running or interrupted line has nothing to
 * open; a finished one opens to its body, a failed one opens by default to the error. A call that touches another
 * transcript links there: the whole line when it has no body, a chip at the top of the body otherwise.
 */
function Tool({ call, ctx }: { call: ToolCall; ctx: ToolContext }) {
  const result = ctx.results.get(call.id);
  const output = result?.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n") ?? "";
  const phase = result ? (result.error ? "error" : "done") : ctx.running ? "running" : "interrupted";
  const s = step(call, output, phase === "running", ctx);
  const description = phase === "interrupted" ? "interrupted" : s.description;
  const line = (
    <TraceLine status={{ running: "running", interrupted: "pending", error: "error", done: undefined }[phase] as "running" | "pending" | "error" | undefined}>
      <TraceIcon>{s.icon}</TraceIcon>
      <TraceTitle>{s.title}</TraceTitle>
      {description && <TraceDescription className="min-w-0 shrink truncate">{description}</TraceDescription>}
    </TraceLine>
  );
  if (phase === "running" || phase === "interrupted") return line;
  const body: ReactNode =
    phase === "error" ? (
      <CodeBlock size="sm" variant="destructive">
        <CodeBlockContent wrap className="max-h-64">
          {output || "(empty)"}
        </CodeBlockContent>
      </CodeBlock>
    ) : (
      s.body
    );
  if (!body)
    return s.link ? (
      <Link to="/" search={s.link.to}>
        {line}
      </Link>
    ) : (
      line
    );
  return (
    <TraceCollapsible defaultOpen={phase === "error"}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-3">
        {s.link && phase === "done" && <Chip {...s.link} />}
        {body}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** Consecutive thinking/tool-call parts of an assistant turn as one Trace (chat-demo); `live` marks the streamed tail. */
export function TraceGroup({ parts, live, ctx }: { parts: readonly PiMessagePart[]; live: boolean; ctx: ToolContext }) {
  return (
    <Trace>
      {parts.map((part, i) => {
        if (part.type === "thinking") return <Reasoning key={i} text={part.text} running={live && i === parts.length - 1} />;
        if (part.type !== "tool-call") throw new Error(`unexpected trace part ${part.type}`);
        return <Tool key={part.id} call={part} ctx={ctx} />;
      })}
    </Trace>
  );
}
