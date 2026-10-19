import { Link } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { Fragment, useState } from "react";
import { Markdown } from "@/components/ai/markdown";
import type { Sender } from "@/components/ai/agents-message";
import { BotAvatar } from "@/components/bot-avatar";
import { InlineConfirm } from "@/components/inline-confirm";
import { breaksTime, Composer, HeaderBar, Said, Status, Thread, ThreadEmpty, ThreadItem, ThreadRow, TimeDivider, WorkingRow } from "@/components/bot-pane";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn, fail } from "@/lib/utils";
import { createGroup, disbandGroup, postToGroup } from "@/server/fns";
import { botObjectName, type BotSummary, type GroupState, type GroupSummary } from "@/shared";

/** A few member faces, overlapped: `md` stacks them in a 36px tile for the rail, `sm` and `lg` line them up. */
export function GroupAvatar({ members, size = "md" }: { members: Pick<BotSummary, "name" | "color">[]; size?: "sm" | "md" | "lg" }) {
  const shown = members.slice(0, 3);
  if (size === "md")
    return (
      <span aria-hidden className="relative flex size-9 items-center justify-center">
        {shown.map((m, i) => (
          <BotAvatar key={i} bot={m} size="sm" className={cn("ring-canvas absolute rounded-full ring-2", ["top-0 left-0 size-6", "right-0 bottom-0 size-6", "top-0 right-0 size-5"][i])} />
        ))}
      </span>
    );
  return (
    <span aria-hidden className={cn("flex", size === "sm" ? "*:not-first:-ml-1.5" : "*:not-first:-ml-3")}>
      {shown.map((m, i) => (
        <BotAvatar key={i} bot={m} size="sm" className={cn("ring-background rounded-full ring-2", size === "lg" && "size-14 text-2xl")} />
      ))}
    </span>
  );
}

/** The header over a group's thread: its members' faces over its name, opening the group's details. */
export function ThreadHeader({ group, members, detailsOpen, onToggleDetails }: { group: GroupSummary; members: BotSummary[]; detailsOpen: boolean; onToggleDetails: () => void }) {
  return <HeaderBar face={<GroupAvatar members={members} size="sm" />} name={group.title} detailsOpen={detailsOpen} onToggleDetails={onToggleDetails} />;
}

const names = (list: string[]) => (list.length < 3 ? list.join(" and ") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);

/** A group chat, the same thread as a bot's: you on the right in blue, each bot on the left with its face and name
 * (iMessage group). Bots working on what they just heard show under your message, or on a line of their own. */
export function GroupPane({ userId, groupId, bots }: { userId: string; groupId: string; bots: BotSummary[] }) {
  const room = useAgent<GroupState>({ agent: "group", name: botObjectName(userId, groupId) });
  const state = room.state;
  const [openedAt] = useState(Date.now);
  // A bot in a group can't be deleted (src/server/user.ts deleteBot), so every speaker is one of the user's bots.
  const member = (id: string) => {
    const bot = bots.find((b) => b.id === id);
    if (!bot) throw new Error(`Group member ${id} is not one of the user's bots`);
    return bot;
  };
  const sender = (id: string): Sender => ({ key: id, name: member(id).name, color: member(id).color, to: { bot: id } });
  const messages = state?.messages ?? [];
  const typing = state ? names(state.typing.map((id) => sender(id).name)) : "";
  const working = typing && `${typing} ${state!.typing.length === 1 ? "is" : "are"} working…`;
  const anchorAt = messages.findLastIndex((m) => m.from === null);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Thread busy={!!working}>
        {state && messages.length === 0 && (
          <ThreadEmpty
            face={<GroupAvatar members={state.members.map((m) => member(m.id))} size="lg" />}
            title={state.title}
            description="Everyone here hears your messages. @mention a bot to talk to just that one; bots hand work to each other the same way."
          />
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const divides = breaksTime(prev?.ts, m.ts);
          const first = divides || prev.from !== m.from;
          const last = !next || breaksTime(m.ts, next.ts) || next.from !== m.from;
          const mine = m.from === null;
          return (
            <Fragment key={m.id}>
              {divides && <TimeDivider id={`time:${m.id}`} ts={m.ts} />}
              <ThreadItem id={m.id} first={first} enter={m.ts >= openedAt} mine={mine} anchor={i === anchorAt}>
                <ThreadRow mine={mine} sender={mine ? undefined : sender(m.from!)} first={first} last={last}>
                  <Said mine={mine} tail={last}>
                    {mine ? m.text : <Markdown>{m.text}</Markdown>}
                  </Said>
                  {mine && !next && <Status working={!!working}>{working || "Delivered"}</Status>}
                </ThreadRow>
              </ThreadItem>
            </Fragment>
          );
        })}
        {working && messages.at(-1)?.from !== null && <WorkingRow label={working} />}
      </Thread>
      <Composer
        onSend={(text) => void postToGroup({ data: { groupId, text } }).catch(fail("send to the group"))}
        ready={!!state}
        placeholder={state ? `Message ${state.title}` : "Connecting…"}
      />
    </div>
  );
}

