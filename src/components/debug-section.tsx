import { Bug, ChevronRight, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { InlineConfirm } from "@/components/inline-confirm";
import { StepSlider } from "@/components/step-slider";
import { memoryStats, resetMemory, setDebug } from "@/server/fns";
import { VIEW_BUDGETS, type DebugSettings, type MemoryStats } from "@/shared";
import { fail } from "@/lib/utils";

const kb = (n: number) => `${Math.round(n / 1000)}K`;

/** Inline sidebar section: per-user debug knobs and the user's OptChat memory (shared by every chat), live. */
export function DebugSection({ debug }: { debug: DebugSettings }) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    if (!open) return setStats(null);
    const poll = () => memoryStats().then(setStats, fail("read memory stats"));
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
            <ChevronRight className="ml-auto transition-transform duration-200 motion-reduce:transition-none group-data-[state=open]/collapsible:rotate-90" />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent className="grid gap-3 pt-1 text-xs">
            <div className="grid gap-2 px-2">
              <StepSlider
                label="OptChat view budget"
                steps={VIEW_BUDGETS.map(kb)}
                value={VIEW_BUDGETS.findIndex((b) => b === debug.viewBytes)}
                onCommit={(i) => setDebug({ data: { viewBytes: VIEW_BUDGETS[i] } }).catch(fail("save debug setting"))}
              />
              <p className="text-muted-foreground">All your chats. Lower it to watch older lines merge after a few messages.</p>
            </div>
            <SidebarMenu>
              {stats &&
                (
                  [
                    ["Log entries", stats.entries],
                    ["Tree nodes", stats.nodes],
                    ["View lines", stats.lines],
                    ["View size", `${kb(stats.viewBytes)} / ${kb(stats.budget)}`],
                    ["Summarizing", `${stats.building} running, ${stats.pending} queued`],
                  ] as const
                ).map(([label, value]) => (
                  <SidebarMenuItem key={label} className="text-sidebar-foreground flex h-7 items-center px-2">
                    {label}
                    <SidebarMenuBadge className="top-1/2 -translate-y-1/2">{value}</SidebarMenuBadge>
                  </SidebarMenuItem>
                ))}
              <SidebarMenuItem>
                {resetting ? (
                  <InlineConfirm
                    className="h-7"
                    question="Forget everything?"
                    action="Reset"
                    onCancel={() => setResetting(false)}
                    onConfirm={() =>
                      resetMemory().then(
                        () => setResetting(false),
                        fail("reset memory"),
                      )
                    }
                  />
                ) : (
                  <SidebarMenuButton size="sm" className="hover:text-destructive" onClick={() => setResetting(true)}>
                    <RotateCcw /> Reset memory
                  </SidebarMenuButton>
                )}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  );
}
