import { COLOR_BY_ID } from "bloub-react";
import { useId, type ReactNode } from "react";
import { BotAvatar } from "@/components/bot-avatar";
import { CAPTION, LINE } from "@/components/panel";
import { cn } from "@/lib/utils";
import { LOOK_COLORS, LOOK_EXPRESSIONS, LOOK_SHAPES, type BotLook } from "@/shared";

/** A bot's look (DESIGN.md §6 Look): shape, color and face as three rows; `className` is their container (a card in the
 * new-bot form, nothing in the panel's popover, which is the surface itself). Each option is
 * drawn as the look it would give, so you see the result before you pick it. Native radios: arrow keys move within a
 * row, Tab moves between rows. */
export function LookPicker({ look, onChange, className }: { look: BotLook; onChange: (patch: Partial<BotLook>) => void; className?: string }) {
  const id = useId();
  return (
    <div className={cn("flex flex-col", className)}>
      <Choices id={`${id}-shape`} legend="Shape" options={LOOK_SHAPES} value={look.shape} onPick={(shape) => onChange({ shape })} className="grid-cols-8">
        {(shape) => <BotAvatar look={{ ...look, shape }} size={20} still />}
      </Choices>
      <Choices id={`${id}-color`} legend="Color" options={LOOK_COLORS} value={look.color} onPick={(color) => onChange({ color })} className="grid-cols-10">
        {(color) => <span className="size-4 rounded-full" style={{ backgroundColor: COLOR_BY_ID.get(color)!.hex }} />}
      </Choices>
      <Choices id={`${id}-face`} legend="Face" options={LOOK_EXPRESSIONS} value={look.expression} onPick={(expression) => onChange({ expression })} className="grid-cols-8">
        {(expression) => <BotAvatar look={{ ...look, expression }} size={20} still />}
      </Choices>
    </div>
  );
}

/** One row: its caption, then a grid of square tiles; the picked tile is filled, hover tints the rest. */
function Choices<T extends string>({ id, legend, options, value, onPick, className, children }: { id: string; legend: string; options: [T, string][]; value: T; onPick: (id: T) => void; className: string; children: (id: T) => ReactNode }) {
  return (
    <div role="radiogroup" aria-labelledby={id} className={cn(LINE, "flex flex-col gap-1.5 px-1.5 pt-2.5 pb-1.5")}>
      <span id={id} className={cn(CAPTION, "px-1.5")}>
        {legend}
      </span>
      <div className={cn("grid", className)}>
        {options.map(([option, label]) => (
          <label key={option} title={label} className="has-checked:bg-muted hover:bg-accent flex aspect-square cursor-pointer items-center justify-center rounded-md transition-colors duration-150 has-focus-visible:outline-2 has-focus-visible:-outline-offset-2">
            <input type="radio" name={id} value={option} checked={option === value} onChange={() => onPick(option)} aria-label={label} className="sr-only" />
            {children(option)}
          </label>
        ))}
      </div>
    </div>
  );
}
