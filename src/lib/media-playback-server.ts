import "server-only"
import { readFile, stat } from "node:fs/promises"
import type { MediaPlaybackProvider, MediaPlaybackSource } from "./media-provider-types"
import { normalizePlaybackSource } from "./media-playback-policy"
import { cineSrcEpisodeSource, cineSrcMovieSource } from "./media-cinesrc"

/** Optional operator-managed, private playback sources retained as an override. */
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
    } catch { return null }
  }
  getMovieSource(id: number) { return this.source(`movie:${id}`) }
  getEpisodeSource(id: number, season: number, episode: number) { return this.source(`tv:${id}:${season}:${episode}`) }
}

/** CineSrc receives only a validated TMDB identity; no browser-supplied URL is accepted. */
class CineSrcPlaybackProvider implements MediaPlaybackProvider {
  readonly id = "cinesrc"
  private readonly manifest = new ManifestPlaybackProvider()

  async getMovieSource(id: number): Promise<MediaPlaybackSource | null> {
    return await this.manifest.getMovieSource(id) ?? cineSrcMovieSource(id)
  }

  async getEpisodeSource(id: number, season: number, episode: number): Promise<MediaPlaybackSource | null> {
    return await this.manifest.getEpisodeSource(id, season, episode) ?? cineSrcEpisodeSource(id, season, episode)
  }
}

export const mediaPlaybackProvider: MediaPlaybackProvider = new CineSrcPlaybackProvider()
