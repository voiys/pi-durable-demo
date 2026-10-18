import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { BotIcon, ChevronLeft, MessageCircleDashedIcon, Plus, Search, UsersIcon, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { z } from "zod";
import { BotAvatar } from "@/components/bot-avatar";
import { BotPanel } from "@/components/bot-panel";
import { BotPane } from "@/components/bot-pane";
import { GroupAvatar, GroupPane, GroupPanel, NewGroup } from "@/components/group-pane";
import { NewBot } from "@/components/new-bot";
import { connect, NavUser } from "@/components/nav-user";
import { SearchPanel } from "@/components/search-panel";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getSession } from "@/server/fns";
import type { GroupSummary, UserState } from "@/shared";

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

/** A bot in the rail, its name in a tooltip; the open one gets a ring. */
function RailBot({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-current={active || undefined}
          onClick={onClick}
          // flex: an inline button's line box would push the ring off the avatar's center.
          className={cn("flex rounded-[15px] p-[3px] ring-2 transition-shadow duration-150 outline-none ring-inset focus-visible:ring-ring", active ? "ring-primary" : "ring-transparent")}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function App() {
  const { user } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const state = useAgent<UserState>({ agent: "user", name: user.id }).state;
  const bots = state?.bots ?? [];
  const bot = bots.find((b) => b.id === search.bot);
  const subagent = bot && search.agent ? bot.agents.find((a) => a.session === search.agent) : undefined;
  const group = state?.groups?.find((g) => g.id === search.group);
  const membersOf = (g: GroupSummary) => g.members.flatMap((id) => bots.filter((b) => b.id === id));
  // Each view names itself (WCAG 2.4.2): the bot you're talking to, or what you're doing.
  useEffect(() => {
    document.title = `${search.new ? `New ${search.new}` : (subagent?.name ?? bot?.name ?? group?.title ?? "Bots")} · pi durable`;
  }, [search.new, subagent?.name, bot?.name, group?.title]);
  const togglePanel = (panel: "details" | "search") => navigate({ search: (s) => ({ ...s, panel: s.panel === panel ? undefined : panel }) });

  return (
    <div className="flex h-svh">
      <nav aria-label="Bots" className="bg-sidebar flex w-16 shrink-0 flex-col items-center gap-3 border-r py-3">
        <div className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto overscroll-contain">
          {/* The main bot sits on top, apart from the rest (Grok Bot). */}
          {[...bots].sort((a, b) => Number(b.id === state?.mainBot) - Number(a.id === state?.mainBot)).map((b, i) => [
            i === 1 && bots[0] && state?.mainBot && <Separator key="sep" className="my-1 w-8" />,
            <RailBot key={b.id} label={b.id === state?.mainBot ? `${b.name} (main)` : b.name} active={b.id === search.bot && !search.new} onClick={() => navigate({ search: (s) => ({ bot: b.id, panel: s.panel }) })}>
              <BotAvatar bot={b} />
            </RailBot>,
          ])}
          {(state?.groups ?? []).length > 0 && <Separator className="my-1 w-8" />}
          {state?.groups?.map((g) => (
            <RailBot key={g.id} label={g.title} active={g.id === search.group} onClick={() => navigate({ search: (s) => ({ group: g.id, panel: s.panel === "search" ? "search" : undefined }) })}>
              <GroupAvatar members={membersOf(g)} />
            </RailBot>
          ))}
        </div>
        {state?.chatgpt ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="New bot or group">
                <Plus />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => navigate({ search: { new: "bot" } })}>
                  <BotIcon /> New bot
                </DropdownMenuItem>
                <DropdownMenuItem disabled={bots.length < 2} onSelect={() => navigate({ search: { new: "group" } })}>
                  <UsersIcon /> New group
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* aria-disabled, not disabled: the tooltip saying why must stay reachable by keyboard. */}
              <Button variant="ghost" size="icon" aria-label="New bot" aria-disabled className="aria-disabled:opacity-50">
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Connect ChatGPT first</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Search all bots" aria-pressed={search.panel === "search"} onClick={() => togglePanel("search")}>
              <Search />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Search</TooltipContent>
        </Tooltip>
        {state && <NavUser user={user} chatgpt={state.chatgpt} />}
      </nav>

      {/* Below md the panel takes the thread's place: two columns don't fit beside the rail at phone widths. */}
      <main className={cn("relative flex min-w-0 flex-1 flex-col", search.panel && "max-md:hidden")}>
        <header className="flex h-12 shrink-0 items-center justify-center px-3">
          {subagent && bot && (
            <Button variant="ghost" size="sm" className="absolute left-3" onClick={() => navigate({ search: (s) => ({ bot: bot.id, panel: s.panel }) })}>
              <ChevronLeft /> {bot.name}
            </Button>
          )}
          {group && !search.new && (
            <Button variant="secondary" size="sm" className="max-w-64 rounded-full" aria-pressed={search.panel === "details"} onClick={() => togglePanel("details")}>
              <GroupAvatar members={membersOf(group)} size="sm" />
              <span className="truncate">{group.title}</span>
            </Button>
          )}
          {bot && !search.new && (
            <Button variant="secondary" size="sm" className="max-w-64 rounded-full" aria-pressed={search.panel === "details"} onClick={() => togglePanel("details")}>
              {subagent ? <BotIcon /> : <BotAvatar bot={bot} size="sm" />}
              <span className="truncate">{subagent ? subagent.name : bot.name}</span>
            </Button>
          )}
        </header>
        {search.new === "bot" ? (
          <NewBot onCreated={(id) => navigate({ search: { bot: id } })} />
        ) : search.new === "group" ? (
          <NewGroup bots={bots} onCreated={(id) => navigate({ search: { group: id } })} />
        ) : group ? (
          <GroupPane key={group.id} userId={user.id} groupId={group.id} bots={bots} />
        ) : bot ? (
          <BotPane key={`${bot.id}:${search.agent ?? "main"}`} userId={user.id} bot={bot} session={search.agent} entry={search.entry} bots={bots} />
        ) : state && !state.chatgpt ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <MessageCircleDashedIcon />
              </EmptyMedia>
              <EmptyTitle>Connect your ChatGPT plan</EmptyTitle>
              <EmptyDescription>Bots run on your own ChatGPT plan. Connect it to start.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={connect}>Continue with ChatGPT</Button>
            </EmptyContent>
          </Empty>
        ) : (
          state && (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BotIcon />
                </EmptyMedia>
                <EmptyTitle>{bots.length ? "Pick a bot" : "No bots yet"}</EmptyTitle>
                <EmptyDescription>Each bot is one agent with one endless conversation and its own memory.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => navigate({ search: { new: "bot" } })}>
                  <Plus /> New bot
                </Button>
              </EmptyContent>
            </Empty>
          )
        )}
      </main>

      {(search.panel === "search" || (search.panel === "details" && (bot || group))) && (
        <aside aria-label={search.panel === "search" ? "Search" : group ? "Group details" : "Bot details"} className="flex w-80 shrink-0 flex-col border-l max-md:w-auto max-md:flex-1">
          <div className="flex h-12 shrink-0 items-center justify-between px-4">
            <h2 className="text-sm font-medium">{search.panel === "search" ? "Search" : "Details"}</h2>
            <Button variant="ghost" size="icon-sm" aria-label="Close panel" onClick={() => navigate({ search: (s) => ({ ...s, panel: undefined }) })}>
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
                onOpenAgent={(session) => navigate({ search: (s) => ({ ...s, agent: session }) })}
                onDeleted={() => navigate({ search: {} })}
              />
            )
          )}
        </aside>
      )}
    </div>
  );
}
