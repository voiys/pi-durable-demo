import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { Plus, Search, X } from "lucide-react";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { z } from "zod";
import { BotAvatar } from "@/components/bot-avatar";
import { BotPanel } from "@/components/bot-panel";
import { BotPane, ThreadHeader as BotHeader } from "@/components/bot-pane";
import { GroupAvatar, GroupPane, GroupPanel, NewGroup, ThreadHeader as GroupHeader } from "@/components/group-pane";
import { NewBot } from "@/components/new-bot";
import { connect, NavUser } from "@/components/nav-user";
import { SearchPanel } from "@/components/search-panel";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, fail } from "@/lib/utils";
import { getSession, markSeen } from "@/server/fns";
import type { BotSummary, GroupSummary, UserState } from "@/shared";

export const Route = createFileRoute("/")({
  validateSearch: z.object({
    bot: z.string().optional(),
    agent: z.string().optional(),
    entry: z.string().optional(),
    panel: z.enum(["details", "search"]).optional(),
    new: z.enum(["bot", "group"]).optional(),
    group: z.string().optional(),
    report: z.number().optional(),
  }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/login" });
    return { user: session.user };
  },
  component: App,
});

/** The glance layer in words, for the tooltip and the accessible name (DESIGN.md §6 Rail). */
const status = (b: Pick<BotSummary, "working" | "unread">) => (b.working ? "Working" : b.unread ? "New messages" : undefined);

/**
 * A face in the rail. The ring says which conversation is open (blue) or that the bot is working (its own color,
 * pulsing; steady under reduced motion); an open bot that is working pulses blue. The dot is unread, never on the open one.
 */
