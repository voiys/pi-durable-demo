import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Brain, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { InputGroupButton } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StepSlider } from "@/components/step-slider";
import { cn, fail } from "@/lib/utils";
import { modelOptions } from "@/server/fns";
import type { ModelOption } from "@/shared";

// The list depends on the ChatGPT account, not the chat: one fetch per page load, shown from cache on every later mount.
let cached: ModelOption[] | undefined;
let loading: Promise<ModelOption[]> | undefined;

/** Reasoning levels in words (DESIGN.md §8: sentence case, no identifiers on the surface). */
const LEVELS: Record<ModelThinkingLevel, string> = { off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" };
const levelName = (level: string) => {
  const name = LEVELS[level as ModelThinkingLevel];
  if (!name) throw new Error(`Unknown reasoning level ${level}`);
  return name;
};

/** A brain button in the prompt input: pick the model, then the reasoning effort on a stepped slider of that model's levels.
 * `onChange` applies the choice to the bot. */
export function ModelPicker({ model, thinkingLevel, onChange }: { model: string | null; thinkingLevel: string | null; onChange: (model: string, thinkingLevel: string) => Promise<unknown> }) {
  const [options, setOptions] = useState<ModelOption[] | "failed" | undefined>(cached);
  // Loads on mount; after a failure, opening the picker again tries again.
  const load = () => {
    if (!loading) setOptions(undefined);
    loading ??= modelOptions().then((list) => (cached = list));
    loading.then(setOptions, (e: Error) => ((loading = undefined), setOptions("failed"), fail("load models")(e)));
  };
  useEffect(load, []);
  const list = Array.isArray(options) ? options : [];
  const current = list.find((o) => o.id === model);
  const levels = current?.levels ?? [];
  const label = [current?.name ?? model, thinkingLevel && `${levelName(thinkingLevel)} reasoning`].filter(Boolean).join(" · ") || "Model";
  const change = (next: string, level: string) => onChange(next, level).catch(fail("change model"));

  return (
    <Popover onOpenChange={(open) => open && options === "failed" && load()}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <InputGroupButton variant="ghost" size="icon-sm" aria-label={`Model and reasoning: ${label}`}>
              <Brain />
            </InputGroupButton>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" side="top" sideOffset={8} className="w-64 p-0">
        <Command>
          <CommandList>
            <CommandGroup heading="Model">
              {options === undefined && (
                <div role="status" className="flex flex-col gap-1 p-1">
                  <span className="sr-only">Loading the models on your plan…</span>
                  {["w-28", "w-24", "w-20"].map((w) => (
                    <Skeleton key={w} aria-hidden className={cn("my-1.5 h-4", w)} />
                  ))}
                </div>
              )}
              {options === "failed" && <p role="alert" className="text-muted-foreground px-2 py-1.5 text-sm">Couldn't load the models on your plan. Close this and open it again to retry.</p>}
              {list.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.id}
                  // Keep the effort when the new model supports it, else take the new model's lowest level.
                  onSelect={() => change(o.id, o.levels.find((l) => l === thinkingLevel) ?? o.levels[0])}
                >
                  <span className="flex-1 truncate">{o.name}</span>
                  <Check className={cn(o.id !== model && "invisible")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {/* Outside the Command: a listbox may only hold options. */}
        {levels.length > 1 && (
          <div className="border-t p-3">
            <StepSlider label="Reasoning" steps={levels.map(levelName)} value={levels.findIndex((l) => l === thinkingLevel)} onCommit={(i) => change(model!, levels[i])} ticks />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
