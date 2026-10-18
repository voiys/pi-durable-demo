import { Button } from "@/components/ui/button";

/** A row that asks in place ("Delete chat?") instead of a dialog. Escape, Cancel or leaving it cancels. */
export function InlineConfirm({ question, action, onConfirm, onCancel, className }: { question: string; action: string; onConfirm: () => void; onCancel: () => void; className?: string }) {
  return (
    <div
      className={`bg-destructive/10 flex items-center gap-1 rounded-md pr-1 pl-2 text-sm ${className ?? "h-8"}`}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && onCancel()}
    >
      <span className="text-destructive flex-1 truncate">{question}</span>
      <Button autoFocus size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={onConfirm}>
        {action}
      </Button>
      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
