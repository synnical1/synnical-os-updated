import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-[#2a2a2a] placeholder:text-[#888888] focus-visible:border-white focus-visible:ring-white/30 aria-invalid:ring-[#ef4444]/20 aria-invalid:border-[#ef4444] bg-[#080808] flex field-sizing-content min-h-16 w-full rounded-md border px-3 py-2 text-base shadow-none transition-colors outline-none focus-visible:ring-[2px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
