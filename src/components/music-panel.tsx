"use client"

import { useAuth } from "@/hooks/use-auth"
import { MusicBackground } from "./music-background"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  Heart,
  ListMusic,
  Loader2,
  Music2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  Server,
  SkipBack,
  SkipForward,
  Volume2,
  Waves,
  Trophy,
} from "lucide-react"
import type { MusicProviderStatus, MusicTrack } from "@/lib/music-types"
import { readSetting, useSetting, writeSetting } from "@/lib/settings-runtime"
import { cn } from "@/lib/utils"
import { featureApi } from "@/lib/feature-api"
import { MusicSocialPanel } from "@/components/music-social-panel"

type Source = "audius" | "bridge" | "soundcloud" | "cobalt" | "radio" | "social"

const RADIO_STATIONS = [
  { name: "SomaFM Groove Salad", owner: "SomaFM", url: "https://ice1.somafm.com/groovesalad-128-mp3" },
  { name: "SomaFM Lush", owner: "SomaFM", url: "https://ice1.somafm.com/lush-128-mp3" },
  { name: "SomaFM DEF CON", owner: "SomaFM", url: "https://ice1.somafm.com/defcon-128-mp3" },
]

const EMPTY_STATUS: MusicProviderStatus = {
  audius: { available: true, authenticated: false },
  piped: { available: false },
  invidious: { available: false },
  cobalt: { available: false },
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--:--"
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${String(secs).padStart(2, "0")}`
}

function formatCount(value?: number | null) {
  if (!value) return ""
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value)
}

function trackKey(track: Pick<MusicTrack, "provider" | "id">) {
  return `${track.provider}:${track.id}`
}

function streamUrl(track: MusicTrack) {
  if (track.provider === "audius") return `/api/music/audius/stream/${encodeURIComponent(track.id)}`
  if (track.provider === "piped" || track.provider === "invidious") {
    return `/api/music/bridge/stream?provider=${track.provider}&id=${encodeURIComponent(track.id)}`
  }
  return track.sourceUrl || ""
}

function SoundCloudWidget({ url, onBack }: { url: string; onBack: () => void }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const parent = host.current
    if (!parent) return
    parent.replaceChildren()
    const iframe = document.createElement("iframe")
    ;(iframe as HTMLIFrameElement & { credentialless?: boolean }).credentialless = true
    iframe.title = "Embedded player"
    iframe.width = "100%"
    iframe.height = "100%"
    iframe.frameBorder = "0"
    iframe.allow = "autoplay"
    iframe.setAttribute("scrolling", "no")
    const target = new URL("https://w.soundcloud.com/player/")
    target.searchParams.set("url", url)
    target.searchParams.set("auto_play", "true")
    target.searchParams.set("visual", "true")
    target.searchParams.set("show_artwork", "true")
    target.searchParams.set("show_comments", "false")
    target.searchParams.set("show_reposts", "false")
    iframe.src = target.toString()
    iframe.className = "h-full min-h-[420px] w-full bg-black"
    parent.appendChild(iframe)
    return () => iframe.remove()
  }, [url])

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/10 px-4">
        <button onClick={onBack} className="rounded-lg p-2 text-white/55 hover:bg-white/10 hover:text-white" aria-label="Back to Music"><ArrowLeft className="h-4 w-4" /></button>
        <Music2 className="h-4 w-4" />
        <span className="text-sm font-medium">Embedded player</span>
      </div>
      <div ref={host} className="min-h-0 flex-1 bg-black" />
    </div>
  )
}

export function MusicPanel() {
  const { user } = useAuth()
  const [library, setLibrary] = useState<{ favorites: MusicTrack[]; history: MusicTrack[] }>({ favorites: [], history: [] })
  const [libraryView, setLibraryView] = useState<"browse" | "favorites" | "history">("browse")
  const reloadLibrary = useCallback(async () => {
    const response = await fetch("/api/music/library", { cache: "no-store" })
    if (!response.ok) return
    const data = await response.json()
    setLibrary(data); setFavorites(new Set((data.favorites as MusicTrack[]).map(trackKey)))
  }, [])
  useEffect(() => { if (user) void reloadLibrary() }, [user?.id, reloadLibrary])

  const [repeat, setRepeat] = useSetting<string>("music.repeat", "off")
  const [shuffle, setShuffle] = useSetting<boolean>("music.shuffle", false)
  const [storedSource, setStoredSource] = useSetting<string>("music.source", "audius")
  const source: Source = ["audius", "bridge", "soundcloud", "cobalt", "radio", "social"].includes(storedSource) ? storedSource as Source : "audius"
  const [volume, setVolume] = useSetting<number>("music.volume", 100)
  const [outputVolume] = useSetting<number>("voice.outputVolume", 100)
  const [outputDevice] = useSetting<string>("voice.outputDevice", "default")
  const [query, setQuery] = useState("")
  const [tracks, setTracks] = useState<MusicTrack[]>([])
  const [queue, setQueue] = useState<MusicTrack[]>([])
  const [current, setCurrent] = useState<MusicTrack | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [status, setStatus] = useState<MusicProviderStatus>(EMPTY_STATUS)
  const [isPlaying, setIsPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set())
  const [soundCloudInput, setSoundCloudInput] = useState("")
  const [soundCloudUrl, setSoundCloudUrl] = useState("")
  const [cobaltInput, setCobaltInput] = useState("")
  const [radioIndex, setRadioIndex] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const richPresenceTrackRef = useRef<string | null>(null)
  const richPresenceStartedRef = useRef<string | null>(null)

  useEffect(() => {
    const handler = (event: Event) => {
      const mute = (event as CustomEvent<{ mute?: unknown }>).detail?.mute !== false
      if (audioRef.current) audioRef.current.muted = mute
      window.dispatchEvent(new CustomEvent("synnical-music-muted", { detail: { muted: mute } }))
    }
    window.addEventListener("synnical-music-mute", handler)
    return () => window.removeEventListener("synnical-music-mute", handler)
  }, [])
  const [musicFeatures, setMusicFeatures] = useState<any>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const [dragQueueIndex, setDragQueueIndex] = useState<number | null>(null)

  const refreshMusicFeatures = useCallback(async () => {
    try { setMusicFeatures(await featureApi.music.state()) } catch {}
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/music/providers", { credentials: "include" })
      if (response.ok) setStatus(await response.json() as MusicProviderStatus)
    } catch {
      /* Audius still remains the default provider. */
    }
  }, [])

  const loadAudius = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/music/audius/discover", { credentials: "include" })
      const body = await response.json().catch(() => ({})) as { tracks?: MusicTrack[]; error?: string }
      if (!response.ok) throw new Error(body.error || "Music could not load")
      setTracks(Array.isArray(body.tracks) ? body.tracks : [])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Music could not load")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
    void loadAudius()
    void refreshMusicFeatures()
  }, [loadAudius, loadStatus, refreshMusicFeatures])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const effectiveVolume = (Math.max(0, Math.min(100, volume)) / 100) * (Math.max(0, Math.min(100, outputVolume)) / 100)
    audio.volume = Math.max(0, Math.min(1, effectiveVolume))
    const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> }
    if (typeof sinkAudio.setSinkId === "function") {
      void sinkAudio.setSinkId(outputDevice === "default" ? "" : outputDevice).catch(() => {})
    }
  }, [volume, outputVolume, outputDevice, current])

  useEffect(() => {
    const handler = (event: Event) => {
      const track = (event as CustomEvent<{ title?: unknown; artist?: unknown }>).detail
      const title = typeof track?.title === "string" ? track.title : ""
      const artist = typeof track?.artist === "string" ? track.artist : ""
      const value = [title, artist].filter(Boolean).join(" ").trim()
      if (!value) return
      setQuery(value)
      requestAnimationFrame(() => {
        const form = document.querySelector('[data-synnical-music-search]') as HTMLFormElement | null
        form?.requestSubmit()
      })
    }
    window.addEventListener("synnical-music-open-track", handler)
    return () => window.removeEventListener("synnical-music-open-track", handler)
  }, [])

  const playTrack = useCallback((track: MusicTrack, list = tracks) => {
    setCurrent(track)
    setQueue(list.length ? list : [track])
    setPosition(0)
    setDuration(track.duration || 0)
    setError("")
    requestAnimationFrame(() => {
      const audio = audioRef.current
      if (!audio) return
      audio.load()
      void audio.play().catch(() => setIsPlaying(false))
    })
  }, [tracks, reloadLibrary])

  const publishMusicActivity = useCallback(async () => {
    if (!musicFeatures) return
    const result = await featureApi.music.action("activity", { track: current, isPlaying, shareEnabled: musicFeatures?.activity?.shareEnabled !== false })
    if (result?.activity) setMusicFeatures((previous: any) => previous ? { ...previous, activity: result.activity } : previous)
  }, [current, isPlaying, Boolean(musicFeatures), musicFeatures?.activity?.shareEnabled])

  useEffect(() => {
    if (!musicFeatures) return
    const timer = window.setTimeout(() => {
      void publishMusicActivity().catch(() => undefined)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [publishMusicActivity, Boolean(musicFeatures)])

  const clearMusicActivity = useCallback(async () => {
    try {
      if (musicFeatures?.activity?.shareEnabled === false) return
      await featureApi.music.action("activity", { clear: true, isPlaying: false, shareEnabled: musicFeatures?.activity?.shareEnabled !== false })
      setMusicFeatures((previous: any) => previous ? { ...previous, activity: previous.activity ? { ...previous.activity, trackId: null, title: null, artist: null, artwork: null, isPlaying: false } : previous.activity } : previous)
    } catch {}
  }, [musicFeatures?.activity?.shareEnabled])

  useEffect(() => {
    if (!current || musicFeatures?.activity?.shareEnabled === false) {
      window.dispatchEvent(new CustomEvent("synnical-rich-presence", { detail: { source: "music", activity: null } }))
      richPresenceTrackRef.current = null
      richPresenceStartedRef.current = null
      if (!current) void clearMusicActivity()
      return
    }
    const key = trackKey(current)
    if (richPresenceTrackRef.current !== key) {
      richPresenceTrackRef.current = key
      richPresenceStartedRef.current = new Date().toISOString()
    }
    window.dispatchEvent(new CustomEvent("synnical-rich-presence", { detail: { source: "music", activity: {
      kind: "listening",
      name: current.title,
      details: current.artist || current.provider,
      state: isPlaying ? "Playing" : "Paused",
      artwork: current.artwork || null,
      startedAt: richPresenceStartedRef.current,
    } } }))
    void publishMusicActivity().catch(() => undefined)
    return () => { window.dispatchEvent(new CustomEvent("synnical-rich-presence", { detail: { source: "music", activity: null } })) }
  }, [clearMusicActivity, current, isPlaying, musicFeatures?.activity?.shareEnabled, publishMusicActivity])

  const saveQueuePlaylist = useCallback(async () => {
    const name = window.prompt("Playlist name")?.trim()
    if (!name) return
    await featureApi.music.action("save-playlist", { name, tracks: queue })
    await refreshMusicFeatures()
  }, [queue, refreshMusicFeatures])

  const loadPlaylist = useCallback((playlist: any) => {
    const list: MusicTrack[] = Array.isArray(playlist?.tracks) ? playlist.tracks.map((track: any) => ({
      id: String(track.trackId), provider: (["audius", "piped", "invidious", "cobalt"].includes(track.provider) ? track.provider : "audius") as MusicTrack["provider"], title: String(track.title || track.trackId), artist: String(track.artist || ""), artwork: track.artwork || null, duration: Number(track.duration) || 0, sourceUrl: track.streamUrl || null,
    })) : []
    setQueue(list)
    if (list[0]) playTrack(list[0], list)
  }, [playTrack])

  const reorderQueue = useCallback((from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return
    setQueue((previous) => {
      const next = [...previous]
      const [moved] = next.splice(from, 1)
      if (moved) next.splice(to, 0, moved)
      return next
    })
  }, [])

  const search = async () => {
    setLibraryView("browse")
    const value = query.trim()
    if (!value) return source === "audius" ? void loadAudius() : undefined
    setLoading(true)
    setError("")
    try {
      const endpoint = source === "bridge" ? `/api/music/bridge/search?q=${encodeURIComponent(value)}` : `/api/music/audius/search?q=${encodeURIComponent(value)}`
      const response = await fetch(endpoint, { credentials: "include" })
      const body = await response.json().catch(() => ({})) as { tracks?: MusicTrack[]; error?: string }
      if (!response.ok) throw new Error(body.error || "Search failed")
      setTracks(Array.isArray(body.tracks) ? body.tracks : [])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Search failed")
      setTracks([])
    } finally {
      setLoading(false)
    }
  }

  const toggleFavorite = async (track: MusicTrack) => {
    if (track.provider === "audius") {
      const response = await fetch("/api/music/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "favorite", track, remove: favorites.has(trackKey(track)) }) });
      if (!response.ok) { setError((await response.json()).error || "Could not save favorite"); return }
      await reloadLibrary(); return
    }
    const key = trackKey(track)
    const next = new Set(favorites)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setFavorites(next)
    writeSetting("music.favorites", [...next])
  }

  const stepQueue = useCallback((direction: -1 | 1) => {
    if (!current || queue.length < 2) return
    const index = queue.findIndex((item) => trackKey(item) === trackKey(current))
    if (index < 0) return
    const nextIndex = shuffle && direction === 1 ? (index + 1 + Math.floor(Math.random() * (queue.length - 1))) % queue.length : (index + direction + queue.length) % queue.length
    const next = queue[nextIndex]
    if (next) playTrack(next, queue)
  }, [current, queue, playTrack, shuffle])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("synnical-media-state", { detail: { panel: "music", title: current?.title || "Music", subtitle: current?.artist || "", playing: isPlaying, canNext: Boolean(current && queue.length > 1), canPrevious: Boolean(current && queue.length > 1) } }))
  }, [current, isPlaying, queue.length])

  useEffect(() => {
    const command = (event: Event) => {
      const detail = (event as CustomEvent<{ panel?: unknown; command?: unknown }>).detail
      if (detail?.panel !== "music") return
      if (detail.command === "next") return stepQueue(1)
      if (detail.command === "previous") return stepQueue(-1)
      if (detail.command === "toggle") { const audio = audioRef.current; if (!audio || !current) return; if (audio.paused) void audio.play().catch(() => setIsPlaying(false)); else audio.pause() }
    }
    window.addEventListener("synnical-media-command", command)
    return () => window.removeEventListener("synnical-media-command", command)
  }, [current, stepQueue])

  const openSoundCloud = () => {
    const raw = soundCloudInput.trim()
    if (!raw) return
    try {
      const parsed = new URL(raw)
      if (!/(^|\.)soundcloud\.com$/i.test(parsed.hostname)) throw new Error()
      setSoundCloudUrl(parsed.toString())
      setError("")
    } catch {
      setError("Paste a valid supported music URL")
    }
  }

  const resolveCobalt = async () => {
    if (!cobaltInput.trim()) return
    setLoading(true)
    setError("")
    try {
      const response = await fetch("/api/music/cobalt/resolve", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: cobaltInput.trim() }),
      })
      const body = await response.json().catch(() => ({})) as { url?: string; error?: string }
      if (!response.ok || !body.url) throw new Error(body.error || "Music import could not resolve that URL")
      const synthetic: MusicTrack = {
        id: `cobalt-${Date.now()}`,
        provider: "cobalt",
        title: "Imported audio",
        artist: new URL(cobaltInput.trim()).hostname,
        artwork: null,
        duration: 0,
        sourceUrl: body.url,
      }
      playTrack(synthetic, [synthetic])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Music import could not resolve that URL")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return
    navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.artist, artwork: current.artwork ? [{ src: current.artwork }] : [] })
    const actions: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => { void audioRef.current?.play().catch(() => setError("Playback was blocked")) },
      pause: () => audioRef.current?.pause(),
      nexttrack: () => stepQueue(1), previoustrack: () => stepQueue(-1),
      seekto: detail => { if (audioRef.current && typeof detail.seekTime === "number") audioRef.current.currentTime = detail.seekTime },
    }
    for (const [action, handler] of Object.entries(actions)) try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler!) } catch {}
    return () => { for (const action of Object.keys(actions)) try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, null) } catch {} }
  }, [current, stepQueue])
  useEffect(() => { if ("mediaSession" in navigator) navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused" }, [isPlaying])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.documentElement.dataset.synnicalPanel !== "music" || (event.target instanceof Element && event.target.closest("input,textarea,select,button,[contenteditable]"))) return
      const audio = audioRef.current; if (!audio) return
      if (event.code === "Space") { event.preventDefault(); if (audio.paused) void audio.play().catch(() => setError("Playback was blocked")); else audio.pause() }
      if (event.key === "ArrowRight") audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5)
      if (event.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 5)
    }
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey)
  }, [])

  const bridgeAvailable = status.piped.available || status.invidious.available

  const currentStream = useMemo(() => current ? streamUrl(current) : "", [current])

  if (source === "soundcloud" && soundCloudUrl) {
    return <SoundCloudWidget url={soundCloudUrl} onBack={() => setSoundCloudUrl("")} />
  }

  return (
    <section className="synnical-music relative isolate flex h-full min-h-0 flex-col overflow-hidden"><MusicBackground />
      <header className="synnical-music-header shrink-0 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto min-w-[180px]">
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[var(--synnical-muted)]">Synnical</p>
            <div className="mt-1 flex items-center gap-2"><Waves className="h-5 w-5" /><h1 className="text-xl font-semibold">Music</h1></div>
          </div>
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-white/10 bg-black p-1">
            <button className="px-3 text-xs" onClick={() => { setStoredSource("audius"); setLibraryView("favorites") }}>Favorites</button>
            <button className="px-3 text-xs" onClick={() => { setStoredSource("audius"); setLibraryView("history") }}>Recently played</button>
            <SourceButton active={source === "audius"} onClick={() => { setStoredSource("audius"); setLibraryView("browse"); void loadAudius() }} icon={Waves} label="Home" />
            <SourceButton active={source === "bridge"} onClick={() => setStoredSource("bridge")} icon={Server} label="Search" disabled={!bridgeAvailable} />
            <SourceButton active={source === "soundcloud"} onClick={() => setStoredSource("soundcloud")} icon={Music2} label="Import" />
            <SourceButton active={source === "cobalt"} onClick={() => setStoredSource("cobalt")} icon={ExternalLink} label="Link" disabled={!status.cobalt.available} />
            <SourceButton active={source === "radio"} onClick={() => setStoredSource("radio")} icon={Radio} label="Radio" />
            <SourceButton active={source === "social"} onClick={() => setStoredSource("social")} icon={Trophy} label="Social" />
          </div>
        </div>
      </header>

      {error ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-500/20 bg-red-950/25 px-5 py-2.5 text-xs text-red-200"><AlertCircle className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{error}</span><button onClick={() => setError("")} className="text-white/60 hover:text-white">Dismiss</button></div>
      ) : null}

      <div className="shrink-0 border-b border-white/8 bg-black/40 px-4 py-2">
        <div className="mx-auto flex max-w-6xl items-center gap-2 overflow-x-auto">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-white/30">Playlists</span>
          {musicFeatures?.playlists?.map((playlist: any) => <button key={playlist.id} type="button" onClick={() => loadPlaylist(playlist)} className="shrink-0 rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/60 hover:border-white/30 hover:text-white">{playlist.name} · {playlist.tracks?.length || 0}</button>)}
          <button type="button" disabled={!queue.length} onClick={() => void saveQueuePlaylist()} className="shrink-0 rounded-full border border-white/10 px-3 py-1 text-[11px] disabled:opacity-30">Save queue</button>
          <label className="ml-auto flex shrink-0 items-center gap-2 text-[10px] text-white/45"><input type="checkbox" checked={musicFeatures?.activity?.shareEnabled !== false} onChange={async (event) => { const result = await featureApi.music.action("activity", { track: current, isPlaying, shareEnabled: event.target.checked }); setMusicFeatures((previous: any) => previous ? { ...previous, activity: result.activity } : previous) }} />Share listening activity</label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto custom-scroll">
        {(source === "audius" || source === "bridge") && (
          <div className="mx-auto max-w-6xl p-5 pb-32">
            <form data-synnical-music-search onSubmit={(event) => { event.preventDefault(); void search() }} className="mb-5 flex items-center gap-2 rounded-xl border border-white/10 bg-[#080808] p-2">
              <Search className="ml-2 h-4 w-4 text-white/35" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm outline-none" placeholder={source === "audius" ? "Search music and artists" : "Search imported music"} />
              <button type="submit" disabled={loading} className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}</button>
              {source === "audius" ? <button type="button" onClick={() => void loadAudius()} className="rounded-lg p-2 text-white/45 hover:bg-white/10 hover:text-white" aria-label="Refresh trending"><RefreshCw className="h-4 w-4" /></button> : null}
            </form>

            {source === "bridge" && !bridgeAvailable ? (
              <ProviderSetup title="Search source is not configured" detail="This music source is unavailable in the current build." />
            ) : loading && libraryView === "browse" && tracks.length === 0 ? (
              <div className="grid min-h-[320px] place-items-center text-white/40"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : (libraryView === "browse" ? tracks : library[libraryView]).length === 0 ? (
              <div className="grid min-h-[320px] place-items-center text-sm text-white/35">No tracks to show.</div>
            ) : (
              <>
                <div className="mb-3 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-white/35">{source === "audius" && !query.trim() ? "Featured" : "Results"}</p><h2 className="mt-1 text-lg font-semibold">{source === "audius" ? "Home" : "Search"}</h2></div>{source === "audius" ? <span className="text-[10px] text-white/30">{status.audius.authenticated ? "Enhanced access enabled" : "Public catalog"}</span> : null}</div>
                <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
                  {(libraryView === "browse" ? tracks : library[libraryView]).map((track, index) => <TrackRow key={trackKey(track)} track={track} index={index} active={Boolean(current && trackKey(current) === trackKey(track))} favorite={favorites.has(trackKey(track))} onPlay={() => playTrack(track, libraryView === "browse" ? tracks : library[libraryView])} onFavorite={() => toggleFavorite(track)} />)}
                </div>
              </>
            )}
          </div>
        )}

        {source === "soundcloud" && (
          <div className="mx-auto max-w-3xl p-6 pb-32">
            <div className="rounded-2xl border border-white/10 bg-black/40 p-6">
              <Music2 className="h-7 w-7 text-orange-300" />
              <h2 className="mt-4 text-xl font-semibold">Link player</h2>
              <p className="mt-2 text-sm leading-6 text-white/45">Paste a track, playlist, or artist URL from a supported music service. Synnical opens the official embed instead of routing it through the browser.</p>
              <div className="mt-5 flex gap-2 rounded-xl border border-white/10 bg-black p-2"><input value={soundCloudInput} onChange={(event) => setSoundCloudInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") openSoundCloud() }} placeholder="https://..." className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none" /><button onClick={openSoundCloud} className="rounded-lg bg-orange-300/15 px-4 py-2 text-sm text-orange-100 hover:bg-orange-300/25">Open player</button></div>
            </div>
          </div>
        )}

        {source === "cobalt" && (
          <div className="mx-auto max-w-3xl p-6 pb-32">
            {status.cobalt.available ? (
              <div className="rounded-2xl border border-white/10 bg-black/40 p-6"><ExternalLink className="h-7 w-7" /><h2 className="mt-4 text-xl font-semibold">Direct link import</h2><p className="mt-2 text-sm leading-6 text-white/45">Paste a supported media URL and Synnical will resolve it into the player.</p><div className="mt-5 flex gap-2 rounded-xl border border-white/10 bg-black p-2"><input value={cobaltInput} onChange={(event) => setCobaltInput(event.target.value)} placeholder="Paste a supported media URL" className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none" /><button onClick={() => void resolveCobalt()} disabled={loading} className="rounded-lg bg-white px-4 py-2 text-sm text-black disabled:opacity-40">Resolve audio</button></div></div>
            ) : <ProviderSetup title="Import source is not configured" detail="This music source is unavailable in the current build." />}
          </div>
        )}

        {source === "radio" && (
          <div className="mx-auto max-w-3xl p-6 pb-32"><div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">{RADIO_STATIONS.map((station, index) => <button key={station.url} onClick={() => { setRadioIndex(index); const synthetic: MusicTrack = { id: `radio-${index}`, provider: "cobalt", title: station.name, artist: station.owner, duration: 0, sourceUrl: station.url }; playTrack(synthetic, [synthetic]) }} className={cn("flex w-full items-center gap-3 border-b border-white/8 px-4 py-3 text-left last:border-0 hover:bg-white/[.04]", radioIndex === index && current?.id === `radio-${index}` && "bg-white/10")}><span className="grid h-9 w-9 place-items-center rounded-full bg-white/10"><Play className="h-4 w-4" fill="currentColor" /></span><span><strong className="block text-sm">{station.name}</strong><small className="text-white/40">{station.owner}</small></span></button>)}</div></div>
        )}

        {source === "social" && <MusicSocialPanel />}
      </div>

      {queueOpen ? <div className="absolute bottom-[76px] right-4 z-30 max-h-[45vh] w-[min(420px,calc(100%-2rem))] overflow-y-auto rounded-xl border border-white/12 bg-black/95 p-2 shadow-2xl">
        <div className="mb-2 flex items-center justify-between px-2"><strong className="text-xs">Queue · drag to reorder</strong><button onClick={() => setQueueOpen(false)} className="text-xs text-white/40">Close</button></div>
        {queue.length ? queue.map((track, index) => <div key={`${trackKey(track)}:${index}`} draggable onDragStart={() => setDragQueueIndex(index)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragQueueIndex !== null) reorderQueue(dragQueueIndex, index); setDragQueueIndex(null) }} className={cn("flex cursor-grab items-center gap-2 rounded-lg px-2 py-2 text-xs hover:bg-white/5", current && trackKey(current) === trackKey(track) && "bg-white/8")}>
          <span className="w-5 text-white/30">{index + 1}</span><span className="min-w-0 flex-1"><strong className="block truncate">{track.title}</strong><small className="block truncate text-white/35">{track.artist}</small></span><button onClick={() => playTrack(track, queue)} className="rounded p-1 hover:bg-white/10"><Play className="h-3.5 w-3.5" /></button>
        </div>) : <p className="p-4 text-center text-xs text-white/35">Queue is empty.</p>}
      </div> : null}

      <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-white/10 bg-black/40/95 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <div className="flex min-w-0 w-[min(32vw,310px)] items-center gap-3">
            <div className="h-11 w-11 shrink-0 overflow-hidden rounded-md bg-[#111]">{current?.artwork ? <img src={current.artwork} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center"><Music2 className="h-5 w-5 text-white/25" /></div>}</div>
            <div className="min-w-0"><p className="truncate text-sm font-medium">{current?.title || "Nothing playing"}</p><p className="truncate text-xs text-white/40">{current?.artist || "Choose a track"}</p></div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center justify-center gap-2"><button className="text-xs" aria-pressed={shuffle} onClick={() => setShuffle(!shuffle)}>Shuffle{shuffle ? " on" : ""}</button><button className="text-xs" aria-label={`Repeat: ${repeat}`} onClick={() => setRepeat(repeat === "off" ? "all" : repeat === "all" ? "one" : "off")}>Repeat: {repeat}</button><button onClick={() => stepQueue(-1)} disabled={!current || queue.length < 2} className="rounded-full p-1.5 text-white/55 hover:text-white disabled:opacity-20"><SkipBack className="h-4 w-4" fill="currentColor" /></button><button onClick={() => { const audio = audioRef.current; if (!audio || !current) return; if (audio.paused) void audio.play().catch(() => setError("Playback was blocked. Try again.")); else audio.pause() }} disabled={!current} className="grid h-9 w-9 place-items-center rounded-full bg-white text-black disabled:opacity-30">{isPlaying ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="ml-0.5 h-4 w-4" fill="currentColor" />}</button><button onClick={() => stepQueue(1)} disabled={!current || queue.length < 2} className="rounded-full p-1.5 text-white/55 hover:text-white disabled:opacity-20"><SkipForward className="h-4 w-4" fill="currentColor" /></button></div>
            <div className="flex items-center gap-2 text-[10px] text-white/35"><span className="w-9 text-right">{formatDuration(position)}</span><input type="range" min={0} max={Math.max(1, duration || current?.duration || 1)} value={Math.min(position, Math.max(1, duration || current?.duration || 1))} onChange={(event) => { const next = Number(event.target.value); setPosition(next); if (audioRef.current) audioRef.current.currentTime = next }} className="min-w-0 flex-1 accent-white" aria-label="Playback position" /><span className="w-9">{formatDuration(duration || current?.duration || 0)}</span></div>
          </div>

          <div className="hidden w-[180px] items-center justify-end gap-2 sm:flex"><Volume2 className="h-4 w-4 text-white/45" /><input type="range" min={0} max={100} value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="w-24 accent-white" aria-label="Music volume" /><button type="button" onClick={() => setQueueOpen((value) => !value)} className="rounded p-1 text-white/45 hover:text-white" aria-label="Open queue"><ListMusic className="h-4 w-4" /></button></div>
        </div>
        <audio ref={audioRef} src={currentStream} preload="metadata" onPlay={() => { setIsPlaying(true); if (current?.provider === "audius") void fetch("/api/music/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "history", track: current }) }).then(response => { if (response.ok) void reloadLibrary() }).catch(() => {}) }} onPause={() => setIsPlaying(false)} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : current?.duration || 0)} onEnded={() => { const audio = audioRef.current; if (repeat === "one" && audio) { audio.currentTime = 0; void audio.play().catch(() => setError("Playback was interrupted")) } else if (repeat === "all" || shuffle || (current && queue.findIndex(track => trackKey(track) === trackKey(current)) < queue.length - 1)) stepQueue(1); else setIsPlaying(false) }} onError={() => { if (current) setError("That audio source could not be played. Try another track or source."); setIsPlaying(false) }} className="hidden" />
      </div>
    </section>
  )
}

function SourceButton({ active, onClick, icon: Icon, label, disabled = false }: { active: boolean; onClick: () => void; icon: typeof Music2; label: string; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} title={disabled ? `${label} is not configured` : label} className={cn("flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs transition-colors", active ? "bg-white text-black" : "text-white/50 hover:bg-white/8 hover:text-white", disabled && "cursor-not-allowed opacity-25")}><Icon className="h-4 w-4" /><span>{label}</span></button>
}

function TrackRow({ track, index, active, favorite, onPlay, onFavorite }: { track: MusicTrack; index: number; active: boolean; favorite: boolean; onPlay: () => void; onFavorite: () => void }) {
  return <div className={cn("group grid grid-cols-[36px_48px_minmax(0,1fr)_100px_52px] items-center gap-3 border-b border-white/7 px-3 py-2 last:border-0 hover:bg-white/[.035] max-sm:grid-cols-[36px_42px_minmax(0,1fr)_42px]", active && "bg-white/[.07]")}><button onClick={onPlay} className="grid h-8 w-8 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white" aria-label={`Play ${track.title}`}>{active ? <Waves className="h-4 w-4" /> : <span className="group-hover:hidden">{index + 1}</span>}<Play className={cn("hidden h-3.5 w-3.5 group-hover:block", active && "hidden group-hover:hidden")} fill="currentColor" /></button><button onClick={onPlay} className="h-11 w-11 overflow-hidden rounded bg-[#111] max-sm:h-10 max-sm:w-10">{track.artwork ? <img src={track.artwork} alt="" className="h-full w-full object-cover" /> : <Music2 className="m-auto h-4 w-4 text-white/20" />}</button><button onClick={onPlay} className="min-w-0 text-left"><strong className={cn("block truncate text-sm font-medium", active && "text-white")}>{track.title}</strong><span className="block truncate text-xs text-white/40">{track.artist}{track.genre ? ` · ${track.genre}` : ""}</span></button><span className="text-right text-[11px] text-white/30 max-sm:hidden">{track.playCount ? `${formatCount(track.playCount)} plays` : formatDuration(track.duration)}</span><button onClick={onFavorite} className={cn("grid h-8 w-8 place-items-center justify-self-end rounded-full text-white/25 hover:bg-white/10 hover:text-white", favorite && "text-red-400")} aria-label={favorite ? "Remove favorite" : "Favorite track"}><Heart className="h-4 w-4" fill={favorite ? "currentColor" : "none"} /></button></div>
}

function ProviderSetup({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-2xl border border-white/10 bg-black/40 p-6"><Server className="h-7 w-7 text-white/60" /><h2 className="mt-4 text-lg font-semibold">{title}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">{detail}</p></div>
}
