export const PUBLIC_CHANNEL_ROLES = ["OWNER", "HEAD_ADMIN", "ADMIN", "MOD", "MEMBER"] as const
export const STAFF_CHANNEL_ROLES = ["OWNER", "HEAD_ADMIN", "ADMIN", "MOD"] as const

export type PublicChannelRole = typeof PUBLIC_CHANNEL_ROLES[number]
export type ChannelAudience = "MEMBERS" | "STAFF"

const PUBLIC_CHANNEL_ROLE_SET = new Set<string>(PUBLIC_CHANNEL_ROLES)
const STAFF_CHANNEL_ROLE_SET = new Set<string>(STAFF_CHANNEL_ROLES)
const CHANNEL_MANAGER_ROLES = new Set<string>(["OWNER", "HEAD_ADMIN", "ADMIN"])

export function canManageChannels(role: string): boolean {
  return CHANNEL_MANAGER_ROLES.has(role)
}

export function isStaffChannelRole(role: string): boolean {
  return STAFF_CHANNEL_ROLE_SET.has(role)
}

export function normalizeChannelAudience(value: unknown): ChannelAudience | null {
  return value === "MEMBERS" || value === "STAFF" ? value : null
}

export function channelRolesForAudience(audience: ChannelAudience): PublicChannelRole[] {
  return audience === "STAFF" ? [...STAFF_CHANNEL_ROLES] : [...PUBLIC_CHANNEL_ROLES]
}

export function normalizeChannelRoles(value: unknown): PublicChannelRole[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((role): role is PublicChannelRole => typeof role === "string" && PUBLIC_CHANNEL_ROLE_SET.has(role)))]
}

export function parseChannelRoles(value: string | null | undefined): PublicChannelRole[] {
  // Legacy channels created before role visibility existed are public. Once a
  // value is present, malformed or empty permission data must FAIL CLOSED
  // instead of silently exposing a restricted channel to MEMBER accounts.
  if (value == null || value.trim() === "") return [...PUBLIC_CHANNEL_ROLES]
  try {
    return normalizeChannelRoles(JSON.parse(value))
  } catch {
    return []
  }
}

export function channelAudienceFromRoleList(value: readonly string[] | null | undefined): ChannelAudience {
  const roles = value == null ? PUBLIC_CHANNEL_ROLES : value
  return roles.includes("MEMBER") ? "MEMBERS" : "STAFF"
}

export function channelAudienceFromStoredRoles(value: string | null | undefined): ChannelAudience {
  return channelAudienceFromRoleList(parseChannelRoles(value))
}

export function canAccessPublicChannel(allowedRoles: string | null | undefined, role: string): boolean {
  // Owner-level staff always retain access so a restricted channel cannot
  // become unmanageable if old data contains a narrower role set.
  if (role === "OWNER" || role === "HEAD_ADMIN") return true
  return parseChannelRoles(allowedRoles).includes(role as PublicChannelRole)
}
