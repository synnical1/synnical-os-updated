import "server-only"
import { createHash } from "node:crypto"
import type { MediaMetadataProvider, MediaSearchPage } from "./media-provider-types"

import type {
  SynnFlixDetails,
  SynnFlixEpisode,
  SynnFlixHomeData,
  SynnFlixMediaItem,
  SynnFlixMediaType,
  SynnFlixSeasonDetails,
  SynnFlixSeasonSummary,
} from "@/lib/synnflix-types"

const TMDB_BASE_URL = "https://api.themoviedb.org/3"
const TMDB_API_KEY_PATTERN = /^[a-f0-9]{32}$/i
const TMDB_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

export class SynnFlixUpstreamError extends Error {
  constructor(message: string, readonly status = 502, readonly retryAfterSeconds?: number) {
    super(message)
    this.name = "SynnFlixUpstreamError"
  }
}

type JsonObject = Record<string, unknown>

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function nullableString(value: unknown): string | null {
  const text = stringValue(value).trim()
  return text ? text : null
}

function numberValue(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) ? number : 0
}

function nullableNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function integer(value: unknown): number {
  const number = numberValue(value)
  return Number.isInteger(number) ? number : Math.floor(number)
}

function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function tmdbAuth(): { token: string | null; apiKey: string | null } {
  const token = process.env.TMDB_READ_TOKEN?.trim() || process.env.TMDB_API_READ_TOKEN?.trim() || ""
  const apiKey = process.env.TMDB_API_KEY?.trim() || ""

  if (token && TMDB_TOKEN_PATTERN.test(token)) return { token, apiKey: null }
  if (apiKey && TMDB_API_KEY_PATTERN.test(apiKey)) return { token: null, apiKey }

  throw new SynnFlixUpstreamError("SynnFlix is not configured with valid TMDB credentials", 503)
}

const cache = new Map<string, { expiresAt: number; payload: JsonObject }>()
const inFlight = new Map<string, Promise<JsonObject>>()
let retryAt = 0

