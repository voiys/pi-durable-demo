import { BotIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fail } from "@/lib/utils";
import { createBot } from "@/server/fns";

/** "New bot", in place: a name and what it is for. The bot exists once created; its conversation starts empty. */
export function NewBot({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BotIcon />
        </EmptyMedia>
        <EmptyTitle>New bot</EmptyTitle>
        <EmptyDescription>One agent with one endless conversation and its own memory. Give it a name and a job.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <form
          className="grid w-full max-w-sm gap-4 text-left"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            createBot({ data: { name, instructions } }).then(({ id }) => onCreated(id), fail("create bot")).finally(() => setBusy(false));
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="bot-name">Name</Label>
            <Input id="bot-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. researcher" maxLength={32} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bot-instructions">Instructions</Label>
            <Textarea id="bot-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Research what I assign you. Cite primary sources." rows={4} />
          </div>
          <Button type="submit" disabled={!name.trim() || busy}>
            Create bot
          </Button>
        </form>
      </EmptyContent>
    </Empty>
  );
}
