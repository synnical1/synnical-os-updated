import "server-only"

import type { SynnFlixDetails, SynnFlixHomeData, SynnFlixMediaItem, SynnFlixMediaType, SynnFlixSeasonDetails } from "./synnflix-types"
import { isJapaneseAnime, mapTmdbMedia, uniqueTmdbItems } from "./tmdb-catalog"

type Row = Record<string, unknown>
type Provider = { id: number; name: string; logoPath: string | null }
type WatchProviders = { flatrate: Provider[]; free: Provider[]; ads: Provider[]; rent: Provider[]; buy: Provider[]; link: string | null }

export class TmdbCatalogError extends Error {
  readonly code: "not_configured" | "upstream"
  constructor(code: "not_configured" | "upstream", message: string) {
    super(message)
    this.name = "TmdbCatalogError"
    this.code = code
  }
}

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}
}
function text(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}
function numeric(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
function resultRows(value: unknown): unknown[] {
  const results = object(value).results
  return Array.isArray(results) ? results : []
}

async function tmdb<T>(path: string, values: Record<string, string> = {}): Promise<T> {
  const token = process.env.TMDB_READ_ACCESS_TOKEN?.trim()
  if (!token) throw new TmdbCatalogError("not_configured", "TMDB is not configured on the server.")
  const url = new URL("https://api.themoviedb.org/3" + path)
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value)
  let response: Response
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw new TmdbCatalogError("upstream", "TMDB could not be reached. Please try again.")
  }
  if (!response.ok) {
    throw new TmdbCatalogError("upstream", response.status === 429 ? "TMDB rate limit reached. Please try again shortly." : "TMDB returned an error. Please try again.")
  }
  return await response.json() as T
}

async function list(path: string): Promise<SynnFlixMediaItem[]> {
  const payload = await tmdb<unknown>(path, { language: "en-GB", include_adult: "false", page: "1" })
  const fallback = path.startsWith("/movie/") ? "movie" : path.startsWith("/tv/") ? "tv" : undefined
  return uniqueTmdbItems(resultRows(payload).map((entry) => mapTmdbMedia(entry, fallback)))
}

async function animeList(type: SynnFlixMediaType, sort: "popularity.desc" | "vote_average.desc"): Promise<SynnFlixMediaItem[]> {
  const payload = await tmdb<unknown>("/discover/" + type, {
    language: "en-GB",
    include_adult: "false",
    page: "1",
    sort_by: sort,
    with_genres: "16",
    with_original_language: "ja",
    with_origin_country: "JP",
  })
  return uniqueTmdbItems(resultRows(payload).filter(isJapaneseAnime).map((entry) => mapTmdbMedia(entry, type)))
}

export async function getTmdbHome(mode: "movies" | "anime"): Promise<SynnFlixHomeData> {
  if (mode === "anime") {
    const [popularMovies, popularTv, topRatedMovies, topRatedTv] = await Promise.all([
      animeList("movie", "popularity.desc"),
      animeList("tv", "popularity.desc"),
      animeList("movie", "vote_average.desc"),
      animeList("tv", "vote_average.desc"),
    ])
    return {
      trending: uniqueTmdbItems([...popularTv, ...popularMovies]).sort((a, b) => b.popularity - a.popularity).slice(0, 24),
      popularMovies, popularTv, topRatedMovies, topRatedTv,
    }
  }
  const [trending, popularMovies, popularTv, topRatedMovies, topRatedTv] = await Promise.all([
    list("/trending/all/week"),
    list("/movie/popular"),
    list("/tv/popular"),
    list("/movie/top_rated"),
    list("/tv/top_rated"),
  ])
  return { trending, popularMovies, popularTv, topRatedMovies, topRatedTv }
}

export async function searchTmdb(query: string, mode: "movies" | "anime") {
  const clean = query.trim().slice(0, 100)
  if (!clean) return { results: [] as SynnFlixMediaItem[], page: 1, totalPages: 0 }
  const params = { language: "en-GB", include_adult: "false", page: "1", query: clean }
  const [movies, television] = await Promise.all([
    tmdb<unknown>("/search/movie", params),
    tmdb<unknown>("/search/tv", params),
  ])
  const entries = [
    ...resultRows(movies).map((entry) => ({ entry, type: "movie" as const })),
    ...resultRows(television).map((entry) => ({ entry, type: "tv" as const })),
  ]
  const filtered = entries.filter(({ entry }) => mode !== "anime" || isJapaneseAnime(entry))
  const mapped = uniqueTmdbItems(filtered.map(({ entry, type }) => mapTmdbMedia(entry, type)))
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 40)
  const totalPages = Math.max(numeric(object(movies).total_pages), numeric(object(television).total_pages))
  return { results: mapped, page: 1, totalPages: Math.min(500, totalPages) }
}

function providers(value: unknown): Provider[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<number>()
  return value.flatMap((entry) => {
    const provider = object(entry)
    const id = numeric(provider.provider_id)
    const name = text(provider.provider_name, 100)
    if (!Number.isSafeInteger(id) || id < 1 || !name || seen.has(id)) return []
    seen.add(id)
    const logo = text(provider.logo_path)
    return [{ id, name, logoPath: logo.startsWith("/") ? logo : null }]
  }).slice(0, 20)
}

