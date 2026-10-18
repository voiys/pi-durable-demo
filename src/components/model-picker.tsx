import { Brain, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { InputGroupButton } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
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
  const step = levels.findIndex((l) => l === thinkingLevel);
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
            <div className="mb-3 flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Reasoning</span>
              <span className="font-medium">{thinkingLevel}</span>
            </div>
            <Slider aria-label="Reasoning effort" min={0} max={levels.length - 1} step={1} value={[step]} onValueCommit={([i]) => change(model!, levels[i])} />
            <div className="text-muted-foreground mt-2 flex justify-between text-[10px]">
              {levels.map((l) => (
                <span key={l}>{l}</span>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
