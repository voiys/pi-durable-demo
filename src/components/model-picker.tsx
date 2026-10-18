import { Brain, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { InputGroupButton } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StepSlider } from "@/components/step-slider";
import { cn, fail } from "@/lib/utils";
import { modelOptions } from "@/server/fns";
import type { ModelOption } from "@/shared";

// The list depends on the ChatGPT account, not the chat: one fetch per page load, shown from cache on every later mount.
let cached: ModelOption[] | undefined;
let loading: Promise<ModelOption[]> | undefined;

/** A brain button in the prompt input: pick the model, then the reasoning effort on a stepped slider of that model's levels.
 * `onChange` applies a choice (to a chat, or to a draft before its chat exists). */
export function ModelPicker({ model, thinkingLevel, onChange }: { model: string | null; thinkingLevel: string | null; onChange: (model: string, thinkingLevel: string) => Promise<unknown> }) {
  const [options, setOptions] = useState<ModelOption[]>(cached ?? []);
  useEffect(() => {
    loading ??= modelOptions().then((list) => (cached = list));
    loading.then(setOptions, (e: Error) => ((loading = undefined), fail("load models")(e)));
  }, []);
  const current = options.find((o) => o.id === model);
  const levels = current?.levels ?? [];
  const label = `${current?.name ?? model ?? "Model"} · ${thinkingLevel ?? "-"}`;
  const change = (next: string, level: string) =>
    onChange(next, level).catch(fail("change model"));

  return (
    <Popover>
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
      <PopoverContent align="start" side="top" className="w-64 p-0">
        <Command>
          <CommandList>
            <CommandGroup heading="Model">
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={o.id}
                  // Keep the effort when the new model supports it, else take the new model's lowest level.
                  onSelect={() => change(o.id, o.levels.find((l) => l === thinkingLevel) ?? o.levels[0])}
                >
                  <span className="flex-1 truncate">{o.name}</span>
                  <Check className={cn("size-4", o.id !== model && "invisible")} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {/* Outside the Command: a listbox may only hold options. */}
        {levels.length > 1 && (
          <div className="border-t p-3">
            <StepSlider label="Reasoning" steps={levels} value={levels.findIndex((l) => l === thinkingLevel)} onCommit={(i) => change(model!, levels[i])} ticks />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
