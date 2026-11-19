import type { SynnFlixMediaItem, SynnFlixMediaType } from "./synnflix-types"

type Row = Record<string, unknown>

function row(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export function isJapaneseAnime(value: unknown): boolean {
  const item = row(value)
  const genres = Array.isArray(item.genre_ids) ? item.genre_ids : []
  const animation = genres.some((id) => Number(id) === 16)
  const language = stringValue(item.original_language).toLowerCase()
  const countries = [
    ...(Array.isArray(item.origin_country) ? item.origin_country : []),
    ...(Array.isArray(item.production_countries) ? item.production_countries.map((country) => row(country).iso_3166_1) : []),
  ]
  return animation && (language === "ja" || countries.some((country) => country === "JP"))
}

export function mapTmdbMedia(value: unknown, fallbackType?: SynnFlixMediaType): SynnFlixMediaItem | null {
  const item = row(value)
  const id = Number(item.id)
  const mediaType = item.media_type === "movie" || item.media_type === "tv" ? item.media_type : fallbackType
  if (!Number.isSafeInteger(id) || id < 1 || !mediaType) return null

  const title = stringValue(mediaType === "movie" ? item.title : item.name).trim()
  if (!title) return null
  const originalTitle = stringValue(mediaType === "movie" ? item.original_title : item.original_name).trim()
  const releaseDate = stringValue(mediaType === "movie" ? item.release_date : item.first_air_date)
  const posterPath = stringValue(item.poster_path)
  const backdropPath = stringValue(item.backdrop_path)
  const voteAverage = Number(item.vote_average)
  const voteCount = Number(item.vote_count)
  const popularity = Number(item.popularity)

  return {
    id,
    mediaType,
    title: title.slice(0, 240),
    originalTitle: (originalTitle || title).slice(0, 240),
    overview: stringValue(item.overview).slice(0, 5000),
    posterPath: posterPath.startsWith("/") ? posterPath : null,
    backdropPath: backdropPath.startsWith("/") ? backdropPath : null,
    releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? releaseDate : null,
    voteAverage: Number.isFinite(voteAverage) ? Math.min(10, Math.max(0, voteAverage)) : 0,
    voteCount: Number.isSafeInteger(voteCount) && voteCount > 0 ? voteCount : 0,
    popularity: Number.isFinite(popularity) && popularity > 0 ? popularity : 0,
  }
}

export function uniqueTmdbItems(items: Array<SynnFlixMediaItem | null>): SynnFlixMediaItem[] {
  const seen = new Set<string>()
  const output: SynnFlixMediaItem[] = []
  for (const item of items) {
    if (!item) continue
    const key = item.mediaType + ":" + item.id
    if (seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }
  return output
}
