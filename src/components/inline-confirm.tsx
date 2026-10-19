import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

/** The quiet text action that opens an InlineConfirm: muted, red on hover only (DESIGN.md §6 Side panel: destructive
 * last, ghost, inline confirm). For a ghost `Button size="sm"`. */
export const QUIET = "text-muted-foreground hover:text-destructive w-fit px-0 font-normal hover:bg-transparent";

/** A row that asks in place (`Delete "title"?`) instead of a dialog. Focus starts on Cancel; Escape, Cancel or leaving it
 * cancels. The question wraps rather than truncates: it is what the row is for. It fades in (opacity only, DESIGN.md §7). */
export function InlineConfirm({ question, action, onConfirm, onCancel, className }: { question: string; action: string; onConfirm: () => void; onCancel: () => void; className?: string }) {
  return (
    <InputGroup
      role="group"
      aria-label={question}
      className={cn("animate-in fade-in bg-destructive/10 h-auto min-h-8 border-transparent duration-150", className)}
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
