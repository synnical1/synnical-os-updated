export const PRESENCE_MODES = [
  "online",
  "available_to_play",
  "looking_to_talk",
  "do_not_invite",
  "free_15",
  "busy",
] as const

export type PresenceMode = typeof PRESENCE_MODES[number]

export type PresenceConfig = {
  mode: PresenceMode
  modeExpiresAt: string | null
  afkMessage: string
  shareSection: boolean
  shareDevice: boolean
  showOnlineDuration: boolean
  shareNetworkQuality: boolean
}

export type PublicPresence = {
  presenceMode?: PresenceMode
  presenceModeExpiresAt?: string | null
  afk?: boolean
  afkMessage?: string
  currentSection?: string | null
  deviceType?: "desktop" | "mobile" | "tablet" | "unknown" | null
  networkQuality?: "good" | "fair" | "poor" | "unknown" | null
  onlineSince?: string | null
  activity?: RichPresenceActivity | null
}

export type RichPresenceActivity = {
  kind: "listening" | "watching" | "playing" | "browsing" | "custom"
  name: string
  details?: string | null
  state?: string | null
  artwork?: string | null
  startedAt?: string | null
}

export function normalizeRichPresenceActivity(value: unknown): RichPresenceActivity | null {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : null
  if (!raw) return null
  const kind = typeof raw.kind === "string" && ["listening", "watching", "playing", "browsing", "custom"].includes(raw.kind)
    ? raw.kind as RichPresenceActivity["kind"]
    : "custom"
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 120) : ""
  if (!name) return null
  const date = typeof raw.startedAt === "string" ? new Date(raw.startedAt) : null
  return {
    kind,
    name,
    details: typeof raw.details === "string" ? raw.details.trim().slice(0, 160) || null : null,
    state: typeof raw.state === "string" ? raw.state.trim().slice(0, 160) || null : null,
    artwork: typeof raw.artwork === "string" ? raw.artwork.trim().slice(0, 1000) || null : null,
    startedAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null,
  }
}

export const DEFAULT_PRESENCE_CONFIG: PresenceConfig = {
  mode: "online",
  modeExpiresAt: null,
  afkMessage: "Away",
  shareSection: false,
  shareDevice: false,
  showOnlineDuration: false,
  shareNetworkQuality: false,
}

export const PRESENCE_LABELS: Record<PresenceMode, string> = {
  online: "Online",
  available_to_play: "Available to play",
  looking_to_talk: "Looking to talk",
  do_not_invite: "Do not invite to games",
  free_15: "Free for 15 minutes",
  busy: "Busy",
}

export function presenceMode(value: unknown): PresenceMode {
  return typeof value === "string" && (PRESENCE_MODES as readonly string[]).includes(value)
    ? value as PresenceMode
    : "online"
}

export function normalizePresenceConfig(value: unknown): PresenceConfig {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const expires = typeof raw.modeExpiresAt === "string" ? new Date(raw.modeExpiresAt) : null
  const now = Date.now()
  const validExpiry = expires && Number.isFinite(expires.getTime()) && expires.getTime() > now && expires.getTime() <= now + 31 * 86400000
    ? expires.toISOString()
    : null
  let mode = presenceMode(raw.mode)
  if (raw.modeExpiresAt && !validExpiry) mode = "online"
  return {
    mode,
    modeExpiresAt: validExpiry,
    afkMessage: typeof raw.afkMessage === "string" ? raw.afkMessage.trim().slice(0, 80) || "Away" : "Away",
    shareSection: raw.shareSection === true,
    shareDevice: raw.shareDevice === true,
    showOnlineDuration: raw.showOnlineDuration === true,
    shareNetworkQuality: raw.shareNetworkQuality === true,
  }
}

export function publicPresenceLabel(mode: unknown, afk = false, expiresAt?: unknown): string {
  if (afk) return "Away"
  const normalized = presenceMode(mode)
  const base = PRESENCE_LABELS[normalized]
  if (typeof expiresAt !== "string" || normalized === "online") return base
  const expiry = new Date(expiresAt)
  if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) return base
  const until = expiry.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  if (normalized === "busy") return `Busy until ${until}`
  if (normalized === "free_15") return `Free until ${until}`
  return `${base} until ${until}`
}

export const PRESENCE_SECTION_LABELS: Record<string, string> = {
  discover: "Discover",
  chat: "Chat",
  friends: "Friends",
  spaces: "Spaces",
  moderation: "Moderation",
  "temp-mail": "Temp Mail",
  browser: "Browser",
  music: "Music",
  ai: "Synnical AI",
  games: "Games",
  shop: "Shop",
  market: "Marketplace",
  drive: "Synn Drive",
  automations: "Automations",
  creator: "Creator Studio",
  calls: "Calls",
  developer: "Developer",
  profile: "Profile",
  settings: "Settings",
  movies: "SynnFlix",
  synnime: "Synnime",
  "linux-vm": "Synn VM",
  auth: "Account",
}

export function presenceSection(value: unknown): string | null {
  if (typeof value !== "string") return null
  return Object.prototype.hasOwnProperty.call(PRESENCE_SECTION_LABELS, value) ? value : null
}

export function presenceSectionLabel(value: unknown): string | null {
  const section = presenceSection(value)
  return section ? PRESENCE_SECTION_LABELS[section] : null
}

export function onlineDurationLabel(value: unknown, now = Date.now()): string | null {
  if (typeof value !== "string") return null
  const started = new Date(value).getTime()
  if (!Number.isFinite(started) || started > now) return null
  const minutes = Math.max(0, Math.floor((now - started) / 60000))
  if (minutes < 1) return "Online just now"
  if (minutes < 60) return `Online for ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Online for ${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `Online for ${days}d ${hours % 24}h`
}
