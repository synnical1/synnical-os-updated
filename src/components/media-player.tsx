"use client"
import { useEffect, useRef, useState } from "react"
import type { MediaPlaybackRequest, MediaPlaybackSource, NativePlaybackEvent } from "@/lib/media-provider-types"
import { playbackKey, validProgress } from "@/lib/media-playback-policy"
import { installSvgFetchAuth } from "@/lib/svg-client"
installSvgFetchAuth()

export function MediaPlayer({ request, title, startSeconds = 0, onPlaybackEvent, onClose }: { request: MediaPlaybackRequest; title: string; startSeconds?: number; onPlaybackEvent: (event: NativePlaybackEvent) => void; onClose?: () => void }) {
  const [source, setSource] = useState<MediaPlaybackSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [buffering, setBuffering] = useState(false)
  const [error, setError] = useState("")
  const videoRef = useRef<HTMLVideoElement>(null)
  const embedRef = useRef<HTMLIFrameElement>(null)
  const embedProgressRef = useRef<{ currentTime: number; duration: number } | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const listenerRef = useRef(onPlaybackEvent)
  const lastEmitRef = useRef(0)
  const initialTimeRef = useRef(startSeconds)
  useEffect(() => { listenerRef.current = onPlaybackEvent }, [onPlaybackEvent])
  const identity = playbackKey(request)
  useEffect(() => {
    const controller = new AbortController()
    setSource(null); setError(""); setLoading(true); lastEmitRef.current = 0; embedProgressRef.current = null
    initialTimeRef.current = startSeconds
    const query = new URLSearchParams({ type: request.mediaType, id: String(request.mediaId) })
    if (request.mediaType === "tv") { query.set("season", String(request.season ?? 1)); query.set("episode", String(request.episode ?? 1)) }
    fetch(`/api/media/playback?${query}`, { signal: controller.signal, credentials: "same-origin", cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("Playback request failed"); return await response.json() as { source: MediaPlaybackSource | null } })
      .then(body => { if (!controller.signal.aborted) setSource(body.source) })
      .catch(() => { if (!controller.signal.aborted) setError("Could not load playback. Please try again.") })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [identity])
  useEffect(() => {
    if (!source || source.kind !== "hls" || !videoRef.current) return
    const video = videoRef.current
    if (video.canPlayType("application/vnd.apple.mpegurl")) { video.src = source.url; return }
    let disposed = false
    let engine: import("hls.js").default | undefined
    void import("hls.js").then(({ default: Hls }) => {
      if (disposed) return
      if (!Hls.isSupported()) { setError("HLS playback is unavailable in this browser."); return }
      engine = new Hls()
      engine.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal && !disposed) setError("This HLS source could not play. Please reload the player.") })
      engine.loadSource(source.url)
      engine.attachMedia(video)
    }).catch(() => { if (!disposed) setError("Could not load the playback engine. Please reload the player.") })
    return () => { disposed = true; engine?.destroy() }
  }, [source])
  useEffect(() => {
    if (!source || source.kind !== "embed") return
    const frame = embedRef.current
    if (!frame) return
    let sourceOrigin = ""
    try { sourceOrigin = new URL(source.url).origin } catch { setError("The player source URL is invalid."); return }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== sourceOrigin || event.source !== frame.contentWindow) return
      if (!event.data || typeof event.data !== "object" || Array.isArray(event.data)) return
      const payload = event.data as Record<string, unknown>
      const type = payload.type
      if (type === "cinesrc:ready") { setBuffering(false); return }
      if (type === "cinesrc:close") { onClose?.(); return }
      if (type === "cinesrc:error") {
        setBuffering(false)
        setError(typeof payload.error === "string" ? payload.error.slice(0, 180) : "CineSrc reported a playback error.")
        return
      }

      const eventMap: Record<string, NativePlaybackEvent["event"]> = {
        "cinesrc:timeupdate": "timeupdate",
        "cinesrc:play": "play",
        "cinesrc:pause": "pause",
        "cinesrc:ended": "ended",
        "cinesrc:seeked": "seeked",
      }
      const mapped = typeof type === "string" ? eventMap[type] : undefined
      const previous = embedProgressRef.current
      const currentTime = typeof payload.currentTime === "number" && Number.isFinite(payload.currentTime)
        ? payload.currentTime : previous?.currentTime ?? 0
      const duration = typeof payload.duration === "number" && Number.isFinite(payload.duration)
        ? payload.duration : previous?.duration ?? 0
      const progress = validProgress(currentTime, duration)
      if (!progress) return
      embedProgressRef.current = progress
      if (!mapped) return

      const now = Date.now()
      if (mapped === "timeupdate" && now - lastEmitRef.current < 1000) return
      lastEmitRef.current = now
      listenerRef.current({
        ...progress,
        event: mapped,
        id: request.mediaId,
        mediaType: request.mediaType,
        season: request.season,
        episode: request.episode,
      })
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [source, request.mediaId, request.mediaType, request.season, request.episode, onClose])

  const emit = (event: NativePlaybackEvent["event"]) => {
    const video = videoRef.current
    if (!video) return
    const progress = validProgress(video.currentTime, Number.isFinite(video.duration) ? video.duration : 0)
    if (!progress) return
    const now = Date.now()
    if (event === "timeupdate" && now - lastEmitRef.current < 1000) return
    lastEmitRef.current = now
    listenerRef.current({ ...progress, event, id: request.mediaId, mediaType: request.mediaType, season: request.season, episode: request.episode })
  }
  useEffect(() => () => {
    const video = videoRef.current
    const progress = video && Number.isFinite(video.currentTime)
      ? { currentTime: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0 }
      : embedProgressRef.current
    if (progress) listenerRef.current({
      ...progress, event: "pause", id: request.mediaId, mediaType: request.mediaType,
      season: request.season, episode: request.episode,
    })
  }, [identity])
  const keyboard = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).closest("input,select,button,textarea")) return
    const video = videoRef.current
    if (!video) return
    if ([" ", "k", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "m", "f"].includes(event.key)) event.preventDefault()
    if (event.key === " " || event.key === "k") { if (video.paused) void video.play().catch(() => setError("Press play to start playback.")); else video.pause() }
    if (event.key === "ArrowLeft") video.currentTime = Math.max(0, video.currentTime - 10)
    if (event.key === "ArrowRight" && Number.isFinite(video.duration)) video.currentTime = Math.min(video.duration, video.currentTime + 10)
    if (event.key === "ArrowUp") video.volume = Math.min(1, video.volume + .05)
    if (event.key === "ArrowDown") video.volume = Math.max(0, video.volume - .05)
    if (event.key === "m") video.muted = !video.muted
    if (event.key === "f") { if (document.fullscreenElement) void document.exitFullscreen(); else void hostRef.current?.requestFullscreen().catch(() => {}) }
  }
  return <div ref={hostRef} tabIndex={0} onKeyDown={keyboard} className="relative flex h-full min-h-[280px] w-full items-center justify-center bg-black p-4 text-white outline-none" aria-label={`${title} player`}>
    {loading ? <p role="status">Loading playback…</p> : error ? <div role="alert" className="text-center"><p>{error}</p><p className="mt-2 text-xs text-white/50">Use Reload player to retry.</p></div> : !source ? <div className="max-w-md text-center"><h2 className="text-xl font-semibold">Playback unavailable</h2><p className="mt-3 text-sm text-white/60">Under Construction — this title has no authorized playback source yet. You can still explore details and save it to your watchlist.</p></div> : source.kind === "embed" ? <iframe ref={embedRef} src={source.url} title={title} sandbox="allow-scripts allow-same-origin allow-forms allow-presentation" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setBuffering(false)} className="h-full min-h-[280px] w-full border-0" /> : <video ref={videoRef} src={source.kind === "hls" ? undefined : source.url} controls playsInline preload="metadata" crossOrigin="anonymous" className="h-full max-h-full w-full bg-black" aria-label={title}
      onLoadedMetadata={() => { const video = videoRef.current; if (!video) return; if (source.kind === "dash" && !video.canPlayType("application/dash+xml")) setError("DASH playback is unavailable in this browser."); const start = initialTimeRef.current; if (Number.isFinite(start) && start > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(start, Math.max(0, video.duration - 1)) }}
      onLoadStart={() => setBuffering(true)} onWaiting={() => setBuffering(true)} onCanPlay={() => setBuffering(false)} onPlaying={() => setBuffering(false)} onError={() => setError("This source could not play. It may be expired, blocked by CORS, or unsupported by this browser.")}
      onTimeUpdate={() => emit("timeupdate")} onPlay={() => emit("play")} onPause={() => emit("pause")} onEnded={() => emit("ended")} onSeeked={() => emit("seeked")}>
      {source.subtitles?.map(sub => <track key={`${sub.language}:${sub.url}`} src={sub.url} kind="subtitles" srcLang={sub.language} label={sub.label} />)}
    </video>}
    {buffering && source && !error ? <span role="status" className="pointer-events-none absolute rounded bg-black/80 px-4 py-2 text-sm">Buffering…</span> : null}
  </div>
}
