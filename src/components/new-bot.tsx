import { motion } from "motion/react";
import { useRef, useState } from "react";
import { BotAvatar } from "@/components/bot-avatar";
import { LookPicker } from "@/components/look-picker";
import { CARD } from "@/components/panel";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SETTLE, SLIDE_UP, useCalm } from "@/lib/motion";
import { createBot } from "@/server/fns";
import { nextLook } from "@/shared";

/** "New bot", in place: a name, what it is for and its look, under the face it will get. The bot exists once created; its
 * conversation starts empty. Checked on submit: a missing or refused name (taken, bad characters) is said under the
 * name, which takes focus. It settles in once: face and title, then the sentence, then the fields (SETTLE). */
export function NewBot({ botCount, onCreated }: { botCount: number; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [look, setLook] = useState(() => nextLook(botCount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const nameRef = useRef<HTMLInputElement>(null);
  const refuse = (message: string) => (setError(message), nameRef.current!.focus());
  const settle = useCalm(SLIDE_UP);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto overscroll-contain px-4 py-12">
      <motion.form
        {...SETTLE}
        noValidate
        className="flex w-full max-w-sm flex-col gap-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return refuse("Give it a name, like Scout.");
          setBusy(true);
          createBot({ data: { name, instructions, look } }).then(({ id }) => onCreated(id), (e: Error) => (setBusy(false), refuse(e.message)));
        }}
      >
        <header className="flex flex-col items-center gap-3 text-center">
          <motion.div variants={settle} className="flex flex-col items-center gap-3">
            <BotAvatar look={look} size={56} />
            <h1 className="text-2xl font-semibold">New bot</h1>
          </motion.div>
          <motion.p variants={settle} className="text-muted-foreground text-balance">
            Give it a name and a job. It keeps one endless conversation and remembers what you tell it.
          </motion.p>
        </header>
        <motion.div variants={settle}>
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
            </Field>
            <Field>
              <FieldLabel id="bot-look" asChild>
                <span>Look</span>
              </FieldLabel>
              <div role="group" aria-labelledby="bot-look">
                <LookPicker look={look} onChange={(patch) => setLook({ ...look, ...patch })} className={CARD} />
              </div>
              <FieldDescription id="bot-instructions-hint">You can change all of this later in its details.</FieldDescription>
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create bot"}
            </Button>
          </FieldGroup>
        </motion.div>
      </motion.form>
    </div>
  );
}
