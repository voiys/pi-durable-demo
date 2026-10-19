import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cronText } from "@/components/ai/activity";
import { Markdown } from "@/components/ai/markdown";
import { BotAvatar } from "@/components/bot-avatar";
import { InlineConfirm, QUIET } from "@/components/inline-confirm";
import { StepSlider } from "@/components/step-slider";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn, fail } from "@/lib/utils";
import { botDetails, deleteBot, deleteReport, deleteRoutine, readReport, resetMemory, retireSubagent, setMainBot, setMemoryBudget, setRoutineEnabled, updateBot } from "@/server/fns";
import { VIEW_BUDGETS, type BotDetails, type BotSummary } from "@/shared";

const kb = (n: number) => `${Math.round(n / 1000)}K`;
const day = (ts: number) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
/** A panel section's title: a caption in sentence case; sections are set apart by space alone (DESIGN.md §6). */
const CAPTION = "text-muted-foreground text-xs font-medium";
/** Shows a row's action on hover or focus, always on touch screens (no hover there). */
const ON_HOVER = "opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className={CAPTION}>{title}</h3>
      {children}
    </section>
  );
}

/** A muted detail on the right of a row (a date, a count). */
function Detail({ children }: { children: ReactNode }) {
  return (
    <ItemContent>
      <ItemDescription className="text-xs font-medium tabular-nums">{children}</ItemDescription>
    </ItemContent>
  );
}

/** An edited field, saved when it loses focus (or on Enter for one-line fields). A refused value stays in the field,
 * marked invalid with the reason under it, until it's fixed or Escape puts the saved value back. */
function useField(saved: string, save: (value: string) => Promise<unknown>, required?: string) {
  const [value, setValue] = useState(saved);
  const [error, setError] = useState<string>();
  // Escape blurs the field before React has the reverted value, so the blur it causes must not save.
  const reverting = useRef(false);
  useEffect(() => setValue(saved), [saved]);
  const commit = () => {
    const next = value.trim();
    if (next === saved) return setError(undefined);
    if (required && !next) return setError(required);
    save(next).then(() => setError(undefined), (e: Error) => setError(e.message));
  };
  return {
    error,
    control: {
      value,
      "aria-invalid": error ? true : undefined,
      onChange: (e: { currentTarget: { value: string } }) => (setValue(e.currentTarget.value), setError(undefined)),
      onBlur: () => (reverting.current ? (reverting.current = false) : commit()),
      onKeyDown: (e: { key: string; currentTarget: HTMLElement }) => e.key === "Escape" && ((reverting.current = true), setValue(saved), setError(undefined), e.currentTarget.blur()),
    },
  };
}

/** The panel's shape while its first read is on the way: a library of a few rows, then a routine card. */
function DetailsSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">Loading its library, routines and memory…</span>
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div aria-hidden className="flex flex-col gap-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    </div>
  );
}

