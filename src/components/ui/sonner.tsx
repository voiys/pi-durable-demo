import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-right"
      offset={16}
      visibleToasts={3}
      closeButton
      toastOptions={{
        classNames: {
          // Elevation from a layered shadow (hairline ring + soft drop) instead of a border; radius-xl (12px) with 12px padding. Reduced motion drops sonner's transitions.
          toast:
            "items-start! gap-2.5! rounded-xl! border-transparent! p-3! shadow-[0_0_0_1px_rgb(0_0_0/0.06),0_2px_6px_rgb(0_0_0/0.06),0_8px_24px_-4px_rgb(0_0_0/0.12)]! dark:shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_8px_24px_-4px_rgb(0_0_0/0.5)]! motion-reduce:transition-none!",
          icon: "mt-0.5 mr-0! ml-0!",
          title: "text-sm font-medium",
          // Server messages are often lowercase: capitalise the first letter for display only.
          description: "text-muted-foreground! text-[13px] first-letter:uppercase",
          error: "[&_[data-icon]]:text-destructive dark:[&_[data-icon]]:text-red-400",
          closeButton: "bg-popover! text-muted-foreground! hover:text-foreground! border-border! shadow-sm",
        },
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-xl)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
