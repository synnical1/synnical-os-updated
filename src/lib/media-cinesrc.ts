import type { MediaPlaybackSource } from "./media-provider-types"
import { normalizePlaybackSource } from "./media-playback-policy"

const CINESRC_ORIGIN = "https://cinesrc.st"
const CINESRC_ALLOWED_ORIGINS = [CINESRC_ORIGIN] as const

function positiveInteger(value: number, allowZero = false): boolean {
  return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0)
}

function approvedEmbed(url: string): MediaPlaybackSource | null {
  return normalizePlaybackSource({
    providerId: "cinesrc",
    kind: "embed",
    url,
  }, CINESRC_ALLOWED_ORIGINS)
}

/** Build the documented CineSrc embed URL from a TMDB identity only. */
export function cineSrcMovieSource(tmdbId: number): MediaPlaybackSource | null {
  if (!positiveInteger(tmdbId)) return null
  const url = new URL("/embed/movie/" + tmdbId, CINESRC_ORIGIN)
  url.searchParams.set("controls", "true")
  url.searchParams.set("autoplay", "true")
  url.searchParams.set("color", "#ffffff")
  url.searchParams.set("back", "close")
  return approvedEmbed(url.toString())
}

/** Build the documented CineSrc TV embed URL from a TMDB identity and episode. */
export function cineSrcEpisodeSource(tmdbId: number, season: number, episode: number): MediaPlaybackSource | null {
  if (!positiveInteger(tmdbId) || !positiveInteger(season, true) || !positiveInteger(episode)) return null
  const url = new URL("/embed/tv/" + tmdbId, CINESRC_ORIGIN)
  url.searchParams.set("s", String(season))
  url.searchParams.set("e", String(episode))
  url.searchParams.set("controls", "true")
  url.searchParams.set("autoplay", "true")
  url.searchParams.set("autonext", "false")
  url.searchParams.set("color", "#ffffff")
  url.searchParams.set("back", "close")
  return approvedEmbed(url.toString())
}
