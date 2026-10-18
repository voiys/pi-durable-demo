import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { MessageSquarePlus, Search } from "lucide-react";
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
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { authClient } from "@/lib/auth-client";
import { createChat, getSession } from "@/server/fns";
import type { UserState } from "@/shared";

export const Route = createFileRoute("/")({
  validateSearch: z.object({ chat: z.string().optional(), entry: z.string().optional() }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) throw redirect({ to: "/login" });
    return { user: session.user };
  },
  component: App,
});

function App() {
  const { user } = Route.useRouteContext();
  const { chat } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const [searching, setSearching] = useState(false);
  const agent = useAgent<UserState>({ agent: "user", name: user.id });
  const state = agent.state;

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <Button onClick={async () => navigate({ search: { chat: (await createChat()).id } })} disabled={!state?.chatgpt}>
            <MessageSquarePlus /> New chat
          </Button>
          <Button variant="outline" onClick={() => setSearching(true)}>
            <Search /> Search messages
          </Button>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>
              {state?.chats.map((c) => (
                <SidebarMenuItem key={c.id}>
                  <SidebarMenuButton isActive={c.id === chat} onClick={() => navigate({ search: { chat: c.id } })}>
                    <span className="truncate">{c.title}</span>
                  </SidebarMenuButton>
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
          <span className="truncate text-sm font-medium">{state?.chats.find((c) => c.id === chat)?.title ?? "pi durable"}</span>
        </header>
        {chat ? (
          <ChatPane key={chat} userId={user.id} chatId={chat} />
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
