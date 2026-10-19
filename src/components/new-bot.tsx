import { useRef, useState } from "react";
import { BotAvatar } from "@/components/bot-avatar";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createBot } from "@/server/fns";
import { botColor } from "@/shared";

/** "New bot", in place: a name and what it is for, under the face it will get. The bot exists once created; its
 * conversation starts empty. Checked on submit: a missing or refused name (taken, bad characters) is said under the
 * name, which takes focus. */
export function NewBot({ botCount, onCreated }: { botCount: number; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const nameRef = useRef<HTMLInputElement>(null);
  const refuse = (message: string) => (setError(message), nameRef.current!.focus());
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto overscroll-contain px-4 py-12">
      <form
        noValidate
        className="flex w-full max-w-sm flex-col gap-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return refuse("Give it a name, like Scout.");
          setBusy(true);
          createBot({ data: { name, instructions } }).then(({ id }) => onCreated(id), (e: Error) => (setBusy(false), refuse(e.message)));
        }}
      >
        <header className="flex flex-col items-center gap-3 text-center">
          <BotAvatar bot={{ name: name.trim() || " ", color: botColor(botCount) }} size="lg" />
          <h1 className="text-2xl font-semibold">New bot</h1>
          <p className="text-muted-foreground text-balance">Give it a name and a job. It keeps one endless conversation and remembers what you tell it.</p>
        </header>
        <FieldGroup>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="bot-name">Name</FieldLabel>
            <Input
              ref={nameRef}
              id="bot-name"
              autoFocus
              value={name}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "bot-name-error" : undefined}
              onChange={(e) => (setName(e.target.value), setError(undefined))}
              placeholder="Scout"
              maxLength={32}
              autoComplete="off"
            />
            <FieldError id="bot-name-error">{error}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor="bot-instructions">Instructions</FieldLabel>
            <Textarea id="bot-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} aria-describedby="bot-instructions-hint" placeholder="Research what I assign you. Cite primary sources." rows={4} className="max-h-60" />
            <FieldDescription id="bot-instructions-hint">You can change both later in its details.</FieldDescription>
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create bot"}
          </Button>
        </FieldGroup>
      </form>
    </div>
  );
}
