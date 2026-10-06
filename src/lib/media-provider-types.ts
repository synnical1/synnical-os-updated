import type { SynnFlixDetails, SynnFlixHomeData, SynnFlixMediaItem, SynnFlixMediaType, SynnFlixSeasonDetails } from "./synnflix-types"

export type MediaCatalogOptions = { animeOnly?: boolean; page?: number }
export type MediaSearchPage = { results: SynnFlixMediaItem[]; page: number; totalPages: number }
export interface MediaMetadataProvider {
  readonly id: string
  home(options?: MediaCatalogOptions): Promise<SynnFlixHomeData>
  search(query: string, options?: MediaCatalogOptions): Promise<MediaSearchPage>
  details(type: SynnFlixMediaType, id: number): Promise<SynnFlixDetails>
  season(id: number, season: number): Promise<SynnFlixSeasonDetails>
}
export type MediaPlaybackRequest = { mediaType: SynnFlixMediaType; mediaId: number; season?: number; episode?: number }
export type MediaPlaybackSource = {
  providerId: string
  kind: "file" | "hls" | "dash" | "embed"
  url: string
  subtitles?: { url: string; language: string; label: string }[]
  audioTracks?: { language: string; label: string }[]
  duration?: number
}
export interface MediaPlaybackProvider {
  readonly id: string
  getMovieSource(id: number): Promise<MediaPlaybackSource | null>
  getEpisodeSource(id: number, season: number, episode: number): Promise<MediaPlaybackSource | null>
}
export type NativePlaybackEvent = { event: "timeupdate" | "play" | "pause" | "ended" | "seeked"; currentTime: number; duration: number; id: number; mediaType: SynnFlixMediaType; season?: number; episode?: number }
