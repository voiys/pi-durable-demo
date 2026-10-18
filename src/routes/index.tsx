import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { MessageCircleDashedIcon, MessageSquarePlus, Search, SearchX, X } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ChatPane, DraftPane } from "@/components/chat-pane";
import { ChatRow } from "@/components/chat-row";
import { DebugSection } from "@/components/debug-section";
import { SubagentRow } from "@/components/subagent-row";
import { connect, NavUser } from "@/components/nav-user";
import { ChatHits } from "@/components/search-hits";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { getSession, searchMessages } from "@/server/fns";
import type { SearchHit, UserState } from "@/shared";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ chat: z.string().optional(), entry: z.string().optional(), agent: z.string().optional() }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/login" });
    return { user: session.user };
  },
  component: App,
});

function App() {
  const { user } = Route.useRouteContext();
  const { chat, agent, entry } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    if (!query.trim()) return setHits([]);
    const t = setTimeout(async () => setHits(await searchMessages({ data: query })), 150);
    return () => clearTimeout(t);
  }, [query]);
  const userAgent = useAgent<UserState>({ agent: "user", name: user.id });
  const state = userAgent.state;
  const current = state?.chats.find((c) => c.id === chat);
  // While searching, show only chats with a message hit (bm25 order) or a matching title.
  const needle = query.trim().toLowerCase();
  const chats = needle
    ? (state?.chats ?? []).filter((c) => hits.some((h) => h.chatId === c.id) || c.title.toLowerCase().includes(needle))
    : (state?.chats ?? []);
  const title = current
    ? [current.title, agent && current.agents.find((a) => a.session === agent)?.name].filter(Boolean).join(" / ")
    : "pi durable";

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <Tooltip open={state?.chatgpt ? false : undefined}>
                <TooltipTrigger asChild>
                  <span className="block">
                    <SidebarMenuButton variant="outline" onClick={() => navigate({ search: {} })} disabled={!state?.chatgpt}>
                      <MessageSquarePlus /> New chat
                    </SidebarMenuButton>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Connect ChatGPT first</TooltipContent>
              </Tooltip>
            </SidebarMenuItem>
          </SidebarMenu>
          <InputGroup className="bg-background h-8 shadow-none">
            <InputGroupInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats and messages" aria-label="Search chats and messages" />
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            {query && (
              <InputGroupAddon align="inline-end">
                {needle && <InputGroupText className="tabular-nums">{chats.length}</InputGroupText>}
                <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setQuery("")}>
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {needle && chats.length === 0 && (
                <Empty className="p-4 md:p-4">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <SearchX />
                    </EmptyMedia>
                    <EmptyTitle>No matches</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              )}
              {chats.map((c) => (
                <ChatRow
                  key={c.id}
                  chat={c}
                  active={c.id === chat && !agent}
                  // While searching, a chat opens at its best (first, bm25-ranked) hit.
                  onOpen={() => navigate({ search: { chat: c.id, entry: hits.find((h) => h.chatId === c.id)?.entryId } })}
                  onDeleted={() => c.id === chat && navigate({ search: {} })}
                >
                  {needle && <ChatHits hits={hits.filter((h) => h.chatId === c.id)} />}
                  {c.agents.length > 0 && (
                    <SidebarMenuSub className="mr-0 pr-0">
                      {c.agents.map((a) => (
                        <SubagentRow
                          key={a.session}
                          chatId={c.id}
                          name={a.name}
                          active={c.id === chat && a.session === agent}
                          onOpen={() => navigate({ search: { chat: c.id, agent: a.session } })}
                          onRetired={() => a.session === agent && navigate({ search: { chat: c.id } })}
                        />
                      ))}
                    </SidebarMenuSub>
                  )}
                </ChatRow>
              ))}
            </SidebarMenu>
          </SidebarGroup>
          {state && <DebugSection debug={state.debug} />}
        </SidebarContent>
        <SidebarFooter>
          {state && <NavUser user={user} chatgpt={state.chatgpt} />}
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="h-svh min-w-0">
        <header className="flex h-12 items-center gap-2 border-b px-3">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <span className="min-w-0 truncate text-sm font-medium" title={title}>{title}</span>
        </header>
        {chat ? (
          <ChatPane key={`${chat}:${agent ?? "main"}`} userId={user.id} chatId={chat} session={agent} entry={entry} chats={state?.chats ?? []} />
        ) : (
          state?.chatgpt ? (
            <DraftPane onCreated={(id) => navigate({ search: { chat: id } })} />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageCircleDashedIcon />
                </EmptyMedia>
                <EmptyTitle>Connect your ChatGPT plan</EmptyTitle>
                <EmptyDescription>Chats run on your own ChatGPT plan. Connect it to start chatting.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={connect}>Continue with ChatGPT</Button>
              </EmptyContent>
            </Empty>
          )
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
