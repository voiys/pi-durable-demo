import { useState } from "react";
import { BotAvatar } from "@/components/bot-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBot } from "@/server/fns";
import { botColor } from "@/shared";

/** "New bot", in place: a name and what it is for, under the face it will get. The bot exists once created; its
 * conversation starts empty. A refused name (taken, bad characters) is said under the form, not in a toast. */
export function NewBot({ botCount, onCreated }: { botCount: number; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto overscroll-contain px-4 py-12">
      <form
        className="flex w-full max-w-sm flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          createBot({ data: { name, instructions } }).then(({ id }) => onCreated(id), (e: Error) => (setError(e.message), setBusy(false)));
        }}
      >
        <header className="flex flex-col items-center gap-3 text-center">
          <BotAvatar bot={{ name: name.trim() || " ", color: botColor(botCount) }} size="lg" />
          <h1 className="text-2xl font-semibold">New bot</h1>
          <p className="text-muted-foreground text-balance">Give it a name and a job. It keeps one endless conversation and remembers what you tell it.</p>
        </header>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bot-name" className="text-sm font-medium">
            Name
          </Label>
          <Input id="bot-name" autoFocus value={name} aria-invalid={!!error} aria-describedby={error ? "bot-error" : undefined} onChange={(e) => (setName(e.target.value), setError(null))} placeholder="Scout" maxLength={32} autoComplete="off" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="bot-instructions" className="text-sm font-medium">
            Instructions
          </Label>
          <Textarea id="bot-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Research what I assign you. Cite primary sources." rows={4} className="max-h-60" />
          <p className="text-muted-foreground text-sm">You can change both later in its details.</p>
        </div>
        {error && (
          <p id="bot-error" role="alert" className="text-destructive text-sm">
            Couldn't create the bot: {error}
          </p>
        )}
        <Button type="submit" disabled={!name.trim() || busy}>
          {busy ? "Creating…" : "Create bot"}
        </Button>
      </form>
    </div>
  );
}
