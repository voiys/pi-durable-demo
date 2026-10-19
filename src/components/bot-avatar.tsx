import { BloubBot, type GazeScript } from "bloub-react";
import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/utils";
import type { BotLook } from "@/shared";

/** Helpers and bots no longer in the catalog: a gray circle, so a bot's own look stays its own. */
export const PLAIN_LOOK: BotLook = { shape: "cercle", color: "gris", expression: "neutre" };

/** Where the pointer is, shared by every following face; null off the window or on touch. */
let pointer: { x: number; y: number } | null = null;
let tracking = false;
function trackPointer() {
  if (tracking) return;
  tracking = true;
  addEventListener("pointermove", (e) => void (pointer = e.pointerType === "touch" ? null : { x: e.clientX, y: e.clientY }));
  document.addEventListener("pointerleave", () => void (pointer = null));
}

/** A head turned straight at the pointer. Bloub's own `follow` first turns the head 26° left, toward its studio's panel
 * (bot/gaze.ts TURN), so a rail face would always look left; this is its lookTarget without that turn: yaw ±16°, pitch
 * 10 ± 13° (YAW_MAX, PITCH, PITCH_MAX), easing in over its 1.1s turn time (easeOutQuint). */
function aimAt(box: RefObject<HTMLElement | null>): GazeScript {
  return (t) => {
    const r = box.current!.getBoundingClientRect();
    const toward = (from: number, to: number, half: number) => Math.max(-1, Math.min(1, (to - from) / half));
    const nx = pointer ? toward(r.left + r.width / 2, pointer.x, innerWidth / 2) : 0;
    const ny = pointer ? toward(r.top + r.height / 2, pointer.y, innerHeight / 2) : 0;
    return { yaw: nx * 16, pitch: 10 - ny * 13, mix: 1 - (1 - Math.min(t / 1.1, 1)) ** 5, spin: 0, wander: pointer ? 0 : 1 };
  };
}

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
  const gaze = useMemo(() => (follow ? aimAt(box) : null), [follow]);
  useEffect(() => void (follow && trackPointer()), [follow]);
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
        gaze={frozen ? null : gaze}
        paper="transparent"
        // Shape and face morph in bloub's engine; a new color cross-fades here (its ink is a fill).
        className="pointer-events-none absolute max-w-none motion-safe:[&_circle,&_path,&_rect]:transition-[fill] motion-safe:[&_circle,&_path,&_rect]:duration-300"
      />
    </span>
  );
}
