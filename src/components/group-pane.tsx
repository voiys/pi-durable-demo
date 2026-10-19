import { Link } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { Fragment, useRef, useState } from "react";
import { Markdown } from "@/components/ai/markdown";
import type { Sender } from "@/components/ai/agents-message";
import { BotAvatar } from "@/components/bot-avatar";
import { breaksTime, Composer, HeaderBar, Said, Status, Thread, ThreadEmpty, ThreadItem, ThreadRow, ThreadSkeleton, TimeDivider, WorkingRow, YourSaid } from "@/components/bot-pane";
import { BARE, CARD, CELL, DangerRow, Group, Identity, LINE, NAME, PanelBody, Saved, TAP, useField } from "@/components/panel";
import { QuoteProvider } from "@/components/quotes";
import { Button } from "@/components/ui/button";
import { EmptyHeader } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SETTLE, SettleEmpty, SLIDE_UP, useCalm } from "@/lib/motion";
import { cn, fail } from "@/lib/utils";
import { createGroup, disbandGroup, postToGroup, updateGroup } from "@/server/fns";
import { botObjectName, type BotSummary, type GroupState, type GroupSummary } from "@/shared";

/** A few member faces: `md` sets them in a 36px tile for the rail, `sm` (20px) and `lg` (56px) line them up, `face`
 * the px size of each in a line. Side by side, not overlapped: bloub shapes aren't round, so a cut ring wouldn't fit. */
export function GroupAvatar({ members, size = "md", face = { sm: 20, lg: 56 }[size === "md" ? "sm" : size] }: { members: Pick<BotSummary, "look">[]; size?: "sm" | "md" | "lg"; face?: number }) {
  const shown = members.slice(0, 3);
  if (size === "md")
    return (
      // The same 36px rounded square as a bot's face, so every rail item has one shape; the faces sit inside it.
      <span aria-hidden className="bg-muted relative flex size-9 shrink-0 rounded-xl">
        {shown.map((m, i) => (
          <BotAvatar key={i} look={m.look} size={i === 2 ? 12 : 16} follow className={cn("absolute", ["top-1 left-1", "right-1 bottom-1", "top-1 right-1"][i])} />
        ))}
      </span>
    );
  return (
    <span aria-hidden className={cn("flex", size === "sm" ? "gap-0.5" : "gap-1.5")}>
      {shown.map((m, i) => (
        <BotAvatar key={i} look={m.look} size={face} />
      ))}
    </span>
  );
}

/** The header over a group's thread: its members' faces over its name, opening the group's details. */
export function ThreadHeader({ group, members, detailsOpen, onToggleDetails }: { group: GroupSummary; members: BotSummary[]; detailsOpen: boolean; onToggleDetails: () => void }) {
  return <HeaderBar face={<GroupAvatar members={members} size="sm" />} name={group.title} detailsOpen={detailsOpen} onToggleDetails={onToggleDetails} />;
}

/** A group room's synced state (Group DO), for its thread and its details. */
const useRoom = (userId: string, groupId: string) => useAgent<GroupState>({ agent: "group", name: botObjectName(userId, groupId) }).state;

const names = (list: string[]) => (list.length < 3 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);

/** A group chat, the same thread as a bot's: you on the right in blue, each bot on the left with its face and name
 * (iMessage group). Bots working on what they just heard show under your message, or on a line of their own. */
