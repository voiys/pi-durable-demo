import { Link } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { LogOutIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { Working } from "@/components/ai/activity";
import { Markdown } from "@/components/ai/markdown";
import { BotAvatar } from "@/components/bot-avatar";
import { InlineConfirm } from "@/components/inline-confirm";
import { Composer } from "@/components/bot-pane";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Message, MessageAvatar, MessageContent, MessageHeader } from "@/components/ui/message";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller";
import { Trace } from "@/components/ui/trace";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fail } from "@/lib/utils";
import { createGroup, disbandGroup, postToGroup } from "@/server/fns";
import { botObjectName, type BotSummary, type GroupState, type GroupSummary } from "@/shared";

/** A few member faces, overlapped, for a group in the rail and its header. */
export function GroupAvatar({ members, size = "md" }: { members: Pick<BotSummary, "name" | "color">[]; size?: "sm" | "md" }) {
  const shown = members.slice(0, 3);
  return (
    <span aria-hidden className={size === "md" ? "relative flex size-9 items-center justify-center" : "flex -space-x-1.5"}>
      {size === "md" ? (
        shown.map((m, i) => (
          <BotAvatar key={i} bot={m} size="sm" className={["absolute top-0 left-0 size-6 rounded-full ring-2 ring-sidebar", "absolute right-0 bottom-0 size-6 rounded-full ring-2 ring-sidebar", "absolute top-0 right-0 size-5 rounded-full ring-2 ring-sidebar"][i]} />
        ))
      ) : (
        shown.map((m, i) => <BotAvatar key={i} bot={m} size="sm" className="rounded-full ring-2 ring-background" />)
      )}
    </span>
  );
}

/** A group chat: the user on the right in blue, each bot on the left with its face and name (iMessage group). Bots that
 * are working on what they just heard show as a running line. */
export function GroupPane({ userId, groupId, bots }: { userId: string; groupId: string; bots: BotSummary[] }) {
  const room = useAgent<GroupState>({ agent: "group", name: botObjectName(userId, groupId) });
  const state = room.state;
  const botOf = (id: string) => bots.find((b) => b.id === id);
  const name = (id: string) => botOf(id)?.name ?? state?.members.find((m) => m.id === id)?.name ?? "a bot";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider autoScroll>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-3 px-4 pt-4 pb-6">
              {state && state.messages.length === 0 && (
                <MessageScrollerItem messageId="empty">
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <UsersIcon />
                      </EmptyMedia>
                      <EmptyTitle>{state.title}</EmptyTitle>
                      <EmptyDescription>Everyone here hears your messages. @mention a bot to talk to just that one; bots hand work to each other the same way.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </MessageScrollerItem>
              )}
              {state?.messages.map((m, i) => {
                const bot = m.from && botOf(m.from);
                const first = i === 0 || state.messages[i - 1].from !== m.from;
                return (
                  <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.from === null && i === state.messages.findLastIndex((x) => x.from === null)}>
                    {m.from === null ? (
                      <Message align="end">
                        <MessageContent>
                          <Bubble align="end" variant="default">
                            <BubbleContent className="rounded-[18px] whitespace-pre-wrap">{m.text}</BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    ) : (
                      <Message>
                        <MessageAvatar className="self-end">{bot ? <BotAvatar bot={bot} className="size-7 rounded-full text-xs" /> : <span className="size-7" />}</MessageAvatar>
                        <MessageContent>
                          {first && <MessageHeader className="text-muted-foreground px-3 text-xs">{name(m.from)}</MessageHeader>}
                          <Bubble variant="muted">
                            <BubbleContent className="rounded-[18px]">
                              <Markdown>{m.text}</Markdown>
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    )}
                  </MessageScrollerItem>
                );
              })}
              {state && state.typing.length > 0 && (
                <MessageScrollerItem messageId="typing">
                  <Trace>
                    <Working label={`${state.typing.map(name).join(", ")} ${state.typing.length === 1 ? "is" : "are"} on it`} />
                  </Trace>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton variant="outline" />
        </MessageScroller>
      </MessageScrollerProvider>
      <Composer
        onSend={(text) => void postToGroup({ data: { groupId, text } }).catch(fail("send to the group"))}
        ready={!!state}
        running={false}
        onAbort={() => {}}
        placeholder={`Message ${state?.title ?? "the group"}…`}
      />
    </div>
  );
}

/** "New group", in place: which bots, and a name. */
export function NewGroup({ bots, onCreated }: { bots: BotSummary[]; onCreated: (id: string) => void }) {
  const [members, setMembers] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <UsersIcon />
        </EmptyMedia>
        <EmptyTitle>New group</EmptyTitle>
        <EmptyDescription>Put a few bots in one room to work on something together. Disband it when you're done; each bot keeps what it learned.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <form
          className="grid w-full max-w-sm gap-4 text-left"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            createGroup({ data: { title, botIds: members } }).then(({ id }) => onCreated(id), fail("create group")).finally(() => setBusy(false));
          }}
        >
          <div className="grid gap-2">
            <Label id="group-members">Bots</Label>
            <ToggleGroup type="multiple" variant="outline" value={members} onValueChange={setMembers} aria-labelledby="group-members" className="flex-wrap justify-start">
              {bots.map((b) => (
                <ToggleGroupItem key={b.id} value={b.id} className="gap-1.5 px-2.5">
                  <BotAvatar bot={b} size="sm" className="rounded-full" />
                  {b.name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="group-title">Name</Label>
            <Input id="group-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={members.length ? members.map((id) => bots.find((b) => b.id === id)?.name).join(", ") : "e.g. launch research"} maxLength={60} />
          </div>
          <Button type="submit" disabled={members.length < 2 || busy}>
            {members.length < 2 ? "Pick at least two bots" : "Start group"}
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
        <GroupAvatar members={members} />
        <span className="font-medium">{group.title}</span>
      </div>
      <section className="grid gap-2">
        <h3 className="text-muted-foreground text-xs font-medium">Members</h3>
        <ul className="grid gap-1">
          {members.map((b) => (
            <li key={b.id}>
              <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
                <Link to="/" search={{ bot: b.id }}>
                  <BotAvatar bot={b} size="sm" className="rounded-full" /> {b.name}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </section>
      <div className="mt-auto grid gap-2">
        <p className="text-muted-foreground text-xs">Disbanding deletes this room. Each bot keeps what it saw here in its own memory.</p>
        {confirming ? (
          <InlineConfirm question={`Disband ${group.title}?`} action="Disband" onCancel={() => setConfirming(false)} onConfirm={() => disbandGroup({ data: group.id }).then(onDisbanded, fail("disband group"))} />
        ) : (
          <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive w-fit px-0" onClick={() => setConfirming(true)}>
            <LogOutIcon /> Disband group
          </Button>
        )}
      </div>
    </div>
  );
}
