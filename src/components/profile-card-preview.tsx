"use client"

import type { ReactNode } from "react"
import type { SafeUser } from "@/lib/api"
import { AvatarWithDeco, DisplayName, RoleBadge, TagsDisplay } from "@/components/role-ui"
import { ProfileEffectLayer, useProfileEffectGeometry } from "@/components/profile-effects"
import { profileThemeBackground, profileThemeTextColor, type ProfileThemeStyle } from "@/lib/profile-theme"
import { cn } from "@/lib/utils"

export type ProfileCardScale = "profile" | "showcase"

export function ProfileCardFrame({
  user,
  profileEffect = user.profileEffect,
  themePrimary = user.profileThemePrimary,
  themeAccent = user.profileThemeAccent,
  themeStyle = user.profileThemeStyle,
  children,
  className,
  scale = "profile",
}: {
  user: SafeUser
  profileEffect?: string | null
  themePrimary?: string
  themeAccent?: string
  themeStyle?: ProfileThemeStyle
  children: ReactNode
  className?: string
  scale?: ProfileCardScale
}) {
  const textColor = profileThemeTextColor(themePrimary, themeAccent)
  const geometry = useProfileEffectGeometry(profileEffect)
  const nativeWidth = geometry.intrinsic ? geometry.width : 340
  const renderedWidth = scale === "showcase" ? Math.min(nativeWidth, 700) : Math.min(nativeWidth, 340)

  return (
    <div
      data-profile-effect-native={geometry.intrinsic ? `${geometry.width}x${geometry.height}` : "fallback"}
      className={cn(
        "relative isolate overflow-hidden rounded-[22px] border border-white/15 shadow-2xl",
        scale === "showcase" ? "max-w-[calc(100vw-420px)] max-lg:max-w-[calc(100vw-40px)]" : "max-w-[calc(100vw-32px)]",
        className,
      )}
      style={{
        width: `${renderedWidth}px`,
        aspectRatio: `${geometry.width} / ${geometry.height}`,
        background: profileThemeBackground(themePrimary, themeAccent, themeStyle),
        color: textColor,
      }}
    >
      <div className="relative z-10 h-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</div>
      <ProfileEffectLayer effect={profileEffect} />
    </div>
  )
}

export function ProfileCardPreview({
  user,
  avatarDeco = user.avatarDeco,
  profileEffect = user.profileEffect,
  themePrimary = user.profileThemePrimary,
  themeAccent = user.profileThemeAccent,
  themeStyle = user.profileThemeStyle,
  scale = "profile",
}: {
  user: SafeUser
  avatarDeco?: string | null
  profileEffect?: string | null
  themePrimary?: string
  themeAccent?: string
  themeStyle?: ProfileThemeStyle
  scale?: ProfileCardScale
}) {
  const textColor = profileThemeTextColor(themePrimary, themeAccent)
  const muted = textColor === "#111111" ? "rgba(17,17,17,.68)" : "rgba(255,255,255,.72)"
  const surface = textColor === "#111111" ? "rgba(255,255,255,.44)" : "rgba(0,0,0,.28)"
  return (
    <ProfileCardFrame user={user} profileEffect={profileEffect} themePrimary={themePrimary} themeAccent={themeAccent} themeStyle={themeStyle} scale={scale}>
      <div className="relative h-[27%] min-h-[92px] max-h-[170px] overflow-hidden bg-black/20">
        {user.bannerUrl ? <img src={user.bannerUrl} alt="" className="h-full w-full object-cover" /> : null}
      </div>
      <div className="relative px-[4.7%] pb-5">
        <div className="-mt-11 mb-2 w-fit">
          <AvatarWithDeco src={user.pfpUrl} name={user.displayName} role={user.role} avatarDeco={avatarDeco} isGif={user.pfpIsGif} size="xl" avatarClassName="border-4 border-black/35" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DisplayName name={user.displayName} role={user.role} className="text-lg font-bold" />
          <RoleBadge role={user.role} tags={user.tags} />
        </div>
        <p className="text-sm" style={{ color: muted }}>@{user.username}</p>
        {user.tags?.length ? <TagsDisplay tags={user.tags} className="mt-2" /> : null}
        {user.status ? <div className="mt-3 rounded-lg px-3 py-2 text-sm" style={{ background: surface }}>{user.status}</div> : null}
        {user.bio ? <div className="mt-3"><p className="mb-1 text-[10px] font-bold uppercase tracking-[.12em]" style={{ color: muted }}>About me</p><p className="whitespace-pre-wrap text-sm leading-5">{user.bio}</p></div> : null}
      </div>
    </ProfileCardFrame>
  )
}
