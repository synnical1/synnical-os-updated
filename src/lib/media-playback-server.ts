import "server-only"
import { readFile, stat } from "node:fs/promises"
import type { MediaPlaybackProvider, MediaPlaybackSource } from "./media-provider-types"
import { normalizePlaybackSource } from "./media-playback-policy"

/** Operator-provisioned catalogue of media for which the operator has playback rights.
 * Never accepts a URL, path or provider identifier supplied by a browser request.
 * No server fetch to playback URLs, so this layer cannot become an SSRF proxy.
 */
class ManifestPlaybackProvider implements MediaPlaybackProvider {
  readonly id = "authorized-manifest"
  private async source(key: string): Promise<MediaPlaybackSource | null> {
    const filename = process.env.MEDIA_PLAYBACK_MANIFEST?.trim()
    const origins = (process.env.MEDIA_PLAYBACK_ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean)
    if (!filename || !origins.length) return null
    try {
      if ((await stat(filename)).size > 2_000_000) return null
      const manifest: unknown = JSON.parse(await readFile(filename, "utf8"))
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null
      const entries = manifest as Record<string, unknown>
      return Object.prototype.hasOwnProperty.call(entries, key) ? normalizePlaybackSource(entries[key], origins) : null
    } catch { return null } // Paths, signed URLs and credentials must never enter diagnostics.
  }
  getMovieSource(id: number) { return this.source(`movie:${id}`) }
  getEpisodeSource(id: number, season: number, episode: number) { return this.source(`tv:${id}:${season}:${episode}`) }
}
export const mediaPlaybackProvider: MediaPlaybackProvider = new ManifestPlaybackProvider()
