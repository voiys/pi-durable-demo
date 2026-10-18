// What a bot did while answering, in plain words: one summary line per run of tool calls ("Searched the web, read 2
// pages and saved data"), opening to one line per step. Arguments, SQL and raw output never show as such; a step's detail
// is what a person would want to see (the sources, the rows, the report).
import { Link } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArrowUpRightIcon,
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  CalendarClockIcon,
  DatabaseIcon,
  FileTextIcon,
  GlobeIcon,
  HistoryIcon,
  SendIcon,
  SparklesIcon,
  UserPlusIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Markdown } from "@/components/ai/markdown";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import type { PiMessagePart } from "@/pi/transcript";
import type { BotSummary } from "@/shared";

type ToolCall = Extract<PiMessagePart, { type: "tool-call" }>;
export type ToolResult = Extract<PiMessagePart, { type: "tool-result" }>;

/** What activity rows need beyond their calls: results by call id, whether the session runs (a call without a result in
 * an idle session was interrupted), this bot and all the user's bots (for names and links). */
export type ToolContext = { results: Map<string, ToolResult>; running: boolean; bot: BotSummary; bots: BotSummary[] };

/** One step in words. `summary` is the short past-tense phrase the run's summary line joins ("read 2 pages" counts). */
type Step = { icon: ReactNode; doing: string; done: string; summary: string; detail?: ReactNode; href?: string; to?: { bot: string; agent?: string } };

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
/** ` for “query”`, or nothing while the call's arguments are still streaming in. */
const quoted = (prefix: string, s: unknown) => (String(s ?? "").trim() ? `${prefix} “${String(s).trim()}”` : "");
const DAYS: Record<string, string> = { "*": "every day", "1-5": "weekdays", "0,6": "weekends", "6,0": "weekends", "0": "Sundays", "1": "Mondays", "2": "Tuesdays", "3": "Wednesdays", "4": "Thursdays", "5": "Fridays", "6": "Saturdays" };

/** A cron schedule in words for the common shapes, else as written. Cron is UTC (src/server/bot.ts routines). */
export function cronText(cron: string) {
  const [m, h, dom, mon, dow] = cron.trim().split(/\s+/);
  if (cron.trim() === "* * * * *") return "every minute";
  if (/^\d+$/.test(m) && h === "*" && dom === "*" && mon === "*" && dow === "*") return `every hour at :${m.padStart(2, "0")}`;
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === "*" && mon === "*" && DAYS[dow]) return `${DAYS[dow]} at ${h.padStart(2, "0")}:${m.padStart(2, "0")} UTC`;
  return `on schedule ${cron} (UTC)`;
}

/** web_search output: "1. title\n   url (date)\n   snippet" per result (src/server/web.ts). */
function searchResults(output: string) {
  return [...output.matchAll(/^\d+\. (.*)\n {3}(\S+)[^\n]*\n {3}(.*)$/gm)].map(([, title, url, snippet]) => ({ title, url, snippet }));
}

