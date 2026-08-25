import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-white focus-visible:ring-white/35 focus-visible:ring-[3px] aria-invalid:ring-[#ef4444]/25 aria-invalid:border-[#ef4444]",
  {
    variants: {
      variant: {
        default:
          "border border-white bg-white text-black shadow-none hover:bg-[#e8e8e8] hover:border-[#e8e8e8]",
        destructive:
          "border border-[#ef4444] bg-[#ef4444] text-white shadow-none hover:bg-[#dc2626] focus-visible:ring-[#ef4444]/30",
        outline:
          "border border-[#353535] bg-black text-white shadow-none hover:border-[#5a5a5a] hover:bg-[#111111]",
        secondary:
          "border border-[#2d2d2d] bg-[#111111] text-white shadow-none hover:bg-[#191919]",
        ghost:
          "border border-transparent bg-black text-[#d7d7d7] shadow-none hover:border-[#2b2b2b] hover:bg-[#101010] hover:text-white",
        link: "bg-transparent text-white underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
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
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
