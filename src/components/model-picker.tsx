import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InputGroupButton } from "@/components/ui/input-group";
import { chatModels, setChatModel } from "@/server/fns";
import type { ModelOption } from "@/shared";

/** AI Elements model-selector, inside the prompt input: two dropdowns (model, effort) showing pi's own session state. */
// The list depends on the ChatGPT account, not the chat: one fetch per page load, shown from cache on every later mount.
let cached: ModelOption[] | undefined;
let loading: Promise<ModelOption[]> | undefined;

export function ModelPicker({ chatId, model, thinkingLevel }: { chatId: string; model: string | null; thinkingLevel: string | null }) {
  const [options, setOptions] = useState<ModelOption[]>(cached ?? []);
  useEffect(() => {
    loading ??= chatModels({ data: chatId }).then((list) => (cached = list));
    loading.then(setOptions, (e: Error) => ((loading = undefined), toast.error(e.message)));
  }, [chatId]);
  const current = options.find((o) => o.id === model);
  const change = (next: string, level: string) =>
    setChatModel({ data: { chatId, model: next, thinkingLevel: level } }).catch((e: Error) => toast.error(e.message));

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <InputGroupButton variant="ghost" aria-label={`Model: ${current?.name ?? "none"}`}>
            {current?.name ?? model ?? "Model"}
            <ChevronDownIcon />
          </InputGroupButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={model ?? ""}
            onValueChange={(id) => {
              // Keep the effort when the new model supports it, else take the new model's lowest level.
              const levels = options.find((o) => o.id === id)!.levels;
              void change(id, levels.find((l) => l === thinkingLevel) ?? levels[0]);
            }}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Model</DropdownMenuLabel>
              {options.map((o) => (
                <DropdownMenuRadioItem key={o.id} value={o.id}>{o.name}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <InputGroupButton variant="ghost" aria-label={`Effort: ${thinkingLevel ?? "none"}`}>
            <span className="text-muted-foreground">Effort</span>
            {thinkingLevel ?? "-"}
            <ChevronDownIcon />
          </InputGroupButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Effort</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={thinkingLevel ?? ""} onValueChange={(level) => void change(model!, level)}>
              {(current?.levels ?? []).map((l) => (
                <DropdownMenuRadioItem key={l} value={l}>{l}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
