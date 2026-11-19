"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { ArrowLeft, CalendarDays, ChevronRight, Clapperboard, ExternalLink, Film, Play, Search, Star, Tv, X } from "lucide-react"
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

const imageUrl = (path: string | null, size = "w500") => path ? "https://image.tmdb.org/t/p/" + size + path : null
const year = (date: string | null) => date && /^\d{4}/.test(date) ? date.slice(0, 4) : ""
const rating = (value: number) => Number.isFinite(value) && value > 0 ? value.toFixed(1) : "NR"

async function api<T>(params: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/tmdb?" + params.toString(), { credentials: "same-origin", cache: "no-store", signal })
  const body = await response.json().catch(() => ({})) as { error?: unknown }
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "The catalogue request failed.")
  return body as T
}

function Poster({ item }: { item: SynnFlixMediaItem }) {
  const src = imageUrl(item.posterPath, "w342")
  return (
    <div role="img" aria-label={item.title + " poster"} className="relative aspect-[2/3] overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-white/10 to-white/[0.02] shadow-xl shadow-black/30" style={src ? { backgroundImage: "url(" + JSON.stringify(src) + ")", backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
      {!src ? <div className="grid h-full place-items-center text-white/25">{item.mediaType === "movie" ? <Film className="h-9 w-9" /> : <Tv className="h-9 w-9" />}</div> : null}
      <span className="absolute left-2 top-2 rounded-lg border border-white/15 bg-black/55 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/85 backdrop-blur-xl">{item.mediaType === "movie" ? "Film" : "Series"}</span>
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/90 to-transparent px-2.5 pb-2.5 pt-8 text-[11px] text-white/85"><span className="flex items-center gap-1"><Star className="h-3 w-3 fill-current" />{rating(item.voteAverage)}</span><span>{year(item.releaseDate)}</span></span>
    </div>
  )
}

function MediaCard({ item, onSelect }: { item: SynnFlixMediaItem; onSelect: (item: SynnFlixMediaItem) => void }) {
  return (
    <button type="button" onClick={() => onSelect(item)} aria-label={"View " + item.title + " details"} className="group w-[138px] shrink-0 text-left sm:w-[158px]">
      <span className="block transition duration-200 group-hover:-translate-y-1 group-hover:drop-shadow-[0_12px_20px_rgba(0,0,0,.4)]"><Poster item={item} /></span>
      <strong className="mt-2 block truncate text-[13px] font-medium text-white/90 group-hover:text-white">{item.title}</strong>
      <span className="mt-0.5 block text-[11px] text-white/45">{item.mediaType === "movie" ? "Movie" : "TV"}{year(item.releaseDate) ? " · " + year(item.releaseDate) : ""}</span>
    </button>
  )
}

function Rail({ title, items, onSelect }: { title: string; items: SynnFlixMediaItem[]; onSelect: (item: SynnFlixMediaItem) => void }) {
  if (!items.length) return null
  return <section className="mb-8"><div className="mb-3 flex items-center justify-between px-1"><h2 className="text-sm font-semibold tracking-wide text-white/90">{title}</h2><span className="text-[10px] uppercase tracking-[.18em] text-white/35">{items.length} titles</span></div><div className="custom-scroll flex gap-3 overflow-x-auto px-1 pb-3">{items.map((item) => <MediaCard key={item.mediaType + ":" + item.id} item={item} onSelect={onSelect} />)}</div></section>
}

export function MediaCatalogPanel({ mode }: { mode: Mode }) {
  const isAnime = mode === "anime"
  const appName = isAnime ? "Synnime" : "SynnFlix"
  const [home, setHome] = useState<SynnFlixHomeData | null>(null)
  const [homeLoading, setHomeLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SynnFlixMediaItem[]>([])
  const [searchType, setSearchType] = useState<SearchType>("all")
  const [searchActive, setSearchActive] = useState(false)
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
    setPlaybackProgress((previous) => ({
      currentTime: event.currentTime,
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
        currentTime: event.currentTime, duration: event.duration, completed: event.event === "ended",
        poster, backdrop,
      }),
    }).catch(() => {})
  }, [activePlayback])
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
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 opacity-80" style={{ background: "radial-gradient(ellipse at 12% 0%, rgba(74,112,168,.20), transparent 42%), radial-gradient(ellipse at 92% 28%, rgba(121,83,160,.12), transparent 34%)" }} />
      <div className="relative mx-auto w-full max-w-[1500px] px-4 pb-12 pt-7 sm:px-7 lg:px-10">
        <header className="mb-7 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.28em] text-white/40">{isAnime ? <Tv className="h-3.5 w-3.5" /> : <Clapperboard className="h-3.5 w-3.5" />}Synnical entertainment</div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{appName}<span className="ml-2 text-white/35">.</span></h1>
            <p className="mt-2 max-w-xl text-sm text-white/50">{isAnime ? "Japanese animation, films and series, gathered in one catalogue." : "Discover films and series, with UK viewing availability and rich title details."}</p>
          </div>
          <form onSubmit={search} className="flex w-full max-w-2xl items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.075] p-2 shadow-[0_12px_55px_rgba(0,0,0,.28),inset_0_1px_0_rgba(255,255,255,.12)] backdrop-blur-2xl transition focus-within:border-white/30 focus-within:bg-white/[0.10]">
            <Search className="ml-2 h-5 w-5 shrink-0 text-white/50" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isAnime ? "Search anime titles…" : "Search films and series…"} aria-label={"Search " + appName} className="h-10 min-w-0 flex-1 bg-transparent px-1 text-sm text-white outline-none placeholder:text-white/35" />
            {query ? <button type="button" onClick={() => { searchController.current?.abort(); setSearching(false); setQuery(""); setSearchActive(false); setSearchResults([]) }} aria-label="Clear search" className="grid h-9 w-9 place-items-center rounded-xl text-white/55 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button> : null}
            <button type="submit" disabled={searching || !query.trim()} className="rounded-xl border border-white/15 bg-white/[0.12] px-4 py-2.5 text-xs font-semibold text-white shadow-lg backdrop-blur-xl transition hover:bg-white/[0.2] disabled:cursor-not-allowed disabled:opacity-40">{searching ? "Searching…" : "Search"}</button>
          </form>
        </header>

        {error ? <div role="alert" className="mb-6 rounded-2xl border border-amber-200/20 bg-amber-100/[0.07] px-4 py-3 text-sm text-amber-100/90 backdrop-blur-xl">{error}</div> : null}

        {searchActive ? <section>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-[10px] uppercase tracking-[.22em] text-white/40">Search results</p><h2 className="mt-1 text-xl font-semibold">“{query.trim()}”</h2></div>
            <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.06] p-1 backdrop-blur-xl">
              {(["all", "movie", "tv"] as SearchType[]).map((value) => <button key={value} type="button" onClick={() => setSearchType(value)} className={"rounded-lg px-3 py-2 text-xs transition " + (searchType === value ? "bg-white/[0.16] text-white shadow" : "text-white/50 hover:text-white")}>{value === "all" ? "All" : value === "movie" ? "Films" : "Series"}</button>)}
            </div>
          </div>
          {searching ? <p className="py-16 text-center text-sm text-white/45" role="status">Searching TMDB…</p> : visibleResults.length ? <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">{visibleResults.map((item) => <MediaCard key={item.mediaType + ":" + item.id} item={item} onSelect={openDetails} />)}</div> : <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-12 text-center text-sm text-white/45">No matching titles found.</p>}
        </section> : homeLoading ? <div className="grid min-h-[360px] place-items-center text-sm text-white/45" role="status">Loading {appName} catalogue…</div> : home ? <>
          {hero ? <section className="relative mb-9 min-h-[250px] overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/30 sm:min-h-[310px]">
            <div className="absolute inset-0 bg-cover bg-center opacity-70" style={hero.backdropPath ? { backgroundImage: "url(" + JSON.stringify(imageUrl(hero.backdropPath, "w1280")) + ")" } : undefined} />
            <div className="absolute inset-0 bg-gradient-to-r from-[#050608] via-[#050608]/85 to-[#050608]/15" /><div className="absolute inset-0 bg-gradient-to-t from-[#050608]/85 via-transparent to-black/10" />
            <div className="relative flex min-h-[250px] max-w-2xl flex-col items-start justify-end p-6 sm:min-h-[310px] sm:p-9">
              <span className="mb-3 rounded-full border border-white/15 bg-white/[0.09] px-3 py-1 text-[9px] font-semibold uppercase tracking-[.2em] text-white/70 backdrop-blur-xl">{isAnime ? "Popular anime" : "Trending this week"}</span>
              <h2 className="max-w-xl text-2xl font-semibold tracking-tight sm:text-4xl">{hero.title}</h2>
              <p className="mt-3 line-clamp-3 max-w-xl text-sm leading-6 text-white/65">{hero.overview || "Explore the details and viewing availability."}</p>
              <button type="button" onClick={() => openDetails(hero)} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/[0.14] px-4 py-2.5 text-xs font-semibold backdrop-blur-xl transition hover:bg-white/[0.22]">Explore title <ChevronRight className="h-4 w-4" /></button>
            </div>
          </section> : null}
          {isAnime ? <>
            <Rail title="Popular anime films" items={home.popularMovies} onSelect={openDetails} />
            <Rail title="Popular anime series" items={home.popularTv} onSelect={openDetails} />
            <Rail title="Top-rated anime films" items={home.topRatedMovies} onSelect={openDetails} />
            <Rail title="Top-rated anime series" items={home.topRatedTv} onSelect={openDetails} />
          </> : <>
            <Rail title="Trending now" items={home.trending} onSelect={openDetails} />
            <Rail title="Popular films" items={home.popularMovies} onSelect={openDetails} />
            <Rail title="Popular series" items={home.popularTv} onSelect={openDetails} />
            <Rail title="Top-rated films" items={home.topRatedMovies} onSelect={openDetails} />
            <Rail title="Top-rated series" items={home.topRatedTv} onSelect={openDetails} />
          </>}
        </> : null}
        <footer className="mt-10 border-t border-white/10 pt-5 text-[10px] leading-5 text-white/35">This product uses the TMDB API but is not endorsed or certified by TMDB. Viewing availability reflects the UK region where TMDB has provider data.</footer>
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
          <button type="button" onClick={() => { const playback = activePlayback; if (playback && (playbackProgress.currentTime > 0 || playbackProgress.duration > 0)) { lastProgressSaveRef.current = Date.now(); void fetch("/api/features/media", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "progress", mediaType: playback.request.mediaType, mediaId: String(playback.request.mediaId), title: playback.mediaTitle, season: playback.request.season ?? 0, episode: playback.request.episode ?? 0, currentTime: playbackProgress.currentTime, duration: playbackProgress.duration, poster: playback.poster, backdrop: playback.backdrop }) }).catch(() => {}) } setActivePlayback(null) }} aria-label="Close player" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/[0.08] text-white/75 backdrop-blur-xl transition hover:bg-white/[0.16]"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1">
          <MediaPlayer request={activePlayback.request} title={activePlayback.title} onPlaybackEvent={handlePlaybackEvent} />
        </div>
      </section> : null}
    </main>
  )
}
