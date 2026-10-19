import { cn } from "cn"

/** A placeholder in the shape of what is coming: the translucent accent fill (reads on the thread, the canvas panel and
 * popovers in both themes), pulsing slowly; still under reduced motion (DESIGN.md §7). */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-md bg-accent motion-safe:animate-pulse", className)}
      {...props}
    />
  )
}

export { Skeleton }
