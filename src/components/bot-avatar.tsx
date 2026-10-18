import { cn } from "@/lib/utils";
import type { BotSummary } from "@/shared";

/** A bot's face: its color with its initial, as in the rail. */
export function BotAvatar({ bot, size = "md", className }: { bot: Pick<BotSummary, "name" | "color">; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: bot.color }}
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold text-white select-none",
        { sm: "size-5 rounded-md text-[10px]", md: "size-9 rounded-xl text-sm", lg: "size-14 rounded-2xl text-xl" }[size],
        className,
      )}
    >
      {bot.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
