// How a bot's work reads in the thread (DESIGN.md §6 "Intent and outcome"): each tool call is the sentence the model
// wrote for the person (its `intent`, src/server/intent.ts) and how that attempt went, in the same voice. A run reads
// like a short paragraph; no tool names, arguments, SQL or JSON on the surface, no icons. Receipts (the sources, the rows)
// open on request; a page read or a conversation reached is a link.
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, type ReactNode } from "react";
import { clause, count, host, lower, past, prose } from "@/components/ai/intent";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceLine, TraceTitle } from "@/components/ui/trace";
import { BLUR_IN, CrossFade, FADE, useCalm } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { PiMessagePart } from "@/pi/transcript";
import type { BotSummary } from "@/shared";

type ToolCall = Extract<PiMessagePart, { type: "tool-call" }>;
export type ToolResult = Extract<PiMessagePart, { type: "tool-result" }>;

/** What activity rows need beyond their calls: results by call id, whether the session runs (a call without a result in
 * an idle session was interrupted), this bot and all the user's bots (for names and links). */
export type ToolContext = { results: Map<string, ToolResult>; running: boolean; bot: BotSummary; bots: BotSummary[] };

/** One tool call in words. `detail`, `href` and `to` exist only once it is done. */
type Step = {
  id: string;
  /** What the bot set out to do, progressive ("Checking …"); done lines show it in the past tense. Empty while a call
   * streams in before its intent has. */
  intent: string;
  phase: "running" | "done" | "error" | "stopped";
  /** How it went, the clause after the en dash: "3 sources", "didn't work: …", "stopped". */
  outcome?: string;
  /** Receipts a person would open: the sources, the rows. */
  detail?: ReactNode;
  /** The page it read, opening in a new tab. */
  href?: string;
  /** The conversation it reached. */
  to?: { bot: string; agent?: string };
};

const DAYS: Record<string, string> = { "*": "every day", "1-5": "weekdays", "0,6": "weekends", "6,0": "weekends", "0": "Sundays", "1": "Mondays", "2": "Tuesdays", "3": "Wednesdays", "4": "Thursdays", "5": "Fridays", "6": "Saturdays" };

/** A cron schedule in words for the common shapes, else as written. Cron is UTC (src/server/bot.ts routines). */
export function cronText(cron: string) {
  const [m, h, dom, mon, dow] = cron.trim().split(/\s+/);
  if (cron.trim() === "* * * * *") return "every minute";
  if (/^\d+$/.test(m) && h === "*" && dom === "*" && mon === "*" && dow === "*") return `every hour at :${m.padStart(2, "0")}`;
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && dom === "*" && mon === "*" && DAYS[dow]) return `${DAYS[dow]} at ${h.padStart(2, "0")}:${m.padStart(2, "0")} UTC`;
  return `on schedule ${cron} (UTC)`;
}

const output = (r: ToolResult | undefined) => r?.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n") ?? "";

/** web_search output: "1. title\n   url (date)\n   snippet" per result (src/server/web.ts). */
const searchResults = (out: string) => [...out.matchAll(/^\d+\. (.*)\n {3}(\S+)/gm)].map(([, title, url]) => ({ title, url }));

/** sql output: a markdown table then "(N rows…)" (src/server/bot-data.ts), as cells with `\|` unescaped. */
const tableCells = (out: string) => out.split("\n").slice(0, -1).map((line) => line.slice(2, -2).split(/(?<!\\) \| /).map((c) => c.replaceAll("\\|", "|")));

/** Statements whose written-row count means data saved (a CREATE also counts rows written to sqlite_master). */
const SAVES = /\b(insert|replace|update)\b/i;

