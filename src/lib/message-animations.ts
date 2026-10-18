// The "slide-up" message animation from shadcn's AI Elements chat demo
// (shadcn-ui-source apps/v4/lib/message-animations.ts, used by apps/v4/examples/radix/chat-demo.tsx:249).
import type { Variants } from "motion/react";

export const SLIDE_UP: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.26, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, y: 4, transition: { duration: 0.15 } },
};
