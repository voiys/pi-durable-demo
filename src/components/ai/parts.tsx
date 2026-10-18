import { SparklesIcon, TerminalIcon, UsersIcon } from "lucide-react";
import { Streamdown } from "streamdown";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
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

type ToolCall = Extract<PiMessagePart, { type: "tool-call" }>;
export type ToolResult = Extract<PiMessagePart, { type: "tool-result" }>;

/** Assistant text. While `streaming`, Streamdown fades new words in and shows a caret (its own `animated` mode). */
export function Markdown({ children, streaming = false }: { children: string; streaming?: boolean }) {
  return (
    <Streamdown className="w-full min-w-0 overflow-hidden" isAnimating={streaming} animated caret={streaming ? "block" : undefined}>
      {children}
    </Streamdown>
  );
}

/** pi reasoning (reasoning-demo): a collapsible "Thinking" line. */
function Reasoning({ text, running }: { text: string; running: boolean }) {
  const line = (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>
        <SparklesIcon />
      </TraceIcon>
      <TraceTitle>{running ? "Thinking" : "Thought"}</TraceTitle>
    </TraceLine>
  );
  if (!text) return line;
  return (
    <TraceCollapsible defaultOpen={running}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap">{text}</TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/**
 * A tool call with its matching result (tool-states); no result yet means it is running.
 * The `subagent` tool renders as subagent-details: its action, the message, and the reply.
 */
function Tool({ call, result }: { call: ToolCall; result?: ToolResult }) {
  const status = result === undefined ? "running" : result.error ? "error" : undefined;
  const output = result?.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");
  const sub = call.name === "subagent" ? (call.arguments as { action: string; name: string; message?: string }) : undefined;
  return (
    <TraceCollapsible defaultOpen={sub !== undefined || status === "error"}>
      <TraceCollapsibleTrigger>
        <TraceLine status={status}>
          <TraceIcon>{sub ? <UsersIcon /> : <TerminalIcon />}</TraceIcon>
          <TraceTitle>
            {status === "running" ? "Running" : status === "error" ? "Failed" : "Ran"} {sub ? `subagent ${sub.name}` : call.name}
          </TraceTitle>
          {sub && <TraceDescription>{sub.action}</TraceDescription>}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-2">
        {sub ? (
          <>
            {sub.message && <p className="whitespace-pre-wrap">{sub.message}</p>}
            {output && <Markdown>{output}</Markdown>}
          </>
        ) : (
          <>
            <CodeBlock size="sm">
              <CodeBlockContent wrap className="max-h-48">
                {JSON.stringify(call.arguments, null, 2)}
              </CodeBlockContent>
            </CodeBlock>
            {result && (
              <CodeBlock size="sm" variant={result.error ? "destructive" : undefined}>
                <CodeBlockContent wrap className="max-h-64">
                  {output || "(empty)"}
                </CodeBlockContent>
              </CodeBlock>
            )}
          </>
        )}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** Consecutive thinking/tool-call parts of an assistant message as one Trace (trace-turn). */
export function TraceGroup({ parts, results, live }: { parts: readonly PiMessagePart[]; results: Map<string, ToolResult>; live: boolean }) {
  return (
    <Trace>
      {parts.map((part, i) => {
        if (part.type === "thinking") return <Reasoning key={i} text={part.text} running={live && i === parts.length - 1} />;
        if (part.type !== "tool-call") throw new Error(`unexpected trace part ${part.type}`);
        return <Tool key={part.id} call={part} result={results.get(part.id)} />;
      })}
    </Trace>
  );
}
