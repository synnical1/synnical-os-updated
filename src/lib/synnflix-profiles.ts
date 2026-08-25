export const SYNNFLIX_PROFILE_LIMIT = 12

export type SynnFlixProfile = {
  id: string
  name: string
  avatarKey: string
  avatarUrl: string | null
  isKids: boolean
  createdAt?: string
  updatedAt?: string
}

export const SYNNFLIX_AVATAR_SPRITE = "/synnflix/profile-atlas-v1.webp"

// Keep avatar-001…avatar-100 stable so existing profiles retain their choice.
// The artwork is a 10 × 10 production sprite: one distinct cinematic portrait
// per tile, loaded in a single lightweight request.
export const SYNNFLIX_AVATARS = Array.from({ length: 100 }, (_, index) => ({
  id: `avatar-${String(index + 1).padStart(3, "0")}`,
  column: index % 10,
  row: Math.floor(index / 10),
}))

export function validSynnFlixAvatarKey(value: unknown): string {
  const key = typeof value === "string" ? value : ""
  return SYNNFLIX_AVATARS.some((avatar) => avatar.id === key) ? key : SYNNFLIX_AVATARS[0].id
}

export function synnFlixAvatar(key: string) {
  return SYNNFLIX_AVATARS.find((avatar) => avatar.id === key) || SYNNFLIX_AVATARS[0]
}
