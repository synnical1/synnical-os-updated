import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-[#f0f0f0] placeholder:text-[#888888] selection:bg-white selection:text-black border-[#2a2a2a] bg-[#080808] flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base shadow-none transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-white focus-visible:ring-white/30 focus-visible:ring-[2px]",
        "aria-invalid:ring-[#ef4444]/20 dark:aria-invalid:ring-[#ef4444]/40 aria-invalid:border-[#ef4444]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
