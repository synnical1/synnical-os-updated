import type { Role } from "@/lib/constants"

export type SafeUser = {
  id: string
  username: string
  displayName: string
  bio: string
  status: string
  statusExpiresAt?: string | null
  pfpUrl: string | null
  bannerUrl: string | null
  pfpIsGif: boolean
  bannerIsGif: boolean
  avatarDeco: string | null
  profileEffect: string | null
  profileThemePrimary: string
  profileThemeAccent: string
  profileThemeStyle: "solid" | "gradient"
  role: Role
  tags: string[]
  muted: boolean
  mutedUntil: string | null
  banned?: boolean
  coins?: number
  securitySetupRequired: boolean
}

export function toSafeUser(u: {
  id: string
  username: string
  displayName: string
  bio: string
  status: string
  statusExpiresAt?: Date | null
  pfpUrl: string | null
  bannerUrl: string | null
  pfpIsGif: boolean
  bannerIsGif: boolean
  avatarDeco: string | null
  profileEffect: string | null
  profileThemePrimary: string
  profileThemeAccent: string
  profileThemeStyle: string
  role: string
  tags?: string
  muted: boolean
  mutedUntil: Date | null
  coins?: number
  securitySetupCompletedAt?: Date | null
}): SafeUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    bio: u.bio,
    status: u.statusExpiresAt && u.statusExpiresAt.getTime() <= Date.now() ? "" : u.status,
    statusExpiresAt: u.statusExpiresAt && u.statusExpiresAt.getTime() > Date.now() ? u.statusExpiresAt.toISOString() : null,
    pfpUrl: u.pfpUrl,
    bannerUrl: u.bannerUrl,
    pfpIsGif: u.pfpIsGif,
    bannerIsGif: u.bannerIsGif,
    avatarDeco: u.avatarDeco,
    profileEffect: u.profileEffect,
    profileThemePrimary: u.profileThemePrimary || "#111111",
    profileThemeAccent: u.profileThemeAccent || "#2b2b2b",
    profileThemeStyle: u.profileThemeStyle === "gradient" ? "gradient" : "solid",
    role: u.role as Role,
    tags: (() => { try { return JSON.parse(u.tags || '[]') } catch { return [] } })(),
    muted: u.muted,
    mutedUntil: u.mutedUntil ? u.mutedUntil.toISOString() : null,
    coins: u.coins ?? 0,
    securitySetupRequired: !u.securitySetupCompletedAt,
  }
}

// ---------- permission helpers ----------
export function isOwner(role: string) { return role === "OWNER" }
export function isOwnerLevel(role: string) { return role === "OWNER" || role === "HEAD_ADMIN" }
export function isAdmin(role: string) { return isOwnerLevel(role) || role === "ADMIN" }
export function isMod(role: string) { return isAdmin(role) || role === "MOD" }
export function canModerate(role: string) { return isMod(role) }
export function canDeleteAnyMessage(role: string) { return isOwnerLevel(role) }
export function canUseGifAndDeco(role: string) { return isMod(role) }
export function canManageRoles(role: string) { return isAdmin(role) }
export function canManageTags(role: string) { return isMod(role) }
