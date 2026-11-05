import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Pill buttons (reference: 40px, bold). Focus = full-opacity ring + offset (≥ 3:1 on every surface).
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Hover states must keep AA too: /90 over white drops white text to 4.20 (mixing toward --foreground raises it in both themes).
        default: "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklab,var(--primary),var(--foreground)_12%)]",
        outline:
          "border-input bg-transparent text-foreground hover:bg-muted aria-expanded:bg-muted",
        "outline-primary":
          "border-primary bg-transparent text-primary hover:bg-primary/5 aria-expanded:bg-primary/5", // /10 = 4.37 in light
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklab,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-[color-mix(in_oklab,var(--secondary),var(--foreground)_6%)]",
        ghost:
          "text-foreground hover:bg-muted aria-expanded:bg-muted",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/15 focus-visible:ring-destructive", // /20 < 4.5 on dialog footers
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-10 gap-2 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        xs: "h-7 gap-1 px-3 text-xs has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3.5 text-[0.8rem] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-6 text-base has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5",
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8",
        "icon-lg": "size-11 [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
