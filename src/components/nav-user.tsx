// shadcn sidebar-07 nav-user block (shadcn-ui-source apps/v4/registry/new-york-v4/blocks/sidebar-07/components/nav-user.tsx),
// collapsed to an avatar for the bot rail, with the ChatGPT plan connection in place of the demo items.
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink, LogOut, Sparkles, Unplug } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { connectChatGPT, disconnectChatGPT } from "@/server/fns";
import type { UserState } from "@/shared";
import { fail } from "@/lib/utils";

function Identity({ name, email }: { name: string; email: string }) {
  return (
    <>
      <Avatar className="h-8 w-8 rounded-lg">
        <AvatarFallback className="rounded-lg">{name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-xs">{email}</span>
      </div>
    </>
  );
}

export const connect = () => connectChatGPT().then((url) => (window.location.href = url), fail("connect ChatGPT"));

/** The rail's account button (sidebar-07 nav-user, collapsed): the avatar opens identity, the ChatGPT plan and log out. */
export function NavUser({ user, chatgpt }: { user: { name: string; email: string }; chatgpt: UserState["chatgpt"] }) {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9 rounded-full" aria-label="Open account menu">
          <Avatar className="size-8">
            <AvatarFallback>{user.name.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56 rounded-lg" side="right" align="end" sideOffset={8}>
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <Identity name={user.name} email={user.email} />
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            {chatgpt ? `ChatGPT plan · ${chatgpt.email}` : "ChatGPT plan not connected"}
          </DropdownMenuLabel>
          {chatgpt ? (
            <>
              <DropdownMenuItem asChild>
                <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Manage usage
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => disconnectChatGPT().catch(fail("disconnect ChatGPT"))}>
                <Unplug />
                Disconnect ChatGPT
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={connect}>
              <Sparkles />
              Continue with ChatGPT
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => authClient.signOut().then(() => navigate({ to: "/login" }), fail("log out"))}>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
