"use client"

import { type JSX } from "react"
import { avatarDecorationById, AVATAR_DECORATIONS } from "@/lib/avatar-decoration-catalog"
import { cn } from "@/lib/utils"

export const DECORATION_IDS = ["none", ...AVATAR_DECORATIONS.map((item) => item.id)]

export function AvatarDecoration({ deco, className }: { deco: string; className?: string }): JSX.Element | null {
  const item = avatarDecorationById(deco)
  if (!item) return null
  return (
    <span aria-hidden="true" className={cn("pointer-events-none absolute -inset-[18%] z-20 block", className)}>
      <img
        src={item.mediaUrl}
        alt=""
        draggable={false}
        referrerPolicy="no-referrer"
        className="h-full w-full select-none object-contain"
      />
    </span>
  )
}

export function AvatarDecorationBackdrop(_props: { deco: string; className?: string }): JSX.Element | null {
  return null
}
