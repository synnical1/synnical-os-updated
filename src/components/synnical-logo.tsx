import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"

/** The supplied artwork, split into neutral light and theme-colored energy. */
export function SynnicalLogo({ variant = "mark", small = false, className, decorative = false }: {
  variant?: "logo" | "mark"
  small?: boolean
  className?: string
  decorative?: boolean
}) {
  const asset = variant === "mark" && small ? "mark-small" : variant
  const style = { "--synnical-logo-mask": `url("/brand/synnical/synnical-${asset}-accent-mask.png")` } as CSSProperties
  return <span className={cn("synnical-logo", variant === "logo" ? "synnical-logo-full" : "synnical-logo-mark", className)}
    style={style} role={decorative ? undefined : "img"} aria-label={decorative ? undefined : "Synnical"} aria-hidden={decorative || undefined}>
    <span className="synnical-logo-accent" />
    <img src={`/brand/synnical/synnical-${asset}-base.webp`} alt="" draggable={false} decoding="async" />
  </span>
}
