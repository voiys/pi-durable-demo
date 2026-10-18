import { Archive, Bot } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { InlineConfirm } from "@/components/inline-confirm";
import { SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar";
import { retireSubagent } from "@/server/fns";

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
          onConfirm={() => retireSubagent({ data: { chatId, name } }).then(onRetired, (e: Error) => toast.error("Couldn't retire subagent", { description: e.message }))}
        />
      </SidebarMenuSubItem>
    );
  return (
    <SidebarMenuSubItem className="group/subagent relative">
      <SidebarMenuSubButton isActive={active} onClick={onOpen} className="pr-7">
        <Bot />
        <span className="truncate">{name}</span>
      </SidebarMenuSubButton>
      <button
        type="button"
        aria-label={`Retire ${name}`}
        title={`Retire ${name}`}
        className="text-sidebar-foreground hover:text-destructive absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm opacity-0 transition-colors duration-150 group-focus-within/subagent:opacity-100 group-hover/subagent:opacity-100 [&>svg]:size-3.5"
        onClick={() => setConfirming(true)}
      >
        <Archive />
      </button>
    </SidebarMenuSubItem>
  );
}