/** "New group", in place: which bots, and a name. */
export function NewGroup({ bots, onCreated }: { bots: BotSummary[]; onCreated: (id: string) => void }) {
  const [members, setMembers] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const picked = members.map((id) => bots.find((b) => b.id === id)!);
  return (
    <Empty className="justify-start pt-12 md:pt-20">
      <EmptyHeader className="gap-1.5">
        <EmptyTitle className="text-2xl font-semibold">New group</EmptyTitle>
        <EmptyDescription className="text-base">Put a few bots in one room to work on something together. Each keeps what it learned after you disband it.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="max-w-sm">
        <form
          className="flex w-full flex-col gap-6 text-left"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            createGroup({ data: { title: title.trim(), botIds: members } }).then(({ id }) => onCreated(id), fail("create group")).finally(() => setBusy(false));
          }}
        >
          <div className="flex flex-col gap-2">
            <Label id="group-members" className="text-muted-foreground text-xs font-medium">
              Bots
            </Label>
            <ToggleGroup type="multiple" variant="outline" value={members} onValueChange={setMembers} aria-labelledby="group-members" spacing={2} className="w-full flex-wrap justify-start">
              {bots.map((b) => (
                <ToggleGroupItem key={b.id} value={b.id} className="data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background data-[state=on]:hover:bg-foreground/90 data-[state=on]:hover:text-background h-8 gap-1.5 rounded-full pr-3 pl-1.5 text-sm font-normal">
                  <BotAvatar bot={b} size="sm" className="rounded-full" />
                  {b.name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="group-title" className="text-muted-foreground text-xs font-medium">
              Name
            </Label>
            <Input id="group-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={picked.length ? picked.map((b) => b.name).join(", ") : "Launch research"} maxLength={60} />
          </div>
          <Button type="submit" disabled={members.length < 2 || busy} className="self-start">
            {busy ? "Starting…" : members.length < 2 ? "Pick at least two bots" : "Start group"}
          </Button>
        </form>
      </EmptyContent>
    </Empty>
  );
}

/** A group's details, inline beside it: who's in it, and disbanding it when the work is done. */
export function GroupPanel({ group, bots, onDisbanded }: { group: GroupSummary; bots: BotSummary[]; onDisbanded: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const members = group.members.flatMap((id) => bots.filter((b) => b.id === id));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain p-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <GroupAvatar members={members} size="lg" />
        <span className="max-w-full truncate text-lg font-semibold">{group.title}</span>
        <span className="text-muted-foreground text-sm">{members.length === 1 ? "1 bot" : `${members.length} bots`}</span>
      </div>
      <section aria-labelledby="group-members-title" className="flex flex-col gap-1">
        <h3 id="group-members-title" className="text-muted-foreground px-2 text-xs font-medium">
          Members
        </h3>
        <ul className="flex flex-col">
          {members.map((b) => (
            <li key={b.id}>
              <Button variant="ghost" size="sm" className="w-full justify-start text-sm font-normal" asChild>
                <Link to="/" search={{ bot: b.id }}>
                  <BotAvatar bot={b} size="sm" className="rounded-full" />
                  <span className="truncate">{b.name}</span>
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <div className="mt-auto flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">Disbanding deletes this room. Each bot keeps what it saw here in its own memory.</p>
        {confirming ? (
          <InlineConfirm question={`Disband ${group.title}?`} action="Disband" onCancel={() => setConfirming(false)} onConfirm={() => disbandGroup({ data: group.id }).then(onDisbanded, fail("disband group"))} />
        ) : (
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive w-fit px-2 text-sm font-normal" onClick={() => setConfirming(true)}>
            Disband group
          </Button>
        )}
      </div>
    </div>
  );
}
