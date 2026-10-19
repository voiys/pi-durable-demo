import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { Plus, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
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
import { EmptyHeader } from "@/components/ui/empty";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ARRIVE, SETTLE, SettleEmpty, SLIDE_UP, useCalm } from "@/lib/motion";
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

/** The glance layer in words, for the rail's card and the accessible name (DESIGN.md §6 Rail). */
const status = (b: Pick<BotSummary, "working" | "unread">) => (b.working ? "Working" : b.unread ? "New messages" : undefined);

/**
 * A face in the rail. The open conversation gets a small ink bar at the rail's edge (macOS Dock / Linear), never a ring
 * around the face; hovering a closed one shows a shorter bar. A working bot gets a 2px ring in its own color, pulsing
 * (steady under reduced motion). The dot is unread, never on the open one: it pops in once (scale 0.6 to 1, 200ms spring,
 * no bounce; a fade under reduced motion) and fades out when read. A new face rises into the rail (ARRIVE).
 * Resting on it (or focusing it) shows a small card with a glance at who it is; the face itself opens the conversation.
 */
function RailItem({ label, active, working = false, unread = false, color, onClick, face, card }: { label: string; active: boolean; working?: boolean; unread?: boolean; color?: string; onClick: () => void; face: ReactNode; card: Omit<GlanceProps, "face"> }) {
  return (
    <HoverCard openDelay={300} closeDelay={100}>
      <HoverCardTrigger asChild>
        <motion.button
          {...ARRIVE}
          aria-label={label}
          aria-current={active || undefined}
          onClick={onClick}
          // flex: an inline button's line box would push the ring off the avatar's center.
          className="group/rail relative flex shrink-0 rounded-[15px] p-[3px] focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          {/* The rail is 64px and the item 42px, so the bar sits 11px out, on the rail's edge. */}
          <span
            aria-hidden
            className={cn(
              "bg-foreground pointer-events-none absolute top-1/2 -left-[11px] w-1 -translate-y-1/2 rounded-r-full transition-[height,opacity] duration-150 ease-out",
              active ? "h-5 opacity-100" : "h-2 opacity-0 group-hover/rail:opacity-100",
            )}
          />
          <span
            aria-hidden
            style={{ "--bot": color } as CSSProperties}
            className={cn(
              "pointer-events-none absolute inset-0 rounded-[15px] ring-2 transition-[box-shadow] duration-150 ease-out ring-inset",
              working ? "ring-(color:--bot) motion-safe:animate-ring-pulse" : "ring-transparent",
            )}
          />
          {face}
          <AnimatePresence initial={false}>
            {unread && !active && (
              <motion.span
                aria-hidden
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1, transition: { type: "spring", duration: 0.2, bounce: 0 } }}
                exit={{ opacity: 0, transition: { duration: 0.15, ease: "easeOut" } }}
                className="bg-primary ring-canvas absolute top-0 right-0 size-2 rounded-full ring-2"
              />
            )}
          </AnimatePresence>
        </motion.button>
      </HoverCardTrigger>
      {/* The faces' rings are cut in the rail's canvas color; on the card they are cut in its surface instead. */}
      <HoverCardContent side="right" align="start" className="flex flex-col gap-3 [--canvas:var(--popover)]">
        <Glance face={face} name={card.name} line={card.line} about={card.about} />
      </HoverCardContent>
    </HoverCard>
  );
}

/** The rail card's body: the face beside the name and a line of status, and a few lines about it. No "Open": clicking
 * the face opens it. */
type GlanceProps = { face: ReactNode; name: string; line: string; about?: string };
function Glance({ face, name, line, about }: GlanceProps) {
  return (
    <>
      <div className="flex items-center gap-3">
        {face}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{name}</span>
          <span className="text-muted-foreground truncate text-xs font-medium">{line}</span>
        </div>
      </div>
      {about && <p className="text-muted-foreground line-clamp-3 break-words">{about}</p>}
    </>
  );
}

/** An empty main area: a title, one sentence and one action (DESIGN.md §6 Empty states). No icon. It settles in once,
 * title, sentence, then action (SETTLE). */
