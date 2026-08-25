"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

/** Uses the supplied photographic OLED rose with the legacy mark as fallback. */
export function AnimatedBrandMark({ className }: { className?: string }) {
  const [fallback, setFallback] = useState(false)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={fallback ? "/logo.svg" : "/brand/rose.png"}
      alt="Synnical"
      className={cn("object-cover", className)}
      onError={() => setFallback(true)}
    />
  )
}