export function GroupPane({ userId, groupId, bots }: { userId: string; groupId: string; bots: BotSummary[] }) {
  const state = useRoom(userId, groupId);
  const [openedAt] = useState(Date.now);
  // A bot in a group can't be deleted (src/server/user.ts deleteBot), so every speaker is one of the user's bots.
  const member = (id: string) => {
    const bot = bots.find((b) => b.id === id);
    if (!bot) throw new Error(`Group member ${id} is not one of the user's bots`);
    return bot;
  };
  const sender = (id: string): Sender => ({ key: id, name: member(id).name, look: member(id).look, to: { bot: id } });
  const messages = state?.messages ?? [];
  const typing = state ? names(state.typing.map((id) => sender(id).name)) : "";
  const working = typing && `${typing} ${state!.typing.length === 1 ? "is" : "are"} working…`;
  const anchorAt = messages.findLastIndex((m) => m.from === null);
  const said = (id: string) => {
    const m = messages.find((x) => x.id === id);
    if (!m) throw new Error(`Group message ${id} replies to a message the room doesn't have`);
    return { sender: m.from ? sender(m.from).name : "You", text: m.text };
  };
  return (
    <QuoteProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        <Thread
          busy={!!working}
          composer={
            <Composer
              mentions={state?.members.map((m) => member(m.id))}
              onSend={(text, replyTo) => void postToGroup({ data: { groupId, text, replyTo } }).catch(fail("send to the group"))}
              ready={!!state}
              placeholder={state ? `Message ${state.title}` : "Connecting…"}
            />
          }
        >
          {!state && <ThreadSkeleton />}
          {state && messages.length === 0 && (
            <ThreadEmpty
              face={<GroupAvatar members={state.members.map((m) => member(m.id))} size="lg" />}
              title={state.title}
              description={state.purpose || "Everyone here hears your messages. @mention a bot or reply to its message to talk to just that one; bots hand work to each other the same way."}
            />
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const divides = breaksTime(prev?.ts, m.ts);
            const first = divides || prev.from !== m.from;
            const last = !next || breaksTime(m.ts, next.ts) || next.from !== m.from;
            const mine = m.from === null;
            const enter = m.ts >= openedAt;
            return (
              <Fragment key={m.id}>
                {divides && <TimeDivider id={`time:${m.id}`} ts={m.ts} enter={enter} />}
                <ThreadItem id={m.id} first={first} enter={enter} mine={mine} anchor={i === anchorAt}>
                  <ThreadRow mine={mine} sender={mine ? undefined : sender(m.from!)} first={first} last={last}>
                    {mine ? (
                      <YourSaid text={m.text} run={{ first, last }} id={m.id} replied={m.replyTo ? said(m.replyTo) : undefined} />
                    ) : (
                      <Said run={{ first, last }} reply={{ sender: sender(m.from!).name, text: m.text, replyTo: m.id }}>
                        <Markdown>{m.text}</Markdown>
                      </Said>
                    )}
                    {mine && !next && <Status working={!!working}>{working || "Delivered"}</Status>}
                  </ThreadRow>
                </ThreadItem>
              </Fragment>
            );
          })}
          {working && messages.at(-1)?.from !== null && <WorkingRow label={working} />}
        </Thread>
      </div>
    </QuoteProvider>
  );
}

/** "New group", in place: which bots, and a name. Checked on submit: too few bots is said under them and focus goes
 * back to the first; a refusal from the server is said above the button. It settles in once: title, sentence, form. */
