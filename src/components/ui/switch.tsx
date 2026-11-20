"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

// Border-box 40×20; 1px border + 2px anchor = 3px outer inset.
// Pin the thumb at 2px or 22px from the padding edge so both states have
// an exact 3px outer inset without relying on a transform utility.
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex h-[20px] w-[40px] shrink-0 rounded-full border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] shadow-none outline-none transition-colors data-[state=checked]:border-[var(--synnical-accent)] data-[state=checked]:bg-[var(--synnical-accent)] focus-visible:ring-2 focus-visible:ring-[var(--synnical-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--synnical-surface)] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none absolute left-[2px] top-[2px] block size-[14px] rounded-full bg-[var(--synnical-text)] data-[state=checked]:left-[22px] data-[state=checked]:bg-[var(--primary-foreground)] ring-0 transition-[left] duration-150 motion-reduce:transition-none"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
