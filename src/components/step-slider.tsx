import { useId, useState } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

/** A labelled slider over named steps. It follows the drag locally and saves once, on release (`onCommit`). */
export function StepSlider({ label, steps, value, onCommit, ticks = false }: { label: string; steps: readonly string[]; value: number; onCommit: (index: number) => Promise<unknown>; ticks?: boolean }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const id = useId();
  const shown = dragging ?? value;
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-muted-foreground text-sm tabular-nums">{steps[shown]}</span>
      </div>
      <Slider
        id={id}
        aria-valuetext={steps[shown]}
        min={0}
        max={steps.length - 1}
        step={1}
        value={[shown]}
        onValueChange={([i]) => setDragging(i)}
        onValueCommit={([i]) => void onCommit(i).finally(() => setDragging(null))}
      />
      {ticks && (
        <div className="text-muted-foreground flex justify-between text-xs">
          {steps.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}
