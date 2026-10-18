import { Archive, Bot } from "lucide-react";
import { useState } from "react";
import { InlineConfirm } from "@/components/inline-confirm";
import { SidebarMenuAction, SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar";
import { retireSubagent } from "@/server/fns";
import { fail } from "@/lib/utils";

/** A subagent under its chat. Hovering (or focusing) shows a retire action, which confirms inline. */
export function SubagentRow({ chatId, name, active, onOpen, onRetired }: { chatId: string; name: string; active: boolean; onOpen: () => void; onRetired: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming)
    return (
      <SidebarMenuSubItem>
        <InlineConfirm
          className="h-7"
          question={`Retire ${name}?`}
          action="Retire"
          onCancel={() => setConfirming(false)}
          onConfirm={() => retireSubagent({ data: { chatId, name } }).then(onRetired, fail("retire subagent"))}
        />
      </SidebarMenuSubItem>
    );
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton isActive={active} onClick={onOpen} className="pr-7">
        <Bot />
        <span className="truncate">{name}</span>
      </SidebarMenuSubButton>
      <SidebarMenuAction
        aria-label={`Retire ${name}`}
        // showOnHover keys on the chat's group, which would reveal every subagent when its chat is hovered: key on this row instead.
        className="top-1/2 -translate-y-1/2 hover:text-destructive group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 md:opacity-0"
        onClick={() => setConfirming(true)}
      >
        <Archive />
      </SidebarMenuAction>
    </SidebarMenuSubItem>
  );
}
