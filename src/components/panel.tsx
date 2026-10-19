import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmSwap, InlineConfirm } from "@/components/inline-confirm";
import { FADE } from "@/lib/motion";
import { cn } from "@/lib/utils";

// The side panel's system (DESIGN.md §6 Side panel): inset grouped lists, as in iOS/macOS Settings, at Linear's
// precision. Canvas behind; each group a caption over a surface card of rows; groups 24px apart. Every text starts on
// one edge: the card's 16px gutter plus the row's 12px inset, so captions, labels and the panel title all line up.

/** A group's title, a footnote, a "Saved": caption, sentence case. */
export const CAPTION = "text-muted-foreground text-xs font-medium";
/** The card a group's rows sit on (`<ul>` for a list, `<div>` for one field). Clips the rows' hover fill to its radius. */
export const CARD = "bg-surface overflow-hidden rounded-lg border";
/** A group's footnote, or a sentence standing in for a group: caption size, regular weight (prose, not a label). */
export const FOOTNOTE = "text-muted-foreground px-3 text-xs text-pretty";
/** A row's hairline divider, inset to the text edge (`not-first:before:left-11` past a 20px face). On the `<li>`. */
export const LINE = "relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3 not-first:before:h-px not-first:before:bg-border";
/** A row's body: 44px min, its label leading and its value or control trailing. */
export const CELL = "flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm";
/** Focus drawn inside a row, since the card clips anything outside it. */
export const FOCUS_IN = "focus-visible:outline-2 focus-visible:-outline-offset-2";
/** A row that is itself a link or a button: the hover fill runs edge to edge. */
export const TAP = cn("transition-colors duration-150 hover:bg-accent", FOCUS_IN);
/** A row's value: muted, trailing, numbers in fixed widths. */
export const VALUE = "text-muted-foreground shrink-0 tabular-nums";
/** Shows a row's secondary action on hover or focus, always on touch screens (no hover there). */
export const ON_HOVER = "opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100";
/** A field that is the row's text itself: no box until focus, then the 2px ring inside the card. */
export const BARE = "min-h-11 rounded-lg border-transparent px-3 py-2.5 focus-visible:border-transparent focus-visible:outline-2 focus-visible:-outline-offset-2 md:text-sm";

/** A row that destroys something: ink at rest, red on hover (DESIGN.md §6), and on click it asks in the same row. The
 * confirm (32px) sits in 6px of padding so the row keeps its 44px and nothing below it moves. `className` is the row's
 * box: CARD when the row is a group of its own, nothing inside a list's <li>. */
export function DangerRow({ label, question, action, asking, onAsk, onCancel, onConfirm, className }: { label: string; question: string; action: string; asking: boolean; onAsk: () => void; onCancel: () => void; onConfirm: () => void; className?: string }) {
  return (
    <ConfirmSwap
      className={className}
      confirm={
        asking && (
          <div className="px-3 py-1.5">
            <InlineConfirm question={question} action={action} onCancel={onCancel} onConfirm={onConfirm} />
          </div>
        )
      }
    >
      <button type="button" className={cn(CELL, TAP, "hover:text-destructive")} onClick={onAsk}>
        {label}
      </button>
    </ConfirmSwap>
  );
}

/** The panel's scrolling body: groups flow top-down, 24px apart; nothing is pinned to the bottom. */
export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pt-1 pb-6", className)}>{children}</div>;
}

/** A group: a caption title (with `aside` at its end, such as <Saved>), its card, a footnote. Fades in when it mounts
 * (150ms), so a group replacing the skeleton arrives softly. `id` names the title for a field that it labels. */
export function Group({ title, id, aside, footer, children }: { title?: string; id?: string; aside?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={title && id} className="animate-in fade-in flex flex-col gap-1.5 duration-150 ease-out">
      {title && (
        <div className="flex items-baseline justify-between gap-2 px-3">
          <h3 id={id} className={CAPTION}>
            {title}
          </h3>
          {aside}
        </div>
      )}
      {children}
      {footer && <div className={FOOTNOTE}>{footer}</div>}
    </section>
  );
}

/** "Saved" for 1.5s after a field saves, then faded: the acknowledgment in place of a toast (FADE: opacity, in 200ms,
 * out 150ms). The region stays mounted so each save is announced; the field's own value is the lasting cue. */
export function Saved({ at, className }: { at: number; className?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!at) return;
    setShown(true);
    const t = setTimeout(() => setShown(false), 1500);
    return () => clearTimeout(t);
  }, [at]);
  return (
    <span role="status" className={cn(CAPTION, "shrink-0", className)}>
      <AnimatePresence>
        {shown && (
          <motion.span variants={FADE} initial="initial" animate="animate" exit="exit">
            Saved
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** An edited field, saved when it loses focus (or on Enter for one-line fields). A refused value stays in the field,
 * marked invalid with the reason under it, until it's fixed or Escape puts the saved value back. `savedAt` is when it
 * last saved, for <Saved>. */
export function useField(saved: string, save: (value: string) => Promise<unknown>, required?: string) {
  const [value, setValue] = useState(saved);
  const [error, setError] = useState<string>();
  const [savedAt, setSavedAt] = useState(0);
  // Escape blurs the field before React has the reverted value, so the blur it causes must not save.
  const reverting = useRef(false);
  useEffect(() => setValue(saved), [saved]);
  const commit = () => {
    const next = value.trim();
    if (next === saved) return setError(undefined);
    if (required && !next) return setError(required);
    save(next).then(() => (setError(undefined), setSavedAt(Date.now())), (e: Error) => setError(e.message));
  };
  return {
    error,
    savedAt,
    control: {
      value,
      "aria-invalid": error ? true : undefined,
      onChange: (e: { currentTarget: { value: string } }) => (setValue(e.currentTarget.value), setError(undefined)),
      onBlur: () => (reverting.current ? (reverting.current = false) : commit()),
      onKeyDown: (e: { key: string; currentTarget: HTMLElement }) => e.key === "Escape" && ((reverting.current = true), setValue(saved), setError(undefined), e.currentTarget.blur()),
    },
  };
}

/** A name edited in place as the identity card's title (17/590): no box until hover (a faint fill) or focus (the ring).
 * Its box overhangs the text by 6px each side, so the letters keep the card's text edge. */
export const NAME = "-mx-1.5 h-8 w-auto border-transparent px-1.5 text-lg font-semibold hover:bg-accent focus-visible:bg-transparent md:text-lg";

/** The identity card: a face, the name, one muted line under it (or the name's error) with "Saved" at its end. */
export function Identity({ face, name, line }: { face: ReactNode; name: ReactNode; line: ReactNode }) {
  return (
    <div className={cn(CARD, "flex items-center gap-3 p-3")}>
      {face}
      <div className="flex min-w-0 flex-1 flex-col">
        {name}
        <div className="flex min-h-5 items-baseline justify-between gap-2">{line}</div>
      </div>
    </div>
  );
}
