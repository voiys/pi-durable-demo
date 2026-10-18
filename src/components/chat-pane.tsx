import { ArrowUp, Square } from "lucide-react";
import { useState } from "react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { usePiSession } from "@/pi/use-pi-session";
import type { PiMessage } from "@/pi/transcript";
import { chatObjectName } from "@/shared";

function Row({ message }: { message: PiMessage }) {
  const text = message.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n");
  if (message.role !== "user" && message.role !== "assistant") return null;
  return (
    <MessageScrollerItem messageId={message.id} scrollAnchor={message.role === "user"}>
      <Message id={`entry-${message.id}`} align={message.role === "user" ? "end" : "start"}>
        <MessageContent>
          <Bubble variant={message.role === "user" ? "default" : "muted"}>
            <BubbleContent className="whitespace-pre-wrap">{text || "…"}</BubbleContent>
          </Bubble>
          {message.error && <p className="text-destructive text-xs">{message.error}</p>}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}

export function ChatPane({ userId, chatId }: { userId: string; chatId: string }) {
  const session = usePiSession(chatObjectName(userId, chatId));
  const [draft, setDraft] = useState("");
  const send = () => {
    if (!draft.trim()) return;
    session.submit(draft);
    setDraft("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MessageScrollerProvider>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl p-4">
              {session.messages.map((m) => (
                <Row key={m.id} message={m} />
              ))}
              {session.live && <Row message={session.live} />}
              {session.error && <p className="text-destructive text-sm">{session.error}</p>}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <form
        className="mx-auto w-full max-w-3xl p-4"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <InputGroup>
          <InputGroupTextarea
            value={draft}
            placeholder={session.status === "open" ? "Message pi…" : "Connecting…"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <InputGroupAddon align="block-end" className="justify-end p-2">
            {session.running ? (
              <InputGroupButton type="button" variant="outline" size="icon-sm" onClick={session.abort}>
                <Square />
              </InputGroupButton>
            ) : (
              <InputGroupButton type="submit" variant="default" size="icon-sm" disabled={session.status !== "open"}>
                <ArrowUp />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  );
}
