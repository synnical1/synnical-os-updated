import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-white focus-visible:ring-white/30 focus-visible:ring-[3px] aria-invalid:ring-[#ef4444]/20 dark:aria-invalid:ring-[#ef4444]/40 aria-invalid:border-[#ef4444] transition-[color,box-shadow] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-white text-black [a&]:hover:bg-white/90",
        secondary:
          "border-transparent bg-[#0d0d0d] text-[#f0f0f0] [a&]:hover:bg-[#0d0d0d]",
        destructive:
          "border-transparent bg-[#ef4444] text-white [a&]:hover:bg-[#ef4444]/90 focus-visible:ring-[#ef4444]/20 dark:focus-visible:ring-[#ef4444]/40 dark:bg-[#ef4444]/60",
        outline:
          "text-[#f0f0f0] [a&]:hover:bg-[#0d0d0d] [a&]:hover:text-[#f0f0f0]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
