import type { MediaPlaybackRequest, MediaPlaybackSource } from "./media-provider-types"

export function playbackKey(request: MediaPlaybackRequest): string {
  return request.mediaType === "movie" ? `movie:${request.mediaId}` : `tv:${request.mediaId}:${request.season}:${request.episode}`
}
export function trustedPlaybackUrl(value: unknown, allowedOrigins: readonly string[]): string | null {
  if (typeof value !== "string" || value.length > 4000) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || url.hash || !allowedOrigins.includes(url.origin)) return null
    // Operator allowlisting is required, but do not allow private literal hosts.
    const host = url.hostname.toLowerCase()
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host)) return null
    return url.toString()
  } catch { return null }
}
export function normalizePlaybackSource(value: unknown, origins: readonly string[]): MediaPlaybackSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const url = trustedPlaybackUrl(row.url, origins)
  if (!url || !["file", "hls", "dash", "embed"].includes(String(row.kind)) || typeof row.providerId !== "string" || !/^[\w-]{1,64}$/.test(row.providerId)) return null
  const subtitles: NonNullable<MediaPlaybackSource["subtitles"]> = []
  if (Array.isArray(row.subtitles)) for (const raw of row.subtitles.slice(0, 20)) {
    if (!raw || typeof raw !== "object") continue
    const subUrl = trustedPlaybackUrl(raw.url, origins)
    if (subUrl && typeof raw.language === "string" && /^[a-z]{2,3}(?:-[A-Za-z0-9]+)?$/.test(raw.language) && typeof raw.label === "string") subtitles.push({ url: subUrl, language: raw.language, label: raw.label.slice(0, 80) })
  }
  return { providerId: row.providerId, kind: row.kind as MediaPlaybackSource["kind"], url, subtitles,
    ...(typeof row.duration === "number" && Number.isFinite(row.duration) && row.duration > 0 && row.duration <= 864000 ? { duration: row.duration } : {}) }
}
export function validProgress(value: unknown, duration: unknown): { currentTime: number; duration: number } | null {
  if (typeof value !== "number" || typeof duration !== "number" || !Number.isFinite(value) || !Number.isFinite(duration) || value < 0 || duration < 0 || duration > 864000 || value > 864000) return null
  // Unknown duration is permitted while a live/file player initializes.
  return { currentTime: duration > 0 ? Math.min(value, duration) : value, duration }
}
