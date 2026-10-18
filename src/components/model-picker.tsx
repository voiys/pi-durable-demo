import { Brain, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { InputGroupButton } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StepSlider } from "@/components/step-slider";
import { cn } from "@/lib/utils";
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
    loading.then(setOptions, (e: Error) => ((loading = undefined), toast.error("Couldn't load models", { description: e.message })));
  }, []);
  const current = options.find((o) => o.id === model);
  const levels = current?.levels ?? [];
  const label = `${current?.name ?? model ?? "Model"} · ${thinkingLevel ?? "-"}`;
  const change = (next: string, level: string) =>
    onChange(next, level).catch((e: Error) => toast.error("Couldn't change model", { description: e.message }));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <InputGroupButton variant="ghost" size="icon-xs" aria-label={`Model and reasoning: ${label}`} title={label}>
          <Brain />
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-64 p-1">
        <div role="radiogroup" aria-label="Model" className="grid">
          {options.map((o) => (
            <button
              key={o.id}
              role="radio"
              aria-checked={o.id === model}
              className="hover:bg-accent flex h-8 items-center gap-2 rounded-sm px-2 text-left text-sm"
              // Keep the effort when the new model supports it, else take the new model's lowest level.
              onClick={() => change(o.id, o.levels.find((l) => l === thinkingLevel) ?? o.levels[0])}
            >
              <span className="flex-1 truncate">{o.name}</span>
              <Check className={cn("size-4", o.id !== model && "invisible")} />
            </button>
          ))}
        </div>
        {levels.length > 1 && (
          <div className="border-t px-2 pt-3 pb-2">
            <StepSlider label="Reasoning" steps={levels} value={levels.findIndex((l) => l === thinkingLevel)} onCommit={(i) => change(model!, levels[i])} ticks />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