/** One report from the library, read in place of the details. */
function Report({ bot, id }: { bot: BotSummary; id: number }) {
  const [body, setBody] = useState<string | Error>();
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();
  useEffect(() => void readReport({ data: { botId: bot.id, id } }).then(setBody, setBody), [bot.id, id]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-6">
      <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground -ml-2 w-fit px-2 text-sm font-normal" asChild>
        <Link to="/" search={(s) => ({ ...s, report: undefined })}>
          Back to library
        </Link>
      </Button>
      {body === undefined && (
        <div role="status" className="flex flex-col gap-3 pt-1">
          <span className="sr-only">Opening the report…</span>
          <Skeleton aria-hidden className="h-6 w-3/4" />
          {["w-full", "w-full", "w-5/6", "w-full", "w-2/3"].map((w, i) => (
            <Skeleton key={i} aria-hidden className={cn("h-4", w)} />
          ))}
        </div>
      )}
      {body instanceof Error && (
        <p role="alert" className="text-muted-foreground text-sm">
          Couldn't open this report: {body.message}
        </p>
      )}
      {typeof body === "string" && <Markdown className="text-base">{body}</Markdown>}
      <div className="mt-auto pt-6">
        {confirming ? (
          <InlineConfirm
            question="Delete this report?"
            action="Delete"
            onCancel={() => setConfirming(false)}
            onConfirm={() => deleteReport({ data: { botId: bot.id, id } }).then(() => navigate({ to: "/", search: (s) => ({ ...s, report: undefined }) }), fail("delete report"))}
          />
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
export function BotPanel({ bot, main, report, onDeleted }: { bot: BotSummary; main: boolean; report?: number; onDeleted: () => void }) {
  const [details, setDetails] = useState<BotDetails | null>(null);
  // A failed read is said in place (not a toast on every poll); the next poll that works clears it.
  const [error, setError] = useState<Error>();
  // One inline question at a time: resetting memory, deleting the bot, a routine or retiring a helper.
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    const poll = () => botDetails({ data: bot.id }).then((d) => (setDetails(d), setError(undefined)), setError);
    void poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [bot.id]);
  const name = useField(bot.name, (v) => updateBot({ data: { botId: bot.id, name: v } }), "Give it a name.");
  const instructions = useField(bot.instructions, (v) => updateBot({ data: { botId: bot.id, instructions: v } }));
  const memory = details?.memory;
  const cancel = () => setConfirm(null);
  if (report !== undefined) return <Report bot={bot} id={report} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pb-6">
      <div className="flex flex-col items-center gap-2 pt-2">
        <BotAvatar bot={bot} size="lg" />
        <Field data-invalid={name.error ? true : undefined} className="gap-1">
          <FieldLabel htmlFor="bot-panel-name" className="sr-only">
            Name
          </FieldLabel>
          <Input
            id="bot-panel-name"
            {...name.control}
            onKeyDown={(e) => (e.key === "Enter" ? e.currentTarget.blur() : name.control.onKeyDown(e))}
            aria-describedby={name.error ? "bot-panel-name-error" : undefined}
            maxLength={32}
            autoComplete="off"
            className="hover:border-input focus-visible:bg-surface border-transparent text-center text-lg font-semibold md:text-lg"
          />
          <FieldError id="bot-panel-name-error" className="text-center">
            {name.error}
          </FieldError>
        </Field>
        {main ? (
          <p className="text-muted-foreground text-center text-sm">Main bot · runs your team and can make new bots</p>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setMainBot({ data: bot.id }).catch(fail("make main bot"))}>
            Make main bot
          </Button>
        )}
      </div>

      <Field data-invalid={instructions.error ? true : undefined}>
        <FieldLabel htmlFor="bot-panel-instructions" className={CAPTION}>
          Instructions
        </FieldLabel>
        <Textarea
          id="bot-panel-instructions"
          {...instructions.control}
          aria-describedby={instructions.error ? "bot-panel-instructions-error" : undefined}
          placeholder="Research what I assign you. Cite primary sources."
          rows={4}
          className="bg-surface max-h-72 md:text-sm"
        />
        <FieldError id="bot-panel-instructions-error">{instructions.error}</FieldError>
      </Field>

      {!details &&
        (error ? (
          <p role="alert" className="text-muted-foreground text-sm">
            Couldn't load its library, routines and memory: {error.message}. Trying again in a moment.
          </p>
        ) : (
          <DetailsSkeleton />
        ))}

      {details && details.library.length > 0 && (
        <Section title="Library">
          <ItemGroup className="-mx-2">
            {details.library.map((r) => (
              <li key={r.id}>
                <Item asChild size="sm">
                  <Link to="/" search={(s) => ({ ...s, report: r.id })}>
                    <ItemContent>
                      <ItemTitle>{r.title}</ItemTitle>
                    </ItemContent>
                    <Detail>{day(r.createdAt)}</Detail>
                  </Link>
                </Item>
              </li>
            ))}
          </ItemGroup>
        </Section>
      )}

      {details && details.tables.length > 0 && (
        <Section title="Data">
          <ItemGroup className="-mx-2">
            {details.tables.map((t) => (
              <Item key={t.name} asChild size="sm">
                <li>
                  <ItemContent>
                    <ItemTitle>{t.name}</ItemTitle>
                  </ItemContent>
                  <Detail>{`${t.rows.toLocaleString()} ${t.rows === 1 ? "row" : "rows"}`}</Detail>
                </li>
              </Item>
            ))}
          </ItemGroup>
        </Section>
      )}

      {bot.agents.length > 0 && (
        <Section title="Helpers">
          <ItemGroup className="-mx-2 gap-0.5">
            {bot.agents.map((a) =>
              confirm === `helper:${a.name}` ? (
                <li key={a.session} className="px-2">
                  <InlineConfirm question={`Retire ${a.name}?`} action="Retire" onCancel={cancel} onConfirm={() => retireSubagent({ data: { botId: bot.id, name: a.name } }).then(cancel, fail("retire helper"))} />
                </li>
              ) : (
                <li key={a.session} className="group/row flex items-center gap-1">
                  <Item asChild size="sm" className="flex-1">
                    <Link to="/" search={(s) => ({ ...s, bot: bot.id, agent: a.session })} aria-label={`Open ${a.name}'s conversation`}>
                      <ItemContent>
                        <ItemTitle>{a.name}</ItemTitle>
                      </ItemContent>
                    </Link>
                  </Item>
                  <Button variant="ghost" size="sm" aria-label={`Retire ${a.name}`} className={cn(QUIET, ON_HOVER, "px-2")} onClick={() => setConfirm(`helper:${a.name}`)}>
                    Retire
                  </Button>
                </li>
              ),
            )}
          </ItemGroup>
        </Section>
      )}

      {details && (
        <Section title="Routines">
          {details.routines.length === 0 && <p className="text-muted-foreground text-sm">None yet. Ask {bot.name} something like “every weekday at 8, check the AI news”.</p>}
          <ItemGroup className="gap-2">
            {details.routines.map((r) => (
              <Item key={r.id} asChild variant="card" className="group/row items-start">
                <li>
                  <ItemContent>
                    <ItemTitle>{r.name}</ItemTitle>
                    <ItemDescription className="text-xs font-medium">{r.enabled ? cronText(r.cron) : `Paused · ${cronText(r.cron)}`}</ItemDescription>
                    <ItemDescription className="line-clamp-3 pt-1">{r.prompt}</ItemDescription>
                  </ItemContent>
                  <ItemActions className="gap-3">
                    {confirm !== `routine:${r.id}` && (
                      <Button variant="ghost" size="sm" aria-label={`Delete routine ${r.name}`} className={cn(QUIET, ON_HOVER, "h-5")} onClick={() => setConfirm(`routine:${r.id}`)}>
                        Delete
                      </Button>
                    )}
                    <Switch checked={r.enabled} aria-label={`Run ${r.name} on schedule`} onCheckedChange={(on) => setRoutineEnabled({ data: { botId: bot.id, id: r.id, enabled: on } }).catch(fail("change routine"))} />
                  </ItemActions>
                  {confirm === `routine:${r.id}` && (
                    <ItemFooter>
                      <InlineConfirm className="w-full" question={`Delete ${r.name}?`} action="Delete" onCancel={cancel} onConfirm={() => deleteRoutine({ data: { botId: bot.id, id: r.id } }).then(cancel, fail("delete routine"))} />
                    </ItemFooter>
                  )}
                </li>
              </Item>
            ))}
          </ItemGroup>
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
