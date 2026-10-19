import { useEffect, useState, type ReactNode } from "react";
import { cronText } from "@/components/ai/activity";
import { Markdown } from "@/components/ai/markdown";
import { BotAvatar } from "@/components/bot-avatar";
import { InlineConfirm } from "@/components/inline-confirm";
import { StepSlider } from "@/components/step-slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn, fail } from "@/lib/utils";
import { botDetails, deleteBot, deleteReport, deleteRoutine, readReport, resetMemory, retireSubagent, setMainBot, setMemoryBudget, setRoutineEnabled, updateBot } from "@/server/fns";
import { VIEW_BUDGETS, type BotDetails, type BotSummary } from "@/shared";

const kb = (n: number) => `${Math.round(n / 1000)}K`;
const day = (ts: number) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
/** A quiet text action that turns red on hover only (DESIGN.md §6 Side panel: destructive last, ghost, inline confirm). */
const QUIET = "text-muted-foreground hover:text-destructive h-7 w-fit px-0 text-sm font-normal hover:bg-transparent dark:hover:bg-transparent";
/** Shows a row's action on hover or focus, always on touch screens (no hover there). */
const ON_HOVER = "opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100";

/** A panel section: a caption title in sentence case, then its content; sections are set apart by space alone. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
      {children}
    </section>
  );
}

/** A row in a panel list: one line, a muted detail on the right. */
function Row({ children, detail, onClick, label }: { children: ReactNode; detail?: ReactNode; onClick?: () => void; label?: string }) {
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {detail && <span className="text-muted-foreground shrink-0 text-xs font-medium tabular-nums">{detail}</span>}
    </>
  );
  const className = "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm";
  return onClick ? (
    <button aria-label={label} onClick={onClick} className={cn(className, "hover:bg-sidebar-accent focus-visible:ring-ring transition-colors duration-150 outline-none focus-visible:ring-2")}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** Saves an edited field when it loses focus (or on Enter for one-line fields); Escape puts the saved value back. */
function useField(saved: string, save: (value: string) => Promise<unknown>) {
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  return {
    value,
    onChange: (e: { currentTarget: { value: string } }) => setValue(e.currentTarget.value),
    onBlur: () => value.trim() !== saved && save(value).catch((e: Error) => (setValue(saved), fail("save")(e))),
    onKeyDown: (e: { key: string; currentTarget: HTMLElement }) => e.key === "Escape" && (setValue(saved), e.currentTarget.blur()),
  };
}

/** One report from the library, read in place of the details. */
function Report({ bot, id, onBack }: { bot: BotSummary; id: number; onBack: () => void }) {
  const [body, setBody] = useState<string | Error>();
  const [confirming, setConfirming] = useState(false);
  useEffect(() => void readReport({ data: { botId: bot.id, id } }).then(setBody, setBody), [bot.id, id]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-6">
      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -ml-2 w-fit px-2 text-sm font-normal" onClick={onBack}>
        Back to library
      </Button>
      {body === undefined && <p className="text-muted-foreground text-sm">Opening the report…</p>}
      {body instanceof Error && (
        <p role="alert" className="text-muted-foreground text-sm">
          Couldn't open this report: {body.message}
        </p>
      )}
      {typeof body === "string" && <Markdown className="text-base">{body}</Markdown>}
      <div className="mt-auto pt-6">
        {confirming ? (
          <InlineConfirm question="Delete this report?" action="Delete" onCancel={() => setConfirming(false)} onConfirm={() => deleteReport({ data: { botId: bot.id, id } }).then(onBack, fail("delete report"))} />
        ) : (
          <Button variant="ghost" size="sm" className={QUIET} onClick={() => setConfirming(true)}>
            Delete report
          </Button>
        )}
      </div>
    </div>
  );
}

/** A bot's details, inline beside its conversation: who it is, its library and data, helpers, routines and memory.
 * Polls while open. `report` opens one report from the library in place of the details. */
export function BotPanel({ bot, main, report, onOpenReport, onOpenAgent, onDeleted }: { bot: BotSummary; main: boolean; report?: number; onOpenReport: (id: number | undefined) => void; onOpenAgent: (session: string) => void; onDeleted: () => void }) {
  const [details, setDetails] = useState<BotDetails | null>(null);
  // One inline question at a time: resetting memory, deleting the bot, a routine or retiring a helper.
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    const poll = () => botDetails({ data: bot.id }).then(setDetails, fail("read bot details"));
    void poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [bot.id]);
  const name = useField(bot.name, (v) => updateBot({ data: { botId: bot.id, name: v } }));
  const instructions = useField(bot.instructions, (v) => updateBot({ data: { botId: bot.id, instructions: v } }));
  const memory = details?.memory;
  const cancel = () => setConfirm(null);
  if (report !== undefined) return <Report bot={bot} id={report} onBack={() => onOpenReport(undefined)} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pb-6">
      <div className="flex flex-col items-center gap-2 pt-2">
        <BotAvatar bot={bot} size="lg" />
        <Input
          {...name}
          onKeyDown={(e) => (e.key === "Enter" ? e.currentTarget.blur() : name.onKeyDown(e))}
          aria-label="Bot name"
          maxLength={32}
          autoComplete="off"
          className="hover:border-input focus-visible:bg-surface h-9 border-transparent bg-transparent text-center text-lg font-semibold shadow-none md:text-lg dark:bg-transparent"
        />
        {main ? (
          <p className="text-muted-foreground text-center text-sm">Main bot · runs your team and can make new bots</p>
        ) : (
          <Button variant="ghost" size="sm" className="text-sm" onClick={() => setMainBot({ data: bot.id }).catch(fail("make main bot"))}>
            Make main bot
          </Button>
        )}
      </div>

      <Section title="Instructions">
        <Textarea {...instructions} aria-label="Instructions" placeholder="What this bot is for, in your words" rows={4} className="bg-surface dark:bg-surface max-h-72 text-sm shadow-none md:text-sm" />
      </Section>

      {details === null && <p className="text-muted-foreground text-sm">Loading its library, routines and memory…</p>}

      {details && details.library.length > 0 && (
        <Section title="Library">
          <ul className="-mx-2 flex flex-col">
            {details.library.map((r) => (
              <li key={r.id}>
                <Row onClick={() => onOpenReport(r.id)} detail={day(r.createdAt)}>
                  {r.title}
                </Row>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {details && details.tables.length > 0 && (
        <Section title="Data">
          <ul className="-mx-2 flex flex-col">
            {details.tables.map((t) => (
              <li key={t.name}>
                <Row detail={`${t.rows.toLocaleString()} ${t.rows === 1 ? "row" : "rows"}`}>{t.name}</Row>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {bot.agents.length > 0 && (
        <Section title="Helpers">
          <ul className="-mx-2 flex flex-col gap-1">
            {bot.agents.map((a) =>
              confirm === `helper:${a.name}` ? (
                <li key={a.session} className="px-2">
                  <InlineConfirm question={`Retire ${a.name}?`} action="Retire" onCancel={cancel} onConfirm={() => retireSubagent({ data: { botId: bot.id, name: a.name } }).then(cancel, fail("retire helper"))} />
                </li>
              ) : (
                <li key={a.session} className="group/row flex items-center gap-1">
                  <Row onClick={() => onOpenAgent(a.session)} label={`Open ${a.name}'s conversation`}>
                    {a.name}
                  </Row>
                  <Button variant="ghost" size="sm" aria-label={`Retire ${a.name}`} className={cn(QUIET, ON_HOVER, "px-2")} onClick={() => setConfirm(`helper:${a.name}`)}>
                    Retire
                  </Button>
                </li>
              ),
            )}
          </ul>
        </Section>
      )}

      {details && (
        <Section title="Routines">
          {details.routines.length === 0 && <p className="text-muted-foreground text-sm">None yet. Ask {bot.name} something like “every weekday at 8, check the AI news”.</p>}
          <ul className="flex flex-col gap-2">
            {details.routines.map((r) => (
              <li key={r.id} className="group/row bg-surface flex flex-col gap-2 rounded-lg p-3 shadow-composer">
                <div className="flex items-start gap-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{r.name}</span>
                    <span className="text-muted-foreground text-xs font-medium">{r.enabled ? cronText(r.cron) : `Paused · ${cronText(r.cron)}`}</span>
                  </div>
                  <Switch checked={r.enabled} aria-label={`Run ${r.name} on schedule`} onCheckedChange={(on) => setRoutineEnabled({ data: { botId: bot.id, id: r.id, enabled: on } }).catch(fail("change routine"))} />
                </div>
                <p className="text-muted-foreground line-clamp-3 text-sm break-words">{r.prompt}</p>
                {confirm === `routine:${r.id}` ? (
                  <InlineConfirm question={`Delete ${r.name}?`} action="Delete" onCancel={cancel} onConfirm={() => deleteRoutine({ data: { botId: bot.id, id: r.id } }).then(cancel, fail("delete routine"))} />
                ) : (
                  <Button variant="ghost" size="sm" aria-label={`Delete routine ${r.name}`} className={cn(QUIET, ON_HOVER, "h-5")} onClick={() => setConfirm(`routine:${r.id}`)}>
                    Delete
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {memory && (
        <Section title="Memory">
          <StepSlider label="How much it keeps in mind" steps={VIEW_BUDGETS.map(kb)} value={VIEW_BUDGETS.findIndex((b) => b === memory.budget)} onCommit={(i) => setMemoryBudget({ data: { botId: bot.id, bytes: VIEW_BUDGETS[i] } }).catch(fail("change memory budget"))} />
          <dl className="text-muted-foreground grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 pt-1 text-sm tabular-nums">
            <dt>Messages remembered</dt>
            <dd className="text-foreground text-right">{memory.entries.toLocaleString()}</dd>
            <dt>In mind now</dt>
            <dd className="text-foreground text-right">
              {kb(memory.viewBytes)} of {kb(memory.budget)}
            </dd>
            <dt>Summarizing</dt>
            <dd className="text-foreground text-right">{memory.building + memory.pending === 0 ? "Up to date" : `${memory.building} now, ${memory.pending} waiting`}</dd>
          </dl>
          {confirm === "reset" ? (
            <InlineConfirm question="Forget everything it remembers?" action="Forget" onCancel={cancel} onConfirm={() => resetMemory({ data: bot.id }).then(cancel, fail("reset memory"))} />
          ) : (
            <Button variant="ghost" size="sm" className={QUIET} onClick={() => setConfirm("reset")}>
              Reset memory
            </Button>
          )}
        </Section>
      )}

      <div className="mt-auto pt-6">
        {main ? (
          <p className="text-muted-foreground text-sm">Make another bot main to delete {bot.name}.</p>
        ) : confirm === "delete" ? (
          <InlineConfirm question={`Delete ${bot.name} for good?`} action="Delete" onCancel={cancel} onConfirm={() => deleteBot({ data: bot.id }).then(onDeleted, fail("delete bot"))} />
        ) : (
          <Button variant="ghost" size="sm" className={QUIET} onClick={() => setConfirm("delete")}>
            Delete {bot.name}
          </Button>
        )}
      </div>
    </div>
  );
}
