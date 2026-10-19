import { Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { cronText } from "@/components/ai/activity";
import { Markdown } from "@/components/ai/markdown";
import { BotAvatar } from "@/components/bot-avatar";
import { ConfirmSwap, InlineConfirm, QUIET } from "@/components/inline-confirm";
import { BARE, CARD, CELL, DangerRow, FOCUS_IN, FOOTNOTE, Group, Identity, LINE, NAME, ON_HOVER, PanelBody, Saved, TAP, useField, VALUE } from "@/components/panel";
import { StepSlider } from "@/components/step-slider";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ROW } from "@/lib/motion";
import { cn, fail } from "@/lib/utils";
import { botDetails, deleteBot, deleteReport, deleteRoutine, readReport, resetMemory, retireSubagent, setMainBot, setMemoryBudget, setRoutineEnabled, updateBot } from "@/server/fns";
import { VIEW_BUDGETS, type BotDetails, type BotSummary } from "@/shared";

const kb = (n: number) => `${Math.round(n / 1000)}K`;
const day = (ts: number) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The panel's shape while its first read is on the way: two groups of rows. */
function DetailsSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">Loading its library, routines and memory…</span>
      {[3, 2].map((rows) => (
        <div key={rows} aria-hidden className="flex flex-col gap-1.5">
          <Skeleton className="mx-3 h-3 w-16" />
          <div className={CARD}>
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className={cn(LINE, CELL)}>
                <Skeleton className={cn("h-3", ["w-3/5", "w-2/5", "w-1/2"][i])} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One report from the library, read in place of the details: back, the report on its card, then deleting it. */
function Report({ bot, id }: { bot: BotSummary; id: number }) {
  const [body, setBody] = useState<string | Error>();
  const [confirming, setConfirming] = useState(false);
  const navigate = useNavigate();
  useEffect(() => void readReport({ data: { botId: bot.id, id } }).then(setBody, setBody), [bot.id, id]);
  return (
    <PanelBody>
      <Link to="/" search={(s) => ({ ...s, report: undefined })} className="text-muted-foreground hover:text-foreground -mb-3 flex h-8 w-fit items-center rounded-md px-3 text-sm transition-colors duration-150 focus-visible:outline-2">
        Back to library
      </Link>
      <div className={cn(CARD, "p-3")}>
        {body === undefined && (
          <div role="status" className="flex flex-col gap-3">
            <span className="sr-only">Opening the report…</span>
            <Skeleton aria-hidden className="h-5 w-3/4" />
            {["w-full", "w-full", "w-5/6", "w-full", "w-2/3"].map((w, i) => (
              <Skeleton key={i} aria-hidden className={cn("h-3", w)} />
            ))}
          </div>
        )}
        {body instanceof Error && (
          <p role="alert" className="text-muted-foreground text-sm">
            Couldn't open this report: {body.message}
          </p>
        )}
        {typeof body === "string" && <Markdown className="animate-in fade-in text-sm duration-150 ease-out">{body}</Markdown>}
      </div>
      <DangerRow
        className={CARD}
        label="Delete report"
        question="Delete this report?"
        action="Delete"
        asking={confirming}
        onAsk={() => setConfirming(true)}
        onCancel={() => setConfirming(false)}
        onConfirm={() => deleteReport({ data: { botId: bot.id, id } }).then(() => navigate({ to: "/", search: (s) => ({ ...s, report: undefined }) }), fail("delete report"))}
      />
    </PanelBody>
  );
}

/** A bot's details, inline beside its conversation, as grouped lists: who it is, its instructions, library and data,
 * helpers, routines, memory, then its role. Polls while open. `report` opens one report in place of the details. */
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
    <PanelBody>
      <Identity
        face={<BotAvatar bot={bot} size="lg" className="size-12" />}
        name={
          <>
            <label htmlFor="bot-panel-name" className="sr-only">
              Name
            </label>
            <Input
              id="bot-panel-name"
              {...name.control}
              onKeyDown={(e) => (e.key === "Enter" ? e.currentTarget.blur() : name.control.onKeyDown(e))}
              aria-describedby={name.error ? "bot-panel-name-error" : undefined}
              maxLength={32}
              autoComplete="off"
              className={NAME}
            />
          </>
        }
        line={
          <>
            {name.error ? (
              <FieldError id="bot-panel-name-error">{name.error}</FieldError>
            ) : (
              <p className="text-muted-foreground truncate text-sm">{main ? "Main bot · runs your team" : "Takes work from you and your main bot"}</p>
            )}
            <Saved at={name.savedAt} />
          </>
        }
      />

      <Group title="Instructions" id="bot-panel-instructions-title" aside={<Saved at={instructions.savedAt} />} footer={instructions.error && <FieldError id="bot-panel-instructions-error">{instructions.error}</FieldError>}>
        <div className={CARD}>
          <Textarea
            {...instructions.control}
            aria-labelledby="bot-panel-instructions-title"
            aria-describedby={instructions.error ? "bot-panel-instructions-error" : undefined}
            placeholder="Research what I assign you. Cite primary sources."
            className={cn(BARE, "max-h-80")}
          />
        </div>
      </Group>

      {!details &&
        (error ? (
          <p role="alert" className="text-muted-foreground px-3 text-sm">
            Couldn't load its library, routines and memory: {error.message}. Trying again in a moment.
          </p>
        ) : (
          <DetailsSkeleton />
        ))}

      {details && details.library.length > 0 && (
        <Group title="Library">
          <ul className={CARD}>
            <AnimatePresence initial={false}>
              {details.library.map((r) => (
                <motion.li key={r.id} {...ROW} className={LINE}>
                  <Link to="/" search={(s) => ({ ...s, report: r.id })} className={cn(CELL, TAP)}>
                    <span className="min-w-0 flex-1 text-pretty">{r.title}</span>
                    <span className={VALUE}>{day(r.createdAt)}</span>
                  </Link>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </Group>
      )}

      {details && details.tables.length > 0 && (
        <Group title="Data">
          <ul className={CARD}>
            <AnimatePresence initial={false}>
              {details.tables.map((t) => (
                <motion.li key={t.name} {...ROW} className={cn(LINE, CELL)}>
                  <span className="min-w-0 flex-1 break-words">{t.name}</span>
                  <span className={VALUE}>{`${t.rows.toLocaleString()} ${t.rows === 1 ? "row" : "rows"}`}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </Group>
      )}

      {bot.agents.length > 0 && (
        <Group title="Helpers">
          <ul className={CARD}>
            <AnimatePresence initial={false}>
              {bot.agents.map((a) => (
                <motion.li key={a.session} {...ROW} className={LINE}>
                  <ConfirmSwap
                    confirm={
                      confirm === `helper:${a.name}` && (
                        <div className="px-3 py-1.5">
                          <InlineConfirm question={`Retire ${a.name}?`} action="Retire" onCancel={cancel} onConfirm={() => retireSubagent({ data: { botId: bot.id, name: a.name } }).then(cancel, fail("retire helper"))} />
                        </div>
                      )
                    }
                  >
                    <div className="group/row hover:bg-accent flex items-center pr-3 transition-colors duration-150">
                      <Link to="/" search={(s) => ({ ...s, bot: bot.id, agent: a.session })} className={cn(CELL, FOCUS_IN, "flex-1")}>
                        <span className="min-w-0 break-words">{a.name}</span>
                      </Link>
                      <Button variant="ghost" size="sm" aria-label={`Retire ${a.name}`} className={cn(QUIET, ON_HOVER)} onClick={() => setConfirm(`helper:${a.name}`)}>
                        Retire
                      </Button>
                    </div>
                  </ConfirmSwap>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </Group>
      )}

      {details && (
        <Group title="Routines">
          <ul className={CARD}>
            {details.routines.length === 0 && <li className={cn(CELL, "text-muted-foreground py-2.5 text-pretty")}>None yet. Ask {bot.name} something like “every weekday at 8, check the AI news”.</li>}
            <AnimatePresence initial={false}>
              {details.routines.map((r) => (
                <motion.li key={r.id} {...ROW} className={cn(LINE, "group/row")}>
                  <div className="flex items-start gap-3 px-3 py-2.5 text-sm">
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="break-words">{r.name}</span>
                      <span className="text-muted-foreground text-xs font-medium">{r.enabled ? sentence(cronText(r.cron)) : `Paused · ${cronText(r.cron)}`}</span>
                      <p className="text-muted-foreground pt-1 break-words">{r.prompt}</p>
                    </div>
                    <div className="flex h-5 items-center gap-3">
                      {confirm !== `routine:${r.id}` && (
                        <Button variant="ghost" size="sm" aria-label={`Delete routine ${r.name}`} className={cn(QUIET, ON_HOVER)} onClick={() => setConfirm(`routine:${r.id}`)}>
                          Delete
                        </Button>
                      )}
                      <Switch checked={r.enabled} aria-label={`Run ${r.name} on schedule`} onCheckedChange={(on) => setRoutineEnabled({ data: { botId: bot.id, id: r.id, enabled: on } }).catch(fail("change routine"))} />
                    </div>
                  </div>
                  {/* Under the routine it asks about (Delete, beside the switch, is too small to hold it), so it fades in. */}
                  {confirm === `routine:${r.id}` && (
                    <div className="animate-in fade-in px-3 pb-2.5 duration-150 ease-out">
                      <InlineConfirm question={`Delete ${r.name}?`} action="Delete" onCancel={cancel} onConfirm={() => deleteRoutine({ data: { botId: bot.id, id: r.id } }).then(cancel, fail("delete routine"))} />
                    </div>
                  )}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </Group>
      )}

      {memory && (
        <Group title="Memory">
          <ul className={CARD}>
            {/* The slider's label reads as a row label: regular weight, as every other row's. */}
            <li className={cn(LINE, "px-3 pt-3 pb-4 [&_[data-slot=field-label]]:font-normal")}>
              <StepSlider label="How much it keeps in mind" steps={VIEW_BUDGETS.map(kb)} value={VIEW_BUDGETS.findIndex((b) => b === memory.budget)} onCommit={(i) => setMemoryBudget({ data: { botId: bot.id, bytes: VIEW_BUDGETS[i] } }).catch(fail("change memory budget"))} />
            </li>
            <li className={cn(LINE, CELL)}>
              <span className="flex-1">Remembers</span>
              <span className={VALUE}>{`${memory.entries.toLocaleString()} ${memory.entries === 1 ? "message" : "messages"}`}</span>
            </li>
            <li className={cn(LINE, CELL)}>
              <span className="flex-1">In mind now</span>
              <span className={VALUE}>
                {kb(memory.viewBytes)} of {kb(memory.budget)}
              </span>
            </li>
            <li className={cn(LINE, CELL)}>
              <span className="flex-1">Summarizing</span>
              <span className={VALUE}>{memory.building + memory.pending === 0 ? "Up to date" : `${memory.building} now, ${memory.pending} waiting`}</span>
            </li>
            <li className={LINE}>
              <DangerRow label="Reset memory" question="Forget everything it remembers?" action="Forget" asking={confirm === "reset"} onAsk={() => setConfirm("reset")} onCancel={cancel} onConfirm={() => resetMemory({ data: bot.id }).then(cancel, fail("reset memory"))} />
            </li>
          </ul>
        </Group>
      )}

      {/* The main bot can't be deleted; a footnote says why instead of a card holding one gray sentence. */}
      {main ? (
        <p className={FOOTNOTE}>Make another bot main to delete {bot.name}.</p>
      ) : (
        <ul className={CARD}>
          <li className={LINE}>
            <button type="button" className={cn(CELL, TAP)} onClick={() => setMainBot({ data: bot.id }).catch(fail("make main bot"))}>
              Make main bot
            </button>
          </li>
          <li className={LINE}>
            <DangerRow label={`Delete ${bot.name}`} question={`Delete ${bot.name} for good?`} action="Delete" asking={confirm === "delete"} onAsk={() => setConfirm("delete")} onCancel={cancel} onConfirm={() => deleteBot({ data: bot.id }).then(onDeleted, fail("delete bot"))} />
          </li>
        </ul>
      )}
    </PanelBody>
  );
}
