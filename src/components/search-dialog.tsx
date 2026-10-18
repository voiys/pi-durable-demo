import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { searchMessages } from "@/server/fns";
import type { SearchHit } from "@/shared";

/** FTS5 bm25 search over the signed-in user's own messages, served by their User DO. */
export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    const t = setTimeout(async () => setHits(await searchMessages({ data: query })), 150);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <DialogTitle className="sr-only">Search messages</DialogTitle>
        {/* Ranking comes from bm25 in the User DO, so cmdk must not re-filter. */}
        <Command shouldFilter={false}>
      <CommandInput placeholder="Search your messages…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{query ? "No matches." : "Type to search."}</CommandEmpty>
        {hits.map((h) => (
          <CommandItem
            key={`${h.chatId}:${h.entryId}`}
            value={`${h.chatId}:${h.entryId}`}
            onSelect={() => {
              onOpenChange(false);
              void navigate({ to: "/", search: { chat: h.chatId, entry: h.entryId } });
            }}
          >
            <div className="grid min-w-0">
              <span className="text-muted-foreground truncate text-xs">
                {h.title} · {h.role}
              </span>
              <span className="truncate">{h.snippet}</span>
            </div>
          </CommandItem>
        ))}
      </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