function describe(call: ToolCall, result: ToolResult | undefined, ctx: ToolContext): Step {
  const a = call.arguments as Record<string, string | undefined>;
  const out = output(result);
  const phase = result ? (result.error ? "error" : "done") : ctx.running ? "running" : "stopped";
  // A tool's own one-line answer ("Sent to Scout.", "No routines.") is already an outcome in words.
  const said = !out.includes("\n") && out.endsWith(".") && out.length <= 80 ? clause(out) : undefined;
  const botNamed = (name = "") => ctx.bots.find((b) => b.name.toLowerCase() === name.toLowerCase());
  const agentTo = (name = "") => {
    const agent = ctx.bot.agents.find((x) => x.name === name);
    return agent && { bot: ctx.bot.id, agent: agent.session };
  };
  /** `history` is the plain wording for older calls, made before every call carried an intent. `done` reads the
   * result, so it runs only once there is one that worked. */
  const step = (history: string, done?: () => Partial<Step>): Step => {
    const s: Step = {
      id: call.id,
      intent: a.intent?.trim() || (phase === "running" ? "" : history),
      phase,
      ...(phase === "done" ? { outcome: said, ...done?.() } : { outcome: phase === "error" ? `didn't work: ${clause(out)}` : phase === "stopped" ? "stopped" : undefined }),
    };
    // An outcome that only repeats the line ("Created scribe – created scribe") says nothing new.
    const plain = (t = "") => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return s.outcome && plain(s.outcome) === plain(past(s.intent)) ? { ...s, outcome: undefined } : s;
  };
  switch (call.name) {
    case "web_search":
      return step(`Searching the web for “${a.query}”`, () => {
        const hits = searchResults(out);
        return hits.length ? { outcome: count(hits.length, "source"), detail: <Sources hits={hits} /> } : {};
      });
    case "web_fetch":
      return step(`Reading ${host(a.url ?? "")}`, () => {
        const url = out.slice(0, out.indexOf("\n"));
        return { outcome: /^\S+\n\n# (.+)/.exec(out)?.[1].trim() || host(url), href: url };
      });
    case "sql":
      if (a.schema) return step("Looking over its tables");
      return step("Working with its data", () => {
        const rows = /^\((\d+) rows/m.exec(out)?.[1];
        if (rows) return { outcome: rows === "0" ? "no rows" : count(Number(rows), "row"), detail: rows !== "0" && <Rows out={out} /> };
        const written = /^OK: (\d+) rows written/.exec(out)?.[1];
        if (!written) throw new Error(`Unexpected sql output: ${out.slice(0, 80)}`);
        return { outcome: SAVES.test(a.query ?? "") ? `${count(Number(written), "row")} saved` : undefined };
      });
    case "library":
      if (a.action === "save") return step("Writing up a report", () => ({ outcome: `“${/^Saved report \d+: (.*)$/.exec(out)![1]}”` }));
      return step(a.action === "read" ? "Opening a report" : "Checking its library");
    case "routines":
      if (a.action === "add") return step(`Setting up the routine “${a.name}”`, () => ({ outcome: `runs ${cronText(a.cron!)}` }));
      return step(a.action === "remove" ? `Removing the routine “${a.name}”` : "Checking its routines");
    case "search":
      return step(`Searching its memory for “${a.text}”`, () => {
        const hits = /^(\d+) /.exec(out)?.[1];
        return hits ? { outcome: count(Number(hits), "match", "matches") } : {};
      });
    case "zoom":
      return step("Looking back through earlier messages");
    case "date":
      return step("Checking when that was said");
    case "bots": {
      const target = botNamed(a.name);
      const to = target && { bot: target.id };
      if (a.action === "send") return step(`Messaging ${a.name}`, () => ({ to }));
      if (a.action === "last") return step(`Checking in with ${a.name}`, () => ({ outcome: `heard back from ${a.name}`, to }));
      return step("Looking at your bots");
    }
    case "subagent": {
      const verb = { spawn: "Bringing in", send: "Briefing", stop: "Pausing" }[a.action ?? ""];
      return step(verb ? `${verb} ${a.name}` : `Letting ${a.name} go`, () => ({ to: agentTo(a.name) }));
    }
    case "agents":
      if (a.action === "send") return step(`Messaging ${a.name}`, () => ({ to: agentTo(a.name) }));
      return step("Checking on the other helpers");
    case "fleet": {
      const target = botNamed(a.action === "rename" ? a.newName : a.name);
      const to = target && { bot: target.id };
      if (a.action === "create") return step(`Creating ${a.name}`, () => ({ to }));
      if (a.action === "rename") return step(`Renaming ${a.name} to ${a.newName}`, () => ({ to }));
      if (a.action === "instruct") return step(`Updating ${a.name}'s instructions`, () => ({ to }));
      if (a.action === "delete") return step(`Deleting ${a.name}`);
      return step("Looking at your bots");
    }
  }
  // A call to a tool the bot doesn't have (the model named one that isn't there); its result is the error.
  return step("Trying something it can't do");
}

/** A search's results as links: title, then host. */
function Sources({ hits }: { hits: { title: string; url: string }[] }) {
  return (
    <Trace>
      {hits.map((h, i) => (
        <a key={i} href={h.url} target="_blank" rel="noreferrer">
          <TraceLine>
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
}

/** A query's rows as a small table, scrolling inside its hairline frame when taller than 16rem or wider than the thread. */
function Rows({ out }: { out: string }) {
  const [head, , ...body] = tableCells(out);
  return (
    <div className="max-h-64 overflow-auto rounded-md border">
      <table className="text-sm tabular-nums">
        <thead className="bg-background text-muted-foreground sticky top-0">
          <tr>
            {head.map((c, i) => (
              <th key={i} scope="col" className="px-2 py-1 text-left font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-foreground">
          {body.map((row, i) => (
            <tr key={i} className="border-t">
              {row.map((c, j) => (
                <td key={j} className="px-2 py-1 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The intent, past tense once done, then how it went after an en dash (a failure in destructive ink, and in words). */
function StepLine({ step }: { step: Step }) {
  return (
    <TraceLine status={step.phase === "running" ? "running" : undefined}>
      <TraceTitle className="whitespace-normal">
        {step.phase === "done" ? past(step.intent) : step.intent}
        {step.outcome && (
          <>
            {" – "}
            <span className={cn(step.phase === "error" && "text-destructive")}>{step.outcome}</span>
          </>
        )}
        {step.href && <span className="sr-only"> (opens in a new tab)</span>}
      </TraceTitle>
    </TraceLine>
  );
}

/** Behavior wraps the line (shadcn rules/chat.md): receipts open underneath, a page or a conversation is a link. */
function StepRow({ step }: { step: Step }) {
  const line = <StepLine step={step} />;
  if (step.detail)
    return (
      <TraceCollapsible>
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent>{step.detail}</TraceCollapsibleContent>
      </TraceCollapsible>
    );
  if (step.href)
    return (
      <a href={step.href} target="_blank" rel="noreferrer">
        {line}
      </a>
    );
  if (step.to)
    return (
      <Link to="/" search={step.to}>
        {line}
      </Link>
    );
  return line;
}

/** More than two settled steps fold into one line written from what worked ("3 things: checked …, saved …, and wrote
 * …"), with what didn't counted after it; it opens to every step. */
function Summary({ steps }: { steps: Step[] }) {
  const things = [...new Set(steps.filter((s) => s.phase === "done").map((s) => lower(past(s.intent))))];
  const failed = steps.filter((s) => s.phase === "error").length;
  const notes = [
    things.length > 0 && `${count(things.length, "thing")}: ${prose(things.length > 3 ? [...things.slice(0, 3), `${things.length - 3} more`] : things)}`,
    failed > 0 && <span className="text-destructive">{things.length ? failed : count(failed, "attempt")} didn't work</span>,
    steps.some((s) => s.phase === "stopped") && "stopped",
  ].filter(Boolean);
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceTitle className="whitespace-normal">
            {notes.map((note, i) => (
              <Fragment key={i}>
                {i > 0 && " – "}
                {note}
              </Fragment>
            ))}
          </TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>
          {steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** A running line that says what the bot is doing now, shimmering; new words ("Scout and Digger are working…")
 * cross-fade over the old in the same line box. */
export function Working({ label = "Thinking…" }: { label?: string }) {
  return (
    <TraceLine className="grid">
      <CrossFade text={label} className="shimmer motion-reduce:shimmer-none" />
    </TraceLine>
  );
}

const MotionTrace = motion.create(Trace);

/**
 * One run of thinking and tool calls. Settled steps read as lines, or past two as a summary that opens to them; running
 * steps follow with their intent shimmering; a live run with nothing running says "Thinking…". Thinking itself never
 * shows once settled (the answer speaks for it).
 */
export function Activity({ parts, live, ctx }: { parts: readonly PiMessagePart[]; live: boolean; ctx: ToolContext }) {
  const settle = useCalm(BLUR_IN);
  const steps = parts.flatMap((p) => (p.type === "tool-call" ? [describe(p, ctx.results.get(p.id), ctx)] : []));
  const settled = steps.filter((s) => s.phase !== "running");
  const running = steps.filter((s) => s.phase === "running" && s.intent);
  if (!live && !settled.length && !running.length) return null;
  const folded = settled.length > 2;
  // Each line is keyed by what it shows, so a step that settles cross-fades from its shimmering intent to its outcome in
  // the same place (popLayout lifts the leaving line out of flow; the Trace is its frame). Lines folding into the
  // summary leave at once and the summary blurs in. Lines there when the run first renders (history) never animate.
  const lines = [
    ...(folded ? [{ key: "summary", line: <Summary steps={settled} /> }] : settled.map((s) => ({ key: `${s.id}:settled`, line: <StepRow step={s} /> }))),
    ...running.map((s) => ({ key: `${s.id}:running`, line: <StepRow step={s} /> })),
    ...(live && !running.length ? [{ key: "thinking", line: <Working /> }] : []),
  ];
  return (
    <Trace className="relative">
      <AnimatePresence initial={false} mode="popLayout" custom={folded}>
        {lines.map(({ key, line }) => (
          <MotionTrace key={key} variants={key === "summary" ? settle : FADE} initial="initial" animate="animate" exit="exit">
            {line}
          </MotionTrace>
        ))}
      </AnimatePresence>
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