/** Tables a SQL batch writes to, in order. */
const writtenTables = (sql: string) => [...new Set([...sql.matchAll(/\b(?:insert\s+(?:or\s+\w+\s+)?into|create\s+(?:temp\w*\s+)?(?:table|view)\s+(?:if\s+not\s+exists\s+)?|update|delete\s+from)\s+["`]?(\w+)/gi)].map((m) => m[1]))];

const output = (r: ToolResult | undefined) => r?.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n") ?? "";

function describe(call: ToolCall, result: ToolResult | undefined, ctx: ToolContext): Step {
  const a = (call.arguments ?? {}) as Record<string, string | number | boolean | undefined>;
  const out = output(result);
  const botNamed = (name: unknown) => ctx.bots.find((b) => b.name.toLowerCase() === String(name ?? "").toLowerCase());
  const s = (icon: ReactNode, doing: string, done: string, summary = done.charAt(0).toLowerCase() + done.slice(1), extra: Partial<Step> = {}): Step => ({ icon, doing, done, summary, ...extra });
  switch (call.name) {
    case "web_search": {
      const hits = searchResults(out);
      const detail = hits.length > 0 && (
        <Trace>
          {hits.slice(0, 8).map((h) => (
            <a key={h.url} href={h.url} target="_blank" rel="noreferrer">
              <TraceLine>
                <TraceIcon>
                  <GlobeIcon />
                </TraceIcon>
                <TraceTitle>
                  {h.title}
                  <span className="sr-only"> (opens in a new tab)</span>
                </TraceTitle>
                <TraceDescription>{host(h.url)}</TraceDescription>
              </TraceLine>
            </a>
          ))}
        </Trace>
      );
      return s(<GlobeIcon />, `Searching the web${quoted(" for", a.query)}`, `Searched the web${quoted(" for", a.query)}`, "searched the web", { detail });
    }
    case "web_fetch":
      return s(<BookOpenIcon />, `Reading ${host(String(a.url ?? ""))}`, `Read ${host(String(a.url ?? ""))}`, "page", { href: String(a.url ?? "") });
    case "sql": {
      if (a.schema) return s(<DatabaseIcon />, "Checking its data", "Checked its data");
      const tables = writtenTables(String(a.query ?? ""));
      const table = /^\|/.test(out) && <Markdown>{out.replace(/\n\(\d+ rows.*\)$/, "")}</Markdown>;
      return tables.length
        ? s(<DatabaseIcon />, `Saving data to ${tables.join(", ")}`, `Saved data to ${tables.join(", ")}`, "saved data", { detail: table })
        : s(<DatabaseIcon />, "Looking at its data", "Looked at its data", "analyzed data", { detail: table });
    }
    case "library":
      if (a.action === "save") return s(<FileTextIcon />, `Writing a report: ${a.title ?? ""}`, `Wrote a report: ${a.title ?? ""}`, "wrote a report");
      if (a.action === "read") return s(<FileTextIcon />, "Opening a report", "Opened a report");
      return s(<FileTextIcon />, "Checking its library", "Checked its library");
    case "routines":
      if (a.action === "add") return s(<CalendarClockIcon />, `Setting up ${a.name ?? "a routine"}`, `Set up ${a.name}, ${cronText(String(a.cron ?? ""))}`, "set up a routine", { detail: a.prompt && <p className="text-muted-foreground">{String(a.prompt)}</p> });
      if (a.action === "remove") return s(<CalendarClockIcon />, `Removing ${a.name ?? "a routine"}`, `Removed ${a.name}`, "removed a routine");
      return s(<CalendarClockIcon />, "Checking its routines", "Checked its routines");
    case "search":
      return s(<HistoryIcon />, `Searching its memory${quoted(" for", a.text)}`, `Searched its memory${quoted(" for", a.text)}`, "searched its memory");
    case "zoom":
      return s(<HistoryIcon />, "Looking back through earlier messages", "Looked back through earlier messages", "looked back");
    case "date":
      return s(<HistoryIcon />, "Checking when that was", "Checked when that was", "looked back");
    case "bots": {
      const target = botNamed(a.name);
      const name = target?.name ?? String(a.name ?? "a bot");
      const to = target && { bot: target.id };
      if (a.action === "send") return s(<SendIcon />, `Messaging ${name}`, `Messaged ${name}`, `messaged ${name}`, { to, detail: a.message && <Markdown>{String(a.message)}</Markdown> });
      if (a.action === "last") return s(<SendIcon />, `Checking in with ${name}`, `Checked in with ${name}`, `checked in with ${name}`, { to });
      return s(<UsersIcon />, "Looking at your bots", "Looked at your bots");
    }
    case "subagent": {
      const name = String(a.name ?? "a helper");
      const agent = ctx.bot.agents.find((x) => x.name === name);
      const to = agent && { bot: ctx.bot.id, agent: agent.session };
      const detail = a.message && <Markdown>{String(a.message)}</Markdown>;
      if (a.action === "spawn") return s(<UserPlusIcon />, `Bringing in ${name}`, `Brought in ${name}`, `brought in ${name}`, { to, detail });
      if (a.action === "send") return s(<SendIcon />, `Briefing ${name}`, `Briefed ${name}`, `briefed ${name}`, { to, detail });
      if (a.action === "stop") return s(<ArchiveIcon />, `Stopping ${name}`, `Stopped ${name}`);
      return s(<ArchiveIcon />, `Letting ${name} go`, `Let ${name} go`);
    }
    case "agents":
      if (a.action === "send") return s(<SendIcon />, `Messaging ${a.name ?? "a helper"}`, `Messaged ${a.name}`, `messaged ${a.name}`, { detail: a.message && <Markdown>{String(a.message)}</Markdown> });
      return s(<BotIcon />, "Checking on its helpers", "Checked on its helpers");
    case "fleet": {
      const name = String(a.name ?? "a bot");
      const target = botNamed(a.action === "rename" ? a.newName : a.name);
      const to = target && { bot: target.id };
      if (a.action === "create") return s(<SparklesIcon />, `Creating ${name}`, `Created ${name}`, `created ${name}`, { to, detail: a.instructions && <p className="text-muted-foreground">{String(a.instructions)}</p> });
      if (a.action === "rename") return s(<BotIcon />, `Renaming ${name}`, `Renamed ${name} to ${a.newName}`, `renamed ${name}`, { to });
      if (a.action === "instruct") return s(<BotIcon />, `Updating ${name}`, `Updated ${name}'s instructions`, `updated ${name}`, { to, detail: a.instructions && <p className="text-muted-foreground">{String(a.instructions)}</p> });
      if (a.action === "delete") return s(<ArchiveIcon />, `Deleting ${name}`, `Deleted ${name}`, `deleted ${name}`);
      return s(<UsersIcon />, "Looking at your bots", "Looked at your bots");
    }
  }
  const tool = call.name.replace(/[_-]+/g, " ");
  return s(<WrenchIcon />, `Using ${tool}`, `Used ${tool}`);
}

/** "a, b and c", with repeated page reads counted ("read 3 pages"). */
function summarize(steps: Step[]) {
  const pages = steps.filter((st) => st.summary === "page").length;
  const phrases = [...new Set(steps.map((st) => (st.summary === "page" ? (pages === 1 ? `read ${host(st.href ?? "")}` : `read ${pages} pages`) : st.summary)))];
  const text = phrases.length > 1 ? `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}` : phrases[0];
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One step's line: a link opens the page or conversation, a detail opens underneath, an error opens by default. */
function StepRow({ step, phase, error }: { step: Step; phase: "running" | "done" | "error" | "interrupted"; error: string }) {
  const line = (
    <TraceLine status={phase === "running" ? "running" : phase === "error" ? "error" : undefined}>
      <TraceIcon>{step.icon}</TraceIcon>
      <TraceTitle className="whitespace-normal">{phase === "running" || phase === "interrupted" ? step.doing : phase === "error" ? `Couldn't finish: ${step.doing.charAt(0).toLowerCase()}${step.doing.slice(1)}` : step.done}</TraceTitle>
      {phase === "interrupted" && <TraceDescription>stopped</TraceDescription>}
      {step.href && phase === "done" && (
        <TraceIcon>
          <ArrowUpRightIcon />
        </TraceIcon>
      )}
    </TraceLine>
  );
  if (phase === "error")
    return (
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <CodeBlock size="sm" variant="destructive">
            <CodeBlockContent wrap className="max-h-64">
              {error || "No details"}
            </CodeBlockContent>
          </CodeBlock>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    );
  if (phase !== "done") return line;
  if (step.href)
    return (
      <a href={step.href} target="_blank" rel="noreferrer">
        {line}
      </a>
    );
  if (step.detail)
    return (
      <TraceCollapsible>
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-2">
          {step.detail}
          {step.to && (
            <Link to="/" search={step.to} className="text-muted-foreground hover:text-foreground w-fit text-xs underline-offset-4 transition-colors hover:underline">
              Open conversation
            </Link>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    );
  return step.to ? (
    <Link to="/" search={step.to}>
      {line}
    </Link>
  ) : (
    line
  );
}

/** pi reasoning: hidden detail of the run; while it streams, the run's summary says "Thinking". */
function Thought({ text }: { text: string }) {
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceIcon>
            <BrainIcon />
          </TraceIcon>
          <TraceTitle>Thought it through</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Markdown>{text}</Markdown>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** A running line that says what the bot is doing now; shimmer comes from TraceLine's running status. */
export function Working({ label = "Thinking" }: { label?: string }) {
  return (
    <TraceLine status="running">
      <TraceIcon>
        <SparklesIcon />
      </TraceIcon>
      <TraceTitle className="whitespace-normal">{label}</TraceTitle>
    </TraceLine>
  );
}

/** How long a live run has taken, in seconds, frozen when it ends. */
function useElapsed(live: boolean) {
  const started = useRef<number>(undefined);
  const [seconds, setSeconds] = useState<number>();
  useEffect(() => {
    if (!live) return;
    started.current ??= Date.now();
    const t = setInterval(() => setSeconds(Math.round((Date.now() - started.current!) / 1000)), 1000);
    return () => clearInterval(t);
  }, [live]);
  return seconds;
}

/**
 * One run of thinking and tool calls (chat-demo, Trace summary pattern): while live, the current step in words; after,
 * a summary that opens to every step. A run of only thinking shows nothing once done (the answer speaks for it).
 */
export function Activity({ parts, live, ctx }: { parts: readonly PiMessagePart[]; live: boolean; ctx: ToolContext }) {
  const seconds = useElapsed(live);
  const calls = parts.filter((p): p is ToolCall => p.type === "tool-call");
  const steps = calls.map((call) => {
    const result = ctx.results.get(call.id);
    const phase = result ? (result.error ? "error" : "done") : ctx.running ? "running" : "interrupted";
    return { call, step: describe(call, result, ctx), phase, error: output(result) } as const;
  });
  const current = steps.findLast((s) => s.phase === "running");
  if (live)
    return (
      <Trace>
        <Working label={current?.step.doing ?? "Thinking"} />
      </Trace>
    );
  if (!steps.length) return null;
  // One step needs no summary over it: the step's own line says it all.
  if (steps.length === 1 && !parts.some((p) => p.type === "thinking" && p.text.trim()))
    return (
      <Trace>
        <StepRow {...steps[0]} />
      </Trace>
    );
  const failed = steps.filter((s) => s.phase === "error").length;
  // The summary names only what worked; failures are counted beside it and open by default.
  const worked = steps.filter((s) => s.phase !== "error").map((s) => s.step);
  const summary = (
    <TraceLine status={current ? "running" : worked.length ? undefined : "error"}>
      <TraceIcon>
        <SparklesIcon />
      </TraceIcon>
      <TraceTitle className="whitespace-normal">{current ? current.step.doing : worked.length ? summarize(worked) : "Couldn't finish"}</TraceTitle>
      {failed > 0 && worked.length > 0 && <TraceDescription className="text-destructive">{failed} didn't work</TraceDescription>}
      {!failed && seconds !== undefined && <TraceDescription>{seconds}s</TraceDescription>}
    </TraceLine>
  );
  return (
    <Trace>
      <TraceCollapsible defaultOpen={failed > 0}>
        <TraceCollapsibleTrigger>{summary}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>
            {parts.map((part, i) =>
              part.type === "thinking" ? (
                part.text.trim() && <Thought key={i} text={part.text} />
              ) : part.type === "tool-call" ? (
                <StepRow key={part.id} {...steps.find((s) => s.call.id === part.id)!} />
              ) : null,
            )}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** Reports a run saved to the bot's library, to show as cards after it. */
export function savedReports(parts: readonly PiMessagePart[], ctx: ToolContext) {
  return parts.flatMap((p) => {
    if (p.type !== "tool-call" || p.name !== "library") return [];
    const a = p.arguments as { action?: string; title?: string };
    const out = output(ctx.results.get(p.id));
    const id = /^Saved report (\d+):/.exec(out)?.[1];
    return a.action === "save" && id ? [{ id: Number(id), title: a.title ?? "Report" }] : [];
  });
}
