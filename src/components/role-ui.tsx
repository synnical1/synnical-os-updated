"use client"

import type { ReactNode } from "react"
import type { Role } from "@/lib/api"
import { cn } from "@/lib/utils"
import { AvatarDecoration, AvatarDecorationBackdrop } from "@/components/avatar-decorations"
import { ProfileEffectLayer as ProfileEffectVisualLayer } from "@/components/profile-effects"
import { BETA_TESTER_TAG, GOAT_TAG, BIG_SITE_OWNER_TAG, DEV_TAG, NOTABLE_PERSON_TAG, ordinaryTags, recognitionTags } from "@/lib/recognition-tags"

const avatarRoleBorder: Record<Role, string> = {
  OWNER: "border-amber-400/55",
  HEAD_ADMIN: "border-red-400/45",
  ADMIN: "border-red-400/45",
  MOD: "border-blue-400/45",
  MEMBER: "border-[var(--synnical-border)]",
}

const roleMeta: Record<Exclude<Role, "MEMBER">, { label: string; className: string }> = {
  OWNER: { label: "Owner", className: "border-amber-400/25 bg-amber-400/[0.08] text-amber-200" },
  HEAD_ADMIN: { label: "Admin", className: "border-red-400/25 bg-red-400/[0.08] text-red-200" },
  ADMIN: { label: "Admin", className: "border-red-400/25 bg-red-400/[0.08] text-red-200" },
  MOD: { label: "Mod", className: "border-blue-400/25 bg-blue-400/[0.08] text-blue-200" },
}

const recognitionMeta: Record<typeof NOTABLE_PERSON_TAG | typeof BIG_SITE_OWNER_TAG | typeof DEV_TAG | typeof BETA_TESTER_TAG | typeof GOAT_TAG, { label: string; className: string }> = {
  [NOTABLE_PERSON_TAG]: { label: "Notable person", className: "border-cyan-400/20 bg-cyan-400/[0.06] text-cyan-200" },
  [BIG_SITE_OWNER_TAG]: { label: "Site owner", className: "border-sky-400/20 bg-sky-400/[0.06] text-sky-200" },
  [BETA_TESTER_TAG]: { label: "Beta tester", className: "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200" },
  [GOAT_TAG]: { label: "GOAT", className: "border-rose-400/20 bg-rose-400/[0.06] text-rose-200" },
  [DEV_TAG]: { label: "Developer", className: "border-violet-400/20 bg-violet-400/[0.06] text-violet-200" },
}

const badgeBase = "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none"

export function RoleBadge({ role, tags, className }: { role: Role; tags?: string[] | null; className?: string }) {
  const recognition = recognitionTags(tags)
  if (role === "MEMBER" && recognition.length === 0) return null

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {role !== "MEMBER" && (
        <span className={cn(badgeBase, roleMeta[role].className)}>{roleMeta[role].label}</span>
      )}
      {recognition.map((tag) => {
        const meta = recognitionMeta[tag]
        return <span key={tag} className={cn(badgeBase, meta.className)}>{meta.label}</span>
      })}
    </span>
  )
}

export function DisplayName({ name, role, className }: { name: ReactNode; role: Role; className?: string }) {
  return (
    <span className={cn(
      role !== "MEMBER" && "font-semibold",
      role === "OWNER" && "text-amber-200",
      (role === "HEAD_ADMIN" || role === "ADMIN") && "text-red-200",
      role === "MOD" && "text-blue-200",
      className,
    )}>
      {name}
    </span>
  )
}

function customTagLabel(slug: string): string {
  return slug.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function TagsDisplay({ tags, className }: { tags: string[]; className?: string }) {
  const visible = ordinaryTags(tags)
  if (!visible.length) return null

  const custom = (value: string) => {
    const match = /^custom:([a-z0-9-]{1,24}):(?:heart|crown|star|shield|code|thumbs-up|tag):(pink|red|orange|amber|yellow|green|blue|cyan|purple|violet|white|gray)$/i.exec(value)
    if (!match) return null

    const [, slug, colour] = match
    const palette: Record<string, string> = {
      pink: "border-pink-400/20 bg-pink-400/[0.06] text-pink-200",
      red: "border-red-400/20 bg-red-400/[0.06] text-red-200",
      orange: "border-orange-400/20 bg-orange-400/[0.06] text-orange-200",
      amber: "border-amber-400/20 bg-amber-400/[0.06] text-amber-200",
      yellow: "border-yellow-400/20 bg-yellow-400/[0.06] text-yellow-200",
      green: "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200",
      blue: "border-blue-400/20 bg-blue-400/[0.06] text-blue-200",
      cyan: "border-cyan-400/20 bg-cyan-400/[0.06] text-cyan-200",
      purple: "border-purple-400/20 bg-purple-400/[0.06] text-purple-200",
      violet: "border-violet-400/20 bg-violet-400/[0.06] text-violet-200",
      white: "border-white/20 bg-white/[0.04] text-white/85",
      gray: "border-slate-400/20 bg-slate-400/[0.06] text-slate-200",
    }

    return (
      <span key={value} className={cn(badgeBase, palette[colour.toLowerCase()] || palette.gray)}>
        {customTagLabel(slug)}
      </span>
    )
  }

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {visible.map((tag) => custom(tag) || (
        <span key={tag} className={cn(badgeBase, "border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] text-[var(--synnical-muted)]")}>
          {tag}
        </span>
      ))}
    </div>
  )
}

export function AvatarWithDeco({
  src, name, role, avatarDeco, size = "sm", className, avatarClassName,
}: {
  src?: string | null
  name: string
  role: Role
  avatarDeco?: string | null
  isGif?: boolean
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl"
  className?: string
  avatarClassName?: string
}) {
  const sizes = { xs: "h-7 w-7", sm: "h-9 w-9", md: "h-12 w-12", lg: "h-20 w-20", xl: "h-24 w-24", "2xl": "h-32 w-32" }
  return (
    <div className={cn("relative shrink-0 overflow-visible", sizes[size], className)}>
      {avatarDeco ? <AvatarDecorationBackdrop deco={avatarDeco} /> : null}
      <div className={cn("relative h-full w-full overflow-hidden rounded-full border p-[2px]", avatarRoleBorder[role], avatarClassName)}>
        {src ? <img src={src} alt="" className="h-full w-full rounded-full object-cover" /> : <div className="flex h-full w-full items-center justify-center rounded-full bg-[var(--synnical-surface-2)] text-xs">{name.slice(0, 1).toUpperCase()}</div>}
      </div>
      {avatarDeco ? <AvatarDecoration deco={avatarDeco} /> : null}
    </div>
  )
}

type ProfileEffectLayerProps = {
  effect?: string | null
  profileEffect?: string | null
  className?: string
  [legacyProp: string]: unknown
}
export function ProfileEffectLayer({ effect, profileEffect, className }: ProfileEffectLayerProps) {
  return <ProfileEffectVisualLayer effect={effect ?? profileEffect ?? null} className={className} />
}
