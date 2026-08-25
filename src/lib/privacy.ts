import { db } from "@/lib/db"
import { getPreference, setPreference } from "@/lib/feature-platform"

export type PrivacyAudience = "everyone" | "friends" | "close_friends" | "nobody"
export type PrivacyConfig = {
  preset: "everyone" | "friends" | "close_friends" | "private"
  profile: PrivacyAudience
  presence: PrivacyAudience
  activity: PrivacyAudience
  connections: PrivacyAudience
  birthday: PrivacyAudience
  pronouns: PrivacyAudience
  game: PrivacyAudience
  music: PrivacyAudience
  stats: PrivacyAudience
}

export type PrivacyView = {
  isSelf: boolean
  areFriends: boolean
  closeFriend: boolean
  profile: boolean
  presence: boolean
  activity: boolean
  connections: boolean
  birthday: boolean
  pronouns: boolean
  game: boolean
  music: boolean
  stats: boolean
}

export const PRIVACY_KEY = "privacy.config.v1"

const privacyCache = new Map<string, { expiresAt: number; value: PrivacyView }>()
const PRIVACY_CACHE_MS = 15_000

export function invalidatePrivacyCache(userId: string) {
  for (const key of privacyCache.keys()) if (key.startsWith(`${userId}:`)) privacyCache.delete(key)
}

export const PRIVACY_PRESETS: Record<PrivacyConfig["preset"], Omit<PrivacyConfig, "preset">> = {
  everyone: {
    profile: "everyone", presence: "everyone", activity: "everyone", connections: "everyone",
    birthday: "everyone", pronouns: "everyone", game: "everyone", music: "everyone", stats: "everyone",
  },
  friends: {
    profile: "everyone", presence: "everyone", activity: "friends", connections: "friends",
    birthday: "friends", pronouns: "friends", game: "friends", music: "friends", stats: "friends",
  },
  close_friends: {
    profile: "everyone", presence: "everyone", activity: "close_friends", connections: "close_friends",
    birthday: "close_friends", pronouns: "close_friends", game: "close_friends", music: "close_friends", stats: "close_friends",
  },
  private: {
    profile: "nobody", presence: "everyone", activity: "nobody", connections: "nobody",
    birthday: "nobody", pronouns: "nobody", game: "nobody", music: "nobody", stats: "nobody",
  },
}

const AUDIENCES = new Set<PrivacyAudience>(["everyone", "friends", "close_friends", "nobody"])
const PRESETS = new Set<PrivacyConfig["preset"]>(["everyone", "friends", "close_friends", "private"])

export function sanitizePrivacyConfig(input: unknown): PrivacyConfig {
  const raw = input && typeof input === "object" ? input as Partial<PrivacyConfig> : {}
  const preset = PRESETS.has(raw.preset as PrivacyConfig["preset"]) ? raw.preset as PrivacyConfig["preset"] : "friends"
  const base = PRIVACY_PRESETS[preset]
  const out: PrivacyConfig = { preset, ...base }
  for (const key of ["profile", "activity", "connections", "birthday", "pronouns", "game", "music", "stats"] as const) {
    if (AUDIENCES.has(raw[key] as PrivacyAudience)) out[key] = raw[key] as PrivacyAudience
  }
  // Presence itself is factual: if an authenticated Synnical session is
  // online, the account appears in online lists. Users can still hide rich
  // activity details, games, music and other optional context.
  out.presence = "everyone"
  return out
}

export async function getPrivacyConfig(userId: string): Promise<PrivacyConfig> {
  return sanitizePrivacyConfig(await getPreference(userId, PRIVACY_KEY, { preset: "friends" }))
}

export async function savePrivacyConfig(userId: string, input: unknown): Promise<PrivacyConfig> {
  const config = sanitizePrivacyConfig(input)
  await setPreference(userId, PRIVACY_KEY, config)
  invalidatePrivacyCache(userId)
  return config
}

function allowed(audience: PrivacyAudience, isSelf: boolean, areFriends: boolean, closeFriend: boolean) {
  if (isSelf) return true
  if (audience === "everyone") return true
  if (audience === "friends") return areFriends
  if (audience === "close_friends") return closeFriend
  return false
}

