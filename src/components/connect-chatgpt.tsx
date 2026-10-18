import { Button } from "@/components/ui/button";
import { connectChatGPT, disconnectChatGPT } from "@/server/fns";
import type { UserState } from "@/shared";

export function ConnectChatGPT({ chatgpt }: { chatgpt: UserState["chatgpt"] }) {
  if (!chatgpt)
    return (
      <Button variant="secondary" onClick={async () => (window.location.href = await connectChatGPT())}>
        Continue with ChatGPT
      </Button>
    );
  return (
    <div className="grid gap-1 rounded-md border p-2 text-xs">
      <span className="truncate">ChatGPT plan: {chatgpt.email}</span>
      <div className="flex gap-1">
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
          <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">Manage usage</a>
        </Button>
        <Button variant="link" size="sm" className="text-muted-foreground h-auto p-0 text-xs" onClick={() => disconnectChatGPT()}>
          Disconnect
        </Button>
      </div>
    </div>
  );
}
