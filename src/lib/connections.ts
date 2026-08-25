/**
 * Connections platform registry.
 *
 * Each entry maps a supported external platform to its brand metadata so the
 * settings panel, profile panel, and user-profile modal can all render the
 * same real platform icons.
 *
 * Icons are served from the Simple Icons CDN (https://cdn.simpleicons.org).
 * The CDN exposes two URL shapes:
 *
 *   https://cdn.simpleicons.org/<slug>            -> icon filled with the
 *                                                    brand's official color
 *   https://cdn.simpleicons.org/<slug>/<hex>      -> icon filled with the
 *                                                    given hex color
 *
 * Several brands ship a black / near-black official color (Steam, GitHub,
 * Epic Games, Roblox, TikTok, X) which would be invisible on Synnical's dark
 * UI. For those we render the icon glyph in white (ffffff) instead, while the
 * `color` field keeps the true brand color so callers can still use it as an
 * accent (e.g. a tinted chip behind the icon).
 *
 * Xbox is no longer part of Simple Icons (removed after v3), so its icon is
 * pulled from the pinned v3 release of the same library on jsDelivr, which
 * still hosts the original Xbox glyph.
 */

export type Platform = {
  /** Stable identifier persisted in localStorage, e.g. "steam". */
  id: string
  /** Human-readable name shown in the dropdown and on profile cards. */
  name: string
  /** Official brand color (hex, no leading #). Used as an accent. */
  color: string
  /**
   * Icon URL. Points at the Simple Icons CDN with an explicit fill color so
   * dark-colored brands stay visible on dark backgrounds.
   */
  iconUrl: string
}

const SI = "https://cdn.simpleicons.org"
const SI_V3 = "https://cdn.jsdelivr.net/npm/simple-icons@v3/icons"

/**
 * Build a Simple Icons CDN URL that forces the glyph to render in `fill`.
 * `fill` should be a 6-digit hex string without a leading `#`.
 */
function icon(slug: string, fill: string): string {
  return `${SI}/${slug}/${fill}`
}

export const PLATFORMS: Platform[] = [
  { id: "steam",       name: "Steam",        color: "000000", iconUrl: icon("steam", "ffffff") },
  { id: "github",      name: "GitHub",       color: "181717", iconUrl: icon("github", "ffffff") },
  { id: "epicgames",   name: "Epic Games",   color: "313131", iconUrl: icon("epicgames", "ffffff") },
  { id: "discord",     name: "Discord",      color: "5865F2", iconUrl: icon("discord", "5865F2") },
  { id: "xbox",        name: "Xbox",         color: "107C10", iconUrl: `${SI_V3}/xbox.svg` },
  { id: "playstation", name: "PlayStation",  color: "0070D1", iconUrl: icon("playstation", "0070D1") },
  { id: "roblox",      name: "Roblox",       color: "000000", iconUrl: icon("roblox", "ffffff") },
  { id: "twitch",      name: "Twitch",       color: "9146FF", iconUrl: icon("twitch", "9146FF") },
  { id: "youtube",     name: "YouTube",      color: "FF0000", iconUrl: icon("youtube", "FF0000") },
  { id: "tiktok",      name: "TikTok",        color: "000000", iconUrl: icon("tiktok", "ffffff") },
  { id: "instagram",  name: "Instagram",    color: "FF0069", iconUrl: icon("instagram", "FF0069") },
  { id: "x",           name: "X",            color: "000000", iconUrl: icon("x", "ffffff") },
  { id: "reddit",      name: "Reddit",       color: "FF4500", iconUrl: icon("reddit", "FF4500") },
  { id: "spotify",     name: "Spotify",      color: "1ED760", iconUrl: icon("spotify", "1ED760") },
  { id: "battledotnet",name: "Battle.net",   color: "4381C3", iconUrl: icon("battledotnet", "4381C3") },
  { id: "riotgames",   name: "Riot Games",   color: "EB0029", iconUrl: icon("riotgames", "EB0029") },
  { id: "kick",        name: "Kick",          color: "53FC19", iconUrl: icon("kick", "53FC19") },
  { id: "mastodon",    name: "Mastodon",     color: "6364FF", iconUrl: icon("mastodon", "6364FF") },
]

/** Quick id -> platform lookup. */
export const PLATFORM_MAP: Record<string, Platform> = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, p]),
)

/** Find a platform by id, falling back to undefined. */
export function getPlatform(id: string): Platform | undefined {
  return PLATFORM_MAP[id]
}

/* ------------------------------------------------------------------ */
/* Account-scoped persistence                                          */
/* ------------------------------------------------------------------ */

// Legacy browser-wide key retained only for an explicit one-time ownership migration in Settings.
export const CONNECTIONS_STORAGE_KEY = "synnical:connections"

export type Connection = {
  id: string
  /** Platform id from PLATFORMS (e.g. "steam"). */
  platform: string
  /** The user's handle / username on that platform. */
  username: string
  /** Optional profile URL. */
  url?: string
}

export function normalizeConnections(value: unknown): Connection[] {
  if (!Array.isArray(value)) return []
  const output: Connection[] = []
  const seen = new Set<string>()
  for (const raw of value.slice(0, 30)) {
    if (!raw || typeof raw !== "object") continue
    const row = raw as Partial<Connection>
    const platform = typeof row.platform === "string" ? row.platform.trim().toLowerCase() : ""
    const username = typeof row.username === "string" ? row.username.trim().slice(0, 64) : ""
    if (!platform || !username || !getPlatform(platform)) continue
    let id = typeof row.id === "string" ? row.id.trim().slice(0, 100) : ""
    if (!id || seen.has(id)) id = `${platform}:${username}:${output.length}`
    seen.add(id)
    let url: string | undefined
    if (typeof row.url === "string" && row.url.trim()) {
      try {
        const parsed = new URL(row.url.trim())
        if (parsed.protocol === "https:" || parsed.protocol === "http:") url = parsed.toString().slice(0, 300)
      } catch {}
    }
    output.push({ id, platform, username, ...(url ? { url } : {}) })
  }
  return output
}

export function parseStoredConnections(raw: unknown): Connection[] {
  if (typeof raw !== "string" || !raw.trim()) return []
  try { return normalizeConnections(JSON.parse(raw)) } catch { return [] }
}

/** Read legacy browser-only data without displaying or assigning it automatically. */
export function loadLegacyConnections(): Connection[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(CONNECTIONS_STORAGE_KEY)
    return raw ? normalizeConnections(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function clearLegacyConnections(): void {
  if (typeof window === "undefined") return
  try { window.localStorage.removeItem(CONNECTIONS_STORAGE_KEY) } catch {}
}

/** Load only the authenticated account's connections from Synnical. */
export async function loadConnections(): Promise<Connection[]> {
  if (typeof window === "undefined") return []
  const response = await fetch("/api/profile/connections", { credentials: "include", cache: "no-store" })
  const body = await response.json().catch(() => ({})) as { connections?: unknown; error?: unknown }
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not load connections")
  return normalizeConnections(body.connections)
}

/** Save only the authenticated account's connections to Synnical. */
export async function saveConnections(connections: Connection[]): Promise<Connection[]> {
  if (typeof window === "undefined") return []
  const response = await fetch("/api/profile/connections", {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ connections: normalizeConnections(connections) }),
  })
  const body = await response.json().catch(() => ({})) as { connections?: unknown; error?: unknown }
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not save connections")
  return normalizeConnections(body.connections)
}