export async function privacyViewFor(ownerId: string, viewerId: string): Promise<PrivacyView> {
  if (ownerId === viewerId) {
    return { isSelf: true, areFriends: true, closeFriend: true, profile: true, presence: true, activity: true, connections: true, birthday: true, pronouns: true, game: true, music: true, stats: true }
  }
  const cacheKey = `${ownerId}:${viewerId}`
  const cached = privacyCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const [friendship, closeMeta, config, rule] = await Promise.all([
    db.friendship.findFirst({ where: { status: "ACCEPTED", OR: [{ requesterId: ownerId, receiverId: viewerId }, { requesterId: viewerId, receiverId: ownerId }] }, select: { id: true } }),
    db.friendMeta.findUnique({ where: { userId_friendId: { userId: ownerId, friendId: viewerId } }, select: { closeFriend: true } }),
    getPrivacyConfig(ownerId),
    db.privacyRule.findUnique({ where: { userId_viewerId: { userId: ownerId, viewerId } } }),
  ])
  const areFriends = Boolean(friendship)
  const closeFriend = areFriends && Boolean(closeMeta?.closeFriend)
  const base = {
    profile: allowed(config.profile, false, areFriends, closeFriend),
    presence: true,
    activity: allowed(config.activity, false, areFriends, closeFriend),
    connections: allowed(config.connections, false, areFriends, closeFriend),
    birthday: allowed(config.birthday, false, areFriends, closeFriend),
    pronouns: allowed(config.pronouns, false, areFriends, closeFriend),
    game: allowed(config.game, false, areFriends, closeFriend),
    music: allowed(config.music, false, areFriends, closeFriend),
    stats: allowed(config.stats, false, areFriends, closeFriend),
  }
  if (rule) {
    const overrides: Record<keyof typeof base, boolean | null> = {
      profile: rule.shareProfile,
      presence: null,
      activity: rule.shareActivity,
      connections: rule.shareConnections,
      birthday: rule.shareBirthday,
      pronouns: rule.sharePronouns,
      game: rule.shareGame,
      music: rule.shareMusic,
      stats: rule.shareStats,
    }
    for (const key of Object.keys(base) as (keyof typeof base)[]) {
      const value = overrides[key]
      if (typeof value === "boolean") base[key] = value
    }
  }
  const value = { isSelf: false, areFriends, closeFriend, ...base }
  privacyCache.set(cacheKey, { expiresAt: Date.now() + PRIVACY_CACHE_MS, value })
  if (privacyCache.size > 10_000) {
    const now = Date.now()
    for (const [key, entry] of privacyCache) if (entry.expiresAt <= now) privacyCache.delete(key)
  }
  return value
}

export function privacyRulePatch(input: Record<string, unknown>) {
  const data: Record<string, boolean | null | string> = {}
  const preset = typeof input.preset === "string" ? input.preset : "custom"
  data.preset = ["allow_all", "standard", "limited", "hidden", "custom"].includes(preset) ? preset : "custom"
  const presetValues: Record<string, boolean | null> | null = data.preset === "allow_all" ? Object.fromEntries(["Profile","Activity","Connections","Birthday","Pronouns","Game","Music","Stats"].map(k => [`share${k}`, true]))
    : data.preset === "hidden" ? Object.fromEntries(["Profile","Activity","Connections","Birthday","Pronouns","Game","Music","Stats"].map(k => [`share${k}`, false]))
    : data.preset === "standard" ? { shareProfile: true, sharePresence: true, shareActivity: true, shareConnections: true, shareBirthday: true, sharePronouns: true, shareGame: true, shareMusic: true, shareStats: true }
    : data.preset === "limited" ? { shareProfile: true, sharePresence: true, shareActivity: false, shareConnections: false, shareBirthday: false, sharePronouns: false, shareGame: false, shareMusic: false, shareStats: false }
    : null
  if (presetValues) Object.assign(data, presetValues)
  data.sharePresence = true
  for (const key of ["shareProfile", "shareActivity", "shareConnections", "shareBirthday", "sharePronouns", "shareGame", "shareMusic", "shareStats"]) {
    if (input[key] === null || typeof input[key] === "boolean") data[key] = input[key] as boolean | null
  }
  return data
}
