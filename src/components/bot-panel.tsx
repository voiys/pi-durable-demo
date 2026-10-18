import { Archive, BotIcon, ChevronLeft, CrownIcon, DatabaseIcon, FileTextIcon, RotateCcw, Trash2 } from "lucide-react";
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
import { fail } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { botDetails, deleteBot, deleteReport, deleteRoutine, readReport, resetMemory, retireSubagent, setMainBot, setMemoryBudget, setRoutineEnabled, updateBot } from "@/server/fns";
import { VIEW_BUDGETS, type BotDetails, type BotSummary } from "@/shared";

const kb = (n: number) => `${Math.round(n / 1000)}K`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
      {children}
    </section>
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
  const [body, setBody] = useState<string>();
  useEffect(() => void readReport({ data: { botId: bot.id, id } }).then(setBody, fail("open report")), [bot.id, id]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
          <ChevronLeft /> Library
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Delete report" onClick={() => deleteReport({ data: { botId: bot.id, id } }).then(onBack, fail("delete report"))}>
          <Trash2 />
        </Button>
      </div>
      {body !== undefined && <Markdown className="text-sm">{body}</Markdown>}
    </div>
  );
}

/** A bot's details, inline beside its conversation: who it is, its library and data, helpers, routines and memory.
 * Polls while open. `report` opens one report from the library in place of the details. */
export function BotPanel({ bot, main, report, onOpenReport, onOpenAgent, onDeleted }: { bot: BotSummary; main: boolean; report?: number; onOpenReport: (id: number | undefined) => void; onOpenAgent: (session: string) => void; onDeleted: () => void }) {
  const [details, setDetails] = useState<BotDetails | null>(null);
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  useEffect(() => {
    const poll = () => botDetails({ data: bot.id }).then(setDetails, fail("read bot details"));
    void poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [bot.id]);
  const name = useField(bot.name, (v) => updateBot({ data: { botId: bot.id, name: v } }));
  const instructions = useField(bot.instructions, (v) => updateBot({ data: { botId: bot.id, instructions: v } }));
  const memory = details?.memory;
  if (report !== undefined) return <Report bot={bot} id={report} onBack={() => onOpenReport(undefined)} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain p-4">
      <div className="flex flex-col items-center gap-2">
        <BotAvatar bot={bot} size="lg" />
        <Input {...name} onKeyDown={(e) => (e.key === "Enter" ? e.currentTarget.blur() : name.onKeyDown(e))} aria-label="Bot name" className="h-8 border-transparent text-center font-medium shadow-none hover:border-input" />
        {main ? (
          <Badge variant="secondary">
            <CrownIcon /> Main bot
          </Badge>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setMainBot({ data: bot.id }).catch(fail("make main bot"))}>
            <CrownIcon /> Make main bot
          </Button>
        )}
      </div>

      <Section title="Instructions">
        <Textarea {...instructions} aria-label="Instructions" placeholder="What this bot is for" rows={4} className="text-sm" />
      </Section>

      {details && details.library.length > 0 && (
        <Section title="Library">
          <ul className="grid gap-1">
            {details.library.map((r) => (
              <li key={r.id}>
                <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => onOpenReport(r.id)}>
                  <FileTextIcon /> <span className="truncate">{r.title}</span>
                  <span className="text-muted-foreground ml-auto text-xs font-normal">{new Date(r.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {details && details.tables.length > 0 && (
        <Section title="Data">
          <ul className="grid gap-1 text-sm">
            {details.tables.map((t) => (
              <li key={t.name} className="flex items-center gap-2 px-2 py-1">
                <DatabaseIcon className="text-muted-foreground size-4" />
                <span className="truncate">{t.name}</span>
                <span className="text-muted-foreground ml-auto text-xs tabular-nums">{t.rows} rows</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {bot.agents.length > 0 && (
        <Section title="Helpers">
          <ul className="grid gap-1">
            {bot.agents.map((a) => (
              <li key={a.session} className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" onClick={() => onOpenAgent(a.session)}>
                  <BotIcon /> <span className="truncate">{a.name}</span>
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Retire ${a.name}`} onClick={() => retireSubagent({ data: { botId: bot.id, name: a.name } }).catch(fail("retire subagent"))}>
                  <Archive />
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Routines">
        {details && details.routines.length === 0 && <p className="text-muted-foreground text-sm">None yet. Ask the bot, e.g. "every weekday at 8 check the AI news".</p>}
        <ul className="grid gap-2">
          {details?.routines.map((r) => (
            <li key={r.id} className="group/routine flex items-start gap-3 rounded-lg border p-3">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm font-medium">{r.name}</span>
                <span className="text-muted-foreground text-xs">{cronText(r.cron)}</span>
                <span className="text-muted-foreground line-clamp-2 text-xs">{r.prompt}</span>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={`Delete routine ${r.name}`} className="opacity-0 transition-opacity duration-150 group-hover/routine:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100" onClick={() => deleteRoutine({ data: { botId: bot.id, id: r.id } }).catch(fail("delete routine"))}>
                <Trash2 />
              </Button>
              <Switch checked={r.enabled} aria-label={`${r.name} on`} onCheckedChange={(on) => setRoutineEnabled({ data: { botId: bot.id, id: r.id, enabled: on } }).catch(fail("change routine"))} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Memory">
        {memory && (
          <>
            <StepSlider label="View budget" steps={VIEW_BUDGETS.map(kb)} value={VIEW_BUDGETS.findIndex((b) => b === memory.budget)} onCommit={(i) => setMemoryBudget({ data: { botId: bot.id, bytes: VIEW_BUDGETS[i] } }).catch(fail("change memory budget"))} />
            <dl className="text-muted-foreground grid grid-cols-2 gap-x-2 gap-y-1 text-xs tabular-nums">
              <dt>Messages</dt>
              <dd className="text-foreground text-right">{memory.entries}</dd>
              <dt>View lines</dt>
              <dd className="text-foreground text-right">{memory.lines}</dd>
              <dt>View size</dt>
              <dd className="text-foreground text-right">
                {kb(memory.viewBytes)} / {kb(memory.budget)}
              </dd>
              <dt>Summarizing</dt>
              <dd className="text-foreground text-right">
                {memory.building} running, {memory.pending} queued
              </dd>
            </dl>
          </>
        )}
        {confirm === "reset" ? (
          <InlineConfirm question="Forget everything?" action="Reset" onCancel={() => setConfirm(null)} onConfirm={() => resetMemory({ data: bot.id }).then(() => setConfirm(null), fail("reset memory"))} />
        ) : (
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive w-fit px-0" onClick={() => setConfirm("reset")}>
            <RotateCcw /> Reset memory
          </Button>
        )}
      </Section>

      <div className="mt-auto">
        {main ? (
          <p className="text-muted-foreground text-xs">Make another bot main to delete this one.</p>
        ) : confirm === "delete" ? (
          <InlineConfirm question={`Delete ${bot.name} for good?`} action="Delete" onCancel={() => setConfirm(null)} onConfirm={() => deleteBot({ data: bot.id }).then(onDeleted, fail("delete bot"))} />
        ) : (
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive w-fit px-0" onClick={() => setConfirm("delete")}>
            <Trash2 /> Delete bot
          </Button>
        )}
      </div>
    </div>
  );
}