function watchProviders(value: unknown): WatchProviders {
  const watch = object(object(value)["watch/providers"])
  const gb = object(object(watch.results).GB)
  return {
    flatrate: providers(gb.flatrate),
    free: providers(gb.free),
    ads: providers(gb.ads),
    rent: providers(gb.rent),
    buy: providers(gb.buy),
    link: text(gb.link, 1000) || null,
  }
}

function related(value: unknown, type: SynnFlixMediaType): SynnFlixMediaItem[] {
  return uniqueTmdbItems(resultRows(value).map((entry) => mapTmdbMedia(entry, type))).slice(0, 12)
}

export async function getTmdbDetails(type: SynnFlixMediaType, id: number) {
  const data = await tmdb<unknown>("/" + type + "/" + id, {
    language: "en-GB",
    append_to_response: "credits,recommendations,similar,alternative_titles,watch/providers",
  })
  const root = object(data)
  const item = mapTmdbMedia(data, type)
  if (!item) throw new TmdbCatalogError("upstream", "TMDB returned incomplete title metadata.")
  const credits = object(root.credits)
  const alternatives = object(root.alternative_titles)
  const alternativeRows = Array.isArray(alternatives.titles) ? alternatives.titles : Array.isArray(alternatives.results) ? alternatives.results : []
  const seasonRows = Array.isArray(root.seasons) ? root.seasons : []
  const runTimes = Array.isArray(root.episode_run_time) ? root.episode_run_time : []
  const cast = (Array.isArray(credits.cast) ? credits.cast : []).slice(0, 16).flatMap((entry) => {
    const person = object(entry)
    const personId = numeric(person.id)
    const name = text(person.name, 150)
    if (!Number.isSafeInteger(personId) || personId < 1 || !name) return []
    const path = text(person.profile_path)
    return [{ id: personId, name, character: text(person.character, 160), profilePath: path.startsWith("/") ? path : null }]
  })
  const seasons = seasonRows.flatMap((entry) => {
    const season = object(entry)
    const seasonNumber = numeric(season.season_number, -1)
    if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 0) return []
    const path = text(season.poster_path)
    return [{
      id: numeric(season.id), seasonNumber, name: text(season.name, 180),
      overview: text(season.overview, 2000), posterPath: path.startsWith("/") ? path : null,
      airDate: text(season.air_date, 20) || null, episodeCount: Math.max(0, numeric(season.episode_count)),
    }]
  })
  const genres = Array.isArray(root.genres) ? root.genres.flatMap((entry) => {
    const name = text(object(entry).name, 80)
    return name ? [name] : []
  }) : []
  const alternativeTitles = alternativeRows.flatMap((entry) => {
    const title = text(object(entry).title || object(entry).name, 120)
    return title ? [title] : []
  }).slice(0, 20)
  const providers = watchProviders(data)
  return {
    ...item,
    cast,
    recommendations: related(root.recommendations, type),
    similar: related(root.similar, type),
    studios: (Array.isArray(root.production_companies) ? root.production_companies : []).flatMap((entry) => {
      const name = text(object(entry).name, 120)
      return name ? [name] : []
    }).slice(0, 12),
    alternativeTitles,
    tagline: text(root.tagline, 300),
    genres,
    status: text(root.status, 80) || null,
    runtimeMinutes: type === "movie" ? Math.max(0, numeric(root.runtime)) || null : Math.max(0, numeric(runTimes[0])) || null,
    numberOfSeasons: type === "tv" ? Math.max(0, numeric(root.number_of_seasons)) : null,
    numberOfEpisodes: type === "tv" ? Math.max(0, numeric(root.number_of_episodes)) : null,
    seasons,
    watchProviders: providers,
    watchLink: providers.link || ("https://www.themoviedb.org/" + type + "/" + id + "/watch?locale=GB"),
  } satisfies SynnFlixDetails & { watchProviders: WatchProviders; watchLink: string }
}

export async function getTmdbSeason(id: number, season: number): Promise<SynnFlixSeasonDetails> {
  const data = await tmdb<unknown>("/tv/" + id + "/season/" + season, { language: "en-GB" })
  const root = object(data)
  const poster = text(root.poster_path)
  const episodes = (Array.isArray(root.episodes) ? root.episodes : []).flatMap((entry) => {
    const episode = object(entry)
    const episodeNumber = numeric(episode.episode_number, -1)
    const episodeId = numeric(episode.id, -1)
    if (!Number.isSafeInteger(episodeNumber) || episodeNumber < 1 || !Number.isSafeInteger(episodeId) || episodeId < 1) return []
    const still = text(episode.still_path)
    return [{
      id: episodeId, episodeNumber, seasonNumber: season,
      name: text(episode.name, 200) || "Episode " + episodeNumber,
      overview: text(episode.overview, 3000), airDate: text(episode.air_date, 20) || null,
      stillPath: still.startsWith("/") ? still : null,
      runtimeMinutes: Math.max(0, numeric(episode.runtime)) || null,
      voteAverage: Math.min(10, Math.max(0, numeric(episode.vote_average))),
    }]
  })
  return {
    id: numeric(root.id), seasonNumber: season,
    name: text(root.name, 180) || "Season " + season,
    overview: text(root.overview, 3000),
    posterPath: poster.startsWith("/") ? poster : null,
    airDate: text(root.air_date, 20) || null,
    episodes,
  }
}
