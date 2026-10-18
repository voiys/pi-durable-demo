import { Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { InlineConfirm } from "@/components/inline-confirm";
import { SidebarInput, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { deleteChat, renameChat } from "@/server/fns";
import type { ChatSummary } from "@/shared";
import { fail } from "@/lib/utils";

/** One sidebar chat: double-click (or F2) renames it inline; the trash action shows on hover or keyboard focus and confirms inline. */
export function ChatRow({ chat, active, onOpen, onDeleted, children }: { chat: ChatSummary; active: boolean; onOpen: () => void; onDeleted: () => void; children?: ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const save = (title: string) => {
    setEditing(false);
    if (title.trim() && title.trim() !== chat.title) renameChat({ data: { chatId: chat.id, title } }).catch(fail("rename chat"));
  };

  return (
    <SidebarMenuItem>
      {confirming ? (
        <InlineConfirm
          question={`Delete "${chat.title}"?`}
          action="Delete"
          onCancel={() => setConfirming(false)}
          onConfirm={() => deleteChat({ data: chat.id }).then(onDeleted, fail("delete chat"))}
        />
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
          className="hover:text-destructive transition-colors duration-150 ease-out motion-reduce:transition-none"
          onClick={() => setConfirming(true)}
        >
          <Trash2 />
        </SidebarMenuAction>
      )}
      {children}
    </SidebarMenuItem>
  );
}
