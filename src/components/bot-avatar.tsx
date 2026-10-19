import { cn } from "@/lib/utils";
import type { BotSummary } from "@/shared";

/** A bot's face: a squircle in its color with its initial (DESIGN.md §6 Rail). The color is identity, never UI. */
export function BotAvatar({ bot, size = "md", className }: { bot: Pick<BotSummary, "name" | "color">; size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: bot.color }}
      className={cn(
        "flex shrink-0 items-center justify-center font-semibold text-white select-none",
        { sm: "size-5 rounded-md text-xs", md: "size-9 rounded-lg text-base", lg: "size-14 rounded-xl text-2xl" }[size],
        className,
      )}
    >
      {bot.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
