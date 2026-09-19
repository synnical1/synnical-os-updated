"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { cn } from "@/lib/utils"
import { Search, X, ChevronLeft, Wifi, WifiOff, Gamepad2, Clock, Users, Zap, RotateCcw, Volume2, Gauge, FolderPlus, ImagePlus, RefreshCw, Save, Check, Trash2 } from "lucide-react"
import { useSetting } from "@/lib/settings-runtime"
import { featureApi } from "@/lib/feature-api"
import { toast } from "sonner"

// ─── Types ────────────────────────────────────────────────────────────────────

type GameEntry = {
  name: string
  game_key: string
  description: string
  image: string
  cover: string
  tags: string[]
}

type LocalGameEntry = {
  id: string
  title: string
  slug: string
  cover: string | null
  launchUrl: string
  source: "synnical" | "gmshelf"
  sourceRepo?: string
  tags: string[]
}

type SessionState =
  | { phase: "idle" }
  | { phase: "loading"; message: string }
  | { phase: "queued"; uuid: string; pos: number; stage: "queue" | "provider_wait" | "allocating"; waitedSeconds?: number; waitLimitSeconds?: number; providerMessage?: string; queuedAt?: number }
  | { phase: "waiting_start"; uuid: string }
  | { phase: "active"; uuid: string; embedUrl: string }
  | { phase: "error"; code: string; message: string }

type GameFailure = { code: string; message: string }

class GameRequestError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "GameRequestError"
    this.code = code
  }
}

function friendlyGameMessage(value: unknown, fallback = "Cloud gaming hit a problem. Try again."): string {
  const raw = String(value || "").trim()
  if (!raw) return fallback
  return raw
    .replace(/\[[A-Z0-9_:-]+\]\s*/g, "")
    .replace(/\bStratus\b/gi, "cloud gaming")
    .replace(/\bprovider\b/gi, "cloud service")
    .replace(/\bAPI\b/gi, "service")
    .replace(/\bendpoint\b/gi, "service")
    .replace(/\bsession[ _-]?id\b/gi, "game session")
    .replace(/\bHTTP\s*\d{3}\b/gi, "request error")
    .slice(0, 240)
}

function gameFailure(error: unknown, fallbackCode: string): GameFailure {
  if (error instanceof GameRequestError) return { code: error.code, message: friendlyGameMessage(error.message) }
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown }
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return { code: candidate.code, message: friendlyGameMessage(candidate.message) }
    }
  }
  if (error instanceof Error) return { code: fallbackCode, message: friendlyGameMessage(error.message) }
  return { code: fallbackCode, message: friendlyGameMessage(error) }
}

