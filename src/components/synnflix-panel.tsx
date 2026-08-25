"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
import {
  ArrowLeft,
  Bookmark,
  Heart,
  ListPlus,
  Users,
  CalendarDays,
  ChevronRight,
  Clapperboard,
  Clock3,
  Copy,
  Film,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Star,
  Trash2,
  Tv,
  Upload,
  UserRound,
  X,
} from "lucide-react"
import type {
  SynnFlixDetails,
  SynnFlixEpisode,
  SynnFlixHomeData,
  SynnFlixMediaItem,
  SynnFlixMediaType,
  SynnFlixSeasonDetails,
} from "@/lib/synnflix-types"
import { featureApi } from "@/lib/feature-api"
import { io, type Socket } from "socket.io-client"
import { toast } from "sonner"
import { useAuth } from "@/hooks/use-auth"
import {
  SYNNFLIX_AVATAR_SPRITE,
  SYNNFLIX_AVATARS,
  SYNNFLIX_PROFILE_LIMIT,
  synnFlixAvatar,
  type SynnFlixProfile,
} from "@/lib/synnflix-profiles"

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p"
const TMDB_LOGO = "https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg"
const VIDKING_ORIGIN = "https://www.vidking.net"
const PLAYER_COLOR = "ffffff"
const RESUME_REWIND_SECONDS = 10

type LibraryView = "home" | "movies" | "tv"
type CatalogMode = "synnflix" | "anime"

type PlayerState = {
  media: SynnFlixMediaItem
  season: number | null
  episode: number | null
  episodeName: string | null
}

type PlayerEventData = {
  event?: unknown
  currentTime?: unknown
  duration?: unknown
  progress?: unknown
  id?: unknown
  mediaType?: unknown
  type?: unknown
  season?: unknown
  episode?: unknown
  timestamp?: unknown
}

type MediaProgressRow = {
  mediaType: SynnFlixMediaType
  mediaId: string
  title: string
  poster?: string | null
  backdrop?: string | null
  season?: number | null
  episode?: number | null
  episodeName?: string | null
  currentTime?: number | null
  duration?: number | null
  completed?: boolean | null
  updatedAt?: string | null
}

function vidkingEventData(message: unknown): PlayerEventData | null {
  let parsed = message
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed) } catch { return null }
  }
  if (!parsed || typeof parsed !== "object") return null

  const candidate = parsed as { type?: unknown; payload?: unknown; data?: unknown; event?: unknown }
  const envelope = candidate.type === "SYNNFLIX_PLAYER_EVENT" && candidate.payload && typeof candidate.payload === "object"
    ? candidate.payload as { type?: unknown; data?: unknown }
    : candidate
  if (envelope.type === "PLAYER_EVENT" && envelope.data && typeof envelope.data === "object") {
    return envelope.data as PlayerEventData
  }

  // Vidking's field list also describes the event fields directly. Supporting
  // that documented form keeps progress working across player revisions. The
  // active media identity and event schema are validated before it is accepted.
  return "event" in candidate ? candidate as PlayerEventData : null
}


function VidkingPlayerFrame({
  src,
  title,
  playerFrameRef,
}: {
  src: string
  title: string
  playerFrameRef: MutableRefObject<HTMLIFrameElement | null>
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const providerUrl = new URL(src)
    if (providerUrl.origin !== VIDKING_ORIGIN || !providerUrl.pathname.startsWith("/embed/")) return

    const match = providerUrl.pathname.match(/^\/embed\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?$/)
    if (!match) return

    const iframe = document.createElement("iframe")
    iframe.className = "block h-full min-h-[420px] w-full border-0 bg-black"
    iframe.title = title
    iframe.width = "100%"
    iframe.height = "100%"
    iframe.loading = "eager"
    ;(iframe as HTMLIFrameElement & { fetchPriority?: string }).fetchPriority = "high"
    iframe.setAttribute("frameborder", "0")
    iframe.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media"
    iframe.allowFullscreen = true
    iframe.setAttribute("allowfullscreen", "")
    iframe.referrerPolicy = "strict-origin-when-cross-origin"

    const forcePlaybackIntent = () => {
      try { iframe.focus({ preventScroll: true }) } catch { try { iframe.focus() } catch {} }
      const target = iframe.contentWindow
      if (!target) return
      for (const message of [
        { type: "PLAYER_COMMAND", command: "play" },
        { type: "SYNNFLIX_PLAYER_COMMAND", command: "play" },
        { event: "play" },
      ]) {
        try { target.postMessage(message, VIDKING_ORIGIN) } catch {}
      }
    }

    iframe.src = providerUrl.toString()
    playerFrameRef.current = iframe
    host.replaceChildren(iframe)
    iframe.addEventListener("load", forcePlaybackIntent)
    const forceTimers = [
      window.setTimeout(forcePlaybackIntent, 150),
      window.setTimeout(forcePlaybackIntent, 650),
      window.setTimeout(forcePlaybackIntent, 1_500),
    ]

    return () => {
      iframe.removeEventListener("load", forcePlaybackIntent)
      forceTimers.forEach((timer) => window.clearTimeout(timer))
      if (playerFrameRef.current === iframe) playerFrameRef.current = null
      try { iframe.src = "about:blank" } catch {}
      iframe.remove()
    }
  }, [playerFrameRef, src, title])

  return <div ref={hostRef} className="h-full min-h-[420px] w-full bg-black" />
}

function imageUrl(path: string | null | undefined, size: "w342" | "w500" | "w780" | "w1280" = "w500"): string | null {
  if (!path || !path.startsWith("/")) return null
  return `${TMDB_IMAGE_BASE}/${size}${path}`
}

function yearFromDate(value: string | null | undefined): string {
  if (!value || !/^\d{4}/.test(value)) return ""
  return value.slice(0, 4)
}

function formatRating(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "NR"
  return value.toFixed(1)
}

