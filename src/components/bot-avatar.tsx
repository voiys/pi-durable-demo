import { BloubBot } from "bloub-react";
import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { BotLook } from "@/shared";

/** Helpers and bots no longer in the catalog: a gray circle, so a bot's own look stays its own. */
export const PLAIN_LOOK: BotLook = { shape: "cercle", color: "gris", expression: "neutre" };

/** A bot's face (DESIGN.md §6 Faces): its bloub (bloub-react), in its look, `size` px square, moving to a new look as it changes (morph, color cross-fade). Alive on its own (the head
 * drifts, it floats, it blinks) while it is on screen; `working` turns it into bloub's thinking dots; `follow` turns its head toward the pointer (the rail). `still` draws one
 * frame (the look picker's tiles), as does reduced motion: the dots stay, steady. The eyes are cut out of the body
 * (`paper` transparent), so they show whatever surface is behind, on both themes. Bloub draws its body as the middle 200
 * of a 316 view, so the svg is 1.58× the box, centered: the body fills the box. */
export function BotAvatar({ look, size, working = false, still = false, follow = false, className }: { look: BotLook; size: number; working?: boolean; still?: boolean; follow?: boolean; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const seen = useInView(box);
  // Bloub's motion is a function of its own clock, so faces that mount together would blink as one: each wakes up to 2s late.
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setAwake(true), Math.random() * 2000);
    return () => clearTimeout(timer);
  }, []);
  const frozen = useReducedMotion() || still || !awake || !seen;
  return (
    <span ref={box} aria-hidden className={cn("relative flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <BloubBot
        // A still frame samples t=0, where a morph to a new look starts: remount it in the new look instead.
        key={frozen ? `${look.shape}:${look.expression}` : "live"}
        size={Math.round(size * 1.58)}
        shape={look.shape}
        color={look.color}
        expression={look.expression}
        state={working ? "thinking" : "idle"}
        frozenAt={frozen ? 0 : undefined}
        follow={follow}
        paper="transparent"
        // Shape and face morph in bloub's engine; a new color cross-fades here (its ink is a fill).
        className="pointer-events-none absolute max-w-none motion-safe:[&_circle,&_path,&_rect]:transition-[fill] motion-safe:[&_circle,&_path,&_rect]:duration-300"
      />
    </span>
  );
}
