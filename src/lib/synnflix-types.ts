export type SynnFlixMediaType = "movie" | "tv"

export type SynnFlixMediaItem = {
  id: number
  mediaType: SynnFlixMediaType
  title: string
  originalTitle: string
  overview: string
  posterPath: string | null
  backdropPath: string | null
  releaseDate: string | null
  voteAverage: number
  voteCount: number
  popularity: number
}

export type SynnFlixHomeData = {
  trending: SynnFlixMediaItem[]
  popularMovies: SynnFlixMediaItem[]
  popularTv: SynnFlixMediaItem[]
  topRatedMovies: SynnFlixMediaItem[]
  topRatedTv: SynnFlixMediaItem[]
}

export type SynnFlixSeasonSummary = {
  id: number
  seasonNumber: number
  name: string
  overview: string
  posterPath: string | null
  airDate: string | null
  episodeCount: number
}

export type SynnFlixDetails = SynnFlixMediaItem & {
  tagline: string
  genres: string[]
  status: string | null
  runtimeMinutes: number | null
  numberOfSeasons: number | null
  numberOfEpisodes: number | null
  seasons: SynnFlixSeasonSummary[]
}

export type SynnFlixEpisode = {
  id: number
  episodeNumber: number
  seasonNumber: number
  name: string
  overview: string
  airDate: string | null
  stillPath: string | null
  runtimeMinutes: number | null
  voteAverage: number
}

export type SynnFlixSeasonDetails = {
  id: number
  seasonNumber: number
  name: string
  overview: string
  posterPath: string | null
  airDate: string | null
  episodes: SynnFlixEpisode[]
}