function RailItem({ name, label, detail, active, working = false, unread = false, color, onClick, children }: { name: string; label: string; detail?: string; active: boolean; working?: boolean; unread?: boolean; color?: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-current={active || undefined}
          onClick={onClick}
          // flex: an inline button's line box would push the ring off the avatar's center.
          className="focus-visible:outline-ring relative flex shrink-0 rounded-[15px] p-[3px] outline-none focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          <span
            aria-hidden
            style={{ "--bot": color } as CSSProperties}
            className={cn(
              "pointer-events-none absolute inset-0 rounded-[15px] ring-2 transition-[box-shadow] duration-150 ring-inset",
              active ? "ring-primary" : working ? "ring-(color:--bot)" : "ring-transparent",
              working && "motion-safe:animate-pulse motion-safe:[animation-duration:1.6s]",
            )}
          />
          {children}
          {unread && !active && <span aria-hidden className="bg-primary ring-canvas absolute top-0 right-0 size-2 rounded-full ring-2" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={6} className="flex flex-col gap-0.5 text-sm">
        <span className="font-medium">{name}</span>
        {detail && <span className="opacity-70">{detail}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/** An empty main area: a title, one sentence and one action (DESIGN.md §6 Empty states). No icon. */
function EmptyState({ title, children, action }: { title: string; children: ReactNode; action: ReactNode }) {
  return (
    <Empty className="gap-6">
      <EmptyHeader className="gap-2">
        <EmptyTitle className="text-2xl font-semibold">{title}</EmptyTitle>
        <EmptyDescription className="text-base">{children}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{action}</EmptyContent>
    </Empty>
  );
}

function App() {
  const { user } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const state = useAgent<UserState>({ agent: "user", name: user.id }).state;
  const bots = state?.bots ?? [];
  // With nothing picked, the main bot's conversation is open, as a messenger opens your last chat.
  const bot = bots.find((b) => b.id === (search.bot ?? (search.group || search.new ? undefined : state?.mainBot)));
  const subagent = bot && search.agent ? bot.agents.find((a) => a.session === search.agent) : undefined;
  const group = state?.groups.find((g) => g.id === search.group);
  const membersOf = (g: GroupSummary) => g.members.flatMap((id) => bots.filter((b) => b.id === id));
  const mainFirst = [...bots].sort((a, b) => Number(b.id === state?.mainBot) - Number(a.id === state?.mainBot));
  // Each view names itself (WCAG 2.4.2): the bot you're talking to, or what you're doing.
  useEffect(() => {
    document.title = `${search.new ? `New ${search.new}` : (subagent?.name ?? group?.title ?? bot?.name ?? "Bots")} · pi durable`;
  }, [search.new, subagent?.name, bot?.name, group?.title]);
  // The open conversation is read while it is on screen: clears the rail's dot now and whenever the tab comes back.
  const reading = !search.new && !group && !subagent ? bot : undefined;
  useEffect(() => {
    if (!reading?.unread) return;
    const see = () => document.visibilityState === "visible" && void markSeen({ data: reading.id }).catch(fail("mark as read"));
    see();
    document.addEventListener("visibilitychange", see);
    return () => document.removeEventListener("visibilitychange", see);
  }, [reading?.id, reading?.unread]);
  const togglePanel = (panel: "details" | "search") => navigate({ search: (s) => ({ ...s, panel: s.panel === panel ? undefined : panel }) });
  const showing = !search.new && (group ?? bot);

  return (
    <div className="bg-background flex h-svh">
      <nav aria-label="Bots" className="bg-canvas flex w-16 shrink-0 flex-col items-center gap-3 py-3">
        <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto overscroll-contain">
          {/* The main bot sits on top, apart from the rest; groups come after another hairline. */}
          {mainFirst.map((b, i) => [
            i === 1 && <Separator key="sep" className="w-8" />,
            <RailItem
              key={b.id}
              name={b.name}
              label={[b.name, b.id === state?.mainBot && "main bot", status(b)].filter(Boolean).join(", ")}
              detail={status(b)}
              active={!search.new && !group && b.id === bot?.id}
              working={b.working}
              unread={b.unread}
              color={b.color}
              onClick={() => navigate({ search: (s) => ({ bot: b.id, panel: s.panel }) })}
            >
              <BotAvatar bot={b} />
            </RailItem>,
          ])}
          {state && state.groups.length > 0 && <Separator className="w-8" />}
          {state?.groups.map((g) => (
            <RailItem key={g.id} name={g.title} label={`${g.title}, group`} active={g.id === search.group && !search.new} onClick={() => navigate({ search: (s) => ({ group: g.id, panel: s.panel === "search" ? "search" : undefined }) })}>
              <GroupAvatar members={membersOf(g)} />
            </RailItem>
          ))}
        </div>
        {state?.chatgpt ? (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="New bot or group" className="text-muted-foreground hover:text-foreground rounded-full">
                    <Plus />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-sm">
                New
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="right" align="end" sideOffset={8} className="shadow-float min-w-40 rounded-lg border-0 text-sm">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => navigate({ search: { new: "bot" } })}>New bot</DropdownMenuItem>
                <DropdownMenuItem disabled={bots.length < 2} onSelect={() => navigate({ search: { new: "group" } })}>
                  New group
                  {bots.length < 2 && <span className="text-muted-foreground ml-auto text-xs">Needs 2 bots</span>}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* aria-disabled, not disabled: the tooltip saying why must stay reachable by keyboard. */}
              <Button variant="ghost" size="icon" aria-label="New bot" aria-disabled className="text-muted-foreground rounded-full aria-disabled:opacity-50">
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-sm">
              Connect ChatGPT first
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Search all bots"
              aria-pressed={search.panel === "search"}
              className="text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:bg-sidebar-accent rounded-full"
              onClick={() => togglePanel("search")}
            >
              <Search />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-sm">
            Search
          </TooltipContent>
        </Tooltip>
        {state && <NavUser user={user} chatgpt={state.chatgpt} />}
      </nav>

      {/* Below md the panel takes the thread's place: two columns don't fit beside the rail at phone widths. */}
      <main className={cn("relative flex min-w-0 flex-1 flex-col", search.panel && "max-md:hidden")}>
        {group && !search.new ? (
          <GroupHeader group={group} members={membersOf(group)} detailsOpen={search.panel === "details"} onToggleDetails={() => togglePanel("details")} />
        ) : (
          bot && !search.new && <BotHeader bot={bot} subagent={subagent} detailsOpen={search.panel === "details"} onToggleDetails={() => togglePanel("details")} onBack={() => navigate({ search: (s) => ({ bot: bot.id, panel: s.panel }) })} />
        )}
        {search.new === "bot" ? (
          <NewBot botCount={bots.length} onCreated={(id) => navigate({ search: { bot: id } })} />
        ) : search.new === "group" ? (
          <NewGroup bots={bots} onCreated={(id) => navigate({ search: { group: id } })} />
        ) : group ? (
          <GroupPane key={group.id} userId={user.id} groupId={group.id} bots={bots} />
        ) : bot ? (
          <BotPane key={`${bot.id}:${search.agent ?? "main"}`} userId={user.id} bot={bot} session={search.agent} entry={search.entry} bots={bots} />
        ) : state && !state.chatgpt ? (
          <EmptyState title="Connect your ChatGPT plan" action={<Button onClick={connect}>Continue with ChatGPT</Button>}>
            Your bots run on your own ChatGPT plan. Connect it once and they're ready to work.
          </EmptyState>
        ) : (
          state && (
            <EmptyState title="Make your first bot" action={<Button onClick={() => navigate({ search: { new: "bot" } })}>New bot</Button>}>
              A bot researches what you hand it, in one endless conversation with its own memory.
            </EmptyState>
          )
        )}
      </main>

      {(search.panel === "search" || (search.panel === "details" && showing)) && (
        <aside aria-label={search.panel === "search" ? "Search" : group ? "Group details" : "Bot details"} className="bg-canvas flex w-80 shrink-0 flex-col max-md:w-auto max-md:min-w-0 max-md:flex-1">
          <div className="flex h-12 shrink-0 items-center justify-between pr-2 pl-4">
            <h2 className="text-sm font-medium">{search.panel === "search" ? "Search" : "Details"}</h2>
            <Button variant="ghost" size="icon-sm" aria-label="Close panel" className="text-muted-foreground hover:text-foreground rounded-full" onClick={() => navigate({ search: (s) => ({ ...s, panel: undefined, report: undefined }) })}>
              <X />
            </Button>
          </div>
          {search.panel === "search" ? (
            <SearchPanel bots={bots} onOpen={(h) => navigate({ search: { bot: h.botId, entry: h.entryId, panel: "search" } })} />
          ) : group ? (
            <GroupPanel key={group.id} group={group} bots={bots} onDisbanded={() => navigate({ search: {} })} />
          ) : (
            bot && (
              <BotPanel
                key={bot.id}
                bot={bot}
                main={state?.mainBot === bot.id}
                report={search.report}
                onOpenReport={(report) => navigate({ search: (s) => ({ ...s, report }) })}
                onOpenAgent={(session) => navigate({ search: (s) => ({ ...s, bot: bot.id, agent: session }) })}
                onDeleted={() => navigate({ search: {} })}
              />
            )
          )}
        </aside>
      )}
    </div>
  );
}
