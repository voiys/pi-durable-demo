import { useId, useState } from "react";
import { Field, FieldTitle } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";

/** A labelled slider over named steps. It follows the drag locally and saves once, on release (`onCommit`). `ticks`
 * names both ends under the track; the current step is always named beside the label. */
export function StepSlider({ label, steps, value, onCommit, ticks = false }: { label: string; steps: readonly string[]; value: number; onCommit: (index: number) => Promise<unknown>; ticks?: boolean }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const id = useId();
  const shown = dragging ?? value;
  return (
    <Field className="gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <FieldTitle id={id}>{label}</FieldTitle>
        <span className="text-muted-foreground text-sm tabular-nums">{steps[shown]}</span>
      </div>
      <Slider
        aria-labelledby={id}
        aria-valuetext={steps[shown]}
        min={0}
        max={steps.length - 1}
        step={1}
        value={[shown]}
        onValueChange={([i]) => setDragging(i)}
        onValueCommit={([i]) => void onCommit(i).finally(() => setDragging(null))}
      />
      {ticks && (
        <div aria-hidden className="text-muted-foreground flex justify-between text-xs font-medium">
          <span>{steps[0]}</span>
          <span>{steps[steps.length - 1]}</span>
        </div>
      )}
    </Field>
  );
}
