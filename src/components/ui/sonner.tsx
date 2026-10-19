import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * Toasts are a floating surface like a popover: --popover fill, shadow-float, 12px radius, 13px text, top-center.
 * No type icons and no colored fills (DESIGN.md §2.0): the title says what happened ("Couldn't rename bot"). The theme
 * follows prefers-color-scheme, the same signal that sets `.dark` (src/routes/__root.tsx).
 */
const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="system"
    className="toaster group"
    position="top-center"
    offset={16}
    visibleToasts={3}
    closeButton
    toastOptions={{
      classNames: {
        toast:
          "items-start! gap-2! rounded-lg! border-transparent! bg-popover! p-3! font-sans! text-sm! text-popover-foreground! shadow-float! focus-visible:outline-2! focus-visible:outline-ring! motion-reduce:transition-none!",
        icon: "hidden!",
        title: "text-sm! font-medium!",
        // Server messages are often lowercase: capitalise the first letter for display only.
        description: "text-sm! text-muted-foreground! first-letter:uppercase",
        closeButton:
          "border-transparent! bg-popover! text-muted-foreground! shadow-float! hover:bg-popover! hover:text-foreground! focus-visible:outline-2",
      },
    }}
    {...props}
  />
)

export { Toaster }