async function tmdbFetch(pathname: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<JsonObject> {
  const auth = tmdbAuth()
  const url = new URL(`${TMDB_BASE_URL}${pathname}`)
  for (const [key, raw] of Object.entries(params)) if (raw !== undefined) url.searchParams.set(key, String(raw))
  const credentialScope = createHash("sha256").update(auth.token || auth.apiKey || "").digest("hex")
  const key = `${credentialScope}:${url.pathname}:${url.search}`
  const hit = cache.get(key)
  if (hit && hit.expiresAt > Date.now()) return hit.payload
  if (Date.now() < retryAt) throw new SynnFlixUpstreamError("TMDB is rate-limiting requests. Try again shortly.", 503, Math.ceil((retryAt - Date.now()) / 1000))
  const pending = inFlight.get(key)
  if (pending) return pending
  if (inFlight.size >= 32) throw new SynnFlixUpstreamError("The catalogue is busy. Try again shortly.", 503, 2)
  if (auth.apiKey) url.searchParams.set("api_key", auth.apiKey)
  const task = (async () => {
    let response: Response
    try {
      response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json", ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}) } })
    } catch {
      // Never log exception URLs: query authentication may be present.
      throw new SynnFlixUpstreamError("TMDB is temporarily unreachable", 502)
    }
    if (response.status === 401 || response.status === 403) throw new SynnFlixUpstreamError("TMDB rejected the configured credentials", 503)
    if (response.status === 404) throw new SynnFlixUpstreamError("That title was not found", 404)
    if (response.status === 429) {
      const retry = response.headers.get("retry-after")
      const seconds = /^\d+$/.test(retry || "") ? Number(retry) : retry ? (Date.parse(retry) - Date.now()) / 1000 : 30
      const wait = Number.isFinite(seconds) ? Math.max(1, Math.min(300, Math.ceil(seconds))) : 30
      retryAt = Date.now() + wait * 1000
      throw new SynnFlixUpstreamError("TMDB is rate-limiting requests. Try again shortly.", 503, wait)
    }
    if (!response.ok) throw new SynnFlixUpstreamError("TMDB could not provide that content", 502)
    let payload: JsonObject
    try {
      const parsed: unknown = await response.json()
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid payload")
      payload = parsed as JsonObject
    } catch { throw new SynnFlixUpstreamError("TMDB returned an invalid response", 502) }
    cache.delete(key)
    cache.set(key, { expiresAt: Date.now() + 5 * 60_000, payload })
    while (cache.size > 256) cache.delete(cache.keys().next().value!)
    return payload
  })()
  inFlight.set(key, task)
  try { return await task } finally { inFlight.delete(key) }
}

function safePage(page = 1): number {
  if (!Number.isSafeInteger(page) || page < 1 || page > 500) throw new SynnFlixUpstreamError("Invalid catalogue page", 400)
  return page
}

function mediaTypeFromRaw(raw: JsonObject, fallback?: SynnFlixMediaType): SynnFlixMediaType | null {
  if (raw.media_type === "movie" || raw.media_type === "tv") return raw.media_type
  return fallback || null
}

export function normalizeMedia(value: unknown, fallback?: SynnFlixMediaType): SynnFlixMediaItem | null {
  const raw = object(value)
  const mediaType = mediaTypeFromRaw(raw, fallback)
  const id = integer(raw.id)
  if (!mediaType || id <= 0 || raw.adult === true) return null

  const movieTitle = stringValue(raw.title)
  const tvTitle = stringValue(raw.name)
  const title = (mediaType === "movie" ? movieTitle : tvTitle).trim()
    || movieTitle.trim()
    || tvTitle.trim()
  if (!title) return null

  const originalMovieTitle = stringValue(raw.original_title)
  const originalTvTitle = stringValue(raw.original_name)
  const releaseDate = mediaType === "movie"
    ? nullableString(raw.release_date)
    : nullableString(raw.first_air_date)

  return {
    id,
    mediaType,
    title,
    originalTitle: (mediaType === "movie" ? originalMovieTitle : originalTvTitle).trim() || title,
    overview: stringValue(raw.overview).trim(),
    posterPath: nullableString(raw.poster_path),
    backdropPath: nullableString(raw.backdrop_path),
    releaseDate,
    voteAverage: Math.max(0, numberValue(raw.vote_average)),
    voteCount: Math.max(0, integer(raw.vote_count)),
    popularity: Math.max(0, numberValue(raw.popularity)),
  }
}

function normalizeList(payload: JsonObject, fallback?: SynnFlixMediaType): SynnFlixMediaItem[] {
  const dedupe = new Set<string>()
  const output: SynnFlixMediaItem[] = []
  for (const value of safeArray(payload.results)) {
    const item = normalizeMedia(value, fallback)
    if (!item) continue
    const key = `${item.mediaType}:${item.id}`
    if (dedupe.has(key)) continue
    dedupe.add(key)
    output.push(item)
    if (output.length >= 20) break
  }
  return output
}

function isAnimeRaw(value: unknown): boolean {
  const raw = object(value)
  const genres = safeArray(raw.genre_ids).map(Number)
  const language = stringValue(raw.original_language).toLowerCase()
  const countries = safeArray(raw.origin_country).map((country) => stringValue(country).toUpperCase())
  const titleText = [
    stringValue(raw.title),
    stringValue(raw.name),
    stringValue(raw.original_title),
    stringValue(raw.original_name),
    stringValue(raw.overview),
  ].join(" ").toLowerCase()
  if (/\b(hentai|ecchi|erotic|sex|sexual|porn|uncensored|overflow)\b/.test(titleText)) return false
  if (titleText.includes("souryo to majiwaru") || titleText.includes("shikiyoku")) return false
  return genres.includes(16) && (language === "ja" || countries.includes("JP"))
}

function normalizeAnimeList(payload: JsonObject, fallback?: SynnFlixMediaType): SynnFlixMediaItem[] {
  const dedupe = new Set<string>()
  const output: SynnFlixMediaItem[] = []
  for (const value of safeArray(payload.results)) {
    if (!isAnimeRaw(value)) continue
    const item = normalizeMedia(value, fallback)
    if (!item) continue
    const key = `${item.mediaType}:${item.id}`
    if (dedupe.has(key)) continue
    dedupe.add(key)
    output.push(item)
    if (output.length >= 20) break
  }
  return output
}

function mergeLists(...lists: SynnFlixMediaItem[][]): SynnFlixMediaItem[] {
  const seen = new Set<string>()
  return lists.flat()
    .sort((a, b) => b.popularity - a.popularity)
    .filter((item) => {
      const key = `${item.mediaType}:${item.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 20)
}

export async function getSynnFlixHome(options: { animeOnly?: boolean; page?: number } = {}): Promise<SynnFlixHomeData> {
  const page = safePage(options.page)
  if (options.animeOnly) {
    const common = { include_adult: false, language: "en-US", page, with_genres: 16, with_original_language: "ja", "vote_count.gte": 80 }
    const [popularMovies, popularTv, topRatedMovies, topRatedTv] = await Promise.all([
      tmdbFetch("/discover/movie", { ...common, sort_by: "popularity.desc" }),
      tmdbFetch("/discover/tv", { ...common, sort_by: "popularity.desc" }),
      tmdbFetch("/discover/movie", { ...common, sort_by: "vote_average.desc", "vote_count.gte": 120 }),
      tmdbFetch("/discover/tv", { ...common, sort_by: "vote_average.desc", "vote_count.gte": 120 }),
    ])
    const movies = normalizeAnimeList(popularMovies, "movie")
    const tv = normalizeAnimeList(popularTv, "tv")
    return {
      trending: mergeLists(tv, movies),
      popularMovies: movies,
      popularTv: tv,
      topRatedMovies: normalizeAnimeList(topRatedMovies, "movie"),
      topRatedTv: normalizeAnimeList(topRatedTv, "tv"),
    }
  }

  const [trending, popularMovies, popularTv, topRatedMovies, topRatedTv] = await Promise.all([
    tmdbFetch("/trending/all/week", { language: "en-US", page }),
    tmdbFetch("/movie/popular", { language: "en-US", page }),
    tmdbFetch("/tv/popular", { language: "en-US", page }),
    tmdbFetch("/movie/top_rated", { language: "en-US", page }),
    tmdbFetch("/tv/top_rated", { language: "en-US", page }),
  ])

  return {
    trending: normalizeList(trending),
    popularMovies: normalizeList(popularMovies, "movie"),
    popularTv: normalizeList(popularTv, "tv"),
    topRatedMovies: normalizeList(topRatedMovies, "movie"),
    topRatedTv: normalizeList(topRatedTv, "tv"),
  }
}

export async function searchSynnFlixPage(query: string, options: { animeOnly?: boolean; page?: number } = {}): Promise<MediaSearchPage> {
  const page = safePage(options.page)
  const payload = await tmdbFetch("/search/multi", { query, include_adult: false, language: "en-US", page })
  return { results: options.animeOnly ? normalizeAnimeList(payload) : normalizeList(payload), page, totalPages: Math.min(500, Math.max(0, integer(payload.total_pages))) }
}
export async function searchSynnFlix(query: string, options: { animeOnly?: boolean; page?: number } = {}): Promise<SynnFlixMediaItem[]> {
  return (await searchSynnFlixPage(query, options)).results
}

function normalizeSeasonSummary(value: unknown): SynnFlixSeasonSummary | null {
  const raw = object(value)
  const id = integer(raw.id)
  const seasonNumber = integer(raw.season_number)
  if (id <= 0 || seasonNumber < 0) return null
  return {
    id,
    seasonNumber,
    name: stringValue(raw.name).trim() || (seasonNumber === 0 ? "Specials" : `Season ${seasonNumber}`),
    overview: stringValue(raw.overview).trim(),
    posterPath: nullableString(raw.poster_path),
    airDate: nullableString(raw.air_date),
    episodeCount: Math.max(0, integer(raw.episode_count)),
  }
}

export async function getSynnFlixDetails(mediaType: SynnFlixMediaType, id: number): Promise<SynnFlixDetails> {
  if ((mediaType !== "movie" && mediaType !== "tv") || !Number.isSafeInteger(id) || id < 1) throw new SynnFlixUpstreamError("Invalid title", 400)
  const payload = await tmdbFetch(`/${mediaType}/${id}`, { language: "en-US", append_to_response: "credits,recommendations,similar,alternative_titles" })
  const base = normalizeMedia(payload, mediaType)
  if (!base) throw new SynnFlixUpstreamError("That title was not found", 404)

  const genres = safeArray(payload.genres)
    .map((value) => stringValue(object(value).name).trim())
    .filter(Boolean)
    .slice(0, 12)

  const seasons = mediaType === "tv"
    ? safeArray(payload.seasons).map(normalizeSeasonSummary).filter((value): value is SynnFlixSeasonSummary => Boolean(value))
    : []

  const episodeRuntime = safeArray(payload.episode_run_time)
    .map(nullableNumber)
    .find((value): value is number => value !== null && value > 0) ?? null

  return {
    ...base,
    cast: safeArray(object(payload.credits).cast).slice(0, 12).map(value => { const row = object(value); return { id: integer(row.id), name: stringValue(row.name), character: stringValue(row.character), profilePath: nullableString(row.profile_path) } }).filter(row => row.id > 0 && row.name),
    recommendations: normalizeList(object(payload.recommendations), mediaType),
    similar: normalizeList(object(payload.similar), mediaType),
    studios: safeArray(payload.production_companies).map(value => stringValue(object(value).name)).filter(Boolean).slice(0, 8),
    alternativeTitles: safeArray(object(payload.alternative_titles).titles ?? object(payload.alternative_titles).results).map(value => stringValue(object(value).title)).filter(Boolean).slice(0, 12),
    tagline: stringValue(payload.tagline).trim(),
    genres,
    status: nullableString(payload.status),
    runtimeMinutes: mediaType === "movie" ? nullableNumber(payload.runtime) : episodeRuntime,
    numberOfSeasons: mediaType === "tv" ? nullableNumber(payload.number_of_seasons) : null,
    numberOfEpisodes: mediaType === "tv" ? nullableNumber(payload.number_of_episodes) : null,
    seasons,
  }
}

function normalizeEpisode(value: unknown): SynnFlixEpisode | null {
  const raw = object(value)
  const id = integer(raw.id)
  const episodeNumber = integer(raw.episode_number)
  const seasonNumber = integer(raw.season_number)
  if (id <= 0 || episodeNumber <= 0 || seasonNumber < 0) return null
  return {
    id,
    episodeNumber,
    seasonNumber,
    name: stringValue(raw.name).trim() || `Episode ${episodeNumber}`,
    overview: stringValue(raw.overview).trim(),
    airDate: nullableString(raw.air_date),
    stillPath: nullableString(raw.still_path),
    runtimeMinutes: nullableNumber(raw.runtime),
    voteAverage: Math.max(0, numberValue(raw.vote_average)),
  }
}

export async function getSynnFlixSeason(seriesId: number, seasonNumber: number): Promise<SynnFlixSeasonDetails> {
  if (!Number.isSafeInteger(seriesId) || seriesId < 1 || !Number.isSafeInteger(seasonNumber) || seasonNumber < 0 || seasonNumber > 999) throw new SynnFlixUpstreamError("Invalid season", 400)
  const payload = await tmdbFetch(`/tv/${seriesId}/season/${seasonNumber}`, { language: "en-US" })
  const id = integer(payload.id)
  if (id <= 0) throw new SynnFlixUpstreamError("That season was not found", 404)

  return {
    id,
    seasonNumber: integer(payload.season_number),
    name: stringValue(payload.name).trim() || (seasonNumber === 0 ? "Specials" : `Season ${seasonNumber}`),
    overview: stringValue(payload.overview).trim(),
    posterPath: nullableString(payload.poster_path),
    airDate: nullableString(payload.air_date),
    episodes: safeArray(payload.episodes)
      .map(normalizeEpisode)
      .filter((value): value is SynnFlixEpisode => Boolean(value)),
  }
}

export const tmdbMetadataProvider: MediaMetadataProvider = { id: "tmdb", home: getSynnFlixHome, search: searchSynnFlixPage, details: getSynnFlixDetails, season: getSynnFlixSeason }