function EmptyState({ title, children, action }: { title: string; children: ReactNode; action: ReactNode }) {
  const settle = useCalm(SLIDE_UP);
  return (
    <SettleEmpty.Root {...SETTLE} className="gap-6">
      <EmptyHeader className="gap-2">
        <SettleEmpty.Title variants={settle}>{title}</SettleEmpty.Title>
        <SettleEmpty.Description variants={settle}>{children}</SettleEmpty.Description>
      </EmptyHeader>
      <SettleEmpty.Content variants={settle}>{action}</SettleEmpty.Content>
    </SettleEmpty.Root>
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
  // A helper that was retired (an old link, a search hit) leads back to its bot.
  const gone = bot && search.agent && !subagent;
  useEffect(() => {
    if (gone) void navigate({ search: (s) => ({ bot: bot.id, panel: s.panel }), replace: true });
  }, [gone]);
  const togglePanel = (panel: "details" | "search") => navigate({ search: (s) => ({ ...s, panel: s.panel === panel ? undefined : panel }) });
  const showing = !search.new && (group ?? bot);

  return (
    <div className="bg-background flex h-svh overflow-hidden">
      <nav aria-label="Bots" className="bg-canvas flex w-16 shrink-0 flex-col items-center gap-3 py-3">
        <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto overscroll-contain">
          {/* The main bot sits on top, apart from the rest; groups come after another hairline. Mounted with the first
              state, so the faces already there don't animate; later ones rise in and leave faster (ARRIVE). */}
          {state && (
            <AnimatePresence initial={false}>
              {mainFirst.map((b, i) => {
                const active = !search.new && !group && b.id === bot?.id;
                const main = b.id === state.mainBot;
                return [
                  i === 1 && <Separator key="sep" className="w-8" />,
                  <RailItem
                    key={b.id}
                    label={[b.name, main && "main bot", status(b)].filter(Boolean).join(", ")}
                    active={active}
                    working={b.working}
                    unread={b.unread}
                    color={b.color}
                    onClick={() => navigate({ search: (s) => ({ bot: b.id, panel: s.panel }) })}
                    face={<BotAvatar bot={b} />}
                    card={{ name: b.name, line: [main && "Main bot", status(b) ?? "Up to date"].filter(Boolean).join(" · "), about: b.instructions }}
                  />,
                ];
              })}
              {state.groups.length > 0 && <Separator key="groups-sep" className="w-8" />}
              {state.groups.map((g) => {
                const active = g.id === search.group && !search.new;
                const members = membersOf(g);
                return (
                  <RailItem
                    key={`group:${g.id}`}
                    label={`${g.title}, group`}
                    active={active}
                    onClick={() => navigate({ search: (s) => ({ group: g.id, panel: s.panel === "search" ? "search" : undefined }) })}
                    face={<GroupAvatar members={members} />}
                    card={{ name: g.title, line: `Group of ${members.length} bots`, about: members.map((m) => m.name).join(", ") }}
                  />
                );
              })}
            </AnimatePresence>
          )}
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
              <TooltipContent side="right">
                New
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="right" align="end" sideOffset={8}>
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
            <TooltipContent side="right">
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
              className="text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:bg-accent rounded-full"
              onClick={() => togglePanel("search")}
            >
              <Search />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
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
          <BotPane key={`${bot.id}:${subagent?.session ?? "main"}`} userId={user.id} bot={bot} session={subagent?.session} entry={search.entry} bots={bots} />
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

      <AnimatePresence initial={false}>
        {(search.panel === "search" || (search.panel === "details" && showing)) && (
          // The panel slides 8px in from its edge as it fades (200ms, DESIGN.md §7); the thread takes its new width at once,
          // so nothing reflows frame by frame. It closes at once, and one open on page load doesn't animate.
          <motion.aside
            key="panel"
            aria-label={search.panel === "search" ? "Search" : group ? "Group details" : "Bot details"}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            className="bg-canvas flex w-80 shrink-0 flex-col max-md:w-auto max-md:min-w-0 max-md:flex-1"
          >
            {/* The title starts on the panel's text edge (16px gutter + 12px row inset, src/components/panel.tsx). */}
            <div className="flex h-12 shrink-0 items-center justify-between pr-2 pl-7">
              <h2 className="text-sm font-semibold">{search.panel === "search" ? "Search" : "Details"}</h2>
              <Button variant="ghost" size="icon-sm" aria-label="Close panel" className="text-muted-foreground hover:text-foreground rounded-full" onClick={() => navigate({ search: (s) => ({ ...s, panel: undefined, report: undefined }) })}>
                <X />
              </Button>
            </div>
            {search.panel === "search" ? (
              <SearchPanel bots={bots} />
            ) : group ? (
              <GroupPanel key={group.id} userId={user.id} group={group} bots={bots} onDisbanded={() => navigate({ search: {} })} />
            ) : (
              bot && (
                <BotPanel
                  key={bot.id}
                  bot={bot}
                  main={state?.mainBot === bot.id}
                  report={search.report}
                  onDeleted={() => navigate({ search: {} })}
                />
              )
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
