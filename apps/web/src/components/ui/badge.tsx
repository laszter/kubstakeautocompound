"use client"

import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Pill chips. Status colours are "soft" (tinted fill + coloured text); `default` stays solid (counts).
// Prefer <StatusBadge kind=…/> (components/status-badge.tsx) for status meaning.
const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-[color-mix(in_oklab,var(--primary),var(--foreground)_12%)]",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "border-destructive/20 bg-destructive/10 text-destructive [a]:hover:bg-destructive/15",
        outline:
          "border-border bg-card text-foreground [a]:hover:bg-muted",
        ghost: "hover:bg-muted hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        success:
          "border-success/20 bg-success-soft text-success [a]:hover:border-success/40",
        warning:
          "border-warning/20 bg-warning-soft text-warning [a]:hover:border-warning/40",
        info: "border-info/20 bg-info-soft text-info [a]:hover:border-info/40",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
