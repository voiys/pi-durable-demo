// The enter animation for new messages: shadcn's chat-demo slide-up (apps/v4/lib/message-animations.ts "blur-fade" preset)
// at the better-ui values (opacity + 12px translateY + 4px blur, 300ms ease-out). Reduced motion cross-fades opacity only.
import type { Variants } from "motion/react";

export const SLIDE_UP: Variants = {
  initial: { opacity: 0, y: 12, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.3, ease: "easeOut" } },
};

export const FADE: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
};
