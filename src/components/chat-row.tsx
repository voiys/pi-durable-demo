import { Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SidebarInput, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { deleteChat, renameChat } from "@/server/fns";
import type { ChatSummary } from "@/shared";

/** One sidebar chat: double-click (or F2) renames it inline; the trash action shows on hover or keyboard focus and confirms inline. */
export function ChatRow({ chat, active, onOpen, onDeleted, children }: { chat: ChatSummary; active: boolean; onOpen: () => void; onDeleted: () => void; children?: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fail = (e: Error) => toast.error(e.message);
  const save = (title: string) => {
    setEditing(false);
    if (title.trim() && title.trim() !== chat.title) renameChat({ data: { chatId: chat.id, title } }).catch(fail);
  };

  return (
    <SidebarMenuItem>
      {confirming ? (
        // Inline confirm: the row itself asks; Escape or leaving it cancels.
        <div
          className="flex h-8 items-center gap-1 rounded-md bg-destructive/10 pr-1 pl-2 text-sm"
          onKeyDown={(e) => e.key === "Escape" && setConfirming(false)}
          onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setConfirming(false)}
        >
          <span className="text-destructive flex-1 truncate">Delete chat?</span>
          <Button autoFocus size="sm" variant="destructive" className="h-6 px-2 text-xs" onClick={() => deleteChat({ data: chat.id }).then(onDeleted, fail)}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : editing ? (
        <SidebarInput
          autoFocus
          defaultValue={chat.title}
          aria-label="Chat title"
          className="h-8"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => save(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save(e.currentTarget.value);
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <SidebarMenuButton
          isActive={active}
          onClick={onOpen}
          onDoubleClick={() => setEditing(true)}
          onKeyDown={(e) => e.key === "F2" && setEditing(true)}
          title={`${chat.title} (double-click to rename)`}
        >
          <span className="truncate">{chat.title}</span>
        </SidebarMenuButton>
      )}
      {!editing && !confirming && (
        <SidebarMenuAction
          showOnHover
          aria-label={`Delete "${chat.title}"`}
          className="hover:text-destructive transition-opacity duration-150 ease-out motion-reduce:transition-none"
          onClick={() => setConfirming(true)}
        >
          <Trash2 />
        </SidebarMenuAction>
      )}
      {children}
    </SidebarMenuItem>
  );
}