async function responseFailure(res: Response, stage: string): Promise<GameRequestError> {
  const contentType = (res.headers.get("content-type") || "").toLowerCase()
  const text = await res.text().catch(() => "")
  let payload: any = {}
  if (contentType.includes("json") || /^\s*[\[{]/.test(text)) {
    try { payload = text ? JSON.parse(text) : {} } catch {}
  }
  const code = typeof payload?.code === "string" ? payload.code : `${stage}_HTTP_${res.status}`
  const structuredMessage = typeof payload?.error === "string" ? payload.error : typeof payload?.message === "string" ? payload.message : ""
  const nonJsonResponse = !contentType.includes("json") && !structuredMessage
  const message = res.status === 401 || res.status === 403
    ? "Cloud gaming could not authorize this request. Sign in again and retry."
    : res.status === 404
      ? "Cloud gaming is temporarily unavailable because its service route could not be reached."
      : res.status === 429
        ? "Cloud gaming is busy right now. Try again shortly."
        : res.status >= 500
          ? friendlyGameMessage(structuredMessage, "Cloud gaming is temporarily unavailable. Try again shortly.")
          : nonJsonResponse
            ? "Cloud gaming returned an invalid service response. Try again shortly."
            : friendlyGameMessage(structuredMessage, "Cloud gaming could not complete that request. Try again.")
  return new GameRequestError(code, message)
}

async function responseJson<T>(res: Response, stage: string): Promise<T> {
  if (!res.ok) throw await responseFailure(res, stage)
  const contentType = (res.headers.get("content-type") || "").toLowerCase()
  if (!contentType.includes("json")) throw new GameRequestError(`${stage}_INVALID_RESPONSE`, "Cloud gaming returned an invalid service response. Try again shortly.")
  try { return await res.json() as T }
  catch { throw new GameRequestError(`${stage}_INVALID_JSON`, "Cloud gaming returned an invalid service response. Try again shortly.") }
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const STRATUS_API_KEY = process.env.NEXT_PUBLIC_STRATUS_API_KEY || ""
const STRATUS_BASE = "/api/games/cloud/v1"

const ALL_TAGS = [
  "Action", "Adventure", "Fighting", "RPG", "Shooting", "Racing",
  "Sports", "Strategy", "Simulation", "Puzzle", "Arcade", "Casual",
  "Indie", "Multiplayer", "Online", "Offline", "3A", "Challenge", "Easy",
]

const LOADING_MESSAGES: Record<string, string> = {
  creating_account: "Setting up your cloud session…",
  account_ready: "Account ready — requesting game server…",
  requesting_game: "Requesting game server…",
  provider_wait: "Waiting for a free cloud gaming slot…",
  queue: "You're in queue — waiting for a slot…",
  allocating: "You're first — allocating the streaming machine…",
  finished_queue: "Server allocated — starting game…",
}

// ─── Hooks ─────────────────────────────────────────────────────────────────────

function useImageError(src: string) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [src])
  return { failed, onError: () => setFailed(true) }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function GameImage({
  src,
  alt,
  className,
  fallbackClassName,
}: {
  src: string
  alt: string
  className?: string
  fallbackClassName?: string
}) {
  const { failed, onError } = useImageError(src)
  if (failed) {
    return (
      <div className={cn("flex items-center justify-center bg-[var(--synnical-surface-2)] text-[var(--synnical-muted)]", fallbackClassName || className)}>
        <Gamepad2 className="h-8 w-8 opacity-30" />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={onError}
      loading="lazy"
      decoding="async"
    />
  )
}

function TagBadge({ tag, active, onClick }: { tag: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-[10px] font-medium px-2 py-0.5 rounded-full border transition-colors",
        active
          ? "bg-[var(--synnical-accent)] border-[var(--synnical-accent)] text-black"
          : "bg-[var(--synnical-surface-2)] border-[var(--synnical-border)] text-[var(--synnical-muted)] hover:border-[var(--synnical-accent)] hover:text-[var(--synnical-text)]"
      )}
    >
      {tag}
    </button>
  )
}

function GameCard({ game, onClick }: { game: GameEntry; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative w-full aspect-[3/4] rounded-xl overflow-hidden border border-[var(--synnical-border)] hover:border-[var(--synnical-accent)] transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-[var(--synnical-accent)]/10 bg-[var(--synnical-surface)] text-left"
    >
      {/* Cover image */}
      <GameImage
        src={game.cover || game.image}
        alt={game.name}
        className="absolute inset-0 w-full h-full object-cover"
        fallbackClassName="absolute inset-0 w-full h-full"
      />

      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

      {/* Tags top-right */}
      {game.tags.slice(0, 2).length > 0 && (
        <div className="absolute top-2 right-2 flex flex-col gap-1">
          {game.tags.slice(0, 2).map((t) => (
            <span key={t} className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/60 text-[var(--synnical-accent)] border border-[var(--synnical-accent)]/30 leading-none">
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Bottom info */}
      <div className="absolute bottom-0 left-0 right-0 p-3">
        <p className="text-white font-semibold text-sm leading-tight line-clamp-2 group-hover:text-[var(--synnical-accent)] transition-colors">
          {game.name}
        </p>
        <div className="mt-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Zap className="h-3 w-3 text-[var(--synnical-accent)]" />
          <span className="text-[10px] text-[var(--synnical-accent)] font-medium">Play now</span>
        </div>
      </div>
    </button>
  )
}

function SessionStatusBar({ state, onQuit }: { state: SessionState; onQuit: () => void }) {
  const [tick, setTick] = useState(() => Date.now())
  const isProviderWait = state.phase === "queued" && state.stage === "provider_wait"
  useEffect(() => {
    if (!isProviderWait) return
    const timer = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isProviderWait])
  if (state.phase === "idle") return null

  const colors = {
    loading: "text-yellow-400",
    queued: "text-white",
    waiting_start: "text-[#cfcfcf]",
    active: "text-green-400",
    error: "text-red-400",
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--synnical-surface-2)] border border-[var(--synnical-border)] rounded-lg text-xs">
      <div className={cn("h-2 w-2 rounded-full animate-pulse", {
        "bg-yellow-400": state.phase === "loading",
        "bg-white": state.phase === "queued",
        "bg-[#cfcfcf]": state.phase === "waiting_start",
        "bg-green-400": state.phase === "active",
        "bg-red-400": state.phase === "error",
      })} />
      <span className={cn("font-medium", colors[state.phase] ?? "text-[var(--synnical-text)]")}>
        {state.phase === "loading" && (state as any).message}
        {state.phase === "queued" && (
          state.stage === "provider_wait"
            ? (() => {
                const liveWaited = state.queuedAt ? Math.max(0, Math.floor((tick - state.queuedAt) / 1000)) : 0
                const waited = Math.max(0, Math.max(state.waitedSeconds || 0, liveWaited))
                const limit = Math.max(0, state.waitLimitSeconds || 0)
                const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
                return `Waiting for a free cloud slot… ${clock(waited)}${limit ? ` / ${clock(limit)}` : ""}`
              })()
            : state.stage === "allocating"
              ? "Queue complete — preparing your streaming machine…"
              : `Queue position: #${state.pos}`
        )}
        {state.phase === "waiting_start" && "Starting game…"}
        {state.phase === "active" && "Game running"}
        {state.phase === "error" && <span>{state.message} <span className="font-mono text-[9px] opacity-65">({state.code})</span></span>}
      </span>
      {state.phase !== "loading" && (
        <button onClick={onQuit} className="ml-auto text-[var(--synnical-muted)] hover:text-red-400 transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// ─── Stratus API client ────────────────────────────────────────────────────────

async function stratusCreateSession(
  game_key: string,
  onStatus: (msg: string) => void,
): Promise<{ uuid: string; queued: boolean; queue_pos?: number; queue_stage?: "queue" | "provider_wait" }> {
  let res: Response
  try {
    res = await fetch(`${STRATUS_BASE}/createSession`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": STRATUS_API_KEY,
      },
      body: JSON.stringify({ game_key }),
    })
  } catch (error) {
    const online = typeof navigator === "undefined" || navigator.onLine
    throw new GameRequestError(
      online ? "GAME_API_UNREACHABLE" : "GAME_CLIENT_OFFLINE",
      online ? "Cloud gaming is temporarily unavailable. Try again in a moment." : "This device is offline.",
    )
  }

  if (!res.ok) throw await responseFailure(res, "GAME_CREATE")
  if (!res.body) throw new GameRequestError("GAME_CREATE_NO_BODY", "Cloud gaming did not respond. Try again.")

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  let uuid = ""
  let queued = false
  let queue_pos = 0
  let queue_stage: "queue" | "provider_wait" = "queue"

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split("\n")
    buf = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.trim()) continue
      let obj: any
      try { obj = JSON.parse(line) } catch { continue }
      if (obj.status && LOADING_MESSAGES[obj.status]) {
        onStatus(LOADING_MESSAGES[obj.status])
      }
      if (obj.status === "queue" || obj.status === "provider_wait") {
        uuid = obj.uuid
        queued = true
        queue_pos = obj.queue_pos ?? 0
        queue_stage = obj.status === "provider_wait" ? "provider_wait" : "queue"
      }
      if (obj.status === "finished_queue") {
        uuid = obj.uuid
        queued = false
      }
      if (obj.status === "error") {
        throw new GameRequestError(obj.code || "GAME_CREATE_STREAM_ERROR", obj.error || "Session creation failed")
      }
    }
  }

  if (!uuid) throw new GameRequestError("GAME_CREATE_NO_SESSION_ID", "Cloud gaming could not start the game. Try again.")
  return { uuid, queued, queue_pos, queue_stage }
}

type QueueResponse = {
  status: "provider_wait" | "queue" | "allocating" | "finished_queue" | "active"
  pos: number
  retryAfterMs: number
  waitedSeconds: number
  waitLimitSeconds: number
  providerMessage: string
}

async function stratusGetQueue(uuid: string): Promise<QueueResponse> {
  let res: Response
  try {
    res = await fetch(`${STRATUS_BASE}/getQueue?uuid=${uuid}`, {
      headers: { "x-api-key": STRATUS_API_KEY },
    })
  } catch (error) {
    throw new GameRequestError("GAME_QUEUE_NETWORK", error instanceof Error ? error.message : "Queue request failed")
  }
  if (!res.ok) {
    const failure = await responseFailure(res, "GAME_QUEUE")
    // 429 = "Too fast. Poll at most once every 3 seconds." The server now
    // returns the last known queue position on 429 too, but if it doesn't
    // (older server) we rethrow with a softer message and let the caller
    // retry on the next interval tick instead of tearing the session down.
    if (res.status === 429) {
      throw new GameRequestError("GAME_QUEUE_RATE_LIMIT", "Polling too fast — retrying…")
    }
    throw failure
  }
  const data = await responseJson<any>(res, "GAME_QUEUE")
  const status: QueueResponse["status"] =
    data.status === "active" || data.status === "finished_queue" || data.status === "provider_wait" || data.status === "allocating"
      ? data.status
      : "queue"
  const defaultPos = status === "queue" ? 1 : 0
  const retryAfterMs = Math.min(15_000, Math.max(3_100, Number(data.retry_after_ms) || (status === "provider_wait" ? 5_000 : status === "allocating" ? 4_000 : 3_250)))
  return {
    status,
    pos: Number.isFinite(Number(data.queue_pos)) ? Number(data.queue_pos) : defaultPos,
    retryAfterMs,
    waitedSeconds: Math.max(0, Number(data.waited_seconds) || 0),
    waitLimitSeconds: Math.max(0, Number(data.wait_limit_seconds) || 0),
    providerMessage: typeof data.provider_message === "string" ? data.provider_message.slice(0, 180) : "",
  }
}

async function stratusStartGame(uuid: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(`${STRATUS_BASE}/startGame`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": STRATUS_API_KEY,
      },
      body: JSON.stringify({ uuid }),
    })
  } catch (error) {
    throw new GameRequestError("GAME_START_NETWORK", error instanceof Error ? error.message : "Start request failed")
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new GameRequestError(data.code || `GAME_START_HTTP_${res.status}`, data.error || "startGame failed")
  }
}

async function stratusPingSession(uuid: string): Promise<number> {
  const started = performance.now()
  await fetch(`${STRATUS_BASE}/pingSession`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": STRATUS_API_KEY,
    },
    body: JSON.stringify({ uuid }),
  }).catch(() => {})
  return Math.max(0, Math.round(performance.now() - started))
}

async function stratusQuitSession(uuid: string): Promise<void> {
  await fetch(`${STRATUS_BASE}/quitSession`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": STRATUS_API_KEY,
    },
    body: JSON.stringify({ uuid }),
  }).catch(() => {})
}

