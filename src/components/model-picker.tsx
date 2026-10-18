import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { chatModels, setChatModel } from "@/server/fns";
import type { ModelOption } from "@/shared";

/** AI Elements model-selector: two dropdowns (model, effort) showing pi's own session state. */
export function ModelPicker({ chatId, model, thinkingLevel }: { chatId: string; model: string | null; thinkingLevel: string | null }) {
  const [options, setOptions] = useState<ModelOption[]>([]);
  useEffect(() => {
    chatModels({ data: chatId }).then(setOptions, (e: Error) => toast.error(e.message));
  }, [chatId]);
  const current = options.find((o) => o.id === model);
  const change = (next: string, level: string) =>
    setChatModel({ data: { chatId, model: next, thinkingLevel: level } }).catch((e: Error) => toast.error(e.message));

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label={`Model: ${current?.name ?? "none"}`}>
            {current?.name ?? "Model"}
            <ChevronDownIcon />
          </Button>
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
          <Button variant="outline" size="sm" aria-label={`Effort: ${thinkingLevel ?? "none"}`}>
            <span className="text-muted-foreground">Effort</span>
            {thinkingLevel ?? "-"}
            <ChevronDownIcon />
          </Button>
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
