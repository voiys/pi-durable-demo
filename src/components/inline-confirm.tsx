import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText } from "@/components/ui/input-group";
import { ROW } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** The quiet text action that opens an InlineConfirm: muted, red on hover only (DESIGN.md §6 Side panel: destructive
 * last, ghost, inline confirm). For a ghost `Button size="sm"`; 32px tall, as the confirm is, so swapping them never
 * moves the row. */
export const QUIET = "text-muted-foreground hover:text-destructive h-8 w-fit px-0 font-normal hover:bg-transparent";

/** A row that asks in place (`Delete "title"?`) instead of a dialog. Focus starts on Cancel; Escape, Cancel or leaving it
 * cancels. The question wraps rather than truncates: it is what the row is for. Put it in a ConfirmSwap to cross-fade it
 * with the action that asked. */
export function InlineConfirm({ question, action, onConfirm, onCancel, className }: { question: string; action: string; onConfirm: () => void; onCancel: () => void; className?: string }) {
  return (
    <InputGroup
      role="group"
      aria-label={question}
      className={cn("bg-destructive/10 h-auto min-h-8 border-transparent", className)}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && onCancel()}
    >
      <InputGroupAddon className="min-w-0 flex-1 justify-start">
        <InputGroupText className="text-destructive min-w-0 font-medium text-pretty">{question}</InputGroupText>
      </InputGroupAddon>
      <InputGroupAddon align="inline-end">
        <InputGroupButton autoFocus variant="ghost" onClick={onCancel}>
          Cancel
        </InputGroupButton>
        <InputGroupButton variant="destructive" onClick={onConfirm}>
          {action}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** Shows `children` (the action that asks), or `confirm` (its InlineConfirm) in the same spot: they cross-fade (ROW: the new
 * one in over 150ms, the old one out over 100ms, popped out of the flow), so the row neither jumps nor doubles.
 * Opacity only, so reduced motion keeps it; the first render doesn't animate. */
export function ConfirmSwap({ confirm, children, className }: { confirm: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div key={confirm ? "confirm" : "ask"} {...ROW}>
          {confirm || children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
