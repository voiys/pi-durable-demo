import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { Bot, MessageSquarePlus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ChatPane, DraftPane } from "@/components/chat-pane";
import { ChatRow } from "@/components/chat-row";
import { NavUser } from "@/components/nav-user";
import { ChatHits } from "@/components/search-hits";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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
          <Button onClick={() => navigate({ search: {} })} disabled={!state?.chatgpt}>
            <MessageSquarePlus /> New chat
          </Button>
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
            <SidebarInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats and messages" className="pl-8" />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {needle && chats.length === 0 && <p className="text-muted-foreground px-2 text-sm">No matches.</p>}
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
                    <SidebarMenuSub>
                      {c.agents.map((a) => (
                        <SidebarMenuSubItem key={a.session}>
                          <SidebarMenuSubButton
                            isActive={c.id === chat && a.session === agent}
                            onClick={() => navigate({ search: { chat: c.id, agent: a.session } })}
                          >
                            <Bot />
                            <span className="truncate">{a.name}</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  )}
                </ChatRow>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          {state && <NavUser user={user} chatgpt={state.chatgpt} />}
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="h-svh">
        <header className="flex h-12 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <span className="truncate text-sm font-medium">{title}</span>
        </header>
        {chat ? (
          <ChatPane key={`${chat}:${agent ?? "main"}`} userId={user.id} chatId={chat} session={agent} entry={entry} />
        ) : (
          state?.chatgpt ? (
            <DraftPane onCreated={(id) => navigate({ search: { chat: id } })} />
          ) : (
            <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">Connect your ChatGPT plan to start chatting.</div>
          )
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
