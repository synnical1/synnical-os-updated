export type MusicProvider = "audius" | "piped" | "invidious" | "cobalt"

export type MusicTrack = {
  id: string
  provider: MusicProvider
  title: string
  artist: string
  artistHandle?: string | null
  artwork?: string | null
  duration: number
  genre?: string | null
  playCount?: number | null
  permalink?: string | null
  sourceUrl?: string | null
}

export type MusicProviderStatus = {
  audius: { available: true; authenticated: boolean }
  piped: { available: boolean }
  invidious: { available: boolean }
  cobalt: { available: boolean }
}
