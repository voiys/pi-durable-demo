import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: "utf-8" }, { name: "viewport", content: "width=device-width, initial-scale=1" }, { title: "pi durable" }],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: () => (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Dark mode follows the system, set before first paint so there's no flash (the `.dark` class is the one switch). */}
        <script
          dangerouslySetInnerHTML={{
            __html: "(()=>{const m=matchMedia('(prefers-color-scheme: dark)');const s=()=>document.documentElement.classList.toggle('dark',m.matches);s();m.addEventListener('change',s)})()",
          }}
        />
        <HeadContent />
      </head>
      <body>
        {/* Reduced motion: every motion element drops movement and scale and keeps its opacity (DESIGN.md §7). */}
        <MotionConfig reducedMotion="user">
          <TooltipProvider>
            <Outlet />
          </TooltipProvider>
        </MotionConfig>
        <Toaster />
        <Scripts />
      </body>
    </html>
  ),
});
