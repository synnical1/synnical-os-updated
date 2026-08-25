"use client"
import type { ReactNode } from "react"
import type { Role } from "@/lib/api"
import { BadgeCheck, Crown, Sparkles, Shield, Tag, Code2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { AvatarDecoration, AvatarDecorationBackdrop } from "@/components/avatar-decorations"
import { ProfileEffectLayer as ProfileEffectVisualLayer } from "@/components/profile-effects"
import { BIG_SITE_OWNER_TAG, DEV_TAG, NOTABLE_PERSON_TAG, ordinaryTags, recognitionTags } from "@/lib/recognition-tags"

const style: Record<Role, string> = {
  OWNER: "border-amber-300/70 bg-amber-400/15 text-amber-200 shadow-[0_0_14px_rgba(251,191,36,.6)]",
  HEAD_ADMIN: "border-orange-300/75 bg-orange-500/10 text-white shadow-[0_0_15px_rgba(249,115,22,.8),0_0_7px_rgba(255,255,255,.45)]",
  ADMIN: "border-red-500/70 bg-black text-red-300 shadow-[0_0_14px_rgba(239,68,68,.65)]",
  MOD: "border-blue-300/70 bg-blue-500/10 text-white shadow-[0_0_14px_rgba(96,165,250,.65)]",
  MEMBER: "border-[#2a2a2a] bg-[#0d0d0d] text-[#cfcfcf]",
}

const roleMeta: Record<Exclude<Role, "MEMBER">, { label: string; icon: typeof Crown; className: string }> = {
  OWNER: { label: "OWNER", icon: Crown, className: "text-amber-100" },
  HEAD_ADMIN: { label: "HEAD ADMIN", icon: Crown, className: "text-orange-100" },
  ADMIN: { label: "ADMIN", icon: Shield, className: "text-red-200" },
  MOD: { label: "MOD", icon: BadgeCheck, className: "text-blue-100" },
}

const recognitionMeta: Record<typeof NOTABLE_PERSON_TAG | typeof BIG_SITE_OWNER_TAG | typeof DEV_TAG, { label: string; icon: typeof Sparkles; className: string }> = {
  [NOTABLE_PERSON_TAG]: { label: "NOTABLE PERSON", icon: Sparkles, className: "border-fuchsia-300/70 bg-fuchsia-400/12 text-fuchsia-100 shadow-[0_0_12px_rgba(217,70,239,.45)]" },
  [BIG_SITE_OWNER_TAG]: { label: "BIG SITE OWNER", icon: Crown, className: "border-cyan-300/70 bg-cyan-400/12 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,.45)]" },
  [DEV_TAG]: { label: "DEV", icon: Code2, className: "border-emerald-300/70 bg-emerald-400/12 text-emerald-100 shadow-[0_0_12px_rgba(52,211,153,.45)]" },
}

export function RoleBadge({ role, tags, className }: { role: Role; tags?: string[] | null; className?: string }) {
  const recognition = recognitionTags(tags)
  if (role === "MEMBER" && recognition.length === 0) return null
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {role !== "MEMBER" ? (() => {
        const meta = roleMeta[role as Exclude<Role, "MEMBER">]
        const Icon = meta.icon
        return (
          <span className={cn("inline-flex items-center gap-1 rounded border px-1 py-px text-[8px] font-bold leading-3 tracking-wide", style[role])}>
            <Icon className={cn("h-2.5 w-2.5 shrink-0", meta.className)} />
            <span>{meta.label}</span>
          </span>
        )
      })() : null}
      {recognition.map((tag) => {
        const meta = recognitionMeta[tag]
        const Icon = meta.icon
        return (
          <span key={tag} className={cn("inline-flex items-center gap-1 rounded border px-1 py-px text-[8px] font-bold leading-3 tracking-wide", meta.className)}>
            <Icon className="h-2.5 w-2.5 shrink-0" />
            <span>{meta.label}</span>
          </span>
        )
      })}
    </span>
  )
}

export function DisplayName({ name, role, className }: { name: ReactNode; role: Role; className?: string }) {
  return <span className={cn(role !== "MEMBER" && "font-semibold", role === "OWNER" && "text-amber-200 drop-shadow-[0_0_7px_rgba(251,191,36,.8)]", role === "HEAD_ADMIN" && "text-orange-100 drop-shadow-[0_0_8px_rgba(249,115,22,.95)]", role === "ADMIN" && "text-red-300 drop-shadow-[0_0_7px_rgba(239,68,68,.85)]", role === "MOD" && "text-blue-100 drop-shadow-[0_0_7px_rgba(96,165,250,.9)]", className)}>{name}</span>
}

export function TagsDisplay({ tags, className }: { tags: string[]; className?: string }) {
  const visible = ordinaryTags(tags)
  if (!visible.length) return null
  return <div className={cn("flex flex-wrap gap-1", className)}>{visible.map((t) => <span key={t} className="inline-flex items-center gap-1 rounded border border-[#242424] bg-[#0d0d0d] px-1 py-px text-[8px] leading-3 text-[#a7a7a7]"><Tag className="h-2.5 w-2.5 shrink-0 text-[#707070]" />{t}</span>)}</div>
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
      <div className={cn("relative h-full w-full overflow-hidden rounded-full border p-[2px]", style[role], avatarClassName)}>
        {src ? <img src={src} alt="" className="h-full w-full rounded-full object-cover" /> : <div className="flex h-full w-full items-center justify-center rounded-full bg-[#101010] text-xs">{name.slice(0, 1).toUpperCase()}</div>}
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