function formatRuntime(minutes: number | null | undefined): string {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return ""
  const rounded = Math.round(minutes)
  const hours = Math.floor(rounded / 60)
  const remainder = rounded % 60
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`
}

function mediaKey(item: Pick<SynnFlixMediaItem, "mediaType" | "id">): string {
  return `${item.mediaType}:${item.id}`
}

function progressKey(player: PlayerState, profileId: string): string {
  return `synnflix.progress.${profileId}.${player.media.mediaType}.${player.media.id}.${player.season ?? 0}.${player.episode ?? 0}`
}

function readProgress(player: PlayerState, profileId: string): number {
  try {
    const value = Number(window.localStorage.getItem(progressKey(player, profileId)) || 0)
    return Number.isFinite(value) && value > 3 ? Math.floor(value) : 0
  } catch {
    return 0
  }
}

function writeProgress(player: PlayerState, profileId: string, seconds: number): void {
  try {
    if (!Number.isFinite(seconds) || seconds < 0) return
    const key = progressKey(player, profileId)
    const existing = Number(window.localStorage.getItem(key) || 0)
    const next = Math.max(Number.isFinite(existing) ? Math.floor(existing) : 0, Math.floor(seconds))
    window.localStorage.setItem(key, String(next))
  } catch {
    // localStorage is optional; playback should still work when storage is blocked.
  }
}

function clearProgress(player: PlayerState, profileId: string): void {
  try {
    window.localStorage.removeItem(progressKey(player, profileId))
  } catch {
    // Ignore blocked storage.
  }
}

function playerIdentity(player: PlayerState): string {
  return `${player.media.mediaType}:${player.media.id}:${player.season ?? 0}:${player.episode ?? 0}`
}

function resumeStartSeconds(value: unknown): number {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 3) return 1
  return Math.max(1, Math.floor(seconds) - RESUME_REWIND_SECONDS)
}

function progressMedia(row: MediaProgressRow): SynnFlixMediaItem {
  return {
    id: Number(row.mediaId),
    mediaType: row.mediaType,
    title: String(row.title || "Untitled"),
    originalTitle: String(row.title || "Untitled"),
    overview: "",
    posterPath: typeof row.poster === "string" ? row.poster : null,
    backdropPath: typeof row.backdrop === "string" ? row.backdrop : null,
    releaseDate: null,
    voteAverage: 0,
    voteCount: 0,
    popularity: 0,
  }
}

function buildPlayerUrl(player: PlayerState, profileId: string, options?: { progress?: number; autoplay?: boolean }): string {
  const savedProgress = typeof window === "undefined" ? 0 : readProgress(player, profileId)
  const progress = Number.isFinite(options?.progress) ? Math.max(0, Math.floor(Number(options?.progress))) : savedProgress
  const shouldAutoplay = options?.autoplay !== false
  const params = new URLSearchParams({
    color: PLAYER_COLOR,
    autoPlay: String(shouldAutoplay),
    autoplay: String(shouldAutoplay),
    autoStart: String(shouldAutoplay),
    autostart: String(shouldAutoplay),
  })
  if (shouldAutoplay) params.set("play", "true")
  if (progress > 0) params.set("progress", String(progress))

  if (player.media.mediaType === "movie") {
    return `${VIDKING_ORIGIN}/embed/movie/${player.media.id}?${params.toString()}`
  }

  params.set("nextEpisode", "true")
  params.set("episodeSelector", "true")
  return `${VIDKING_ORIGIN}/embed/tv/${player.media.id}/${player.season || 1}/${player.episode || 1}?${params.toString()}`
}

function ProfileAvatar({ profile, className = "h-20 w-20" }: { profile: SynnFlixProfile; className?: string }) {
  if (profile.avatarUrl) {
    return <img src={profile.avatarUrl} alt="" className={`${className} rounded-full object-cover ring-2 ring-white/15`} />
  }
  const avatar = synnFlixAvatar(profile.avatarKey)
  return (
    <span
      aria-hidden="true"
      className={`${className} block rounded-full bg-black bg-no-repeat shadow-lg ring-2 ring-white/15`}
      style={{
        backgroundImage: `url(${SYNNFLIX_AVATAR_SPRITE})`,
        backgroundSize: "1000% 1000%",
        backgroundPosition: `${avatar.column * (100 / 9)}% ${avatar.row * (100 / 9)}%`,
      }}
    />
  )
}

async function apiJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" })
  const data = await response.json().catch(() => ({})) as { error?: unknown }
  if (!response.ok) {
    throw new Error(typeof data.error === "string" && data.error ? data.error : "SynnFlix request failed")
  }
  return data as T
}

function dedupe(items: SynnFlixMediaItem[]): SynnFlixMediaItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = mediaKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function MediaCard({ item, onSelect }: { item: SynnFlixMediaItem; onSelect: (item: SynnFlixMediaItem) => void }) {
  const poster = imageUrl(item.posterPath, "w342")
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className="group w-[145px] shrink-0 text-left sm:w-[160px]"
      aria-label={`Open ${item.title}`}
    >
      <span className="relative block aspect-[2/3] overflow-hidden rounded-xl border border-white/10 bg-[#090909] shadow-lg shadow-black/30 transition duration-200 group-hover:-translate-y-1 group-hover:border-white/35">
        {poster ? (
          <img src={poster} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <span className="grid h-full w-full place-items-center bg-[#0b0b0b] text-white/25">
            {item.mediaType === "movie" ? <Film className="h-8 w-8" /> : <Tv className="h-8 w-8" />}
          </span>
        )}
        <span className="absolute left-2 top-2 rounded-md border border-black/20 bg-black/75 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/85 backdrop-blur-sm">
          {item.mediaType === "movie" ? "Movie" : "TV"}
        </span>
        <span className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/95 via-black/45 to-transparent px-2.5 pb-2.5 pt-10 text-[11px] text-white/80">
          <span className="flex items-center gap-1"><Star className="h-3 w-3 fill-current" /> {formatRating(item.voteAverage)}</span>
          <span>{yearFromDate(item.releaseDate)}</span>
        </span>
      </span>
      <strong className="mt-2 block truncate text-sm font-medium text-white/88 transition-colors group-hover:text-white">{item.title}</strong>
    </button>
  )
}

function Rail({ title, icon, items, onSelect }: { title: string; icon: React.ReactNode; items: SynnFlixMediaItem[]; onSelect: (item: SynnFlixMediaItem) => void }) {
  if (!items.length) return null
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className="text-white/55">{icon}</span>
        <h2 className="text-[15px] font-semibold text-white">{title}</h2>
      </div>
      <div className="synnflix-rail flex gap-3 overflow-x-auto px-1 pb-3">
        {items.map((item) => <MediaCard key={mediaKey(item)} item={item} onSelect={onSelect} />)}
      </div>
    </section>
  )
}

function ContinueWatchingRail({
  rows,
  onResume,
  onRemove,
}: {
  rows: MediaProgressRow[]
  onResume: (row: MediaProgressRow) => void
  onRemove: (row: MediaProgressRow) => void
}) {
  if (!rows.length) return null
  return (
    <section className="mb-8" aria-labelledby="synnflix-continue-heading">
      <div className="mb-3 flex items-center gap-2 px-1">
        <Clock3 className="h-4 w-4 text-white/55" />
        <h2 id="synnflix-continue-heading" className="text-[15px] font-semibold text-white">Continue Watching</h2>
      </div>
      <div className="synnflix-rail flex gap-3 overflow-x-auto px-1 pb-3">
        {rows.map((row) => {
          const poster = imageUrl(row.poster, "w342")
          const duration = Math.max(0, Number(row.duration) || 0)
          const currentTime = Math.max(0, Number(row.currentTime) || 0)
          const percent = duration > 0 ? Math.min(100, Math.max(2, (currentTime / duration) * 100)) : 8
          const identity = `${row.mediaType}:${row.mediaId}:${Number(row.season) || 0}:${Number(row.episode) || 0}`
          const subtitle = row.mediaType === "tv"
            ? `S${Number(row.season) || 1} E${Number(row.episode) || 1}${row.episodeName ? ` · ${row.episodeName}` : ""}`
            : `${Math.max(1, Math.round(currentTime / 60))} min watched`
          return (
            <article key={identity} className="group relative w-[190px] shrink-0 sm:w-[220px]">
              <button type="button" onClick={() => onResume(row)} className="block w-full text-left" aria-label={`Resume ${row.title}`}>
                <span className="relative block aspect-video overflow-hidden rounded-xl border border-white/10 bg-[#090909] shadow-lg shadow-black/30 transition group-hover:-translate-y-0.5 group-hover:border-white/35">
                  {poster ? <img src={poster} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <span className="grid h-full w-full place-items-center text-white/25">{row.mediaType === "movie" ? <Film className="h-7 w-7" /> : <Tv className="h-7 w-7" />}</span>}
                  <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/10" />
                  <span className="absolute inset-0 grid place-items-center"><span className="grid h-10 w-10 place-items-center rounded-full bg-white text-black shadow-xl transition group-hover:scale-105"><Play className="ml-0.5 h-4 w-4 fill-current" /></span></span>
                  <span className="absolute inset-x-0 bottom-0 h-1 bg-white/15"><span className="block h-full bg-white" style={{ width: `${percent}%` }} /></span>
                </span>
                <strong className="mt-2 block truncate text-sm font-medium text-white/90">{row.title}</strong>
                <span className="mt-0.5 block truncate text-[11px] text-white/42">{subtitle}</span>
              </button>
              <button type="button" onClick={() => onRemove(row)} className="absolute right-2 top-2 rounded-full border border-white/15 bg-black/80 p-1.5 text-white/65 opacity-0 backdrop-blur transition hover:text-white group-hover:opacity-100 focus:opacity-100" aria-label={`Remove ${row.title} from Continue Watching`}>
                <X className="h-3.5 w-3.5" />
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function ResultGrid({ items, onSelect }: { items: SynnFlixMediaItem[]; onSelect: (item: SynnFlixMediaItem) => void }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => (
        <div key={mediaKey(item)} className="flex justify-center">
          <MediaCard item={item} onSelect={onSelect} />
        </div>
      ))}
    </div>
  )
}

function storedMediaItems(list: any): SynnFlixMediaItem[] {
  if (!Array.isArray(list?.items)) return []
  return list.items.map((item: any) => ({
    id: Number(item.mediaId),
    mediaType: item.mediaType === "tv" ? "tv" : "movie",
    title: String(item.title || "Untitled"),
    originalTitle: String(item.title || "Untitled"),
    overview: "",
    posterPath: typeof item.poster === "string" ? item.poster : null,
    backdropPath: null,
    releaseDate: null, voteAverage: 0, voteCount: 0, popularity: 0,
  })).filter((item: SynnFlixMediaItem) => Number.isSafeInteger(item.id) && item.id > 0)
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="mx-auto w-full max-w-[160px]">
          <div className="aspect-[2/3] animate-pulse rounded-xl border border-white/8 bg-white/[0.035]" />
          <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-white/[0.05]" />
        </div>
      ))}
    </div>
  )
}

export function SynnFlixPanel({ catalogMode = "synnflix" }: { catalogMode?: CatalogMode }) {
  const animeMode = catalogMode === "anime"
  const brandName = animeMode ? "Synnime" : "SynnFlix"
  const brandSubtitle = animeMode ? "Anime only" : "Movies + TV"
  const searchPlaceholder = animeMode ? "Search anime" : "Search movies and TV shows"
  const searchResultLabel = animeMode ? "anime result" : "movie / TV result"
  const homeUrl = animeMode ? "/api/synnflix/home?mode=anime" : "/api/synnflix/home"
  const { user } = useAuth()
  const fullscreenShellRef = useRef<HTMLElement | null>(null)
  const playerFrameRef = useRef<HTMLIFrameElement | null>(null)
  const flushPlaybackProgressRef = useRef<(reason: "hidden" | "pagehide" | "blur" | "close") => void>(() => {})
  const [home, setHome] = useState<SynnFlixHomeData | null>(null)
  const [homeLoading, setHomeLoading] = useState(true)
  const [homeError, setHomeError] = useState("")
  const [view, setView] = useState<LibraryView>("home")
  const [query, setQuery] = useState("")
  const [submittedQuery, setSubmittedQuery] = useState("")
  const [results, setResults] = useState<SynnFlixMediaItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState("")
  const [selected, setSelected] = useState<SynnFlixMediaItem | null>(null)
  const [details, setDetails] = useState<SynnFlixDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState("")
  const [season, setSeason] = useState<SynnFlixSeasonDetails | null>(null)
  const [seasonLoading, setSeasonLoading] = useState(false)
  const [seasonError, setSeasonError] = useState("")
  const [player, setPlayer] = useState<PlayerState | null>(null)
  // `player` owns the iframe URL. `trackedPlayer` owns the episode identity that
  // Vidking says is actually playing. They intentionally diverge when Vidking
  // auto-advances inside the same iframe so Synnical can follow progress without
  // destroying/recreating a live provider player.
  const [trackedPlayer, setTrackedPlayer] = useState<PlayerState | null>(null)
  const trackedPlayerRef = useRef<PlayerState | null>(null)
  const autoplayFallbackTimerRef = useRef<number | null>(null)
  const lastServerProgressRef = useRef(new Map<string, number>())
  const lastProviderEventTimestampRef = useRef(new Map<string, number>())
  const [fullscreenActive, setFullscreenActive] = useState(false)
  const [mediaFeatures, setMediaFeatures] = useState<any>(null)
  const [activeParty, setActiveParty] = useState<any>(null)
  const [partyConnected, setPartyConnected] = useState(0)
  const [partyHeld, setPartyHeld] = useState(false)
  const [syncedProgress, setSyncedProgress] = useState<number | undefined>(undefined)
  const [playerRevision, setPlayerRevision] = useState(0)
  const [currentPlayerTime, setCurrentPlayerTime] = useState(0)
  const currentPlayerTimeRef = useRef(0)
  const currentPlayerDurationRef = useRef(0)
  const richPresenceStartedRef = useRef<string | null>(null)
  const [playerPlaying, setPlayerPlaying] = useState(false)
  const playerPlayingRef = useRef(false)
  const partySocketRef = useRef<Socket | null>(null)
  const [profiles, setProfiles] = useState<SynnFlixProfile[]>([])
  const [profilesLoading, setProfilesLoading] = useState(true)
  const [profileError, setProfileError] = useState("")
  const [activeProfile, setActiveProfile] = useState<SynnFlixProfile | null>(null)
  const [profilePickerOpen, setProfilePickerOpen] = useState(false)
  const [managingProfiles, setManagingProfiles] = useState(false)
  const [editingProfileId, setEditingProfileId] = useState<string | "new" | null>(null)
  const [profileName, setProfileName] = useState("")
  const [profileAvatarKey, setProfileAvatarKey] = useState(SYNNFLIX_AVATARS[0].id)
  const [profileKids, setProfileKids] = useState(false)
  const [profileFile, setProfileFile] = useState<File | null>(null)
  const [keepUploadedAvatar, setKeepUploadedAvatar] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)

  const loadProfiles = useCallback(async () => {
    if (!user?.id) {
      setProfiles([])
      setActiveProfile(null)
      setProfilesLoading(false)
      return
    }
    setProfilesLoading(true)
    setProfileError("")
    try {
      const result = await apiJson<{ profiles: SynnFlixProfile[]; lastActiveProfileId?: string }>("/api/features/media/profiles")
      setProfiles(result.profiles)
      setActiveProfile(result.profiles.find((profile) => profile.id === result.lastActiveProfileId) || result.profiles[0] || null)
      setManagingProfiles(false)
      setEditingProfileId(null)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Profiles could not load")
    } finally {
      setProfilesLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    void loadProfiles()
  }, [loadProfiles])

  const mediaAction = useCallback((action: string, payload: Record<string, unknown> = {}) => {
    if (!activeProfile?.id) return Promise.reject(new Error("Choose a SynnFlix profile first"))
    return featureApi.media.action(action, { ...payload, profileId: activeProfile.id })
  }, [activeProfile])

  const selectProfile = useCallback(async (profile: SynnFlixProfile) => {
    setProfileError("")
    try {
      await featureApi.mediaProfiles.action("select", { profileId: profile.id })
      setActiveProfile(profile)
      setMediaFeatures(null)
      lastServerProgressRef.current.clear()
      lastProviderEventTimestampRef.current.clear()
      setProfilePickerOpen(false)
      setManagingProfiles(false)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Profile could not be selected")
    }
  }, [])

  const openProfileEditor = useCallback((profile?: SynnFlixProfile) => {
    setEditingProfileId(profile?.id || "new")
    setProfileName(profile?.name || "")
    setProfileAvatarKey(profile?.avatarKey || SYNNFLIX_AVATARS[0].id)
    setProfileKids(profile?.isKids || false)
    setProfileFile(null)
    setKeepUploadedAvatar(Boolean(profile?.avatarUrl))
    setProfileError("")
  }, [])

  const saveProfile = useCallback(async () => {
    const name = profileName.trim().replace(/\s+/g, " ")
    if (!name) return setProfileError("Give this profile a name")
    setProfileSaving(true)
    setProfileError("")
    try {
      const action = editingProfileId === "new" ? "create" : "update"
      const result = await featureApi.mediaProfiles.action(action, {
        ...(editingProfileId !== "new" ? { profileId: editingProfileId } : {}),
        name,
        avatarKey: profileAvatarKey,
        isKids: profileKids,
        keepUploadedAvatar,
      }) as { profile: SynnFlixProfile }
      let saved = result.profile
      if (profileFile) {
        const form = new FormData()
        form.set("profileId", saved.id)
        form.set("file", profileFile)
        const response = await fetch("/api/features/media/profiles/upload", { method: "POST", credentials: "include", body: form })
        const uploaded = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(uploaded?.error || "Profile image upload failed")
        saved = uploaded.profile as SynnFlixProfile
      }
      setProfiles((current) => current.some((profile) => profile.id === saved.id)
        ? current.map((profile) => profile.id === saved.id ? saved : profile)
        : [...current, saved])
      setActiveProfile((current) => current?.id === saved.id ? saved : current)
      setEditingProfileId(null)
      setProfileFile(null)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Profile could not be saved")
    } finally {
      setProfileSaving(false)
    }
  }, [editingProfileId, keepUploadedAvatar, profileAvatarKey, profileFile, profileKids, profileName])

  const deleteProfile = useCallback(async (profile: SynnFlixProfile) => {
    if (!window.confirm(`Delete ${profile.name}'s profile and its SynnFlix history?`)) return
    setProfileError("")
    try {
      const result = await featureApi.mediaProfiles.action("delete", { profileId: profile.id }) as { lastActiveProfileId?: string }
      const remaining = profiles.filter((item) => item.id !== profile.id)
      setProfiles(remaining)
      if (activeProfile?.id === profile.id) {
        setActiveProfile(remaining.find((item) => item.id === result.lastActiveProfileId) || remaining[0] || null)
        setMediaFeatures(null)
      }
      setEditingProfileId(null)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Profile could not be deleted")
    }
  }, [activeProfile, profiles])

  useEffect(() => {
    const changed = () => setFullscreenActive(document.fullscreenElement === fullscreenShellRef.current)
    document.addEventListener("fullscreenchange", changed)
    changed()
    return () => document.removeEventListener("fullscreenchange", changed)
  }, [])

  const enterPlayerFullscreen = useCallback(() => {
    const shell = fullscreenShellRef.current
    if (!shell || document.fullscreenElement === shell || !shell.requestFullscreen) return
    void shell.requestFullscreen({ navigationUI: "hide" }).catch(() => {})
  }, [])

  const leavePlayerFullscreen = useCallback(() => {
    if (document.fullscreenElement === fullscreenShellRef.current) void document.exitFullscreen().catch(() => {})
  }, [])

  const refreshMediaFeatures = useCallback(async (focus?: PlayerState | null, partyId?: string | null) => {
    if (!activeProfile?.id) return
    try {
      let url = "/api/features/media"
      const params = new URLSearchParams()
      params.set("profileId", activeProfile.id)
      if (focus) {
        params.set("mediaType", focus.media.mediaType)
        params.set("mediaId", String(focus.media.id))
        if (focus.season) params.set("season", String(focus.season))
        if (focus.episode) params.set("episode", String(focus.episode))
      }
      if (partyId) params.set("partyId", partyId)
      if (params.size) url += `?${params.toString()}`
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store" })
      if (!response.ok) return
      const body = await response.json()
      setMediaFeatures(body)
    } catch {}
  }, [activeProfile])

  const loadHome = useCallback(async () => {
    setHomeLoading(true)
    setHomeError("")
    try {
      setHome(await apiJson<SynnFlixHomeData>(homeUrl))
    } catch (error) {
      setHomeError(error instanceof Error ? error.message : `${brandName} could not load`)
    } finally {
      setHomeLoading(false)
    }
  }, [brandName, homeUrl])

  useEffect(() => {
    void loadHome()
  }, [loadHome])

  useEffect(() => {
    if (activeProfile?.id && !profilePickerOpen) void refreshMediaFeatures()
  }, [activeProfile?.id, profilePickerOpen, refreshMediaFeatures])

  const openMedia = useCallback(async (item: SynnFlixMediaItem) => {
    setSelected(item)
    setDetails(null)
    setSeason(null)
    setDetailsError("")
    setSeasonError("")
    setDetailsLoading(true)
    try {
      const response = await apiJson<{ details: SynnFlixDetails }>(`/api/synnflix/details?type=${item.mediaType}&id=${item.id}`)
      setDetails(response.details)
      if (item.mediaType === "tv") {
        const initialSeason = response.details.seasons.find((entry) => entry.seasonNumber > 0) || response.details.seasons[0]
        if (initialSeason) {
          setSeasonLoading(true)
          try {
            const seasonResponse = await apiJson<{ season: SynnFlixSeasonDetails }>(`/api/synnflix/season?id=${item.id}&season=${initialSeason.seasonNumber}`)
            setSeason(seasonResponse.season)
          } catch (error) {
            setSeasonError(error instanceof Error ? error.message : "Could not load episodes")
          } finally {
            setSeasonLoading(false)
          }
        }
      }
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : "Could not load title")
    } finally {
      setDetailsLoading(false)
    }
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const item = (event as CustomEvent<SynnFlixMediaItem>).detail
      if (!item || !Number.isSafeInteger(Number(item.id)) || (item.mediaType !== "movie" && item.mediaType !== "tv")) return
      void openMedia({ ...item, id: Number(item.id) })
    }
    window.addEventListener("synnical-synnflix-open", handler)
    return () => window.removeEventListener("synnical-synnflix-open", handler)
  }, [openMedia])

  const loadSeason = useCallback(async (seriesId: number, seasonNumber: number) => {
    setSeasonLoading(true)
    setSeasonError("")
    try {
      const response = await apiJson<{ season: SynnFlixSeasonDetails }>(`/api/synnflix/season?id=${seriesId}&season=${seasonNumber}`)
      setSeason(response.season)
    } catch (error) {
      setSeason(null)
      setSeasonError(error instanceof Error ? error.message : "Could not load episodes")
    } finally {
      setSeasonLoading(false)
    }
  }, [])

  const runSearch = useCallback(async () => {
    const value = query.trim().replace(/\s+/g, " ")
    if (!value) {
      setSubmittedQuery("")
      setResults([])
      setSearchError("")
      return
    }
    setSearching(true)
    setSearchError("")
    setSubmittedQuery(value)
    try {
      const response = await apiJson<{ results: SynnFlixMediaItem[] }>(`/api/synnflix/search?q=${encodeURIComponent(value)}${animeMode ? "&mode=anime" : ""}`)
      setResults(response.results)
    } catch (error) {
      setResults([])
      setSearchError(error instanceof Error ? error.message : "Search failed")
    } finally {
      setSearching(false)
    }
  }, [animeMode, query])

  const clearSearch = () => {
    setQuery("")
    setSubmittedQuery("")
    setResults([])
    setSearchError("")
  }

  const movieGrid = useMemo(() => home ? dedupe([
    ...home.trending.filter((item) => item.mediaType === "movie"),
    ...home.popularMovies,
    ...home.topRatedMovies,
  ]) : [], [home])

  const tvGrid = useMemo(() => home ? dedupe([
    ...home.trending.filter((item) => item.mediaType === "tv"),
    ...home.popularTv,
    ...home.topRatedTv,
  ]) : [], [home])

  const hero = home?.trending.find((item) => item.backdropPath) || home?.trending[0] || null
  const continueWatching = useMemo<MediaProgressRow[]>(() => {
    const rows = Array.isArray(mediaFeatures?.progress) ? mediaFeatures.progress as MediaProgressRow[] : []
    const seen = new Set<string>()
    return [...rows]
      .filter((row) => {
        const currentTime = Number(row?.currentTime) || 0
        const duration = Number(row?.duration) || 0
        return (row?.mediaType === "movie" || row?.mediaType === "tv")
          && Number.isSafeInteger(Number(row.mediaId))
          && Number(row.mediaId) > 0
          && Boolean(String(row.title || "").trim())
          && row.completed !== true
          && currentTime >= 3
          && !(duration > 0 && currentTime >= duration * 0.92)
      })
      .sort((a, b) => Date.parse(String(b.updatedAt || 0)) - Date.parse(String(a.updatedAt || 0)))
      .filter((row) => {
        // A TV series gets one card for its most recently watched episode.
        const key = `${row.mediaType}:${row.mediaId}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 20)
  }, [mediaFeatures])

  useEffect(() => {
    trackedPlayerRef.current = player
    setTrackedPlayer(player)
    if (autoplayFallbackTimerRef.current !== null) {
      window.clearTimeout(autoplayFallbackTimerRef.current)
      autoplayFallbackTimerRef.current = null
    }
  }, [player])

  useEffect(() => {
    const focus = trackedPlayer || player
    if (focus) void refreshMediaFeatures(focus, activeParty?.id || null)
  }, [player, trackedPlayer, activeParty?.id, refreshMediaFeatures])

  useEffect(() => () => {
    if (autoplayFallbackTimerRef.current !== null) window.clearTimeout(autoplayFallbackTimerRef.current)
  }, [])

  const mergeProgressSnapshot = useCallback((focus: PlayerState, currentTime: number, duration: number, completed = false) => {
    setMediaFeatures((previous: any) => {
      const base = previous && typeof previous === "object" ? previous : { progress: [] }
      const seasonNumber = focus.season || 0
      const episodeNumber = focus.episode || 0
      const snapshot = {
        mediaType: focus.media.mediaType,
        mediaId: String(focus.media.id),
        title: focus.media.title,
        poster: focus.media.posterPath,
        backdrop: focus.media.backdropPath,
        season: seasonNumber,
        episode: episodeNumber,
        episodeName: focus.episodeName,
        currentTime,
        duration,
        completed,
        updatedAt: new Date().toISOString(),
      }
      const rows = Array.isArray(base.progress) ? base.progress : []
      const index = rows.findIndex((row: any) => row.mediaType === snapshot.mediaType
        && String(row.mediaId) === snapshot.mediaId
        && Number(row.season || 0) === seasonNumber
        && Number(row.episode || 0) === episodeNumber)
      const progress = index >= 0
        ? rows.map((row: any, rowIndex: number) => rowIndex === index ? { ...row, ...snapshot } : row)
        : [snapshot, ...rows]
      return { ...base, progress }
    })
  }, [])

  const flushPlaybackProgress = useCallback((reason: "hidden" | "pagehide" | "blur" | "close") => {
    const focus = trackedPlayerRef.current || player
    const second = Math.floor(currentPlayerTimeRef.current)
    if (!focus || second < 3) return
    const duration = Math.max(0, Math.floor(currentPlayerDurationRef.current))
    if (!activeProfile?.id) return
    writeProgress(focus, activeProfile.id, second)
    mergeProgressSnapshot(focus, second, duration)
    const body = JSON.stringify({
      action: "progress", profileId: activeProfile.id, mediaType: focus.media.mediaType, mediaId: String(focus.media.id), title: focus.media.title,
      poster: focus.media.posterPath, backdrop: focus.media.backdropPath, season: focus.season, episode: focus.episode,
      episodeName: focus.episodeName, currentTime: second, duration, activePlayback: playerPlayingRef.current, flushReason: reason,
    })
    void fetch("/api/features/media", { method: "POST", credentials: "include", keepalive: true, headers: { "Content-Type": "application/json" }, body })
      .then((response) => { if (response.ok && reason === "close") void refreshMediaFeatures(null, activeParty?.id || null) })
      .catch(() => {})
  }, [activeParty?.id, activeProfile, mergeProgressSnapshot, player, refreshMediaFeatures])

  useEffect(() => {
    flushPlaybackProgressRef.current = flushPlaybackProgress
  }, [flushPlaybackProgress])

  // App windows can be closed by the desktop shell without using SynnFlix's
  // own Back button. Persist the last player timestamp during that unmount too.
  useEffect(() => () => {
    flushPlaybackProgressRef.current("close")
  }, [])

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") flushPlaybackProgress("hidden") }
    const onPageHide = () => flushPlaybackProgress("pagehide")
    const onBlur = () => flushPlaybackProgress("blur")
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", onPageHide)
    window.addEventListener("blur", onBlur)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", onPageHide)
      window.removeEventListener("blur", onBlur)
    }
  }, [flushPlaybackProgress])

  useEffect(() => {
    const focus = trackedPlayer || player
    if (!focus || !playerPlaying) {
      richPresenceStartedRef.current = null
      window.dispatchEvent(new CustomEvent("synnical-rich-presence", { detail: { source: "synnflix", activity: null } }))
      return
    }
    if (!richPresenceStartedRef.current) richPresenceStartedRef.current = new Date().toISOString()
    window.dispatchEvent(new CustomEvent("synnical-rich-presence", { detail: { source: "synnflix", activity: {
      kind: "watching", name: focus.media.title,
      details: focus.media.mediaType === "tv" ? `Season ${focus.season} · Episode ${focus.episode}` : "Movie",
      state: focus.episodeName || null, artwork: focus.media.posterPath || focus.media.backdropPath || null,
      startedAt: richPresenceStartedRef.current,
    } } }))
    return () => { window.dispatchEvent(new CustomEvent("synnical-rich-presence", { detail: { source: "synnflix", activity: null } })) }
  }, [player, trackedPlayer, playerPlaying])

  useEffect(() => {
    if (!player) return
    const handleMessage = (event: MessageEvent) => {
      // Vidking can relay PLAYER_EVENT from a nested provider frame, whose
      // origin and source are not necessarily the top-level vidking iframe.
      // Reject same-window messages, then authenticate the message against the
      // exact active media identity and documented event schema below.
      if (event.source === window) return
      const data = vidkingEventData(event.data)
      if (!data) return
      if (String(data.id ?? "") !== String(player.media.id)) return
      const reportedMediaType = String(data.mediaType ?? data.type ?? "").toLowerCase()
      if (reportedMediaType !== player.media.mediaType) return
      const eventName = String(data.event ?? "").toLowerCase()
      if (!["timeupdate", "play", "pause", "ended", "seeked"].includes(eventName)) return
      let eventPlayer: PlayerState = player
      if (player.media.mediaType === "tv") {
        const eventSeason = Number(data.season)
        const eventEpisode = Number(data.episode)
        if (!Number.isSafeInteger(eventSeason) || eventSeason < 1 || !Number.isSafeInteger(eventEpisode) || eventEpisode < 1) return
        const knownEpisodeName = season?.seasonNumber === eventSeason
          ? season.episodes.find((item) => item.episodeNumber === eventEpisode)?.name || null
          : null
        eventPlayer = {
          media: player.media,
          season: eventSeason,
          episode: eventEpisode,
          episodeName: knownEpisodeName
            || (trackedPlayerRef.current?.season === eventSeason && trackedPlayerRef.current?.episode === eventEpisode ? trackedPlayerRef.current.episodeName : null)
            || `Episode ${eventEpisode}`,
        }
        const trackedIdentity = trackedPlayerRef.current ? playerIdentity(trackedPlayerRef.current) : null
        if (trackedIdentity !== playerIdentity(eventPlayer)) {
          trackedPlayerRef.current = eventPlayer
          setTrackedPlayer(eventPlayer)
          setCurrentPlayerTime(0)
          currentPlayerTimeRef.current = 0
          setSyncedProgress(undefined)
        }
      } else if (trackedPlayerRef.current !== player) {
        trackedPlayerRef.current = player
        setTrackedPlayer(player)
      }
      const duration = Number(data.duration)
      if (Number.isFinite(duration) && duration > 0) currentPlayerDurationRef.current = duration
      const directTime = Number(data.currentTime)
      const progressPercent = Number(data.progress)
      const providerTimestamp = Number(data.timestamp)
      const legacyTimestampSeconds = Number.isFinite(providerTimestamp)
        && providerTimestamp >= 0
        && providerTimestamp < 100_000_000
        && (!(duration > 0) || providerTimestamp <= duration + 60)
        ? providerTimestamp
        : NaN
      const currentTime = Number.isFinite(directTime) && directTime >= 0
        ? directTime
        : Number.isFinite(legacyTimestampSeconds)
          ? legacyTimestampSeconds
        : Number.isFinite(duration) && duration > 0 && Number.isFinite(progressPercent) && progressPercent >= 0 && progressPercent <= 100
          ? duration * (progressPercent / 100)
          : NaN
      if (!Number.isFinite(currentTime) || currentTime < 0) return
      const identity = playerIdentity(eventPlayer)
      if (Number.isFinite(providerTimestamp) && providerTimestamp >= 100_000_000_000) {
        const lastTimestamp = lastProviderEventTimestampRef.current.get(identity) || 0
        if (providerTimestamp < lastTimestamp) return
        lastProviderEventTimestampRef.current.set(identity, providerTimestamp)
      }
      const playingNow = eventName === "play" || eventName === "timeupdate"
        ? true
        : eventName === "pause" || eventName === "ended"
          ? false
          : playerPlayingRef.current
      playerPlayingRef.current = playingNow
      setPlayerPlaying(playingNow)
      setCurrentPlayerTime(currentTime)
      currentPlayerTimeRef.current = currentTime
      if (activeParty?.id && activeParty.hostId === mediaFeatures?.meId) {
        partySocketRef.current?.emit("watch-party-state", { partyId: activeParty.id, currentTime, playing: playingNow, season: eventPlayer.season, episode: eventPlayer.episode })
      }
      if (eventName === "ended") {
        const credibleDuration = Number.isFinite(duration) && duration > 0 ? duration : currentPlayerDurationRef.current
        const genuinelyCompleted = credibleDuration > 0 && currentTime >= credibleDuration * 0.92
        if (!genuinelyCompleted) {
          // Provider ad/pop-under navigation can tear down a nested playback frame
          // and surface an early `ended` event. That is an interruption, not the
          // end of the movie/episode. Preserve ordinary playback progress instead of
          // falsely marking the title complete.
          if (currentTime >= 3) {
            if (activeProfile?.id) writeProgress(eventPlayer, activeProfile.id, currentTime)
            void mediaAction("progress", { mediaType: eventPlayer.media.mediaType, mediaId: String(eventPlayer.media.id), title: eventPlayer.media.title, poster: eventPlayer.media.posterPath, backdrop: eventPlayer.media.backdropPath, season: eventPlayer.season, episode: eventPlayer.episode, episodeName: eventPlayer.episodeName, currentTime: Math.floor(currentTime), duration: credibleDuration, activePlayback: false }).catch(() => {})
          }
          return
        }
        void mediaAction("progress", { mediaType: eventPlayer.media.mediaType, mediaId: String(eventPlayer.media.id), title: eventPlayer.media.title, poster: eventPlayer.media.posterPath, backdrop: eventPlayer.media.backdropPath, season: eventPlayer.season, episode: eventPlayer.episode, episodeName: eventPlayer.episodeName, currentTime, duration: credibleDuration, completed: true }).catch(() => {})
        if (activeProfile?.id) clearProgress(eventPlayer, activeProfile.id)
        lastServerProgressRef.current.delete(identity)
        if (eventPlayer.media.mediaType === "tv" && mediaFeatures?.preference?.episodeAutoplay) {
          // Vidking has nextEpisode enabled and may advance inside this exact
          // iframe. Give the provider first chance; only remount as a fallback
          // if no valid event for a different episode arrives shortly after end.
          void (async () => {
            try {
              const loaded = season?.seasonNumber === eventPlayer.season
                ? season
                : (await apiJson<{ season: SynnFlixSeasonDetails }>(`/api/synnflix/season?id=${eventPlayer.media.id}&season=${eventPlayer.season || 1}`)).season
              const next = loaded.episodes.find((episode) => episode.episodeNumber === Number(eventPlayer.episode || 0) + 1)
              if (!next) return
              if (autoplayFallbackTimerRef.current !== null) window.clearTimeout(autoplayFallbackTimerRef.current)
              const endedIdentity = identity
              autoplayFallbackTimerRef.current = window.setTimeout(() => {
                autoplayFallbackTimerRef.current = null
                const tracked = trackedPlayerRef.current
                if (tracked && playerIdentity(tracked) !== endedIdentity) return
                setSyncedProgress(undefined)
                setPartyHeld(false)
                setPlayer({ media: eventPlayer.media, season: next.seasonNumber, episode: next.episodeNumber, episodeName: next.name })
              }, 3000)
            } catch {}
          })()
        }
        return
      }

      if (currentTime < 3) return
      if (activeProfile?.id) writeProgress(eventPlayer, activeProfile.id, currentTime)
      const second = Math.floor(currentTime)
      const lastServer = lastServerProgressRef.current.get(identity) ?? -30
      if (eventName !== "timeupdate" || second - lastServer >= 15) {
        lastServerProgressRef.current.set(identity, second)
        mergeProgressSnapshot(eventPlayer, second, Number.isFinite(duration) && duration > 0 ? duration : currentPlayerDurationRef.current)
        void mediaAction("progress", { mediaType: eventPlayer.media.mediaType, mediaId: String(eventPlayer.media.id), title: eventPlayer.media.title, poster: eventPlayer.media.posterPath, backdrop: eventPlayer.media.backdropPath, season: eventPlayer.season, episode: eventPlayer.episode, episodeName: eventPlayer.episodeName, currentTime: second, duration: Number.isFinite(duration) && duration > 0 ? duration : 0, activePlayback: playingNow }).catch(() => {})
      }
    }
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [player, activeParty, activeProfile?.id, mediaAction, mediaFeatures?.meId, mediaFeatures?.preference?.episodeAutoplay, mergeProgressSnapshot, season])

  useEffect(() => {
    const current = trackedPlayer || player
    if (!current || typeof window === "undefined") return
    const context = { mediaType: current.media.mediaType, mediaId: String(current.media.id), title: current.media.title, season: current.season, episode: current.episode, episodeName: current.episodeName, updatedAt: Date.now() }
    try { localStorage.setItem("synnical:synnflix:last-context", JSON.stringify(context)) } catch {}
    window.dispatchEvent(new CustomEvent("synnical-media-context", { detail: context }))
  }, [player, trackedPlayer])

	  const prepareFreshPlayer = useCallback(() => {
	    playerPlayingRef.current = false
	    setPlayerPlaying(false)
    trackedPlayerRef.current = null
    setTrackedPlayer(null)
    currentPlayerTimeRef.current = 0
    setCurrentPlayerTime(0)
    currentPlayerDurationRef.current = 0
	    lastProviderEventTimestampRef.current.clear()
	  }, [])

  const startMovie = async (item: SynnFlixMediaItem) => {
    const exact = mediaFeatures?.progress?.find((row: any) => row.mediaType === "movie" && String(row.mediaId) === String(item.id) && Number(row.season || 0) === 0 && Number(row.episode || 0) === 0)
    const replayingCompleted = exact?.completed === true
    if (replayingCompleted) {
      await mediaAction("reset-progress", { mediaType: "movie", mediaId: String(item.id), season: 0, episode: 0 }).catch(() => {})
      if (activeProfile?.id) clearProgress({ media: item, season: null, episode: null, episodeName: null }, activeProfile.id)
    }
    enterPlayerFullscreen()
    prepareFreshPlayer()
    setSyncedProgress(replayingCompleted ? undefined : exact ? resumeStartSeconds(exact.currentTime) : undefined)
    setPartyHeld(false)
    setPlayerRevision((value) => value + 1)
    setPlayer({ media: item, season: null, episode: null, episodeName: null })
    if (replayingCompleted) void refreshMediaFeatures(null, null)
  }
  const startEpisode = async (item: SynnFlixMediaItem, episode: SynnFlixEpisode) => {
    const exact = mediaFeatures?.progress?.find((row: any) => row.mediaType === "tv" && String(row.mediaId) === String(item.id) && Number(row.season || 0) === episode.seasonNumber && Number(row.episode || 0) === episode.episodeNumber)
    const replayingCompleted = exact?.completed === true
    if (replayingCompleted) {
      await mediaAction("reset-progress", { mediaType: "tv", mediaId: String(item.id), season: episode.seasonNumber, episode: episode.episodeNumber }).catch(() => {})
      if (activeProfile?.id) clearProgress({ media: item, season: episode.seasonNumber, episode: episode.episodeNumber, episodeName: episode.name }, activeProfile.id)
    }
    enterPlayerFullscreen()
    prepareFreshPlayer()
    setSyncedProgress(replayingCompleted ? undefined : exact ? resumeStartSeconds(exact.currentTime) : undefined)
    setPartyHeld(false)
    setPlayerRevision((value) => value + 1)
    setPlayer({
      media: item,
      season: episode.seasonNumber,
      episode: episode.episodeNumber,
      episodeName: episode.name,
    })
    if (replayingCompleted) void refreshMediaFeatures(null, null)
  }

  const resumeContinueWatching = useCallback((row: MediaProgressRow) => {
    const media = progressMedia(row)
    enterPlayerFullscreen()
    prepareFreshPlayer()
    setSyncedProgress(resumeStartSeconds(row.currentTime))
    setPartyHeld(false)
    setPlayerRevision((value) => value + 1)
    setPlayer({
      media,
      season: row.mediaType === "tv" ? Math.max(1, Number(row.season) || 1) : null,
      episode: row.mediaType === "tv" ? Math.max(1, Number(row.episode) || 1) : null,
      episodeName: row.mediaType === "tv" ? String(row.episodeName || "") || null : null,
    })
  }, [enterPlayerFullscreen, prepareFreshPlayer])

  const removeContinueWatching = useCallback((row: MediaProgressRow) => {
    const seasonNumber = Number(row.season) || 0
    const episodeNumber = Number(row.episode) || 0
    const state: PlayerState = {
      media: progressMedia(row),
      season: row.mediaType === "tv" ? seasonNumber : null,
      episode: row.mediaType === "tv" ? episodeNumber : null,
      episodeName: row.episodeName || null,
    }
    if (activeProfile?.id) clearProgress(state, activeProfile.id)
    setMediaFeatures((previous: any) => previous ? {
      ...previous,
      progress: Array.isArray(previous.progress)
        ? previous.progress.filter((candidate: any) => !(candidate.mediaType === row.mediaType && String(candidate.mediaId) === String(row.mediaId) && Number(candidate.season || 0) === seasonNumber && Number(candidate.episode || 0) === episodeNumber))
        : [],
    } : previous)
    void mediaAction("reset-progress", {
      mediaType: row.mediaType,
      mediaId: String(row.mediaId),
      season: seasonNumber,
      episode: episodeNumber,
    }).then(() => refreshMediaFeatures(null, null)).catch(() => {
      toast.error("Could not remove that title from Continue Watching")
      void refreshMediaFeatures(null, null)
    })
  }, [activeProfile, mediaAction, refreshMediaFeatures])

  const activePlaybackPlayer = trackedPlayer || player

  const toggleMediaList = useCallback(async (item: SynnFlixMediaItem, kind: "watchlist" | "favorite", listId?: string) => {
    await mediaAction("toggle-item", { kind, listId, mediaType: item.mediaType, mediaId: String(item.id), title: item.title, poster: item.posterPath })
    await refreshMediaFeatures(player, activeParty?.id || null)
  }, [player, activeParty?.id, mediaAction, refreshMediaFeatures])

  const mediaListActive = useCallback((item: SynnFlixMediaItem, kind: "watchlist" | "favorite") => Boolean(mediaFeatures?.lists?.some((list: any) => list.kind === kind && list.items?.some((entry: any) => entry.mediaType === item.mediaType && String(entry.mediaId) === String(item.id)))), [mediaFeatures])

  const createCustomListFor = useCallback(async (item: SynnFlixMediaItem) => {
    const name = window.prompt("Custom list name")?.trim()
    if (!name) return
    const created = await mediaAction("create-list", { kind: "custom", name })
    if (created?.list?.id) await toggleMediaList(item, "watchlist", created.list.id)
  }, [mediaAction, toggleMediaList])

  const rateCurrent = useCallback(async (item: SynnFlixMediaItem) => {
    const existing = mediaFeatures?.ratings?.find((row: any) => row.mediaType === item.mediaType && String(row.mediaId) === String(item.id))
    const raw = window.prompt("Rate 1-10", existing?.rating ? String(existing.rating) : "8")
    if (!raw) return
    const rating = Number(raw)
    if (!Number.isInteger(rating) || rating < 1 || rating > 10) return window.alert("Rating must be a whole number from 1 to 10")
    const review = window.prompt("Optional review", existing?.review || "") ?? existing?.review ?? ""
    await mediaAction("rate", { mediaType: item.mediaType, mediaId: String(item.id), rating, review })
    await refreshMediaFeatures(player, activeParty?.id || null)
  }, [mediaFeatures, player, activeParty?.id, mediaAction, refreshMediaFeatures])

  const createParty = useCallback(async () => {
    if (!activePlaybackPlayer) return
    const result = await mediaAction("create-party", { mediaType: activePlaybackPlayer.media.mediaType, mediaId: String(activePlaybackPlayer.media.id), title: activePlaybackPlayer.media.title, season: activePlaybackPlayer.season, episode: activePlaybackPlayer.episode, currentTime: currentPlayerTime, playing: playerPlayingRef.current })
    if (result?.party) {
      setActiveParty(result.party)
      await refreshMediaFeatures(activePlaybackPlayer, result.party.id)
      const inviteCode = String(result.party.id)
      try {
        await navigator.clipboard.writeText(inviteCode)
        toast.success("Watch party ready. Invite code copied. Send it to the person you want to watch with.")
      } catch {
        window.alert(`Watch party ready. Send this invite code to the person you want to watch with:\n${inviteCode}`)
      }
    }
  }, [activePlaybackPlayer, currentPlayerTime, mediaAction, refreshMediaFeatures])

  const copyPartyInvite = useCallback(async () => {
    if (!activeParty?.id) return
    try {
      await navigator.clipboard.writeText(String(activeParty.id))
      toast.success("Invite code copied. Send it to the person you want to watch with.")
    } catch {
      window.alert(`Send this watch party invite code to the person you want to watch with:\n${activeParty.id}`)
    }
  }, [activeParty])

  const joinParty = useCallback(async (id?: string) => {
    const partyId = id || window.prompt("Paste the watch party invite code")?.trim()
    if (!partyId) return
    const result = await mediaAction("join-party", { partyId })
    const party = result?.party
    if (!party) return
    setActiveParty(party)
    const detailsResponse = await apiJson<{ details: SynnFlixDetails }>(`/api/synnflix/details?type=${party.mediaType}&id=${party.mediaId}`)
    const media = detailsResponse.details
    playerPlayingRef.current = false
    setPlayerPlaying(false)
    setPartyHeld(!party.playing)
    setSyncedProgress(Math.max(0, Number(party.currentTime) || 0))
    setPlayerRevision((value) => value + 1)
    setPlayer({ media, season: party.season || null, episode: party.episode || null, episodeName: null })
    await refreshMediaFeatures({ media, season: party.season || null, episode: party.episode || null, episodeName: null }, party.id)
  }, [mediaAction, refreshMediaFeatures])

  useEffect(() => { currentPlayerTimeRef.current = currentPlayerTime }, [currentPlayerTime])

  // Keep the provider URL stable while playback advances. readProgress() reads
  // localStorage; rebuilding this URL on every timeupdate changes the iframe key
  // and restarts playback. Recompute only for an intentional player/sync change.
  const playerUrl = useMemo(
    () => player && activeProfile?.id ? buildPlayerUrl(player, activeProfile.id, { progress: syncedProgress, autoplay: true }) : "",
    [activeProfile, player, syncedProgress],
  )

  useEffect(() => {
    if (!activeParty?.id) return
    const socket = io(window.location.origin, { path: "/socket.io", transports: ["websocket", "polling"], withCredentials: true })
    partySocketRef.current = socket
    socket.on("connect", () => socket.emit("join-watch-party", { partyId: activeParty.id }))
    socket.on("watch-party-presence", (data: any) => { if (data?.partyId === activeParty.id) setPartyConnected(Number(data.connected) || 0) })
    socket.on("watch-party-state", (state: any) => {
      if (!state || state.id !== activeParty.id || activeParty.hostId === mediaFeatures?.meId) return
      setActiveParty((previous: any) => previous ? { ...previous, ...state } : state)
      const target = Math.max(0, Number(state.currentTime) || 0)
      setPartyHeld(!state.playing)
      // The provider does not document a parent-window play/pause command.
      // Party updates therefore never unmount or rewrite the iframe. A guest can
      // explicitly sync to the host without Synnical stealing the Play button.
      if (Math.abs(currentPlayerTimeRef.current - target) > 15) setActiveParty((previous: any) => previous ? { ...previous, needsSync: true } : previous)
    })
    socket.on("watch-party-error", (data: any) => window.alert(data?.error || "Watch party error"))
    return () => { socket.emit("leave-watch-party", { partyId: activeParty.id }); socket.removeAllListeners(); socket.disconnect(); if (partySocketRef.current === socket) partySocketRef.current = null }
  }, [activeParty?.id, activeParty?.hostId, mediaFeatures?.meId])

  const addPrivateJournal = async (media: SynnFlixMediaItem) => {
    const note = window.prompt(`Private journal note for ${media.title}`)?.trim()
    if (!note) return
    await mediaAction("add-journal", { mediaType: media.mediaType, mediaId: String(media.id), title: media.title, note })
    await refreshMediaFeatures(player, activeParty?.id || null)
    toast.success("Journal note saved")
  }

  const predictRating = async (media: SynnFlixMediaItem, seasonNumber?: number | null, episodeNumber?: number | null) => {
    const raw = window.prompt("Your prediction before watching (1–10)")
    if (!raw) return
    const ratingPrediction = Math.max(1, Math.min(10, Number(raw)))
    if (!Number.isFinite(ratingPrediction)) return toast.error("Enter a rating from 1 to 10")
    await mediaAction("progress", { mediaType: media.mediaType, mediaId: String(media.id), title: media.title, poster: media.posterPath, backdrop: media.backdropPath, season: seasonNumber || 0, episode: episodeNumber || 0, ratingPrediction })
    await refreshMediaFeatures(player, activeParty?.id || null)
    toast.success("Prediction saved")
  }

  const addSceneNote = async () => {
    if (!activePlaybackPlayer) return
    const note = window.prompt(`Scene note at ${Math.floor(currentPlayerTime / 60)}:${String(Math.floor(currentPlayerTime % 60)).padStart(2, "0")}`)?.trim()
    if (!note) return
    await mediaAction("add-scene-note", { mediaType: activePlaybackPlayer.media.mediaType, mediaId: String(activePlaybackPlayer.media.id), title: activePlaybackPlayer.media.title, timestamp: currentPlayerTime, season: activePlaybackPlayer.season, episode: activePlaybackPlayer.episode, note })
    await refreshMediaFeatures(activePlaybackPlayer, activeParty?.id || null)
    toast.success("Scene note saved")
  }

  const restartCurrentPlayer = async () => {
    if (!activePlaybackPlayer) return
    const identity = playerIdentity(activePlaybackPlayer)
    if (activeProfile?.id) clearProgress(activePlaybackPlayer, activeProfile.id)
    lastServerProgressRef.current.delete(identity)
    await mediaAction("reset-progress", {
      mediaType: activePlaybackPlayer.media.mediaType,
      mediaId: String(activePlaybackPlayer.media.id),
      season: activePlaybackPlayer.season || 0,
      episode: activePlaybackPlayer.episode || 0,
    }).catch(() => {})
    currentPlayerTimeRef.current = 1
    setCurrentPlayerTime(1)
    setSyncedProgress(undefined)
    setPlayerRevision((value) => value + 1)
    trackedPlayerRef.current = null
    setTrackedPlayer(null)
    playerPlayingRef.current = false
    setPlayerPlaying(false)
    // If Vidking auto-advanced inside the iframe, restart the exact episode the
    // user is currently watching by intentionally remounting that episode.
    if (playerIdentity(activePlaybackPlayer) !== playerIdentity(player!)) setPlayer(activePlaybackPlayer)
    void refreshMediaFeatures(activePlaybackPlayer, activeParty?.id || null)
  }

  const createBingo = async (media: SynnFlixMediaItem) => {
    const defaults = ["Unexpected betrayal", "Someone says the title", "Dramatic entrance", "Plot twist", "Awkward silence", "Big reveal", "Running scene", "Callback", "Post-credit tease"]
    await mediaAction("save-bingo", { mediaType: media.mediaType, mediaId: String(media.id), title: `${media.title} bingo`, cells: defaults.map((label) => ({ label, checked: false })) })
    await refreshMediaFeatures(player, activeParty?.id || null)
    toast.success("Movie bingo card created")
  }

  if (profilePickerOpen || !activeProfile) {
    const editingProfile = editingProfileId && editingProfileId !== "new"
      ? profiles.find((profile) => profile.id === editingProfileId) || null
      : null
    return (
      <section className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#030303] text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_25%,rgba(255,255,255,0.08),transparent_42%)]" />
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-8 sm:px-8 sm:py-12">
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
            <div className="mb-8 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-black"><Clapperboard className="h-5 w-5" /></span>
                <div><strong className="block text-xl">{brandName}</strong><span className="text-xs text-white/38">Profiles sync with your Synnical account</span></div>
              </div>
              {!editingProfileId && profiles.length ? (
                <button type="button" onClick={() => setManagingProfiles((value) => !value)} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/65 hover:border-white/35 hover:text-white">
                  <Pencil className="mr-1.5 inline h-3.5 w-3.5" />{managingProfiles ? "Done" : "Manage profiles"}
                </button>
              ) : null}
            </div>

            {profilesLoading ? (
              <div className="grid flex-1 place-items-center py-24"><div className="text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-white/55" /><p className="mt-4 text-sm text-white/45">Loading your profiles…</p></div></div>
            ) : editingProfileId ? (
              <div className="mx-auto w-full max-w-3xl rounded-2xl border border-white/10 bg-white/[0.035] p-5 shadow-2xl sm:p-7">
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">{editingProfileId === "new" ? "New profile" : "Edit profile"}</p><h1 className="mt-1 text-2xl font-semibold">Make it yours</h1></div>
                  <button type="button" onClick={() => { setEditingProfileId(null); setProfileFile(null); setProfileError("") }} className="rounded-lg p-2 text-white/45 hover:bg-white/8 hover:text-white" aria-label="Close profile editor"><X className="h-5 w-5" /></button>
                </div>
                <label className="block text-xs font-medium text-white/60">Profile name
                  <input value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={24} autoFocus className="mt-2 h-11 w-full rounded-xl border border-white/12 bg-black/55 px-3 text-sm text-white outline-none focus:border-white/40" placeholder="Name" />
                </label>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {editingProfile ? <ProfileAvatar profile={{ ...editingProfile, name: profileName, avatarKey: profileAvatarKey, avatarUrl: keepUploadedAvatar ? editingProfile.avatarUrl : null }} className="h-16 w-16" /> : <ProfileAvatar profile={{ id: "preview", name: profileName || "Profile", avatarKey: profileAvatarKey, avatarUrl: null, isKids: profileKids }} className="h-16 w-16" />}
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/70 hover:border-white/30 hover:text-white">
                    <Upload className="h-3.5 w-3.5" />Upload your image
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" onChange={(event) => { setProfileFile(event.target.files?.[0] || null); if (event.target.files?.[0]) setKeepUploadedAvatar(true) }} />
                  </label>
                  {profileFile ? <span className="max-w-[240px] truncate text-xs text-emerald-300/75">{profileFile.name}</span> : null}
                </div>
                <div className="mt-6">
                  <div className="mb-3 flex items-center justify-between"><span className="text-xs font-medium text-white/60">Choose from 100 avatars</span><span className="text-[10px] text-white/28">Your upload overrides this choice</span></div>
                  <div className="grid max-h-[250px] grid-cols-5 gap-2 overflow-y-auto rounded-xl border border-white/8 bg-black/35 p-3 sm:grid-cols-10">
                    {SYNNFLIX_AVATARS.map((avatar) => (
                      <button key={avatar.id} type="button" onClick={() => { setProfileAvatarKey(avatar.id); setProfileFile(null); setKeepUploadedAvatar(false) }} className={`aspect-square rounded-full p-0.5 transition hover:scale-105 ${profileAvatarKey === avatar.id && !keepUploadedAvatar ? "ring-2 ring-white ring-offset-2 ring-offset-black" : "ring-1 ring-white/10"}`} aria-label={`Choose avatar ${avatar.id}`}>
                        <span
                          aria-hidden="true"
                          className="block h-full w-full rounded-full bg-black bg-no-repeat"
                          style={{
                            backgroundImage: `url(${SYNNFLIX_AVATAR_SPRITE})`,
                            backgroundSize: "1000% 1000%",
                            backgroundPosition: `${avatar.column * (100 / 9)}% ${avatar.row * (100 / 9)}%`,
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </div>
                <label className="mt-5 flex items-center gap-2 text-xs text-white/60"><input type="checkbox" checked={profileKids} onChange={(event) => setProfileKids(event.target.checked)} />Kids profile</label>
                {profileError ? <p role="alert" className="mt-4 rounded-lg border border-rose-300/15 bg-rose-300/5 px-3 py-2 text-xs text-rose-200">{profileError}</p> : null}
                <div className="mt-6 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => void saveProfile()} disabled={profileSaving || !profileName.trim()} className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-40">{profileSaving ? <><Loader2 className="mr-1.5 inline h-4 w-4 animate-spin" />Saving…</> : "Save profile"}</button>
                  <button type="button" onClick={() => setEditingProfileId(null)} className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-white/65">Cancel</button>
                  {editingProfile && profiles.length > 1 ? <button type="button" onClick={() => void deleteProfile(editingProfile)} className="ml-auto rounded-lg border border-rose-300/20 px-3 py-2.5 text-xs text-rose-200"><Trash2 className="mr-1.5 inline h-3.5 w-3.5" />Delete profile</button> : null}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
                <UserRound className="h-8 w-8 text-white/22" />
                <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Who&apos;s watching?</h1>
                <p className="mt-2 text-sm text-white/42">Each profile has its own Continue Watching, lists and ratings.</p>
                {profileError ? <div role="alert" className="mt-5 rounded-xl border border-rose-300/15 bg-rose-300/5 px-4 py-3 text-sm text-rose-200">{profileError}<button type="button" onClick={() => void loadProfiles()} className="ml-3 underline">Retry</button></div> : null}
                <div className="mt-9 flex max-w-4xl flex-wrap justify-center gap-x-7 gap-y-8">
                  {profiles.map((profile) => (
                    <button key={profile.id} type="button" onClick={() => managingProfiles ? openProfileEditor(profile) : void selectProfile(profile)} className="group relative w-28 text-center sm:w-32">
                      <span className="relative mx-auto block w-fit transition duration-200 group-hover:-translate-y-1 group-hover:scale-105">
                        <ProfileAvatar profile={profile} className="h-24 w-24 sm:h-28 sm:w-28" />
                        {managingProfiles ? <span className="absolute inset-0 grid place-items-center rounded-full bg-black/55"><Pencil className="h-6 w-6" /></span> : null}
                      </span>
                      <strong className="mt-3 block truncate text-sm font-medium text-white/65 group-hover:text-white">{profile.name}</strong>
                      {profile.isKids ? <span className="mt-1 inline-block rounded bg-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-white/45">Kids</span> : null}
                    </button>
                  ))}
                  {profiles.length < SYNNFLIX_PROFILE_LIMIT ? (
                    <button type="button" onClick={() => openProfileEditor()} className="group w-28 text-center sm:w-32">
                      <span className="mx-auto grid h-24 w-24 place-items-center rounded-full border-2 border-dashed border-white/18 text-white/35 transition group-hover:border-white/45 group-hover:text-white sm:h-28 sm:w-28"><Plus className="h-8 w-8" /></span>
                      <strong className="mt-3 block text-sm font-medium text-white/45 group-hover:text-white">Add profile</strong>
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    )
  }

  if (player) {
    const displayPlayer = activePlaybackPlayer || player
    return (
      <section ref={fullscreenShellRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-black text-white">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 bg-black px-3 sm:px-4">
          <button type="button" onClick={() => { flushPlaybackProgress("close"); leavePlayerFullscreen(); setPlayer(null) }} className="rounded-lg p-2 text-white/60 hover:bg-white/8 hover:text-white" aria-label={`Back to ${brandName}`}>
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Clapperboard className="h-4 w-4" />
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-sm font-medium">{displayPlayer.media.title}</strong>
            {displayPlayer.episodeName ? <span className="block truncate text-[11px] text-white/42">S{displayPlayer.season} E{displayPlayer.episode} · {displayPlayer.episodeName}</span> : null}
          </div>
          {activeParty ? <span className="text-[10px] text-cyan-300">Party · {partyConnected} connected</span> : null}
          {activeParty ? <button type="button" onClick={() => void copyPartyInvite()} className="rounded border border-white/15 px-2 py-1 text-[10px]"><Copy className="mr-1 inline h-3 w-3" />Copy invite</button> : null}
          {!activeParty ? <button type="button" onClick={() => void createParty()} className="rounded border border-white/15 px-2 py-1 text-[10px]"><Users className="mr-1 inline h-3 w-3" />Start party</button> : null}
          <button type="button" onClick={() => fullscreenActive ? leavePlayerFullscreen() : enterPlayerFullscreen()} className="rounded border border-white/15 px-2 py-1 text-[10px]">{fullscreenActive ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}</button>
          <span className="hidden text-[11px] text-white/35 sm:block">{brandName} Player</span>
        </header>
        <div className="relative min-h-0 w-full flex-1 bg-black">
          <VidkingPlayerFrame
            key={`${playerRevision}:${playerUrl}`}
            src={playerUrl}
            title={`${displayPlayer.media.title} — ${brandName}`}
            playerFrameRef={playerFrameRef}
          />
        </div>
        {activeParty && activeParty.hostId !== mediaFeatures?.meId ? <div className="flex items-center gap-2 border-t border-white/10 bg-[#080808] px-3 py-2 text-[11px] text-white/55"><span>{partyHeld ? "Host is paused" : "Party is playing"}</span>{activeParty.needsSync ? <button type="button" className="rounded border border-white/15 px-2 py-1 text-white/80" onClick={() => { setSyncedProgress(Math.max(0, Number(activeParty.currentTime) || 0)); setPlayerRevision((value) => value + 1); setActiveParty((previous: any) => previous ? { ...previous, needsSync: false } : previous) }}>Sync to host</button> : null}</div> : null}
        <div className="flex flex-wrap gap-2 border-t border-white/10 p-3">
          {mediaFeatures?.introMarker && mediaFeatures?.preference?.skipIntroEnabled && currentPlayerTime >= Number(mediaFeatures.introMarker.startSeconds || 0) && currentPlayerTime < Number(mediaFeatures.introMarker.endSeconds || 0) ? <button type="button" className="rounded bg-white px-3 py-1.5 text-xs font-semibold text-black" onClick={() => { setSyncedProgress(Number(mediaFeatures.introMarker.endSeconds)); setPlayerRevision((value) => value + 1) }}>Skip intro</button> : null}
          {activeParty ? <button type="button" className="rounded border border-white/15 px-3 py-1.5 text-xs" onClick={async () => { await mediaAction("leave-party", { partyId: activeParty.id }); setActiveParty(null); setPartyHeld(false); setPartyConnected(0) }}>Leave party</button> : null}
          <button type="button" className="rounded border border-white/15 px-3 py-1.5 text-xs" onClick={() => void restartCurrentPlayer()}><RotateCcw className="mr-1 inline h-3 w-3" />Restart from beginning</button>
          <button type="button" className="rounded border border-white/15 px-3 py-1.5 text-xs" onClick={() => {
            const progress = Math.max(0, currentPlayerTimeRef.current)
            setSyncedProgress(progress)
            if (playerIdentity(displayPlayer) !== playerIdentity(player)) setPlayer(displayPlayer)
            else setPlayerRevision((value) => value + 1)
          }}>Reload player</button>
          <span className="self-center text-[10px] text-white/35">{playerPlaying ? "Playing" : "Paused"}</span>
          <label className="ml-auto flex items-center gap-2 text-xs text-white/55"><input type="checkbox" checked={mediaFeatures?.preference?.episodeAutoplay !== false} onChange={async (event) => { await mediaAction("set-preference", { episodeAutoplay: event.target.checked }); await refreshMediaFeatures(player, activeParty?.id || null) }} />Autoplay next episode</label>
        </div>
      </section>
    )
  }

  return (
    <section ref={fullscreenShellRef} className="relative h-full min-h-0 overflow-hidden bg-black text-white">
      <div className="flex h-full min-h-0 flex-col">
        <header className="z-20 shrink-0 border-b border-white/10 bg-black/95 px-4 py-3 backdrop-blur-sm sm:px-5">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex items-center justify-between gap-4">
              <button type="button" onClick={() => { setView("home"); clearSearch() }} className="flex items-center gap-2.5 text-left" aria-label={`${brandName} home`}>
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-black"><Clapperboard className="h-4 w-4" /></span>
                <span>
                  <strong className="block text-lg font-semibold leading-none tracking-tight">{brandName}</strong>
                  <small className="mt-1 block text-[10px] uppercase tracking-[0.16em] text-white/35">{brandSubtitle}</small>
                </span>
              </button>
              <nav className="flex items-center rounded-lg border border-white/10 bg-[#080808] p-1 lg:hidden" aria-label="SynnFlix sections">
                {(["home", "movies", "tv"] as LibraryView[]).map((item) => (
                  <button key={item} type="button" onClick={() => { setView(item); clearSearch() }} className={`rounded-md px-2.5 py-1.5 text-xs capitalize ${view === item && !submittedQuery ? "bg-white text-black" : "text-white/55 hover:text-white"}`}>{item === "tv" ? "TV" : item}</button>
                ))}
              </nav>
            </div>

            <nav className="hidden items-center rounded-lg border border-white/10 bg-[#080808] p-1 lg:flex" aria-label="SynnFlix sections">
              {(["home", "movies", "tv"] as LibraryView[]).map((item) => (
                <button key={item} type="button" onClick={() => { setView(item); clearSearch() }} className={`rounded-md px-3 py-1.5 text-xs capitalize ${view === item && !submittedQuery ? "bg-white text-black" : "text-white/55 hover:text-white"}`}>{item === "tv" ? "TV" : item}</button>
              ))}
            </nav>

            <button type="button" onClick={() => { setProfilePickerOpen(true); setManagingProfiles(false); setEditingProfileId(null) }} className="flex shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-[#080808] px-2 py-1.5 text-xs text-white/65 hover:border-white/25 hover:text-white" aria-label={`Switch profile. Current profile: ${activeProfile.name}`}>
              <ProfileAvatar profile={activeProfile} className="h-6 w-6" />
              <span className="hidden max-w-20 truncate xl:block">{activeProfile.name}</span>
            </button>
            <button type="button" onClick={() => void joinParty()} className="rounded-lg border border-white/10 bg-[#080808] px-3 py-2 text-xs text-white/60 hover:text-white"><Users className="mr-1.5 inline h-3.5 w-3.5" />Join party</button>
            <form onSubmit={(event) => { event.preventDefault(); void runSearch() }} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-[#080808] px-3 focus-within:border-white/30 lg:ml-auto lg:max-w-xl">
              <Search className="h-4 w-4 shrink-0 text-white/35" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/28"
                placeholder={searchPlaceholder}
                maxLength={100}
                autoCapitalize="none"
                autoCorrect="off"
              />
              {query ? <button type="button" onClick={clearSearch} className="rounded p-1 text-white/35 hover:text-white" aria-label="Clear search"><X className="h-4 w-4" /></button> : null}
              <button type="submit" disabled={!query.trim() || searching} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-40">
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
              </button>
            </form>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {homeLoading ? (
            <div className="mx-auto max-w-7xl px-4 py-7 sm:px-5"><LoadingGrid /></div>
          ) : homeError ? (
            <div className="mx-auto grid max-w-xl place-items-center px-5 py-20 text-center">
              <Film className="h-10 w-10 text-white/25" />
              <h2 className="mt-4 text-lg font-semibold">{brandName} couldn&apos;t load</h2>
              <p className="mt-2 text-sm text-white/45">{homeError}</p>
              <button type="button" onClick={() => void loadHome()} className="mt-5 flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"><RotateCcw className="h-4 w-4" /> Retry</button>
            </div>
          ) : submittedQuery ? (
            <div className="mx-auto max-w-7xl px-4 py-7 sm:px-5">
              <div className="mb-6 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">Search</p>
                  <h1 className="mt-1 text-2xl font-semibold tracking-tight">Results for “{submittedQuery}”</h1>
                  <p className="mt-1 text-sm text-white/40">{results.length} {searchResultLabel}{results.length === 1 ? "" : "s"}</p>
                </div>
              </div>
              {searchError ? <div role="alert" className="rounded-xl border border-rose-300/15 bg-rose-300/5 p-4 text-sm text-rose-200">{searchError}</div> : searching ? <LoadingGrid /> : results.length ? <ResultGrid items={results} onSelect={openMedia} /> : <p className="py-16 text-center text-sm text-white/40">Nothing matched that search.</p>}
            </div>
          ) : view === "home" && home ? (
            <div>
              {hero ? (
                <section className="relative isolate min-h-[330px] overflow-hidden border-b border-white/8 sm:min-h-[410px]">
                  {imageUrl(hero.backdropPath, "w1280") ? <img src={imageUrl(hero.backdropPath, "w1280")!} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover opacity-60" referrerPolicy="no-referrer" /> : null}
                  <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black via-black/72 to-black/20" />
                  <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black via-transparent to-black/25" />
                  <div className="mx-auto flex min-h-[330px] max-w-7xl items-end px-5 pb-9 pt-16 sm:min-h-[410px] sm:pb-12">
                    <div className="max-w-2xl">
                      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-white/60">
                        <span className="rounded-md border border-white/20 bg-black/50 px-2 py-1 uppercase tracking-wide">Trending {animeMode ? "anime" : hero.mediaType === "movie" ? "movie" : "TV"}</span>
                        {yearFromDate(hero.releaseDate) ? <span>{yearFromDate(hero.releaseDate)}</span> : null}
                        <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-current" /> {formatRating(hero.voteAverage)}</span>
                      </div>
                      <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">{hero.title}</h1>
                      {hero.overview ? <p className="mt-4 line-clamp-3 max-w-xl text-sm leading-6 text-white/68 sm:text-base">{hero.overview}</p> : null}
                      <div className="mt-5 flex flex-wrap gap-2">
                        <button type="button" onClick={() => hero.mediaType === "movie" ? startMovie(hero) : void openMedia(hero)} className="flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black"><Play className="h-4 w-4 fill-current" /> {hero.mediaType === "movie" ? "Play" : "Choose episode"}</button>
                        <button type="button" onClick={() => void openMedia(hero)} className="flex items-center gap-2 rounded-lg border border-white/20 bg-black/45 px-4 py-2.5 text-sm font-medium text-white hover:bg-black/70">Details <ChevronRight className="h-4 w-4" /></button>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}
              <div className="mx-auto max-w-7xl px-4 py-7 sm:px-5">
                <ContinueWatchingRail rows={continueWatching} onResume={resumeContinueWatching} onRemove={removeContinueWatching} />
                {mediaFeatures?.lists?.map((list: any) => <Rail key={list.id} title={list.name} icon={list.kind === "favorite" ? <Heart className="h-4 w-4" /> : list.kind === "watchlist" ? <Bookmark className="h-4 w-4" /> : <ListPlus className="h-4 w-4" />} items={storedMediaItems(list)} onSelect={openMedia} />)}
                <Rail title={animeMode ? "Trending anime" : "Trending now"} icon={<Clapperboard className="h-4 w-4" />} items={home.trending} onSelect={openMedia} />
                <Rail title={animeMode ? "Anime movies" : "Popular movies"} icon={<Film className="h-4 w-4" />} items={home.popularMovies} onSelect={openMedia} />
                <Rail title={animeMode ? "Anime series" : "Popular TV"} icon={<Tv className="h-4 w-4" />} items={home.popularTv} onSelect={openMedia} />
                <Rail title={animeMode ? "Top rated anime movies" : "Top rated movies"} icon={<Star className="h-4 w-4" />} items={home.topRatedMovies} onSelect={openMedia} />
                <Rail title={animeMode ? "Top rated anime series" : "Top rated TV"} icon={<Star className="h-4 w-4" />} items={home.topRatedTv} onSelect={openMedia} />
                <SynnFlixCredits />
              </div>
            </div>
          ) : home ? (
            <div className="mx-auto max-w-7xl px-4 py-7 sm:px-5">
              <div className="mb-6">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">Browse</p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight">{view === "movies" ? animeMode ? "Anime Movies" : "Movies" : animeMode ? "Anime Series" : "TV Shows"}</h1>
              </div>
              <ResultGrid items={view === "movies" ? movieGrid : tvGrid} onSelect={openMedia} />
              <SynnFlixCredits />
            </div>
          ) : null}
        </div>
      </div>

      {selected ? (
        <div className="absolute inset-0 z-40 overflow-y-auto bg-black/96 backdrop-blur-sm">
          <div className="min-h-full">
            <div className="sticky top-0 z-20 flex h-12 items-center border-b border-white/10 bg-black/90 px-4 backdrop-blur">
              <button type="button" onClick={() => { setSelected(null); setDetails(null); setSeason(null) }} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-white/60 hover:bg-white/8 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back</button>
            </div>

            {detailsLoading ? (
              <div className="grid min-h-[60vh] place-items-center"><Loader2 className="h-7 w-7 animate-spin text-white/55" /></div>
            ) : detailsError || !details ? (
              <div className="mx-auto max-w-lg px-5 py-20 text-center">
                <p className="text-sm text-rose-200">{detailsError || "Title details are unavailable"}</p>
                <button type="button" onClick={() => void openMedia(selected)} className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black">Retry</button>
              </div>
            ) : (
              <div>
                <section className="relative isolate overflow-hidden border-b border-white/10">
                  {imageUrl(details.backdropPath, "w1280") ? <img src={imageUrl(details.backdropPath, "w1280")!} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover opacity-45" referrerPolicy="no-referrer" /> : null}
                  <div className="absolute inset-0 -z-10 bg-gradient-to-r from-black via-black/80 to-black/35" />
                  <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black via-black/20 to-transparent" />
                  <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 sm:grid-cols-[180px_1fr] sm:py-12">
                    <div className="mx-auto w-[170px] sm:mx-0">
                      <div className="aspect-[2/3] overflow-hidden rounded-xl border border-white/10 bg-[#090909] shadow-2xl shadow-black/50">
                        {imageUrl(details.posterPath, "w342") ? <img src={imageUrl(details.posterPath, "w342")!} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <span className="grid h-full w-full place-items-center text-white/20"><Film className="h-10 w-10" /></span>}
                      </div>
                    </div>
                    <div className="self-end">
                      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-white/55">
                        <span className="rounded-md border border-white/15 bg-black/40 px-2 py-1 uppercase tracking-wide">{details.mediaType === "movie" ? "Movie" : "TV Series"}</span>
                        {yearFromDate(details.releaseDate) ? <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {yearFromDate(details.releaseDate)}</span> : null}
                        <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-current" /> {formatRating(details.voteAverage)}</span>
                        {formatRuntime(details.runtimeMinutes) ? <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {formatRuntime(details.runtimeMinutes)}</span> : null}
                      </div>
                      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{details.title}</h1>
                      {details.tagline ? <p className="mt-2 text-sm italic text-white/45">{details.tagline}</p> : null}
                      {details.overview ? <p className="mt-4 max-w-3xl text-sm leading-6 text-white/68">{details.overview}</p> : null}
                      {details.genres.length ? <div className="mt-4 flex flex-wrap gap-2">{details.genres.map((genre) => <span key={genre} className="rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[11px] text-white/55">{genre}</span>)}</div> : null}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" onClick={() => void toggleMediaList(details, "watchlist")} className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs"><Bookmark className="mr-1.5 inline h-3.5 w-3.5" />{mediaListActive(details, "watchlist") ? "Remove watchlist" : "Watchlist"}</button>
                        <button type="button" onClick={() => void toggleMediaList(details, "favorite")} className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs"><Heart className="mr-1.5 inline h-3.5 w-3.5" />{mediaListActive(details, "favorite") ? "Unfavourite" : "Favourite"}</button>
                        <button type="button" onClick={() => void createCustomListFor(details)} className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs"><ListPlus className="mr-1.5 inline h-3.5 w-3.5" />Add to list</button>
                        <button type="button" onClick={() => void rateCurrent(details)} className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs"><Star className="mr-1.5 inline h-3.5 w-3.5" />Rate / review</button>
                        <button type="button" onClick={() => void predictRating(details)} className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs">Predict rating</button>
                        <button type="button" onClick={() => void addPrivateJournal(details)} className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs">Private journal</button>
                        <button type="button" onClick={() => void createBingo(details)} className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs">Create bingo</button>
                      </div>
                      {details.mediaType === "movie" ? (
                        <button type="button" onClick={() => startMovie(details)} className="mt-5 flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black"><Play className="h-4 w-4 fill-current" /> Play movie</button>
                      ) : null}
                    </div>
                  </div>
                </section>

                {details.mediaType === "tv" ? (
                  <section className="mx-auto max-w-6xl px-5 py-7">
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">Episodes</p>
                        <h2 className="mt-1 text-xl font-semibold">{season?.name || "Choose a season"}</h2>
                        {season && <p className="mt-1 text-xs text-white/35">{mediaFeatures?.progress?.filter((row:any) => row.mediaType === "tv" && String(row.mediaId) === String(details.id) && Number(row.season) === Number(season.seasonNumber) && row.completed).length || 0} / {season.episodes.length} episodes completed</p>}
                      </div>
                      <label className="flex items-center gap-2 text-xs text-white/45">
                        Season
                        <select
                          value={season?.seasonNumber ?? ""}
                          onChange={(event) => void loadSeason(details.id, Number(event.target.value))}
                          className="h-9 rounded-lg border border-white/12 bg-[#080808] px-3 text-sm text-white outline-none focus:border-white/35"
                        >
                          {!season ? <option value="" disabled>Choose</option> : null}
                          {details.seasons.map((entry) => <option key={entry.id} value={entry.seasonNumber}>{entry.name} ({entry.episodeCount})</option>)}
                        </select>
                      </label>
                    </div>

                    {seasonLoading ? <div className="grid h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-white/45" /></div> : seasonError ? <div role="alert" className="rounded-xl border border-rose-300/15 bg-rose-300/5 p-4 text-sm text-rose-200">{seasonError}</div> : season?.episodes.length ? (
                      <div className="grid gap-3">
                        {season.episodes.map((episode) => (
                          <button key={episode.id} type="button" onClick={() => startEpisode(details, episode)} className="group grid gap-3 rounded-xl border border-white/9 bg-[#070707] p-3 text-left transition hover:border-white/25 hover:bg-[#0b0b0b] sm:grid-cols-[150px_1fr_auto] sm:items-center">
                            <span className="aspect-video overflow-hidden rounded-lg bg-[#0b0b0b]">
                              {imageUrl(episode.stillPath, "w500") ? <img src={imageUrl(episode.stillPath, "w500")!} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <span className="grid h-full w-full place-items-center text-white/20"><Tv className="h-6 w-6" /></span>}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-xs font-medium text-white/40">Episode {episode.episodeNumber}{formatRuntime(episode.runtimeMinutes) ? ` · ${formatRuntime(episode.runtimeMinutes)}` : ""}</span>
                              <strong className="mt-1 block text-sm font-semibold text-white/88">{episode.name}</strong>
                              {(() => { const episodeProgress = mediaFeatures?.progress?.find((row:any) => row.mediaType === "tv" && String(row.mediaId) === String(details.id) && Number(row.season) === Number(season.seasonNumber) && Number(row.episode) === Number(episode.episodeNumber)); return episodeProgress ? <span className="mt-1 block text-[10px] text-emerald-300/70">{episodeProgress.completed ? "Watched" : episodeProgress.duration > 0 ? `${Math.round((episodeProgress.currentTime / episodeProgress.duration) * 100)}% watched` : "Started"}</span> : null })()}
                              {episode.overview ? <span className="mt-1 line-clamp-2 block text-xs leading-5 text-white/42">{episode.overview}</span> : null}
                            </span>
                            <span className="hidden h-9 w-9 place-items-center rounded-full bg-white text-black group-hover:scale-105 sm:grid"><Play className="h-4 w-4 fill-current" /></span>
                          </button>
                        ))}
                      </div>
                    ) : <p className="py-10 text-center text-sm text-white/40">No episodes are listed for this season.</p>}
                  </section>
                ) : null}

                <div className="mx-auto max-w-6xl px-5 pb-8"><SynnFlixCredits /></div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function SynnFlixCredits() {
  return (
    <footer className="mt-8 flex flex-col gap-3 border-t border-white/8 py-6 text-[11px] leading-5 text-white/32 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <img src={TMDB_LOGO} alt="TMDB" className="h-8 w-auto max-w-[48px] object-contain opacity-70" referrerPolicy="no-referrer" />
        <p className="max-w-2xl">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </div>
      <p className="shrink-0">Metadata: TMDB · Playback: Vidking</p>
    </footer>
  )
}