// ─── Main Panel ────────────────────────────────────────────────────────────────

export function GamesPanel() {
  // ── Game settings (wired to settings runtime) ──
  const [gameVolume] = useSetting<number>("games.volume", 100)
  const [outputVolume] = useSetting<number>("voice.outputVolume", 100)
  const [outputDevice] = useSetting<string>("voice.outputDevice", "default")
  const [deadzone] = useSetting<number>("games.deadzone", 15)
  const [gamepad] = useSetting<boolean>("games.gamepad", true)
  const [gameNotifs] = useSetting<boolean>("games.notifications", true)

  const [search, setSearch] = useState("")
  const [games, setGames] = useState<GameEntry[]>([])
  const [localGames, setLocalGames] = useState<LocalGameEntry[]>([])
  const [catalogError, setCatalogError] = useState("")
  const [localCatalogError, setLocalCatalogError] = useState("")
  const [libraryMode, setLibraryMode] = useState<"local" | "cloud">("local")
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [selected, setSelected] = useState<GameEntry | null>(null)
  const [selectedLocal, setSelectedLocal] = useState<LocalGameEntry | null>(null)
  const [localPlaying, setLocalPlaying] = useState(false)
  const [sessionState, setSessionState] = useState<SessionState>({ phase: "idle" })
  const [embedHtml, setEmbedHtml] = useState<string | null>(null)
  const [embedFailure, setEmbedFailure] = useState<GameFailure | null>(null)
  const [embedLoading, setEmbedLoading] = useState(false)
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const queuePollInFlightRef = useRef(false)
  const queueTransitionRef = useRef(false)
  const queueTransientFailuresRef = useRef(0)
  const gameFrameRef = useRef<HTMLIFrameElement | null>(null)
  const [inputReleased, setInputReleased] = useState(false)
  const [featureState, setFeatureState] = useState<any>(null)
  const trackedSessionIdRef = useRef<string | null>(null)
  const trackedProviderIdRef = useRef<string | null>(null)
  const richPresenceGameRef = useRef<string | null>(null)
  const richPresenceStartedRef = useRef<string | null>(null)
  const trackedSessionStartRef = useRef<Promise<string | null> | null>(null)
  const [embedRevision, setEmbedRevision] = useState(0)
  const screenshotInputRef = useRef<HTMLInputElement | null>(null)
  const [gameFullscreen, setGameFullscreen] = useState(false)
  const gameFullscreenOwnedRef = useRef(false)

  const refreshFeatures = useCallback(() => {
    featureApi.games.state().then(setFeatureState).catch(() => {})
  }, [])

  useEffect(() => { refreshFeatures() }, [refreshFeatures])

  useEffect(() => {
    const handler = (event: Event) => {
      const gameKey = (event as CustomEvent<{ gameKey?: unknown }>).detail?.gameKey
      if (typeof gameKey !== "string") return
      const match = games.find((game) => game.game_key === gameKey)
      if (match) { setSearch(match.name); setActiveTag(null); setSelected(match) }
    }
    window.addEventListener("synnical-game-open", handler)
    return () => window.removeEventListener("synnical-game-open", handler)
  }, [games])


  const selectedPreset = selected ? featureState?.presets?.find((row: any) => row.gameId === selected.game_key) : null
  const effectiveGameVolume = Number(selectedPreset?.audio?.gameVolume ?? gameVolume)
  const effectiveOutputVolume = Number(selectedPreset?.audio?.outputVolume ?? outputVolume)
  const effectiveGamepad = Boolean(selectedPreset?.controller?.gamepad ?? gamepad)
  const effectiveDeadzone = Number(selectedPreset?.controller?.deadzone ?? deadzone)

  const activeEmbedUrl = sessionState.phase === "active" ? sessionState.embedUrl : ""
  const activeSessionId = sessionState.phase === "active" ? sessionState.uuid : ""

  const lockGameKeyboard = useCallback(async () => {
    if (typeof navigator === "undefined") return
    const nav = navigator as Navigator & { keyboard?: { lock?: (keys?: string[]) => Promise<void> } }
    // No key list means "all keys the browser/host OS allows". In Chromium
    // fullscreen this gives the remote game browser-reserved keys instead of
    // letting Synnical accidentally behave like an ordinary webpage.
    await nav.keyboard?.lock?.().catch(() => {})
  }, [])

  const requestPlayFullscreen = useCallback(() => {
    if (typeof document === "undefined") return
    if (document.fullscreenElement) {
      gameFullscreenOwnedRef.current = true
      setGameFullscreen(true)
      void lockGameKeyboard()
      return
    }
    const root = document.documentElement as HTMLElement & {
      requestFullscreen?: (options?: FullscreenOptions) => Promise<void>
    }
    try {
      const result = root.requestFullscreen?.({ navigationUI: "hide" })
      result
        ?.then(async () => {
          gameFullscreenOwnedRef.current = true
          setGameFullscreen(true)
          await lockGameKeyboard()
        })
        .catch(() => {
          gameFullscreenOwnedRef.current = false
          setGameFullscreen(false)
          setInputReleased(true)
        })
      if (!result) {
        gameFullscreenOwnedRef.current = false
        setGameFullscreen(false)
        setInputReleased(true)
      }
    } catch {
      gameFullscreenOwnedRef.current = false
      setGameFullscreen(false)
      setInputReleased(true)
    }
  }, [lockGameKeyboard])

  const resumeGameCapture = useCallback(async () => {
    if (typeof document === "undefined") return
    const root = document.documentElement as HTMLElement & {
      requestFullscreen?: (options?: FullscreenOptions) => Promise<void>
    }
    try {
      if (!document.fullscreenElement) {
        const fullscreenRequest = root.requestFullscreen?.({ navigationUI: "hide" })
        if (!fullscreenRequest) throw new Error("Fullscreen is unavailable")
        await fullscreenRequest
      }
      if (!document.fullscreenElement) throw new Error("Fullscreen did not activate")
      gameFullscreenOwnedRef.current = true
      setGameFullscreen(true)
      await lockGameKeyboard()
      setInputReleased(false)
      gameFrameRef.current?.contentWindow?.postMessage({ type: "SYNNICAL_GAME_CAPTURE_INPUT" }, "*")
      requestAnimationFrame(() => {
        gameFrameRef.current?.focus({ preventScroll: true })
        gameFrameRef.current?.contentWindow?.focus()
      })
    } catch {
      gameFullscreenOwnedRef.current = false
      setGameFullscreen(false)
      setInputReleased(true)
      toast.error("Fullscreen game controls could not be captured. Try Resume game again.")
    }
  }, [lockGameKeyboard])

  useEffect(() => {
    const controller = new AbortController()
    setCatalogError("")
    fetch(`${STRATUS_BASE}/games`, { cache: "no-store", signal: controller.signal })
      .then((response) => responseJson<unknown>(response, "GAME_CATALOG"))
      .then((payload: unknown) => {
        if (!Array.isArray(payload)) throw new GameRequestError("GAME_CATALOG_INVALID", "The game catalog response is invalid")
        const valid = payload.filter((entry): entry is GameEntry => {
          if (!entry || typeof entry !== "object") return false
          const game = entry as Partial<GameEntry>
          return typeof game.name === "string" && typeof game.game_key === "string" && Array.isArray(game.tags)
        })
        setGames(valid)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        const failure = gameFailure(error, "GAME_CATALOG_FAILED")
        setCatalogError(failure.message)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLocalCatalogError("")
    fetch("/api/games/local/catalog", { cache: "no-store", credentials: "include", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Local game library could not be loaded")
        return response.json() as Promise<{ games?: unknown }>
      })
      .then((payload) => {
        const rows = Array.isArray(payload.games) ? payload.games : []
        setLocalGames(rows.filter((entry): entry is LocalGameEntry => {
          if (!entry || typeof entry !== "object") return false
          const game = entry as Partial<LocalGameEntry>
          return typeof game.id === "string" && typeof game.title === "string" && typeof game.launchUrl === "string" && Array.isArray(game.tags)
        }))
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLocalCatalogError(error instanceof Error ? error.message : "Local game library could not be loaded")
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    // Keep Synnical chrome available whenever game input has been released so
    // the user can move into Chat/Friends/etc without ending the game.
    window.dispatchEvent(new CustomEvent("synnical-game-focus", { detail: { active: sessionState.phase === "active" && gameFullscreen && !inputReleased } }))
    return () => {
      window.dispatchEvent(new CustomEvent("synnical-game-focus", { detail: { active: false } }))
    }
  }, [sessionState.phase, gameFullscreen, inputReleased])

  useEffect(() => {
    const releaseParentCapture = () => {
      setInputReleased(true)
      const nav = navigator as Navigator & { keyboard?: { unlock?: () => void } }
      try { nav.keyboard?.unlock?.() } catch {}
    }

    const onMessage = (event: MessageEvent) => {
      const frameWindow = gameFrameRef.current?.contentWindow
      if (!frameWindow || event.source !== frameWindow) return
      const data = event.data as { type?: unknown; state?: unknown }
      if (data?.type !== "SYNNICAL_GAME_INPUT") return
      if (data.state === "released") {
        releaseParentCapture()
        // Holding Escape inside the stream is the explicit escape hatch.
        // Leave JS fullscreen so the Synnical navigation and game toolbar are
        // physically outside the captured game again.
        if (gameFullscreenOwnedRef.current && document.fullscreenElement) {
          void document.exitFullscreen().catch(() => {})
        }
      }
      if (data.state === "captured") setInputReleased(false)
    }

    const onFullscreenChange = () => {
      const fullscreen = Boolean(document.fullscreenElement)
      setGameFullscreen(fullscreen && gameFullscreenOwnedRef.current)
      // Chromium can end fullscreen itself after a long Escape hold. Do not
      // rely solely on the iframe message; reconcile parent + stream state.
      if (!fullscreen && gameFullscreenOwnedRef.current) {
        gameFullscreenOwnedRef.current = false
        releaseParentCapture()
        gameFrameRef.current?.contentWindow?.postMessage({ type: "SYNNICAL_GAME_RELEASE_INPUT" }, "*")
      }
    }

    window.addEventListener("message", onMessage)
    document.addEventListener("fullscreenchange", onFullscreenChange)
    return () => {
      window.removeEventListener("message", onMessage)
      document.removeEventListener("fullscreenchange", onFullscreenChange)
    }
  }, [])

  useEffect(() => {
    if (sessionState.phase !== "active" || inputReleased || !gameFullscreen) return
    const refocusGame = () => {
      gameFrameRef.current?.focus({ preventScroll: true })
      gameFrameRef.current?.contentWindow?.focus()
    }
    const keepCapturedShortcutsInGame = (event: KeyboardEvent) => {
      // Keyboard Lock normally routes these into the focused iframe. This is a
      // fallback for the rare case focus momentarily lands on Synnical itself.
      if (!(event.ctrlKey || event.metaKey || event.altKey || event.key === "Tab" || /^F\d{1,2}$/.test(event.key))) return
      event.preventDefault()
      event.stopImmediatePropagation()
      refocusGame()
    }
    window.addEventListener("focus", refocusGame)
    window.addEventListener("keydown", keepCapturedShortcutsInGame, true)
    return () => {
      window.removeEventListener("focus", refocusGame)
      window.removeEventListener("keydown", keepCapturedShortcutsInGame, true)
    }
  }, [gameFullscreen, inputReleased, sessionState.phase])

  // Fetch the same-origin embed document first. Besides giving us exact HTTP
  // diagnostics, srcDoc avoids Chromium replacing the whole frame with a vague
  // "refused to connect" page when an intermediary adds a frame header.
  useEffect(() => {
    if (!activeEmbedUrl || !activeSessionId) {
      setEmbedHtml(null)
      setEmbedFailure(null)
      setEmbedLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12_000)
    setEmbedHtml(null)
    setEmbedFailure(null)
    setEmbedLoading(true)

    fetch(activeEmbedUrl, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw await responseFailure(res, "GAME_EMBED")
        const html = await res.text()
        if (!/<html[\s>]/i.test(html)) {
          throw new GameRequestError("GAME_EMBED_INVALID_HTML", "The embed endpoint did not return an HTML document")
        }
        const safeVolume = Math.min(100, Math.max(0, (Number(effectiveGameVolume) || 0) * (Number(effectiveOutputVolume) || 0) / 100))
        const safeOutputDevice = String(outputDevice || "default")
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
        const safeDeadzone = Math.min(50, Math.max(0, Number(effectiveDeadzone) || 0))
        return html.replace(
          /<html\b/i,
          `<html data-synnical-session-id="${activeSessionId}" data-synnical-game-volume="${safeVolume}" data-synnical-output-device="${safeOutputDevice}" data-synnical-gamepad="${effectiveGamepad ? "true" : "false"}" data-synnical-game-deadzone="${safeDeadzone}"`,
        )
      })
      .then((html) => {
        setEmbedHtml(html)
        setEmbedLoading(false)
      })
      .catch((error) => {
        const failure = controller.signal.aborted
          ? { code: "GAME_EMBED_TIMEOUT", message: "The embed document did not respond within 12 seconds" }
          : gameFailure(error, "GAME_EMBED_FETCH_FAILED")
        setEmbedFailure(failure)
        setEmbedLoading(false)
      })
      .finally(() => clearTimeout(timer))

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [activeEmbedUrl, activeSessionId, effectiveDeadzone, effectiveGameVolume, effectiveGamepad, effectiveOutputVolume, outputDevice, embedRevision])

  useEffect(() => {
    if (sessionState.phase !== "active" || !selected) return
    if (trackedProviderIdRef.current === sessionState.uuid && (trackedSessionIdRef.current || trackedSessionStartRef.current)) return
    const providerId = sessionState.uuid
    trackedProviderIdRef.current = providerId
    try {
      const key = "synnical:os:recent-games:v1"
      const raw = JSON.parse(localStorage.getItem(key) || "[]")
      const rows = Array.isArray(raw) ? raw : []
      const next = [{ id: selected.game_key, name: selected.name, at: Date.now() }, ...rows.filter((row: any) => row?.id !== selected.game_key)].slice(0, 8)
      localStorage.setItem(key, JSON.stringify(next))
      window.dispatchEvent(new CustomEvent("synnical-recent-games-changed", { detail: { games: next } }))
    } catch {}
    const start = featureApi.games.action("session-start", { gameId: selected.game_key, gameName: selected.name, providerSessionId: providerId })
      .then((result: any) => String(result.session?.id || "") || null)
      .catch(() => null)
    trackedSessionStartRef.current = start
    void start.then((id) => {
      if (trackedProviderIdRef.current === providerId) trackedSessionIdRef.current = id
      if (trackedSessionStartRef.current === start) trackedSessionStartRef.current = null
      refreshFeatures()
    })
  }, [sessionState, selected, refreshFeatures])

  useEffect(() => {
    const gameKey = sessionState.phase === "active" && selected ? String(selected.game_key || selected.name) : null
    if (gameKey && richPresenceGameRef.current !== gameKey) {
      richPresenceGameRef.current = gameKey
      richPresenceStartedRef.current = new Date().toISOString()
    } else if (!gameKey) {
      richPresenceGameRef.current = null
      richPresenceStartedRef.current = null
    }
    const activity = gameKey && selected
      ? { kind: "playing", name: selected.name, details: "Playing on Synnical Games", artwork: selected.cover || selected.image || null, startedAt: richPresenceStartedRef.current }
      : null
    window.dispatchEvent(new CustomEvent("synnical-rich-presence", { detail: { source: "games", activity } }))
    return () => { window.dispatchEvent(new CustomEvent("synnical-rich-presence", { detail: { source: "games", activity: null } })) }
  }, [sessionState.phase, selected?.game_key, selected?.name, selected?.cover, selected?.image])

  const endTrackedSession = useCallback(async (result = "ended", errorCode = "") => {
    let id = trackedSessionIdRef.current
    const pending = trackedSessionStartRef.current
    trackedSessionIdRef.current = null
    trackedSessionStartRef.current = null
    trackedProviderIdRef.current = null
    if (!id && pending) id = await pending.catch(() => null)
    if (!id) return
    await featureApi.games.action("session-end", { id, result, errorCode }).catch(() => {})
    refreshFeatures()
  }, [refreshFeatures])

  useEffect(() => {
    if (sessionState.phase !== "active") return
    let cancelled = false
    const heartbeat = async () => {
      let id = trackedSessionIdRef.current
      if (!id && trackedSessionStartRef.current) id = await trackedSessionStartRef.current.catch(() => null)
      if (!cancelled && id) await featureApi.games.action("session-heartbeat", { id }).catch(() => {})
    }
    void heartbeat()
    const timer = window.setInterval(() => { void heartbeat() }, 30_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [sessionState.phase, activeSessionId])

  useEffect(() => {
    const onPageHide = () => {
      const id = trackedSessionIdRef.current
      if (!id) return
      try {
        void fetch("/api/features/games", {
          method: "POST",
          credentials: "include",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "session-end", id, result: "page-exit" }),
        })
      } catch {}
    }
    window.addEventListener("pagehide", onPageHide)
    return () => window.removeEventListener("pagehide", onPageHide)
  }, [])

  const uploadScreenshot = useCallback(async (file: File) => {
    if (!selected || !/^image\/(png|jpeg|webp)$/.test(file.type)) return toast.error("Choose a PNG, JPEG, or WebP screenshot")
    const form = new FormData()
    form.append("file", file)
    form.append("gameId", selected.game_key)
    if (trackedSessionIdRef.current) form.append("sessionId", trackedSessionIdRef.current)
    const response = await fetch("/api/features/games/screenshot", { method: "POST", credentials: "include", body: form })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || "Screenshot upload failed")
    toast.success("Screenshot saved privately")
    refreshFeatures()
  }, [selected, refreshFeatures])

  // ── Filter ──
  const filtered = games.filter((g) => {
    const matchSearch = !search || g.name.toLowerCase().includes(search.toLowerCase())
    const matchTag = !activeTag || g.tags.includes(activeTag)
    return matchSearch && matchTag
  })
  const filteredLocal = localGames.filter((g) => {
    const matchSearch = !search || g.title.toLowerCase().includes(search.toLowerCase())
    const matchTag = !activeTag || g.tags.includes(activeTag)
    return matchSearch && matchTag
  })

  // ── Cleanup ──
  const clearIntervals = useCallback(() => {
    if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null }
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    queuePollInFlightRef.current = false
  }, [])

  // ── Quit session ──
  const quitSession = useCallback(async () => {
    clearIntervals()
    const state = sessionState
    if (state.phase === "active" || state.phase === "waiting_start" || state.phase === "queued") {
      await stratusQuitSession((state as any).uuid)
    }
    await endTrackedSession("quit")
    setSessionState({ phase: "idle" })
    setInputReleased(false)
    setGameFullscreen(false)
    gameFullscreenOwnedRef.current = false
    if (typeof navigator !== "undefined") {
      const nav = navigator as Navigator & { keyboard?: { unlock?: () => void } }
      try { nav.keyboard?.unlock?.() } catch {}
    }
    if (typeof document !== "undefined" && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    }
  }, [sessionState, clearIntervals, endTrackedSession])

  const recordLaunchFailure = useCallback((game: GameEntry | null, failure: GameFailure, providerSessionId?: string, result = "launch-failed") => {
    if (!game) return
    void featureApi.games.action("session-failure", { gameId: game.game_key, providerSessionId: providerSessionId || "", errorCode: failure.code, result })
      .then(refreshFeatures)
      .catch(() => {})
  }, [refreshFeatures])

  // ── Poll provider/queue until the streaming host is actually ready ──
  const startQueuePoll = useCallback((uuid: string, initialPos: number, initialStage: "queue" | "provider_wait" = "queue") => {
    queuePollInFlightRef.current = false
    queueTransitionRef.current = false
    queueTransientFailuresRef.current = 0
    setSessionState({ phase: "queued", uuid, pos: initialPos, stage: initialStage, waitedSeconds: 0, queuedAt: Date.now() })

    const schedule = (delayMs: number) => {
      if (pollRef.current) clearTimeout(pollRef.current)
      pollRef.current = setTimeout(tick, delayMs)
    }

    const tick = async () => {
      if (queuePollInFlightRef.current || queueTransitionRef.current) return
      queuePollInFlightRef.current = true
      try {
        const queue = await stratusGetQueue(uuid)
        queueTransientFailuresRef.current = 0
        const pos = queue.pos

        if (queue.status === "active" || queue.status === "finished_queue") {
          queueTransitionRef.current = true
          if (pollRef.current) clearTimeout(pollRef.current)
          pollRef.current = null
          setSessionState({ phase: "waiting_start", uuid })
          if (queue.status !== "active") await stratusStartGame(uuid)
          setSessionState({ phase: "active", uuid, embedUrl: `${STRATUS_BASE}/embed?id=${uuid}` })
          pingRef.current = setInterval(() => { void stratusPingSession(uuid).then((latencyMs) => { const id = trackedSessionIdRef.current; if (id) void featureApi.games.action("session-latency", { id, latencyMs }) }) }, 20_000)
          if (gameNotifs && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("synnical-os-notify", { detail: { title: `${selected?.name ?? "Game"} is live`, body: "Your cloud gaming session has started.", panel: "games", priority: "normal" } }))
            if ("Notification" in window && Notification.permission === "granted") new Notification(`${selected?.name ?? "Game"} is live`, { body: "Your cloud gaming session has started." })
          }
          return
        }

        const stage: "queue" | "provider_wait" | "allocating" =
          queue.status === "provider_wait" ? "provider_wait" : queue.status === "allocating" ? "allocating" : "queue"
        setSessionState({ phase: "queued", uuid, pos, stage, waitedSeconds: queue.waitedSeconds, waitLimitSeconds: queue.waitLimitSeconds, providerMessage: queue.providerMessage, queuedAt: Date.now() - Math.max(0, queue.waitedSeconds || 0) * 1000 })
        schedule(queue.retryAfterMs)
      } catch (e: any) {
        const failure = gameFailure(e, "GAME_QUEUE_FAILED")
        const isTransient = failure.code === "GAME_QUEUE_NETWORK" || failure.code === "GAME_QUEUE_RATE_LIMIT" || failure.code === "GAME_QUEUE_HTTP_502" || failure.code === "GAME_PROVIDER_VERIFICATION_COOLDOWN"
        if (!isTransient) {
          clearIntervals()
          // The server already destroys provider-wait timeout sessions, while
          // other terminal queue failures may still own an upstream slot. Ask
          // it to quit immediately; a 404 here simply means it was already gone.
          void stratusQuitSession(uuid).catch(() => {})
          recordLaunchFailure(selected, failure, uuid, "queue-failed")
          setSessionState({ phase: "error", ...failure })
          return
        }
        queueTransientFailuresRef.current += 1
        if (queueTransientFailuresRef.current >= 8) {
          clearIntervals()
          void stratusQuitSession(uuid).catch(() => {})
          const exhausted = {
            code: "GAME_QUEUE_RETRY_EXHAUSTED",
            message: `The queue could not be reached after ${queueTransientFailuresRef.current} consecutive retries. Check the connection/server and try again.`,
          }
          recordLaunchFailure(selected, exhausted, uuid, "queue-failed")
          setSessionState({ phase: "error", ...exhausted })
          return
        }
        schedule(failure.code === "GAME_PROVIDER_VERIFICATION_COOLDOWN" ? 6_000 : 4_000)
      } finally {
        queuePollInFlightRef.current = false
      }
    }

    // A real provider queue remains authoritative, but Synnical should not add
    // an unnecessary first-poll delay once the provider has issued a queue id.
    schedule(initialStage === "provider_wait" ? 5_000 : 250)
  }, [clearIntervals, gameNotifs, recordLaunchFailure, selected])

  // ── Launch game ──
  const launchGame = useCallback(async (game: GameEntry) => {
    // Fullscreen must be requested synchronously from the user's Play click.
    // Waiting until the cloud session becomes active loses browser user activation.
    setInputReleased(false)
    requestPlayFullscreen()
    if (sessionState.phase !== "idle" && sessionState.phase !== "error") {
      // Kill existing session first
      await quitSession()
    }

    setSessionState({ phase: "loading", message: "Setting up your cloud session…" })

    try {
      const result = await stratusCreateSession(
        game.game_key,
        (msg) => setSessionState({ phase: "loading", message: msg }),
      )

      if (result.queued) {
        startQueuePoll(result.uuid, result.queue_pos ?? 0, result.queue_stage ?? "queue")
      } else {
        setSessionState({ phase: "waiting_start", uuid: result.uuid })
        await stratusStartGame(result.uuid)
        setSessionState({
          phase: "active",
          uuid: result.uuid,
          embedUrl: `${STRATUS_BASE}/embed?id=${result.uuid}`,
        })
        pingRef.current = setInterval(() => { void stratusPingSession(result.uuid).then((latencyMs) => { const id = trackedSessionIdRef.current; if (id) void featureApi.games.action("session-latency", { id, latencyMs }) }) }, 20_000)
        // Show notification if enabled
        if (gameNotifs && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("synnical-os-notify", { detail: { title: `${selected?.name ?? "Game"} is live`, body: "Your cloud gaming session has started.", panel: "games", priority: "normal" } }))
          if ("Notification" in window && Notification.permission === "granted") new Notification(`${selected?.name ?? "Game"} is live`, { body: "Your cloud gaming session has started." })
        }
      }
    } catch (e: any) {
      clearIntervals()
      const failure = gameFailure(e, "GAME_LAUNCH_FAILED")
      recordLaunchFailure(game, failure)
      setSessionState({ phase: "error", ...failure })
    }
  }, [clearIntervals, gameNotifs, quitSession, recordLaunchFailure, requestPlayFullscreen, selected, sessionState, startQueuePoll])

  // ── Cleanup on unmount ──
  useEffect(() => () => { clearIntervals() }, [clearIntervals])

  if (selectedLocal && localPlaying) {
    return (
      <div className="absolute inset-0 z-20 flex flex-col bg-black">
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-white/10 bg-black/90 px-3 text-white backdrop-blur-xl">
          <button onClick={() => setLocalPlaying(false)} className="rounded-lg px-2 py-1 text-xs hover:bg-white/10"><ChevronLeft className="mr-1 inline h-3.5 w-3.5" />Back</button>
          <strong className="min-w-0 flex-1 truncate text-sm">{selectedLocal.title}</strong>
          <span className="text-[10px] text-white/45">Local game</span>
        </div>
        <iframe
          src={selectedLocal.launchUrl}
          title={selectedLocal.title}
          className="min-h-0 flex-1 border-0 bg-black"
          sandbox="allow-scripts allow-pointer-lock allow-downloads allow-forms allow-modals"
          allow="autoplay; fullscreen; gamepad"
          allowFullScreen
          referrerPolicy="no-referrer"
        />
      </div>
    )
  }

  if (selectedLocal) {
    return (
      <div className="flex h-full flex-col overflow-y-auto bg-[var(--synnical-bg)] text-[var(--synnical-text)] custom-scroll">
        <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center border-b border-[var(--synnical-border)] bg-[var(--synnical-glass-strong)] px-4 backdrop-blur-xl">
          <button onClick={() => setSelectedLocal(null)} className="flex items-center gap-1.5 text-xs text-[var(--synnical-muted)] hover:text-[var(--synnical-text)]"><ChevronLeft className="h-4 w-4" />All games</button>
        </div>
        <div className="mx-auto w-full max-w-3xl p-5">
          <div className="flex items-start gap-4">
            <div className="grid h-28 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)]">
              {selectedLocal.cover ? <img src={selectedLocal.cover} alt="" className="h-full w-full object-cover" /> : <Gamepad2 className="h-8 w-8 text-[var(--synnical-muted)]" />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold">{selectedLocal.title}</h2>
              <p className="mt-1 text-sm text-[var(--synnical-muted)]">Runs locally in a restricted game sandbox. It cannot share the normal Synnical page origin.</p>
              <div className="mt-3 flex flex-wrap gap-1.5">{selectedLocal.tags.map((tag) => <span key={tag} className="rounded-full border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] px-2 py-1 text-[10px]">{tag}</span>)}</div>
            </div>
          </div>
          <button onClick={() => setLocalPlaying(true)} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--synnical-accent)] py-3 text-sm font-bold text-white hover:bg-[var(--synnical-accent-hover)]"><Gamepad2 className="h-4 w-4" />Play locally</button>
          {selectedLocal.source === "gmshelf" ? <p className="mt-3 text-xs text-[var(--synnical-muted)]">Imported only when its redistribution licence is explicitly approved by the server catalogue.</p> : null}
        </div>
      </div>
    )
  }

  // ── Active game view ──
  if (sessionState.phase === "active" && selected) {
    return (
      <div className="group/game absolute inset-0 z-20 bg-black">
        <div className="absolute inset-0">
          {embedLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[var(--synnical-muted)]">
              <RotateCcw className="h-6 w-6 animate-spin" />
              <span className="text-sm">Checking game embed…</span>
            </div>
          )}
          {embedFailure && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-black p-6">
              <div className="max-w-lg rounded-xl border border-red-500/30 bg-red-500/10 p-5 text-center">
                <WifiOff className="mx-auto mb-3 h-8 w-8 text-red-400" />
                <p className="text-sm font-semibold text-red-300">Game could not start</p>
                <p className="mt-2 text-sm text-[var(--synnical-text)]">{embedFailure.message}</p>
              </div>
            </div>
          )}
          {embedHtml && !embedFailure && (
            <iframe
              ref={gameFrameRef}
              srcDoc={embedHtml}
              tabIndex={0}
              data-synnical-session-id={activeSessionId}
              className="absolute inset-0 w-full h-full border-0 outline-none"
              allow={`autoplay; fullscreen; ${gamepad ? "gamepad; " : ""}microphone; camera`}
              allowFullScreen
              onLoad={() => {
                if (gameFullscreen && !inputReleased) {
                  gameFrameRef.current?.contentWindow?.postMessage({ type: "SYNNICAL_GAME_CAPTURE_INPUT" }, "*")
                  gameFrameRef.current?.focus({ preventScroll: true })
                  gameFrameRef.current?.contentWindow?.focus()
                } else {
                  // Reconnects performed from the released/non-fullscreen toolbar
                  // must not silently steal keyboard/mouse focus again.
                  gameFrameRef.current?.contentWindow?.postMessage({ type: "SYNNICAL_GAME_RELEASE_INPUT" }, "*")
                }
              }}
              title={`${selected.name} cloud game`}
            />
          )}
          <input ref={screenshotInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void uploadScreenshot(file).catch((error) => toast.error(error instanceof Error ? error.message : "Screenshot failed")) }} />

          {/* Captured fullscreen is deliberately game-only. Synnical controls,
              reconnect and screenshots reappear only after controls are released. */}
          {!gameFullscreen && !embedFailure && (
            <div className="absolute inset-x-0 top-0 z-[70] flex items-center justify-between gap-3 border-b border-white/10 bg-black/95 px-3 py-2 shadow-2xl">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  onClick={async () => { await quitSession(); setSelected(null) }}
                  className="shrink-0 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs font-bold text-white hover:bg-white/10"
                ><ChevronLeft className="mr-1 inline h-3.5 w-3.5" />Back to games</button>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-white">{selected.name}</p>
                  <p className="text-[10px] text-white/50">Game is still running · controls released</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => setEmbedRevision((value) => value + 1)} className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10" title="Restart the game view without starting a new session"><RefreshCw className="mr-1 inline h-3.5 w-3.5" />Reconnect</button>
                <button onClick={() => screenshotInputRef.current?.click()} title="Save screenshot" className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10"><ImagePlus className="mr-1 inline h-3.5 w-3.5" />Screenshot</button>
                <button
                  onClick={() => { void resumeGameCapture() }}
                  className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-black hover:bg-white/90"
                ><Gamepad2 className="mr-1 inline h-3.5 w-3.5" />Resume game</button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Detail view ──
  if (selected && sessionState.phase !== "active") {
    return (
      <div className="flex flex-col h-full bg-black overflow-y-auto custom-scroll">
        {/* Back */}
        <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-3 border-b border-[var(--synnical-border)] bg-black shrink-0">
          <button
            onClick={() => { setSelected(null); if (sessionState.phase === "error") setSessionState({ phase: "idle" }) }}
            className="flex items-center gap-1.5 text-xs text-[var(--synnical-muted)] hover:text-[var(--synnical-text)] transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>All Games</span>
          </button>
        </div>

        {/* Hero */}
        <div className="relative h-52 sm:h-64 shrink-0 overflow-hidden">
          <GameImage
            src={selected.cover || selected.image}
            alt={selected.name}
            className="absolute inset-0 w-full h-full object-cover"
            fallbackClassName="absolute inset-0 w-full h-full"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--synnical-bg)] via-[var(--synnical-bg)]/40 to-transparent" />
        </div>

        {/* Content */}
        <div className="px-4 -mt-12 relative z-10 pb-6">
          {/* Title row */}
          <div className="flex items-end gap-4 mb-4">
            <div className="h-20 w-14 rounded-xl overflow-hidden border-2 border-[var(--synnical-border)] shrink-0 shadow-xl">
              <GameImage
                src={selected.image}
                alt={selected.name}
                className="w-full h-full object-cover"
                fallbackClassName="w-full h-full"
              />
            </div>
            <div className="min-w-0 pb-1">
              <h2 className="text-xl font-bold text-[var(--synnical-text)] leading-tight">{selected.name}</h2>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {selected.tags.map((t) => (
                  <span key={t} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--synnical-accent)]/10 text-[var(--synnical-accent)] border border-[var(--synnical-accent)]/20">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Session status */}
          {sessionState.phase !== "idle" && (
            <div className="mb-4">
              <SessionStatusBar state={sessionState} onQuit={quitSession} />
            </div>
          )}

          {/* Launch button */}
          {(sessionState.phase === "idle" || sessionState.phase === "error") && (
            <button
              onClick={() => launchGame(selected)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white bg-white py-3 text-sm font-bold text-black transition-colors hover:bg-[#e8e8e8]"
            >
              <Zap className="h-4 w-4" />
              Play in Cloud
            </button>
          )}

          {/* Loading / queued state button */}
          {(sessionState.phase === "loading" || sessionState.phase === "queued" || sessionState.phase === "waiting_start") && (
            <button
              onClick={quitSession}
              className="w-full py-3 rounded-xl bg-[var(--synnical-surface-2)] hover:bg-red-500/10 border border-[var(--synnical-border)] hover:border-red-500/30 text-[var(--synnical-muted)] hover:text-red-400 font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-3">
              <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold uppercase tracking-wider text-[var(--synnical-muted)]">Collections</span><button className="text-xs text-[var(--synnical-accent)]" onClick={async () => { const name = window.prompt("Collection name")?.trim(); if (!name) return; await featureApi.games.action("create-collection", { name }); refreshFeatures() }}><FolderPlus className="mr-1 inline h-3.5 w-3.5" />New</button></div>
              <div className="mt-2 flex flex-wrap gap-1.5">{(featureState?.collections || []).map((collection: any) => { const active = collection.gameIds?.includes(selected.game_key); return <button key={collection.id} onClick={async () => { await featureApi.games.action("toggle-collection-game", { collectionId: collection.id, gameId: selected.game_key }); refreshFeatures() }} className={cn("rounded-full border px-2 py-1 text-[11px]", active ? "border-white bg-white text-black" : "border-[var(--synnical-border)] text-[var(--synnical-muted)]")}>{active && <Check className="mr-1 inline h-3 w-3" />}{collection.name}</button> })}</div>
            </div>
            <div className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--synnical-muted)]">Per-game preset</span>
              <p className="mt-1 text-[11px] text-[var(--synnical-muted)]">{selectedPreset ? `Saved: volume ${selectedPreset.audio?.gameVolume ?? gameVolume}%, deadzone ${selectedPreset.controller?.deadzone ?? deadzone}%` : "No preset yet. Save your current game/audio settings for this title."}</p>
              <button onClick={async () => { await featureApi.games.action("save-preset", { gameId: selected.game_key, controller: { gamepad, deadzone }, audio: { gameVolume, outputVolume, outputDevice } }); toast.success("Game preset saved"); refreshFeatures() }} className="mt-2 rounded-md border border-[var(--synnical-border)] px-2 py-1 text-xs hover:bg-[var(--synnical-surface-2)]"><Save className="mr-1 inline h-3.5 w-3.5" />Save current settings</button>
            </div>
          </div>
          {featureState?.capabilities && (
            <div className="mt-3 rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-3 text-[11px] text-[var(--synnical-muted)]">
              <p>
                <strong className="text-[var(--synnical-text)]">Bitrate:</strong>{" "}
                {featureState.capabilities.providerBitrateControl
                  ? "Manual bitrate controls are available."
                  : "Automatic. Manual bitrate control is unavailable."}
              </p>
              <p className="mt-1">
                <strong className="text-[var(--synnical-text)]">Session invites:</strong>{" "}
                {featureState.capabilities.sameProviderSessionInvite
                  ? "Available for this cloud session."
                  : "Direct session invites are unavailable right now."}
              </p>
            </div>
          )}

          {/* Description */}
          <div className="mt-5">
            <h3 className="text-xs font-bold text-[var(--synnical-muted)] uppercase tracking-wider mb-2">About</h3>
            <p className="text-sm text-[var(--synnical-text)]/80 leading-relaxed">{selected.description}</p>
          </div>

          {/* Meta */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="bg-[var(--synnical-surface)] border border-[var(--synnical-border)] rounded-xl p-3">
              <div className="flex items-center gap-2 text-[var(--synnical-muted)] mb-1">
                <Wifi className="h-3.5 w-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Platform</span>
              </div>
              <p className="text-sm font-semibold text-[var(--synnical-text)]">Cloud Stream</p>
            </div>
            <div className="bg-[var(--synnical-surface)] border border-[var(--synnical-border)] rounded-xl p-3">
              <div className="flex items-center gap-2 text-[var(--synnical-muted)] mb-1">
                <Clock className="h-3.5 w-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Session</span>
              </div>
              <p className="text-sm font-semibold text-[var(--synnical-text)]">Up to 19 minutes</p>
            </div>
          </div>

          {/* Active client-side settings summary */}
          <div className="mt-3 bg-[var(--synnical-surface)] border border-[var(--synnical-border)] rounded-xl p-3">
            <div className="flex items-center gap-2 text-[var(--synnical-muted)] mb-2">
              <Gauge className="h-3.5 w-3.5" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Player Settings</span>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px]">
              <span className="px-2 py-0.5 rounded-full bg-[var(--synnical-surface-2)] text-[var(--synnical-text)]">Volume {gameVolume}%</span>
              {gamepad && <span className="px-2 py-0.5 rounded-full bg-[var(--synnical-surface-2)] text-[var(--synnical-text)]">Gamepad on</span>}
              {gamepad && <span className="px-2 py-0.5 rounded-full bg-[var(--synnical-surface-2)] text-[var(--synnical-text)]">Deadzone {deadzone}%</span>}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Main grid ──
  return (
    <div className="flex flex-col h-full bg-[var(--synnical-bg)]">
      {/* Header */}
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-[var(--synnical-border)] bg-[var(--synnical-glass-strong)] backdrop-blur-xl space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Gamepad2 className="h-5 w-5 text-[var(--synnical-accent)]" />
            <h1 className="text-base font-bold text-[var(--synnical-text)]">Games</h1>
          </div>
          <span className="text-[11px] text-[var(--synnical-muted)] bg-[var(--synnical-surface-2)] px-2 py-0.5 rounded-full border border-[var(--synnical-border)]">
            {libraryMode === "local" ? filteredLocal.length : filtered.length} games
          </span>
          {sessionState.phase !== "idle" && (
            <div className="ml-auto">
              <SessionStatusBar state={sessionState} onQuit={quitSession} />
            </div>
          )}
        </div>

        <div className="flex w-fit rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] p-1">
          <button onClick={() => { setLibraryMode("local"); setSelected(null); setSearch(""); setActiveTag(null) }} className={cn("rounded-lg px-3 py-1.5 text-xs", libraryMode === "local" ? "bg-[var(--synnical-selected)] text-[var(--synnical-text)]" : "text-[var(--synnical-muted)] hover:text-[var(--synnical-text)]")}><Gamepad2 className="mr-1 inline h-3.5 w-3.5" />Local</button>
          <button onClick={() => { setLibraryMode("cloud"); setSelectedLocal(null); setSearch(""); setActiveTag(null) }} className={cn("rounded-lg px-3 py-1.5 text-xs", libraryMode === "cloud" ? "bg-[var(--synnical-selected)] text-[var(--synnical-text)]" : "text-[var(--synnical-muted)] hover:text-[var(--synnical-text)]")}><Wifi className="mr-1 inline h-3.5 w-3.5" />Cloud</button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--synnical-muted)]" />
          <input
            type="text"
            placeholder="Search games…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-[var(--synnical-surface-2)] border border-[var(--synnical-border)] rounded-lg text-[var(--synnical-text)] placeholder:text-[var(--synnical-muted)] focus:outline-none focus:border-[var(--synnical-accent)] transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--synnical-muted)] hover:text-[var(--synnical-text)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Tag filters */}
        <div className="flex flex-wrap gap-1.5">
          <TagBadge
            tag="All"
            active={activeTag === null}
            onClick={() => setActiveTag(null)}
          />
          {ALL_TAGS.map((tag) => (
            <TagBadge
              key={tag}
              tag={tag}
              active={activeTag === tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            />
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto custom-scroll p-4">
        {libraryMode === "local" ? (
          localCatalogError ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 text-center text-red-300"><WifiOff className="h-10 w-10 opacity-50" /><p className="max-w-lg text-sm">{localCatalogError}</p></div>
          ) : filteredLocal.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center gap-3 text-[var(--synnical-muted)]"><Gamepad2 className="h-10 w-10 opacity-20" /><p className="text-sm">No local games match your search</p></div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {filteredLocal.map((game) => (
                <GameCard key={game.id} game={{ name: game.title, game_key: game.id, description: "Local game", image: game.cover || "", cover: game.cover || "", tags: game.tags }} onClick={() => { setSelected(null); setSelectedLocal(game); setLocalPlaying(false) }} />
              ))}
            </div>
          )
        ) : (
          <>
            {featureState?.continuePlaying?.length > 0 && !search && !activeTag && (
              <section className="mb-5">
                <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Continue Playing</h2><span className="text-xs text-[var(--synnical-muted)]">Based on your recent play time</span></div>
                <div className="flex gap-3 overflow-x-auto pb-2 custom-scroll">{featureState.continuePlaying.map((session: any) => { const game = games.find((entry) => entry.game_key === session.gameId); if (!game) return null; return <div key={session.gameId} className="w-36 shrink-0"><GameCard game={game} onClick={() => setSelected(game)} /><p className="mt-1 text-[10px] text-[var(--synnical-muted)]">{Math.max(1, Math.round((featureState.durationByGame?.[session.gameId] || 0) / 60))} min played</p></div> })}</div>
              </section>
            )}
            {featureState?.screenshots?.length > 0 && !search && !activeTag && (
              <section className="mb-5">
                <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Private screenshots</h2><span className="text-xs text-[var(--synnical-muted)]">Only you can view these screenshots</span></div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{featureState.screenshots.slice(0, 20).map((shot: any) => <div key={shot.id} className="group relative overflow-hidden rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)]"><img data-image-viewer={shot.fileUrl} role="button" tabIndex={0} aria-label="Open uploaded image" src={shot.fileUrl} alt="Private game screenshot" className="aspect-video w-full object-cover" loading="lazy" /><button type="button" onClick={async () => { const response = await fetch(shot.fileUrl, { method: "DELETE", credentials: "include" }); if (!response.ok) return toast.error("Could not delete screenshot"); toast.success("Screenshot deleted"); refreshFeatures() }} className="absolute right-1 top-1 rounded-md bg-black/80 p-1.5 text-red-300 opacity-0 transition-opacity group-hover:opacity-100" aria-label="Delete screenshot"><Trash2 className="h-3.5 w-3.5" /></button><p className="truncate px-2 py-1.5 text-[10px] text-[var(--synnical-muted)]">{games.find((entry) => entry.game_key === shot.gameId)?.name || "Unknown game"}</p></div>)}</div>
              </section>
            )}
            {catalogError ? (
              <div className="flex h-48 flex-col items-center justify-center gap-3 text-center text-red-300"><WifiOff className="h-10 w-10 opacity-50" /><p className="max-w-lg text-sm">{catalogError}</p></div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3 text-[var(--synnical-muted)]"><Gamepad2 className="h-10 w-10 opacity-20" /><p className="text-sm">No cloud games match your search</p></div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {filtered.map((game) => <GameCard key={game.game_key} game={game} onClick={() => { setSelectedLocal(null); setSelected(game); if (sessionState.phase === "error") setSessionState({ phase: "idle" }) }} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
