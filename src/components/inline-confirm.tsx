import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

/** A row that asks in place (`Delete "title"?`) instead of a dialog. Focus starts on Cancel; Escape, Cancel or leaving it cancels. */
export function InlineConfirm({ question, action, onConfirm, onCancel, className }: { question: string; action: string; onConfirm: () => void; onCancel: () => void; className?: string }) {
  return (
    <InputGroup
      className={cn("animate-in fade-in bg-destructive/10 dark:bg-destructive/10 border-destructive/30 h-8 duration-150 motion-reduce:animate-none", className)}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && onCancel()}
    >
      <InputGroupAddon className="min-w-0 flex-1 justify-start">
        <InputGroupText className="text-destructive min-w-0">
          <span className="truncate">{question}</span>
        </InputGroupText>
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
