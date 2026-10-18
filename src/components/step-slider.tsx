import { useState } from "react";
import { Slider } from "@/components/ui/slider";

/** A labelled slider over named steps. It follows the drag locally and saves once, on release (`onCommit`). */
export function StepSlider({ label, steps, value, onCommit, ticks = false }: { label: string; steps: readonly string[]; value: number; onCommit: (index: number) => Promise<unknown>; ticks?: boolean }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const shown = dragging ?? value;
  return (
    <div className="grid gap-2 text-xs">
      <div className="flex items-baseline justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{steps[shown]}</span>
      </div>
      <Slider
        aria-label={label}
        aria-valuetext={steps[shown]}
        min={0}
        max={steps.length - 1}
        step={1}
        value={[shown]}
        onValueChange={([i]) => setDragging(i)}
        onValueCommit={([i]) => void onCommit(i).finally(() => setDragging(null))}
      />
      {ticks && (
        <div className="text-muted-foreground flex justify-between text-[10px]">
          {steps.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      )}
    </div>
  );
}
