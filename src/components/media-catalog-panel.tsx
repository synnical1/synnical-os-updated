"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { ArrowLeft, CalendarDays, ExternalLink, Film, Home, Play, Search, Star, Tv, UserRound, X } from "lucide-react"
import type { SynnFlixDetails, SynnFlixHomeData, SynnFlixMediaItem, SynnFlixSeasonDetails } from "@/lib/synnflix-types"
import { MediaPlayer } from "@/components/media-player"
import type { MediaPlaybackRequest, NativePlaybackEvent } from "@/lib/media-provider-types"

type Mode = "movies" | "anime"
type SearchType = "all" | "movie" | "tv"
type Provider = { id: number; name: string; logoPath: string | null }
type Details = SynnFlixDetails & {
  watchProviders: { flatrate: Provider[]; free: Provider[]; ads: Provider[]; rent: Provider[]; buy: Provider[]; link: string | null }
  watchLink: string
}
type SearchPage = { results: SynnFlixMediaItem[]; page: number; totalPages: number }
type LibrarySection = "home" | "movies" | "shows"
type ProgressRow = {
  mediaType: "movie" | "tv"
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

const imageUrl = (path: string | null, size = "w500") => path ? "https://image.tmdb.org/t/p/" + size + path : null
const year = (date: string | null) => date && /^\d{4}/.test(date) ? date.slice(0, 4) : ""
const rating = (value: number) => Number.isFinite(value) && value > 0 ? value.toFixed(1) : "NR"

async function api<T>(params: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/tmdb?" + params.toString(), { credentials: "same-origin", cache: "no-store", signal })
  const body = await response.json().catch(() => ({})) as { error?: unknown }
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The catalogue request failed.")
  return body as T
}

function Poster({ item, layout = "landscape" }: { item: SynnFlixMediaItem; layout?: "landscape" | "poster" }) {
  const path = layout === "poster" ? (item.posterPath || item.backdropPath) : (item.backdropPath || item.posterPath)
  const src = imageUrl(path, layout === "poster" ? "w500" : "w780")
  return (
    <div
      role="img"
      aria-label={item.title + " artwork"}
      className={"relative overflow-hidden rounded-xl border border-white/[.12] bg-[#181818] shadow-[0_12px_30px_rgba(0,0,0,.24)] " + (layout === "poster" ? "aspect-[2/3]" : "aspect-video")}
      style={src ? { backgroundImage: "url(" + JSON.stringify(src) + ")", backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      {!src ? <div className="grid h-full place-items-center text-white/25">{item.mediaType === "movie" ? <Film className="h-9 w-9" /> : <Tv className="h-9 w-9" />}</div> : null}
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/[.08]" />
    </div>
  )
}

function MediaCard({ item, onSelect, layout = "landscape" }: { item: SynnFlixMediaItem; onSelect: (item: SynnFlixMediaItem) => void; layout?: "landscape" | "poster" }) {
  return (
    <button type="button" onClick={() => onSelect(item)} aria-label={"View " + item.title + " details"} className={"group shrink-0 text-left " + (layout === "poster" ? "w-[178px] sm:w-[198px]" : "w-[min(78vw,335px)] sm:w-[310px]")}>
      <span className="block transition duration-200 group-hover:-translate-y-1 group-hover:drop-shadow-[0_14px_25px_rgba(0,0,0,.5)]">
        <Poster item={item} layout={layout} />
      </span>
      <strong className="mt-2 block truncate text-[13px] font-medium text-white/90 transition-colors group-hover:text-white">{item.title}</strong>
      <span className="mt-0.5 flex items-center gap-2 text-[11px] text-white/50">
        {item.voteAverage > 0 ? <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-current text-white/80" />{rating(item.voteAverage)}</span> : null}
        {year(item.releaseDate) ? <span>{year(item.releaseDate)}</span> : null}
        <span>{item.mediaType === "movie" ? "Movie" : "Show"}</span>
      </span>
    </button>
  )
}

function Rail({ title, items, onSelect }: { title: string; items: SynnFlixMediaItem[]; onSelect: (item: SynnFlixMediaItem) => void }) {
  if (!items.length) return null
  return (
    <section className="mb-9">
      <div className="mb-3 flex items-center justify-between px-0.5">
        <h2 className="text-[19px] font-semibold tracking-tight text-white">{title}</h2>
        <span className="text-xs text-white/35">{items.length} titles</span>
      </div>
      <div className="custom-scroll flex gap-3.5 overflow-x-auto pb-3">
        {items.map((item) => <MediaCard key={item.mediaType + ":" + item.id} item={item} onSelect={onSelect} />)}
      </div>
    </section>
  )
}

function TopTenRail({ items, onSelect }: { items: SynnFlixMediaItem[]; onSelect: (item: SynnFlixMediaItem) => void }) {
  if (!items.length) return null
  const lead = items[0]
  const leadImage = imageUrl(lead.backdropPath || lead.posterPath, "w1280")
  return (
    <section className="mb-10">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[19px] font-semibold tracking-tight text-white">Top 10 on SynnFlix</h2>
        <span className="text-xs text-white/35">This week</span>
      </div>
      <div className="custom-scroll flex items-stretch gap-3 overflow-x-auto pb-3">
        <article className="relative h-[300px] w-[min(57vw,650px)] min-w-[330px] shrink-0 overflow-hidden rounded-xl border border-white/[.13] bg-[#171717] sm:h-[315px]">
          {leadImage ? <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url(" + JSON.stringify(leadImage) + ")" }} /> : null}
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/55 to-black/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/10" />
          <span className="absolute left-0 top-0 rounded-br-lg bg-[#e50914] px-2.5 py-1.5 text-[10px] font-bold uppercase leading-tight text-white">Top<br /><strong className="text-base">1</strong></span>
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[.22em] text-white/65">Number one this week</p>
            <h3 className="max-w-[440px] text-xl font-bold leading-tight text-white sm:text-[25px]">{lead.title}</h3>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-white/70">
              {lead.voteAverage > 0 ? <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-current" />{rating(lead.voteAverage)}</span> : null}
              {year(lead.releaseDate) ? <span>{year(lead.releaseDate)}</span> : null}
              <span>{lead.mediaType === "movie" ? "Movie" : "Show"}</span>
            </div>
            <p className="mt-3 line-clamp-2 max-w-[490px] text-xs leading-5 text-white/75">{lead.overview || "Explore the title, cast and viewing information."}</p>
            <button type="button" onClick={() => onSelect(lead)} className="mt-4 rounded-lg border border-white/20 bg-white/[.18] px-4 py-2 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-white/[.27]">More info</button>
          </div>
        </article>
        {items.slice(1, 10).map((item, index) => (
          <div key={item.mediaType + ":" + item.id} className="relative w-[178px] shrink-0 sm:w-[198px]">
            <span className="absolute left-0 top-0 z-10 rounded-br-lg bg-[#e50914] px-2 py-1 text-[10px] font-bold uppercase leading-tight text-white">Top<br /><strong className="text-base">{index + 2}</strong></span>
            <MediaCard item={item} onSelect={onSelect} layout="poster" />
          </div>
        ))}
      </div>
    </section>
  )
}

function ContinueWatchingRail({ rows, onResume }: { rows: ProgressRow[]; onResume: (row: ProgressRow) => void }) {
  if (!rows.length) return null
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[19px] font-semibold tracking-tight text-white">Continue watching</h2>
      </div>
      <div className="custom-scroll flex gap-3.5 overflow-x-auto pb-3">
        {rows.map((row) => {
          const current = Math.max(0, Number(row.currentTime) || 0)
          const duration = Math.max(0, Number(row.duration) || 0)
          const percent = duration > 0 ? Math.min(100, Math.max(2, current / duration * 100)) : 4
          const art = imageUrl(row.backdrop || row.poster || null, "w780")
          const seconds = Math.floor(current)
          const time = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0")
          const subtitle = row.mediaType === "tv"
            ? "S" + (row.season || 1) + " E" + (row.episode || 1) + (row.episodeName ? " · " + row.episodeName : "")
            : time + " watched"
          return (
            <article key={row.mediaType + ":" + row.mediaId + ":" + (row.season || 0) + ":" + (row.episode || 0)} className="w-[min(78vw,335px)] shrink-0">
              <button type="button" onClick={() => onResume(row)} className="group block w-full text-left" aria-label={"Resume " + row.title}>
                <span className="relative block aspect-video overflow-hidden rounded-xl border border-white/[.12] bg-[#191919] shadow-[0_12px_30px_rgba(0,0,0,.25)]">
                  {art ? <span className="absolute inset-0 bg-cover bg-center transition duration-300 group-hover:scale-[1.025]" style={{ backgroundImage: "url(" + JSON.stringify(art) + ")" }} /> : null}
                  <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                  <span className="absolute inset-0 grid place-items-center"><span className="grid h-11 w-11 place-items-center rounded-full border border-white/65 bg-white/[.9] text-black shadow-lg transition group-hover:scale-105"><Play className="ml-0.5 h-4 w-4 fill-current" /></span></span>
                  <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25"><span className="block h-full bg-[#e50914]" style={{ width: percent + "%" }} /></span>
                </span>
                <strong className="mt-2 block truncate text-[13px] font-semibold text-white/90">{row.title}</strong>
                <span className="mt-0.5 block truncate text-[11px] text-white/48">{subtitle}</span>
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export function MediaCatalogPanel({ mode, onNavigate }: { mode: Mode; onNavigate?: (panel: "movies" | "synnime") => void }) {
  const isAnime = mode === "anime"
  const appName = isAnime ? "Synnime" : "SynnFlix"
  const [home, setHome] = useState<SynnFlixHomeData | null>(null)
  const [homeLoading, setHomeLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SynnFlixMediaItem[]>([])
  const [searchType, setSearchType] = useState<SearchType>("all")
  const [searchActive, setSearchActive] = useState(false)
  const [section, setSection] = useState<LibrarySection>("home")
  const [searchOpen, setSearchOpen] = useState(false)
  const [continueWatching, setContinueWatching] = useState<ProgressRow[]>([])
  const [watchedRecommendations, setWatchedRecommendations] = useState<{ title: string; items: SynnFlixMediaItem[] } | null>(null)
  const [error, setError] = useState("")
  const [details, setDetails] = useState<Details | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
  const [seasonData, setSeasonData] = useState<SynnFlixSeasonDetails | null>(null)
  const [activePlayback, setActivePlayback] = useState<{ request: MediaPlaybackRequest; title: string; mediaTitle: string; poster: string | null; backdrop: string | null } | null>(null)
  const [playbackProgress, setPlaybackProgress] = useState({ currentTime: 0, duration: 0, status: "Loading player…" })
  const mainRef = useRef<HTMLElement | null>(null)
  const searchController = useRef<AbortController | null>(null)
  const detailsController = useRef<AbortController | null>(null)
  const seasonController = useRef<AbortController | null>(null)
  const lastProgressSaveRef = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    setHomeLoading(true)
    setError("")
    void api<SynnFlixHomeData>(new URLSearchParams({ action: "home", mode }), controller.signal)
      .then(setHome)
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load the catalogue.") })
      .finally(() => { if (!controller.signal.aborted) setHomeLoading(false) })
    return () => controller.abort()
  }, [mode])

  useEffect(() => {
    if (isAnime) {
      setContinueWatching([])
      return
    }
    const controller = new AbortController()
    void fetch("/api/features/media", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (controller.signal.aborted || !Array.isArray(data?.progress)) return
        const rows = (data.progress as ProgressRow[])
          .filter((row) => {
            const current = Number(row?.currentTime) || 0
            const duration = Number(row?.duration) || 0
            return (row?.mediaType === "movie" || row?.mediaType === "tv")
              && Boolean(row?.mediaId)
              && row?.completed !== true
              && current > 0
              && duration > 0
              && current / duration < 0.92
          })
          .sort((a, b) => Date.parse(String(b.updatedAt || "")) - Date.parse(String(a.updatedAt || "")))
          .slice(0, 12)
        setContinueWatching(rows)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [isAnime])

  useEffect(() => {
    const row = continueWatching[0]
    if (!row || isAnime) {
      setWatchedRecommendations(null)
      return
    }
    const controller = new AbortController()
    const params = new URLSearchParams({ action: "details", mode: "movies", type: row.mediaType, id: row.mediaId })
    void api<Details>(params, controller.signal)
      .then((details) => {
        if (!controller.signal.aborted && details.recommendations.length) {
          setWatchedRecommendations({ title: row.title, items: details.recommendations })
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [continueWatching, isAnime])

  useEffect(() => () => {
    searchController.current?.abort()
    detailsController.current?.abort()
    seasonController.current?.abort()
  }, [])

  const search = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    const clean = query.trim()
    searchController.current?.abort()
    if (!clean) { setSearching(false); setSearchActive(false); setSearchResults([]); return }
    const controller = new AbortController()
    searchController.current = controller
    setSearching(true)
    setError("")
    setSearchActive(true)
    try {
      const params = new URLSearchParams({ action: "search", mode, query: clean })
      const result = await api<SearchPage>(params, controller.signal)
      if (!controller.signal.aborted) setSearchResults(result.results)
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "Search failed.")
        setSearchResults([])
      }
    } finally {
      if (!controller.signal.aborted) setSearching(false)
    }
  }, [mode, query])

  const openDetails = useCallback(async (item: SynnFlixMediaItem) => {
    if (mainRef.current) mainRef.current.scrollTop = 0
    detailsController.current?.abort()
    seasonController.current?.abort()
    const controller = new AbortController()
    detailsController.current = controller
    setDetails(null)
    setDetailsLoading(true)
    setSelectedSeason(null)
    setSeasonData(null)
    try {
      const params = new URLSearchParams({ action: "details", mode, type: item.mediaType, id: String(item.id) })
      const result = await api<Details>(params, controller.signal)
      if (!controller.signal.aborted) setDetails(result)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load title details.")
    } finally {
      if (!controller.signal.aborted) setDetailsLoading(false)
    }
  }, [mode])

  const closeDetails = useCallback(() => {
    detailsController.current?.abort()
    seasonController.current?.abort()
    setDetails(null)
    setDetailsLoading(false)
    setSelectedSeason(null)
    setSeasonData(null)
  }, [])

  const loadSeason = useCallback(async (season: number) => {
    if (!details) return
    seasonController.current?.abort()
    const controller = new AbortController()
    seasonController.current = controller
    setSelectedSeason(season)
    setSeasonData(null)
    try {
      const params = new URLSearchParams({ action: "season", mode, id: String(details.id), season: String(season) })
      const result = await api<SynnFlixSeasonDetails>(params, controller.signal)
      if (!controller.signal.aborted) setSeasonData(result)
    } catch (cause) {
      if (!controller.signal.aborted) {
        setSelectedSeason(null)
        setError(cause instanceof Error ? cause.message : "Could not load season details.")
      }
    }
  }, [details, mode])

  const startPlayback = useCallback((item: SynnFlixMediaItem, season?: number, episode?: number, episodeName?: string) => {
    const request: MediaPlaybackRequest = {
      mediaType: item.mediaType,
      mediaId: item.id,
      ...(item.mediaType === "tv" ? { season: season ?? 1, episode: episode ?? 1 } : {}),
    }
    const episodeLabel = item.mediaType === "tv" ? ` · S${request.season} E${request.episode}${episodeName ? " · " + episodeName : ""}` : ""
    lastProgressSaveRef.current = 0
    setPlaybackProgress({ currentTime: 0, duration: 0, status: "Loading player…" })
    setActivePlayback({ request, title: item.title + episodeLabel, mediaTitle: item.title, poster: item.posterPath, backdrop: item.backdropPath })
  }, [])

  const handlePlaybackEvent = useCallback((event: NativePlaybackEvent) => {
    const currentTime = event.event === "ended" && event.duration > 0 ? event.duration : event.currentTime
    setPlaybackProgress((previous) => ({
      currentTime,
      duration: event.duration,
      status: event.event === "play" ? "Playing" : event.event === "pause" ? "Paused" : event.event === "ended" ? "Finished" : previous.status,
    }))
    if (!activePlayback) return
    const now = Date.now()
    if (event.event === "timeupdate" && now - lastProgressSaveRef.current < 15_000) return
    lastProgressSaveRef.current = now
    const { request, mediaTitle, poster, backdrop } = activePlayback
    void fetch("/api/features/media", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "progress", mediaType: request.mediaType, mediaId: String(request.mediaId),
        title: mediaTitle, season: request.season ?? 0, episode: request.episode ?? 0,
        currentTime, duration: event.duration, completed: event.event === "ended",
        poster, backdrop,
      }),
    }).catch(() => {})
  }, [activePlayback])
  const closePlayback = useCallback(() => {
    const playback = activePlayback
    if (playback && (playbackProgress.currentTime > 0 || playbackProgress.duration > 0)) {
      lastProgressSaveRef.current = Date.now()
      void fetch("/api/features/media", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "progress", mediaType: playback.request.mediaType, mediaId: String(playback.request.mediaId),
          title: playback.mediaTitle, season: playback.request.season ?? 0, episode: playback.request.episode ?? 0,
          currentTime: playbackProgress.currentTime, duration: playbackProgress.duration,
          poster: playback.poster, backdrop: playback.backdrop,
        }),
      }).catch(() => {})
    }
    setActivePlayback(null)
  }, [activePlayback, playbackProgress])
  const visibleResults = useMemo(() => searchResults.filter((item) => searchType === "all" || item.mediaType === searchType), [searchResults, searchType])
  const hero = !searchActive ? home?.trending[0] : null
  const watchGroups = [
    { key: "flatrate" as const, label: "Subscription" },
    { key: "free" as const, label: "Free" },
    { key: "ads" as const, label: "With ads" },
    { key: "rent" as const, label: "Rent" },
    { key: "buy" as const, label: "Buy" },
  ]

  return (
    <main ref={mainRef} className="relative h-full min-h-0 w-full overflow-y-auto overflow-x-hidden bg-[#050608] text-white">
      <div className="relative min-h-full bg-[#0c0c0c] text-white">
        <header className="sticky top-3 z-50 mx-auto mb-[-76px] flex h-[76px] w-full max-w-[1160px] items-center justify-between px-4 sm:px-7">
          <button type="button" onClick={() => { setSearchActive(false); setSection("home"); if (isAnime) onNavigate?.("movies") }} aria-label={appName + " home"} className="select-none text-[38px] font-black leading-none tracking-[-.12em] text-[#e50914] drop-shadow-[0_3px_8px_rgba(0,0,0,.35)]">
            S
          </button>
          <nav aria-label="Media navigation" className="flex max-w-[calc(100%-58px)] items-center gap-0.5 rounded-[17px] border border-white/[.18] px-1.5 py-1.5 text-[12px] text-white/75 shadow-[0_10px_32px_rgba(0,0,0,.28),inset_0_1px_0_rgba(255,255,255,.2)] backdrop-blur-xl" style={{ background: "rgba(14,16,20,.52)", backdropFilter: "blur(17px) saturate(165%)", WebkitBackdropFilter: "blur(17px) saturate(165%)" }}>
            <button type="button" onClick={() => { setSearchActive(false); if (isAnime) onNavigate?.("movies"); else setSection("home") }} className={"inline-flex h-8 items-center gap-1.5 rounded-xl px-3 transition " + (!isAnime && section === "home" ? "bg-white/[.17] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.2)]" : "hover:bg-white/[.09] hover:text-white")}><Home className="h-3.5 w-3.5" /><span>Home</span></button>
            <button type="button" onClick={() => { setSearchActive(false); if (isAnime) onNavigate?.("movies"); else setSection("movies") }} className={"inline-flex h-8 items-center gap-1.5 rounded-xl px-3 transition " + (!isAnime && section === "movies" ? "bg-white/[.17] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.2)]" : "hover:bg-white/[.09] hover:text-white")}><Film className="h-3.5 w-3.5" /><span>Movies</span></button>
            <button type="button" onClick={() => { setSearchActive(false); if (isAnime) onNavigate?.("movies"); else setSection("shows") }} className={"inline-flex h-8 items-center gap-1.5 rounded-xl px-3 transition " + (!isAnime && section === "shows" ? "bg-white/[.17] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.2)]" : "hover:bg-white/[.09] hover:text-white")}><Tv className="h-3.5 w-3.5" /><span>Shows</span></button>
            <button type="button" onClick={() => { setSearchActive(false); onNavigate?.("synnime") }} className={"inline-flex h-8 items-center gap-1.5 rounded-xl px-3 transition " + (isAnime ? "bg-white/[.17] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.2)]" : "hover:bg-white/[.09] hover:text-white")}><Star className="h-3.5 w-3.5" /><span>Anime</span></button>
            <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-white/[.17]" />
            <form onSubmit={search} className="flex h-8 items-center gap-1">
              {searchOpen ? <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles" aria-label={"Search " + appName} className="w-[116px] bg-transparent px-1 text-xs text-white outline-none placeholder:text-white/45 sm:w-[160px]" /> : null}
              <button type={searchOpen ? "submit" : "button"} onClick={searchOpen ? undefined : () => setSearchOpen(true)} disabled={searching || (searchOpen && !query.trim())} aria-label="Search" className="grid h-8 w-8 place-items-center rounded-xl text-white/80 transition hover:bg-white/[.1] hover:text-white disabled:opacity-45"><Search className="h-4 w-4" /></button>
              {searchOpen ? <button type="button" onClick={() => { setQuery(""); setSearchActive(false); setSearchResults([]); setSearchOpen(false) }} aria-label="Close search" className="grid h-8 w-7 place-items-center rounded-lg text-white/60 hover:bg-white/[.1] hover:text-white"><X className="h-3.5 w-3.5" /></button> : null}
            </form>
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-white/[.17]" />
            <span aria-label="Profile" title="Profile" className="grid h-7 w-7 place-items-center rounded-full border border-white/25 bg-gradient-to-br from-white/20 to-white/[.06] text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,.28)]"><UserRound className="h-4 w-4" /></span>
          </nav>
        </header>

        {searchActive ? (
          <div className="mx-auto w-full max-w-[1160px] px-4 pb-14 pt-[100px] sm:px-7">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-[10px] uppercase tracking-[.22em] text-white/40">Search results</p><h2 className="mt-1 text-xl font-semibold">“{query.trim()}”</h2></div>
              <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[.06] p-1" style={{ backdropFilter: "blur(12px) saturate(150%)" }}>
                {(["all", "movie", "tv"] as SearchType[]).map((value) => <button key={value} type="button" onClick={() => setSearchType(value)} className={"rounded-lg px-3 py-2 text-xs transition " + (searchType === value ? "bg-white/[.16] text-white shadow" : "text-white/55 hover:text-white")}>{value === "all" ? "All" : value === "movie" ? "Movies" : "Shows"}</button>)}
              </div>
            </div>
            {searching ? <p className="py-16 text-center text-sm text-white/45" role="status">Searching TMDB…</p> : visibleResults.length ? <div className="grid grid-cols-1 gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">{visibleResults.map((item) => <MediaCard key={item.mediaType + ":" + item.id} item={item} onSelect={openDetails} />)}</div> : <p className="rounded-2xl border border-white/10 bg-white/[.04] px-4 py-12 text-center text-sm text-white/45">No matching titles found.</p>}
          </div>
        ) : homeLoading ? (
          <div className="grid min-h-[470px] place-items-center pt-24 text-sm text-white/45" role="status">Loading {appName} catalogue…</div>
        ) : home ? (
          <>
            {section === "home" ? (
              <section className="relative isolate mb-9 h-[min(78vh,650px)] min-h-[500px] max-h-[680px] w-full overflow-hidden bg-[#171717]">
                {hero?.backdropPath ? <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url(" + JSON.stringify(imageUrl(hero.backdropPath, "w1280")) + ")" }} /> : null}
                <div className="absolute inset-0 bg-gradient-to-r from-[#070707]/95 via-[#070707]/65 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0c0c0c] via-[#0c0c0c]/10 to-black/25" />
                <div className="relative mx-auto flex h-full w-full max-w-[1160px] items-end px-4 pb-16 pt-28 sm:px-7 sm:pb-[76px]">
                  <div className="max-w-[535px]">
                    <p className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-white/75"><span className="rounded bg-[#e50914] px-2 py-1 text-white">{isAnime ? "Popular anime" : "Trending now"}</span>{hero ? hero.mediaType === "movie" ? "Movie" : "Show" : appName}</p>
                    <h1 className="max-w-[560px] text-[30px] font-extrabold leading-[1.06] tracking-[-.025em] text-white drop-shadow-[0_2px_15px_rgba(0,0,0,.5)] sm:text-[42px]">{hero?.title || appName}</h1>
                    {hero ? <div className="mt-4 flex flex-wrap items-center gap-2.5 text-[13px] font-medium text-white/90">
                      {hero.voteAverage > 0 ? <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-current text-[#e50914]" />{rating(hero.voteAverage)}</span> : null}
                      {year(hero.releaseDate) ? <><span className="text-white/40">·</span><span>{year(hero.releaseDate)}</span></> : null}
                      <span className="text-white/40">·</span><span>{hero.mediaType === "movie" ? "Movie" : "Show"}</span>
                    </div> : null}
                    <p className="mt-4 line-clamp-4 max-w-[535px] text-sm leading-[1.65] text-white/90 drop-shadow-[0_1px_8px_rgba(0,0,0,.7)] sm:text-[15px]">{hero?.overview || "Explore films and series in the Synnical catalogue."}</p>
                    {hero ? <div className="mt-6 flex flex-wrap gap-3">
                      <button type="button" onClick={() => startPlayback(hero)} className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-6 text-sm font-semibold text-black shadow-lg transition hover:bg-white/90"><Play className="h-4 w-4 fill-current" />Play</button>
                      <button type="button" onClick={() => openDetails(hero)} className="inline-flex h-11 items-center gap-2 rounded-lg border border-white/25 px-6 text-sm font-semibold text-white transition hover:bg-white/[.16]" style={{ background: "rgba(25,27,30,.48)", backdropFilter: "blur(10px) saturate(150%)", WebkitBackdropFilter: "blur(10px) saturate(150%)" }}><span className="grid h-5 w-5 place-items-center rounded-full border border-white/80 text-[11px]">i</span>More info</button>
                    </div> : null}
                  </div>
                </div>
              </section>
            ) : <div className="h-[96px]" />}

            <div className="mx-auto w-full max-w-[1160px] px-4 pb-12 sm:px-7">
              {section === "home" ? (
                <>
                  {!isAnime ? <ContinueWatchingRail rows={continueWatching} onResume={(row) => startPlayback({
                    id: Number(row.mediaId), mediaType: row.mediaType, title: row.title, originalTitle: row.title,
                    overview: "", posterPath: row.poster || null, backdropPath: row.backdrop || null, releaseDate: null,
                    voteAverage: 0, voteCount: 0, popularity: 0,
                  }, row.season || undefined, row.episode || undefined, row.episodeName || undefined)} /> : null}
                  {!isAnime ? <TopTenRail items={home.trending.slice(0, 10)} onSelect={openDetails} /> : null}
                  {isAnime ? (
                    <>
                      <Rail title="Popular anime films" items={home.popularMovies} onSelect={openDetails} />
                      <Rail title="Popular anime series" items={home.popularTv} onSelect={openDetails} />
                      <Rail title="Top-rated anime films" items={home.topRatedMovies} onSelect={openDetails} />
                      <Rail title="Top-rated anime series" items={home.topRatedTv} onSelect={openDetails} />
                    </>
                  ) : (
                    <>
                      <Rail title="Trending this week" items={home.trending} onSelect={openDetails} />
                      {watchedRecommendations ? <Rail title={"Because you watched " + watchedRecommendations.title} items={watchedRecommendations.items} onSelect={openDetails} /> : null}
                      <Rail title="Popular movies" items={home.popularMovies} onSelect={openDetails} />
                      <Rail title="Current & upcoming TV shows" items={home.onTheAirTv || []} onSelect={openDetails} />
                      <Rail title="Top rated" items={[...home.topRatedMovies, ...home.topRatedTv].sort((a, b) => b.voteAverage - a.voteAverage)} onSelect={openDetails} />
                    </>
                  )}
                </>
              ) : section === "movies" ? (
                <>
                  <Rail title="Popular movies" items={home.popularMovies} onSelect={openDetails} />
                  <Rail title="Top rated movies" items={home.topRatedMovies} onSelect={openDetails} />
                  <Rail title="Trending movies" items={home.trending.filter((item) => item.mediaType === "movie")} onSelect={openDetails} />
                </>
              ) : (
                <>
                  <Rail title="Popular shows" items={home.popularTv} onSelect={openDetails} />
                  <Rail title="Top rated shows" items={home.topRatedTv} onSelect={openDetails} />
                  <Rail title="Trending shows" items={home.trending.filter((item) => item.mediaType === "tv")} onSelect={openDetails} />
                </>
              )}
            </div>
          </>
        ) : (
          <div className="mx-auto max-w-[1160px] px-5 pb-16 pt-28 text-center text-sm text-white/50">The catalogue could not be loaded.</div>
        )}
        {error ? <div role="alert" className="mx-auto mb-5 mt-4 max-w-[1160px] rounded-xl border border-amber-200/20 bg-amber-100/[.07] px-4 py-3 text-sm text-amber-100/90">{error}</div> : null}
        <footer className="mx-auto max-w-[1160px] border-t border-white/10 px-4 py-5 text-[10px] leading-5 text-white/35 sm:px-7">This product uses the TMDB API but is not endorsed or certified by TMDB. Viewing availability reflects UK provider data where available. © 2026 Synnical.</footer>
      </div>

      {detailsLoading ? <div className="absolute inset-0 z-20 grid place-items-center bg-black/75 text-sm text-white/70 backdrop-blur-xl" role="status">Loading title details…</div> : null}
      {details ? <section className="absolute inset-0 z-30 overflow-y-auto bg-[#050608]/95 backdrop-blur-2xl" aria-label={details.title + " details"}>
        <div className="relative min-h-full">
          <div className="absolute inset-x-0 top-0 h-[320px] bg-cover bg-center opacity-45" style={details.backdropPath ? { backgroundImage: "url(" + JSON.stringify(imageUrl(details.backdropPath, "w1280")) + ")" } : undefined} />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#050608]/75 to-[#050608]" />
          <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-5 sm:px-8">
            <button type="button" onClick={closeDetails} className="mb-8 inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-xs text-white/80 backdrop-blur-xl hover:bg-white/10"><ArrowLeft className="h-4 w-4" /> Back to catalogue</button>
            <div className="grid gap-6 sm:grid-cols-[190px_1fr] sm:gap-8">
              <div className="max-w-[190px]"><Poster item={details} /></div>
              <div className="min-w-0 pt-1">
                <div className="mb-3 flex flex-wrap gap-2">{details.genres.map((genre) => <span key={genre} className="rounded-full border border-white/15 bg-white/[0.07] px-3 py-1 text-[10px] text-white/65 backdrop-blur-xl">{genre}</span>)}</div>
                <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">{details.title}</h2>
                {details.tagline ? <p className="mt-2 text-sm italic text-white/55">{details.tagline}</p> : null}
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/55">
                  <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-current" />{rating(details.voteAverage)} ({details.voteCount.toLocaleString("en-GB")} votes)</span>
                  {year(details.releaseDate) ? <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{year(details.releaseDate)}</span> : null}
                  {details.runtimeMinutes ? <span>{details.runtimeMinutes} min</span> : null}
                  {details.status ? <span>{details.status}</span> : null}
                </div>
                <p className="mt-5 max-w-3xl text-sm leading-7 text-white/70">{details.overview || "No synopsis is available for this title."}</p>
                {details.mediaType === "movie" ? <button type="button" onClick={() => startPlayback(details)} className="mt-6 inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/[0.16] px-5 py-3 text-sm font-semibold text-white shadow-lg backdrop-blur-xl transition hover:bg-white/[0.24]"><Play className="h-4 w-4 fill-current" /> Play movie</button> : null}
                {details.cast.length ? <div className="mt-6"><h3 className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-white/45">Cast</h3><p className="text-xs leading-6 text-white/65">{details.cast.slice(0, 10).map((person) => person.name + (person.character ? " as " + person.character : "")).join(" · ")}</p></div> : null}
              </div>
            </div>

            <div className="mt-9 rounded-2xl border border-white/10 bg-white/[0.055] p-5 shadow-xl shadow-black/20 backdrop-blur-2xl">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Where to watch in the UK</h3><p className="mt-1 text-xs text-white/45">Availability supplied by TMDB. Provider catalogues and subscriptions can change.</p></div><a href={details.watchLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.09] px-3 py-2 text-xs hover:bg-white/[0.16]">View availability <ExternalLink className="h-3.5 w-3.5" /></a></div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {watchGroups.map((group) => {
                  const list = details.watchProviders[group.key]
                  return <div key={group.key} className="min-w-0"><h4 className="mb-2 text-[10px] font-semibold uppercase tracking-[.15em] text-white/40">{group.label}</h4>{list.length ? <div className="flex flex-wrap gap-2">{list.map((provider) => <span key={provider.id} title={provider.name} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] text-white/75">{provider.logoPath ? <img src={imageUrl(provider.logoPath, "w92") || ""} alt="" loading="lazy" className="h-6 w-6 rounded-md" /> : null}<span>{provider.name}</span></span>)}</div> : <p className="text-xs text-white/30">Not listed</p>}</div>
                })}
              </div>
            </div>

            {details.mediaType === "tv" && details.seasons.length ? <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.045] p-5 backdrop-blur-2xl">
              <h3 className="font-semibold">Seasons and episodes</h3>
              <div className="mt-4 flex flex-wrap gap-2">{details.seasons.map((season) => <button key={season.seasonNumber} type="button" onClick={() => void loadSeason(season.seasonNumber)} className={"rounded-xl border px-3 py-2 text-xs transition " + (selectedSeason === season.seasonNumber ? "border-white/30 bg-white/[0.15] text-white" : "border-white/10 bg-white/[0.04] text-white/55 hover:bg-white/10")}>{season.name}</button>)}</div>
              {seasonData ? <div className="mt-5 space-y-2">{seasonData.episodes.map((episode) => <article key={episode.id} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-3"><div className="w-24 shrink-0 overflow-hidden rounded-lg bg-white/5">{episode.stillPath ? <img src={imageUrl(episode.stillPath, "w300") || ""} alt="" loading="lazy" className="aspect-video w-full object-cover" /> : <div className="grid aspect-video place-items-center text-white/25"><Tv className="h-5 w-5" /></div>}</div><div className="min-w-0 flex-1"><h4 className="text-xs font-semibold text-white/85">E{episode.episodeNumber} · {episode.name}</h4><p className="mt-1 line-clamp-2 text-[11px] leading-5 text-white/45">{episode.overview || "No episode synopsis available."}</p></div><button type="button" onClick={() => startPlayback(details, episode.seasonNumber, episode.episodeNumber, episode.name)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.12] px-3 py-2 text-xs font-semibold text-white/90 backdrop-blur-xl transition hover:bg-white/[0.2]"><Play className="h-3.5 w-3.5 fill-current" /> Play</button></article>)}</div> : selectedSeason !== null ? <p className="mt-4 text-xs text-white/45">Loading episodes…</p> : <p className="mt-4 text-xs text-white/35">Select a season to browse its episodes.</p>}
            </div> : null}

            {details.recommendations.length ? <div className="mt-8"><Rail title="You might also like" items={details.recommendations} onSelect={openDetails} /></div> : null}
            {details.similar.length ? <div className="mt-8"><Rail title="More like this" items={details.similar} onSelect={openDetails} /></div> : null}
            <p className="mt-8 text-[10px] text-white/30">Metadata and artwork © their respective owners. Synnical is not endorsed or certified by TMDB.</p>
          </div>
        </div>
        <button type="button" onClick={closeDetails} aria-label="Close title details" className="absolute right-4 top-5 grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/30 text-white/75 backdrop-blur-xl hover:bg-white/10"><X className="h-4 w-4" /></button>
      </section> : null}
      {activePlayback ? <section className="absolute inset-0 z-40 flex flex-col bg-black/95 backdrop-blur-2xl" aria-label={"Playing " + activePlayback.title}>
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-white/[0.045] px-4 py-3 backdrop-blur-2xl">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">{activePlayback.title}</h2>
            <p className="mt-0.5 text-[10px] text-white/45">{playbackProgress.status}{playbackProgress.duration > 0 ? " · " + Math.floor(playbackProgress.currentTime / 60) + ":" + String(Math.floor(playbackProgress.currentTime % 60)).padStart(2, "0") + " / " + Math.floor(playbackProgress.duration / 60) + ":" + String(Math.floor(playbackProgress.duration % 60)).padStart(2, "0") : ""}</p>
          </div>
          <button type="button" onClick={closePlayback} aria-label="Close player" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/[0.08] text-white/75 backdrop-blur-xl transition hover:bg-white/[0.16]"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1">
          <MediaPlayer request={activePlayback.request} title={activePlayback.title} onPlaybackEvent={handlePlaybackEvent} onClose={closePlayback} />
        </div>
      </section> : null}
    </main>
  )
}
