// shadcn sidebar-07 nav-user block (shadcn-ui-source apps/v4/registry/new-york-v4/blocks/sidebar-07/components/nav-user.tsx),
// collapsed to an avatar for the bot rail, with the ChatGPT plan connection in place of the demo items. Menu items carry
// words only (DESIGN.md §0).
import { useNavigate } from "@tanstack/react-router";
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

export const connect = () => connectChatGPT().then((url) => (window.location.href = url), fail("connect ChatGPT"));

/** The rail's account button (sidebar-07 nav-user, collapsed): the avatar opens identity, the ChatGPT plan and log out. */
export function NavUser({ user, chatgpt }: { user: { name: string; email: string }; chatgpt: UserState["chatgpt"] }) {
  const navigate = useNavigate();
  const initial = user.name.slice(0, 1).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={`Account: ${user.email}`}>
          <Avatar className="size-8">
            <AvatarFallback className="bg-muted text-sm font-medium">{initial}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="shadow-float min-w-60 rounded-lg border-0 text-sm" side="right" align="end" sideOffset={8}>
        <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-1.5 font-normal">
          <span className="truncate font-medium">{user.name}</span>
          <span className="text-muted-foreground truncate">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-muted-foreground flex flex-col gap-0.5 px-2 py-1.5 text-xs font-medium">
            ChatGPT plan
            <span className="truncate text-sm font-normal">{chatgpt ? chatgpt.email : "Not connected"}</span>
          </DropdownMenuLabel>
          {chatgpt ? (
            <>
              <DropdownMenuItem asChild>
                <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
                  Manage usage
                  <span className="sr-only"> (opens chatgpt.com)</span>
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => disconnectChatGPT().catch(fail("disconnect ChatGPT"))}>Disconnect ChatGPT</DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onSelect={connect}>Continue with ChatGPT</DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => authClient.signOut().then(() => navigate({ to: "/login" }), fail("log out"))}>Log out</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
