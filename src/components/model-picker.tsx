import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { chatModels, setChatModel } from "@/server/fns";
import type { ModelOption } from "@/shared";

/** Shows and changes the chat's model + reasoning effort; the values shown come from pi's own session state. */
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
      <Select
        value={model ?? undefined}
        onValueChange={(id) => {
          // Keep the effort when the new model supports it, else take the new model's lowest level.
          const levels = options.find((o) => o.id === id)!.levels;
          void change(id, levels.find((l) => l === thinkingLevel) ?? levels[0]);
        }}
      >
        <SelectTrigger size="sm" className="w-44">
          <SelectValue placeholder="Model" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={thinkingLevel ?? undefined} onValueChange={(level) => model && change(model, level)}>
        <SelectTrigger size="sm" className="w-28">
          <SelectValue placeholder="Effort" />
        </SelectTrigger>
        <SelectContent>
          {(current?.levels ?? []).map((l) => (
            <SelectItem key={l} value={l}>{l}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