export function NewGroup({ bots, onCreated }: { bots: BotSummary[]; onCreated: (id: string) => void }) {
  const [members, setMembers] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ members?: string; form?: string }>({});
  const picker = useRef<HTMLFieldSetElement>(null);
  const picked = members.map((id) => bots.find((b) => b.id === id)!);
  const settle = useCalm(SLIDE_UP);
  return (
    <SettleEmpty.Root {...SETTLE} className="justify-start pt-12 md:pt-20">
      <EmptyHeader className="gap-1.5">
        <SettleEmpty.Title variants={settle}>New group</SettleEmpty.Title>
        <SettleEmpty.Description variants={settle}>Put a few bots in one room to work on something together. Each keeps what it learned after you disband it.</SettleEmpty.Description>
      </EmptyHeader>
      <SettleEmpty.Content variants={settle} className="max-w-sm">
        <form
          noValidate
          className="w-full text-left"
          onSubmit={(e) => {
            e.preventDefault();
            if (members.length < 2) return setProblem({ members: "Pick at least two bots." }), picker.current!.querySelector("button")!.focus();
            setBusy(true);
            setProblem({});
            createGroup({ data: { title: title.trim(), botIds: members, purpose: purpose.trim() } }).then(({ id }) => onCreated(id), (e: Error) => (setProblem({ form: `Couldn't start the group: ${e.message}` }), setBusy(false)));
          }}
        >
          <FieldGroup>
            <FieldSet ref={picker} data-invalid={problem.members ? true : undefined} aria-describedby={problem.members ? "group-members-error" : undefined} className="gap-0">
              <FieldLegend variant="label">Bots</FieldLegend>
              <ToggleGroup type="multiple" variant="outline" value={members} onValueChange={(v) => (setMembers(v), setProblem({}))} spacing={2} className="w-full flex-wrap justify-start">
                {bots.map((b) => (
                  <ToggleGroupItem key={b.id} value={b.id} className="gap-1.5 pr-3 pl-1.5 font-normal">
                    <BotAvatar look={b.look} size={20} />
                    {b.name}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldError id="group-members-error" className="pt-2">
                {problem.members}
              </FieldError>
            </FieldSet>
            <Field>
              <FieldLabel htmlFor="group-title">Name</FieldLabel>
              <Input id="group-title" value={title} onChange={(e) => setTitle(e.target.value)} aria-describedby="group-title-hint" placeholder={picked.length ? picked.map((b) => b.name).join(", ") : "Launch research"} maxLength={60} />
              <FieldDescription id="group-title-hint">Leave it empty to name the group after its bots.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="group-purpose">What it's for</FieldLabel>
              <Textarea
                id="group-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                aria-describedby="group-purpose-hint"
                placeholder={`Plan the product launch. ${picked[0]?.name ?? "Scout"} digs up what competitors shipped, ${picked[1]?.name ?? "Scribe"} drafts the announcement.`}
                rows={3}
                className="max-h-48"
              />
              <FieldDescription id="group-purpose-hint">Every bot here reads this: the goal, and who owns what.</FieldDescription>
            </Field>
            <FieldError>{problem.form}</FieldError>
            <Button type="submit" disabled={busy} className="self-start">
              {busy ? "Starting…" : "Start group"}
            </Button>
          </FieldGroup>
        </form>
      </SettleEmpty.Content>
    </SettleEmpty.Root>
  );
}

/** What a group is for, edited in place and saved when it loses focus (as a bot's instructions are). */
function PurposeGroup({ groupId, purpose }: { groupId: string; purpose: string }) {
  const field = useField(purpose, (v) => updateGroup({ data: { groupId, purpose: v } }));
  return (
    <Group title="What it's for" id="group-panel-purpose-title" aside={<Saved at={field.savedAt} />} footer={field.error && <FieldError id="group-panel-purpose-error">{field.error}</FieldError>}>
      <div className={CARD}>
        <Textarea
          {...field.control}
          aria-labelledby="group-panel-purpose-title"
          aria-describedby={field.error ? "group-panel-purpose-error" : undefined}
          placeholder="The goal, and who owns what. Every bot here reads it."
          className={cn(BARE, "max-h-80")}
        />
      </div>
    </Group>
  );
}

/** A group's details, inline beside it, as grouped lists: its name and what it's for (both edited in place), who's in
 * it, and disbanding it when the work is done. */
export function GroupPanel({ userId, group, bots, onDisbanded }: { userId: string; group: GroupSummary; bots: BotSummary[]; onDisbanded: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const state = useRoom(userId, group.id);
  const title = useField(group.title, (v) => updateGroup({ data: { groupId: group.id, title: v } }), "Give it a name.");
  const members = group.members.flatMap((id) => bots.filter((b) => b.id === id));
  return (
    <PanelBody>
      <Identity
        face={<GroupAvatar members={members} size="lg" face={28} />}
        name={
          <>
            <label htmlFor="group-panel-title" className="sr-only">
              Name
            </label>
            <Input
              id="group-panel-title"
              {...title.control}
              onKeyDown={(e) => (e.key === "Enter" ? e.currentTarget.blur() : title.control.onKeyDown(e))}
              aria-describedby={title.error ? "group-panel-title-error" : undefined}
              maxLength={60}
              autoComplete="off"
              className={NAME}
            />
          </>
        }
        line={
          <>
            {title.error ? <FieldError id="group-panel-title-error">{title.error}</FieldError> : <p className="text-muted-foreground text-sm">{members.length === 1 ? "1 bot" : `${members.length} bots`}</p>}
            <Saved at={title.savedAt} />
          </>
        }
      />
      {state ? (
        <PurposeGroup groupId={group.id} purpose={state.purpose} />
      ) : (
        <div role="status" className="flex flex-col gap-1.5">
          <span className="sr-only">Loading what it's for…</span>
          <Skeleton aria-hidden className="mx-3 h-3 w-20" />
          <div aria-hidden className={cn(CARD, "flex flex-col gap-2.5 px-3 py-3.5")}>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      )}
      <Group title="Members">
        <ul className={CARD}>
          {members.map((b) => (
            <li key={b.id} className={cn(LINE, "not-first:before:left-11")}>
              <Link to="/" search={{ bot: b.id }} className={cn(CELL, TAP)}>
                <BotAvatar look={b.look} size={20} />
                <span className="min-w-0 break-words">{b.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Group>
      <Group footer="Disbanding deletes this room. Each bot keeps what it saw here in its own memory.">
        <DangerRow
          className={CARD}
          label="Disband group"
          question={`Disband ${group.title}?`}
          action="Disband"
          asking={confirming}
          onAsk={() => setConfirming(true)}
          onCancel={() => setConfirming(false)}
          onConfirm={() => disbandGroup({ data: group.id }).then(onDisbanded, fail("disband group"))}
        />
      </Group>
    </PanelBody>
  );
}
