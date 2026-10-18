import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { Bot, InfinityIcon, MessageSquarePlus, Search } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { ChatPane } from "@/components/chat-pane";
import { ConnectChatGPT } from "@/components/connect-chatgpt";
import { SearchDialog } from "@/components/search-dialog";
import { Button } from "@/components/ui/button";
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
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { createChat, getSession } from "@/server/fns";
import type { UserState } from "@/shared";

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
  const { chat, agent } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const [searching, setSearching] = useState(false);
  const userAgent = useAgent<UserState>({ agent: "user", name: user.id });
  const state = userAgent.state;
  const current = state?.chats.find((c) => c.id === chat);
  const title = current
    ? [current.title, agent && current.agents.find((a) => a.session === agent)?.name].filter(Boolean).join(" / ")
    : "pi durable";

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={async () => navigate({ search: { chat: (await createChat({ data: false })).id } })} disabled={!state?.chatgpt}>
              <MessageSquarePlus /> New chat
            </Button>
            <Button variant="secondary" title="One endless chat whose history is its memory (OptChat)" onClick={async () => navigate({ search: { chat: (await createChat({ data: true })).id } })} disabled={!state?.chatgpt}>
              <InfinityIcon /> OptChat
            </Button>
          </div>
          <Button variant="outline" onClick={() => setSearching(true)}>
            <Search /> Search messages
          </Button>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {state?.chats.map((c) => (
                <SidebarMenuItem key={c.id}>
                  <SidebarMenuButton isActive={c.id === chat && !agent} onClick={() => navigate({ search: { chat: c.id } })}>
                    <span className="truncate">{c.title}</span>
                  </SidebarMenuButton>
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
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          {state && <ConnectChatGPT chatgpt={state.chatgpt} />}
          <div className="text-muted-foreground truncate px-2 text-xs">{user.email}</div>
          <Button variant="ghost" size="sm" onClick={async () => (await authClient.signOut(), navigate({ to: "/login" }))}>
            Log out
          </Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="h-svh">
        <header className="flex h-12 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <span className="truncate text-sm font-medium">{title}</span>
        </header>
        {chat ? (
          <ChatPane key={`${chat}:${agent ?? "main"}`} userId={user.id} chatId={chat} session={agent} />
        ) : (
          <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
            {state?.chatgpt ? "Pick a chat or start a new one." : "Connect your ChatGPT plan to start chatting."}
          </div>
        )}
      </SidebarInset>
      <SearchDialog open={searching} onOpenChange={setSearching} />
    </SidebarProvider>
  );
}
