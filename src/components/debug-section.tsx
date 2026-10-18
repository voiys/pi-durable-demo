import { Bug, ChevronRight, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel } from "@/components/ui/sidebar";
import { InlineConfirm } from "@/components/inline-confirm";
import { StepSlider } from "@/components/step-slider";
import { Button } from "@/components/ui/button";
import { memoryStats, resetMemory, setDebug } from "@/server/fns";
import { VIEW_BUDGETS, type DebugSettings, type MemoryStats } from "@/shared";

const kb = (n: number) => `${Math.round(n / 1000)}K`;

/** Inline sidebar section: per-user debug knobs and the user's OptChat memory (shared by every chat), live. */
export function DebugSection({ debug }: { debug: DebugSettings }) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    if (!open) return setStats(null);
    const poll = () => memoryStats().then(setStats, (e: Error) => toast.error("Couldn't read memory stats", { description: e.message }));
    void poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [open]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <SidebarGroup className="group/collapsible mt-auto">
        <SidebarGroupLabel asChild>
          <CollapsibleTrigger className="gap-2">
            <Bug />
            Debug
            <ChevronRight className="ml-auto transition-transform duration-150 group-data-[state=open]/collapsible:rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent className="grid gap-3 px-2 pt-1 text-xs">
            <div className="grid gap-2">
              <StepSlider
                label="OptChat view budget"
                steps={VIEW_BUDGETS.map(kb)}
                value={VIEW_BUDGETS.findIndex((b) => b === debug.viewBytes)}
                onCommit={(i) => setDebug({ data: { viewBytes: VIEW_BUDGETS[i] } }).catch((e: Error) => toast.error("Couldn't save debug setting", { description: e.message }))}
              />
              <p className="text-muted-foreground">All your chats. Lower it to watch older lines merge after a few messages.</p>
            </div>
            {stats && (
              <dl className="text-muted-foreground grid grid-cols-2 gap-x-2 gap-y-1 tabular-nums">
                <dt>Log entries</dt>
                <dd className="text-foreground text-right">{stats.entries}</dd>
                <dt>Tree nodes</dt>
                <dd className="text-foreground text-right">{stats.nodes}</dd>
                <dt>View lines</dt>
                <dd className="text-foreground text-right">{stats.lines}</dd>
                <dt>View size</dt>
                <dd className="text-foreground text-right">
                  {kb(stats.viewBytes)} / {kb(stats.budget)}
                </dd>
                <dt>Summarizing</dt>
                <dd className="text-foreground text-right">
                  {stats.building} running, {stats.pending} queued
                </dd>
              </dl>
            )}
            {resetting ? (
              <InlineConfirm
                className="h-7"
                question="Forget everything?"
                action="Reset"
                onCancel={() => setResetting(false)}
                onConfirm={() =>
                  resetMemory().then(
                    () => setResetting(false),
                    (e: Error) => toast.error("Couldn't reset memory", { description: e.message }),
                  )
                }
              />
            ) : (
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive h-7 justify-start px-0 text-xs" onClick={() => setResetting(true)}>
                <RotateCcw /> Reset memory
              </Button>
            )}
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
