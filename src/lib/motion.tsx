// Every motion preset in the app (DESIGN.md §2.6, §7; better-ui animations, enter-exit, icon-transitions). One ladder:
// enters 150ms (rows, menus), 200ms (fades, arrivals) or 300ms (your message, staged entrances); exits one step shorter
// (100ms after a 150ms enter, else 150ms); ease-out throughout, springs with no bounce. Movement and scale are dropped
// under reduced motion by <MotionConfig reducedMotion="user"> (src/routes/__root.tsx); blur by `useCalm`. Opacity
// always stays, and every change still reads in words or color.
import { AnimatePresence, motion, useReducedMotion, type MotionProps, type Variants } from "motion/react";
import { Empty, EmptyContent, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

/** Your new message, and each chunk of a staged entrance: shadcn chat-demo's blur-fade slide-up (apps/v4/lib/
 * message-animations.ts) at the better-ui values, opacity + 12px rise + 4px blur, 300ms ease-out. */
export const SLIDE_UP: Variants = {
  initial: { opacity: 0, y: 12, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.3, ease: "easeOut" } },
};

/** Replies, other senders, captions, swapped words: opacity only, 200ms in, 150ms out. An exit told `custom` true is
 * instant (lines folding into a run's summary have nowhere to fade to). */
export const FADE: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2, ease: "easeOut" } },
  exit: (instant?: boolean) => ({ opacity: 0, transition: { duration: instant ? 0 : 0.15, ease: "easeOut" } }),
};

/** A run's summary line settling in: opacity + 4px blur, 200ms. */
export const BLUR_IN: Variants = {
  initial: { opacity: 0, filter: "blur(4px)" },
  animate: { opacity: 1, filter: "blur(0px)", transition: { duration: 0.2, ease: "easeOut" } },
};

/** A report card rising 4px into place just after the activity line that saved it starts its fade. */
export const RISE: Variants = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: "easeOut", delay: 0.1 } },
};

/** A contextual icon swap (send and stop): better-ui's exact cross-fade, scale .25 + 4px blur, spring .3s, no bounce. */
const SPRING = { type: "spring", duration: 0.3, bounce: 0 } as const;
export const ICON: Variants = {
  initial: { opacity: 0, scale: 0.25, filter: "blur(4px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)", transition: SPRING },
  exit: { opacity: 0, scale: 0.25, filter: "blur(4px)", transition: SPRING },
};

/** A row entering or leaving a live list (library, data, helpers, routines) or an inline confirm swap: opacity in 150ms,
 * out 100ms. Wrap the list in `<AnimatePresence initial={false}>` so the rows already there don't animate. */
export const ROW: MotionProps = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.15, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.1, ease: "easeOut" } },
};

/** A face arriving in the rail: a fade and a 4px rise in 200ms; leaving, a 150ms fade. */
export const ARRIVE: MotionProps = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.15, ease: "easeOut" } },
};

/** An infrequent view's one-time entrance (empty states, the new-bot and new-group forms): its chunks (title,
 * description, actions) settle in 100ms apart, each a motion element with `variants={useCalm(SLIDE_UP)}`. */
export const SETTLE: MotionProps = { initial: "initial", animate: "animate", variants: { animate: { transition: { staggerChildren: 0.1 } } } };

/** The Empty parts as motion elements, for a SETTLE entrance. */
export const SettleEmpty = { Root: motion.create(Empty), Title: motion.create(EmptyTitle), Description: motion.create(EmptyDescription), Content: motion.create(EmptyContent) };

/** `variants`, or the plain fade when the person asked for reduced motion (MotionConfig would still run blur). */
export const useCalm = (variants: Variants) => (useReducedMotion() ? FADE : variants);

/** Words that cross-fade in place when they change ("Delivered" to "Working…", who is working): the old fade out over
 * the new in one grid cell, so the line box never moves. The parent is the grid; the first words never animate. */
export function CrossFade({ text, className }: { text: string; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      <motion.span key={text} className={cn("[grid-area:1/1]", className)} variants={FADE} initial="initial" animate="animate" exit="exit">
        {text}
      </motion.span>
    </AnimatePresence>
  );
}
