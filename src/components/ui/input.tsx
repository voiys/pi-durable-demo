import * as React from "react"
import { cn } from "cn"

/** 36px, 6px radius, hairline input border. 16px text below md so iOS doesn't zoom, 15px above (DESIGN.md §4).
 *  Focus: the border turns ring color and a 1px outline doubles it, a 2px blue edge (4.70:1 on white). */
const field =
  "w-full min-w-0 rounded-md border border-input bg-transparent text-[1rem] transition-[color,border-color] duration-150 placeholder:text-faint focus-visible:border-ring focus-visible:outline-1 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:outline-destructive md:text-base"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        field,
        "h-9 px-2.5 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input, field }
