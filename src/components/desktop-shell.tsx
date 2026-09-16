"use client"

import { queueGlobalSearch } from "@/lib/global-search"

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type CSSProperties } from "react"
import {
  Accessibility, AppWindow, Battery, BatteryCharging, Bell, Bluetooth, CalendarDays, ChevronRight,
  Clipboard, Copy, Gamepad2, Grid2X2, Languages, LockKeyhole, Monitor,
  Moon, MoreHorizontal, Network, PanelTop, Power, RefreshCcw, Search, Settings, Sun, Volume2,
  VolumeX, Wifi, WifiOff, X, Zap, LayoutGrid, SquareStack, Smile, Keyboard, Folder,
  Pin, PinOff, ExternalLink, Info, ChevronUp, Focus, AirVent, CircleUserRound, LogOut, Delete, CornerDownLeft, CaseUpper,
  Timer, History, Coins, Users, MessageSquare, Grip, Play, Activity, Terminal, CloudSun, Camera, Video, Square, Mic, Palette,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { readSetting, writeSetting } from "@/lib/settings-runtime"
import { BUILTIN_OS_WALLPAPERS, hydrateOsSettings, persistOsSettings, readOsSettings, wallpaperCss, type OsSettings } from "@/lib/os-settings"
import { useAuth } from "@/hooks/use-auth"
import { useSystemStatus } from "@/hooks/use-system-status"
import { useBrowser } from "@/hooks/use-browser"
import { TASKBAR_METRICS, findSnapPeers, notificationAllowed, safeTimeZoneLabel, type NotificationPriority } from "@/lib/os-batch1"
import type { Panel } from "@/components/app-shell"
import { SYNNICAL_BUILD, SYNNICAL_VERSION } from "@/lib/build-info"
import { announceMediaUsage, type SynnicalMediaUsageDetail } from "@/lib/media-usage"

type DesktopApp = {
  id: Panel
  label: string
  icon: ComponentType<{ className?: string; style?: CSSProperties }>
  authOnly?: boolean
  modOnly?: boolean
  labOnly?: boolean
}

type WindowRecord = {
  id: string
  panel: Panel
  x: number
  y: number
  width: number
  height: number
  z: number
  minimized: boolean
  maximized: boolean
  restore?: { x: number; y: number; width: number; height: number }
  workspace: number
  snapGroup?: string | null
  alwaysOnTop?: boolean
}

type Notice = { id: string; title: string; body: string; createdAt: number; panel?: Panel; app: string; priority: NotificationPriority }
type AgendaItem = { id: string; title: string; when: number; panel?: Panel }
type MediaState = { title: string; subtitle?: string; artwork?: string; playing: boolean; canNext: boolean; canPrevious: boolean }
type WeatherState = { temperature: number; weatherCode: number; label: string } | { error: string }
type Recent = { panel: Panel; at: number }
type MediaUsageRow = { source: string; microphone: boolean; camera: boolean; screen: boolean; at: number }
type ContextMenu =
  | { kind: "desktop"; x: number; y: number }
  | { kind: "app"; x: number; y: number; panel: Panel; anchor?: "pointer" | "taskbar" }
  | null

type DragState = {
  id: string
  startX: number
  startY: number
  baseX: number
  baseY: number
  lastX: number
  lastY: number
  lastDirection: number
  directionChanges: number
  shakeStarted: number
  shaken: boolean
}

const WINDOW_KEY = "synnical:os:windows:v2"
const WORKSPACE_KEY = "layout.osWorkspace"
const NOTICES_KEY = "synnical:os:notices:v3"
const NOTICE_HISTORY_KEY = "synnical:os:notice-history:v1"
const FOCUS_SESSION_KEY = "synnical:os:focus-session-end:v1"
const PINNED_KEY = "synnical:os:pinned:v2"
const RECENTS_KEY = "synnical:os:recents:v2"
const CLIPBOARD_KEY = "synnical:os:clipboard:v1"
const START_SEARCH_HISTORY_KEY = "synnical:os:start-search-history:v1"
const PRIVACY_HISTORY_KEY = "synnical:os:privacy-history:v1"
const FREE_DESKTOP_MIGRATION_KEY = "synnical:os:migration:free-desktop-v1"
const TASKBAR_HEIGHT = 48
const MIN_WIDTH = 420
const MIN_HEIGHT = 280
const DESKTOP_GRID_COLUMNS = { normal: 4, fullscreen: 3 }
const WALLPAPER_VIDEO_RE = /\.(?:mp4|webm|mov)(?:\?|$)/i

function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)) }
function uid(prefix = "id") { return crypto.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}` }

function isFullscreenLikeViewport() {
  if (typeof document === "undefined" || typeof window === "undefined") return false
  if (document.fullscreenElement) return true
  const screenHeight = window.screen?.availHeight || window.screen?.height || 0
  const viewportHeight = Math.round(window.visualViewport?.height || window.innerHeight || 0)
  return Boolean(screenHeight && viewportHeight >= screenHeight - 16)
}

function shortcutMatches(event: KeyboardEvent, combo: string): boolean {
  const parts = combo.split("+")
  const wanted = new Set(parts.slice(0, -1))
  const key = parts[parts.length - 1]
  const actualKey = event.key.length === 1 && event.key !== "." ? event.key.toUpperCase() : event.key
  const wantedKey = key.length === 1 && key !== "." ? key.toUpperCase() : key
  return event.ctrlKey === wanted.has("Ctrl") && event.altKey === wanted.has("Alt") && event.shiftKey === wanted.has("Shift") && event.metaKey === wanted.has("Meta") && actualKey === wantedKey
}

function osCursor(theme: OsSettings["cursorTheme"], sizePercent: number): string | undefined {
  if (theme === "system") return undefined
  if (theme === "crosshair") return "crosshair"
  const px = Math.max(20, Math.min(48, Math.round(28 * sizePercent / 100)))
  const fill = theme === "dark" ? "#111111" : "#ffffff"
  const stroke = theme === "dark" ? "#ffffff" : "#111111"
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 32 32"><path fill="${fill}" stroke="${stroke}" stroke-width="1.6" d="M4 2l20 15-10 2 6 9-5 3-6-10-5 7z"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 4 2, default`
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try { const value = JSON.parse(localStorage.getItem(key) || "null"); return value ?? fallback } catch { return fallback }
}

function readWindows(): WindowRecord[] {
  const rows = readJson<unknown[]>(WINDOW_KEY, [])
  if (!Array.isArray(rows)) return []
  return rows.filter((row): row is WindowRecord => Boolean(row && typeof row === "object" && typeof (row as any).id === "string" && typeof (row as any).panel === "string" && Number.isFinite((row as any).x) && Number.isFinite((row as any).y) && Number.isFinite((row as any).width) && Number.isFinite((row as any).height) && Number.isFinite((row as any).z) && Number.isInteger((row as any).workspace)))
}

function readNoticeRows(key = NOTICES_KEY): Notice[] {
  const rows = readJson<any[]>(key, [])
  return Array.isArray(rows) ? rows.filter((row) => row && typeof row.id === "string" && typeof row.title === "string" && typeof row.body === "string").map((row) => ({
    id: row.id, title: row.title, body: row.body, createdAt: Number(row.createdAt) || Date.now(), panel: typeof row.panel === "string" ? row.panel as Panel : undefined,
    app: typeof row.app === "string" ? row.app : typeof row.panel === "string" ? row.panel : "system",
    priority: row.priority === "urgent" || row.priority === "priority" ? row.priority : row.priority === true ? "priority" : "normal",
  })).slice(0, 120) : []
}

function defaultRect(index = 0, taskbarHeight = TASKBAR_HEIGHT) {
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth
  const viewportHeight = typeof window === "undefined" ? 720 : window.innerHeight - taskbarHeight
  const width = clamp(Math.floor(viewportWidth * 0.72), MIN_WIDTH, Math.max(MIN_WIDTH, viewportWidth - 36))
  const height = clamp(Math.floor(viewportHeight * 0.76), MIN_HEIGHT, Math.max(MIN_HEIGHT, viewportHeight - 28))
  const offset = (index % 7) * 24
  return { x: clamp(34 + offset, 0, Math.max(0, viewportWidth - width)), y: clamp(26 + offset, 0, Math.max(0, viewportHeight - height)), width, height }
}

function useMinuteClock(seconds: boolean) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const timer = window.setInterval(tick, seconds ? 1000 : 15_000)
    tick(); return () => window.clearInterval(timer)
  }, [seconds])
  return now
}

function calendarCells(now: Date) {
  const year = now.getFullYear(), month = now.getMonth()
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, index) => { const d = new Date(start); d.setDate(start.getDate() + index); return d })
}

function writeClipboardHistory(text: string) {
  if (!text.trim()) return
  const normalized = text.slice(0, 4000)
  const current = readJson<{ id: string; text: string; at: number; pinned?: boolean }[]>(CLIPBOARD_KEY, [])
  const existing = current.find((row) => row.text === normalized)
  const pinned = current.filter((row) => row.pinned && row.text !== normalized)
  const unpinned = current.filter((row) => !row.pinned && row.text !== normalized)
  const fresh = { id: existing?.id || uid("clip"), text: normalized, at: Date.now(), pinned: Boolean(existing?.pinned) }
  const next = [fresh, ...pinned, ...unpinned].slice(0, 50)
  try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(next)) } catch {}
  window.dispatchEvent(new CustomEvent("synnical-clipboard-changed"))
}

function setClipboardPinned(id: string, pinned: boolean) {
  const current = readJson<{ id: string; text: string; at: number; pinned?: boolean }[]>(CLIPBOARD_KEY, [])
  const next = current.map((row) => row.id === id ? { ...row, pinned } : row)
  next.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.at - a.at)
  try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(next)) } catch {}
  window.dispatchEvent(new CustomEvent("synnical-clipboard-changed"))
}

function clearUnpinnedClipboardHistory() {
  const current = readJson<{ id: string; text: string; at: number; pinned?: boolean }[]>(CLIPBOARD_KEY, [])
  try { localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(current.filter((row) => row.pinned))) } catch {}
  window.dispatchEvent(new CustomEvent("synnical-clipboard-changed"))
}

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement

function isEditableTarget(value: Element | null): value is EditableTarget {
  if (!value) return false
  if (value instanceof HTMLTextAreaElement) return true
  if (value instanceof HTMLInputElement) return !["button", "submit", "reset", "checkbox", "radio", "range", "file", "color"].includes(value.type)
  return value instanceof HTMLElement && value.isContentEditable
}

function insertText(active: EditableTarget, text: string) {
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? active.value.length
    const end = active.selectionEnd ?? active.value.length
    const next = `${active.value.slice(0, start)}${text}${active.value.slice(end)}`
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(active), "value")?.set
    setter?.call(active, next)
    active.dispatchEvent(new Event("input", { bubbles: true }))
    requestAnimationFrame(() => active.setSelectionRange(start + text.length, start + text.length))
  } else if (active.isContentEditable) {
    document.execCommand("insertText", false, text)
  }
}

function backspaceText(active: EditableTarget) {
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? active.value.length
    const end = active.selectionEnd ?? active.value.length
    const removeFrom = start === end ? Math.max(0, start - 1) : start
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(active), "value")?.set
    setter?.call(active, `${active.value.slice(0, removeFrom)}${active.value.slice(end)}`)
    active.dispatchEvent(new Event("input", { bubbles: true }))
    requestAnimationFrame(() => { active.focus(); active.setSelectionRange(removeFrom, removeFrom) })
    return
  }
  active.focus()
  document.execCommand("delete", false)
}


type WidgetRect = { x: number; y: number; width: number; height: number }
type RecentGameWidgetItem = { id: string; name: string; at: number }
type PinnedChatWidgetItem = { id: string; name: string; avatar?: string | null; unread?: number }
type OnlineWidgetUser = { userId: string; username: string; displayName?: string; pfpUrl?: string | null }
const RECENT_GAMES_WIDGET_KEY = "synnical:os:recent-games:v1"

function DesktopWidgetCard({ id, title, icon: Icon, rect, onRect, children }: {
  id: string
  title: string
  icon: ComponentType<{ className?: string }>
  rect: WidgetRect
  onRect: (next: WidgetRect) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLElement | null>(null)
  const drag = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null)
  const resize = useRef<{ pointerId: number; startX: number; startY: number; width: number; height: number } | null>(null)

  const commit = useCallback(() => {
    const node = ref.current
    if (!node) return
    const width = clamp(node.offsetWidth, 160, Math.max(160, window.innerWidth - 16))
    const height = clamp(node.offsetHeight, 100, Math.max(100, window.innerHeight - 64))
    const x = clamp(node.offsetLeft, 0, Math.max(0, window.innerWidth - width - 8))
    const y = clamp(node.offsetTop, 0, Math.max(0, window.innerHeight - height - 56))
    onRect({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) })
  }, [onRect])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const node = ref.current
      if (!node) return
      const currentDrag = drag.current
      if (currentDrag && event.pointerId === currentDrag.pointerId) {
        const maxX = Math.max(0, window.innerWidth - node.offsetWidth - 8)
        const maxY = Math.max(0, window.innerHeight - node.offsetHeight - 56)
        node.style.left = `${clamp(currentDrag.baseX + event.clientX - currentDrag.startX, 0, maxX)}px`
        node.style.top = `${clamp(currentDrag.baseY + event.clientY - currentDrag.startY, 0, maxY)}px`
        return
      }
      const currentResize = resize.current
      if (currentResize && event.pointerId === currentResize.pointerId) {
        const maxWidth = Math.max(160, window.innerWidth - node.offsetLeft - 8)
        const maxHeight = Math.max(100, window.innerHeight - node.offsetTop - 56)
        node.style.width = `${clamp(currentResize.width + event.clientX - currentResize.startX, 160, maxWidth)}px`
        node.style.height = `${clamp(currentResize.height + event.clientY - currentResize.startY, 100, maxHeight)}px`
      }
    }
    const up = (event: PointerEvent) => {
      let changed = false
      if (drag.current?.pointerId === event.pointerId) { drag.current = null; changed = true }
      if (resize.current?.pointerId === event.pointerId) { resize.current = null; changed = true }
      if (changed) commit()
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", up)
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up) }
  }, [commit])

  return <section ref={ref} data-synnical-widget={id} className="absolute z-[8] flex min-h-[100px] min-w-[160px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/30 text-white shadow-xl backdrop-blur-xl" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
    <header onPointerDown={(event) => { if (event.button !== 0) return; const node = ref.current; if (!node) return; event.preventDefault(); drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, baseX: node.offsetLeft, baseY: node.offsetTop }; event.currentTarget.setPointerCapture?.(event.pointerId) }} className="flex cursor-move touch-none select-none items-center gap-2 border-b border-white/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/55"><Grip className="h-3 w-3" /><Icon className="h-3.5 w-3.5" />{title}</header>
    <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    <button type="button" aria-label={`Resize ${title} widget`} title="Resize widget" onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); const node = ref.current; if (!node) return; resize.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, width: node.offsetWidth, height: node.offsetHeight }; event.currentTarget.setPointerCapture?.(event.pointerId) }} className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize touch-none before:absolute before:bottom-1 before:right-1 before:h-2 before:w-2 before:border-b before:border-r before:border-white/35" />
  </section>
}

export function DesktopShell({ apps, renderPanel, onActivePanel }: {
  apps: DesktopApp[]
  renderPanel: (panel: Panel, openPanel: (panel: Panel) => void) => ReactNode
  onActivePanel?: (panel: Panel) => void
}) {
  const { user, logout } = useAuth()
  const system = useSystemStatus()
  const theme = useBrowser((state) => state.theme)
  const setTheme = useBrowser((state) => state.setTheme)
  const allowed = useMemo(() => new Map(apps.map((app) => [app.id, app])), [apps])
  const [os, setOs] = useState<OsSettings>(() => readOsSettings())
  useEffect(() => {
    const root=document.documentElement
    const lowBattery=system.batterySupported && system.batteryLevel !== null && system.charging === false && system.batteryLevel <= 20
    root.classList.toggle("synnical-battery-perf", lowBattery)
    root.dataset.synnicalBatteryPerf=lowBattery?"on":"off"
    return()=>{root.classList.remove("synnical-battery-perf");delete root.dataset.synnicalBatteryPerf}
  },[system.batterySupported,system.batteryLevel,system.charging])
  const launcherApps = useMemo(() => apps.filter((app) => app.id === "settings" || !os.hiddenLauncherApps.includes(app.id)), [apps, os.hiddenLauncherApps])

  // Browsers reject fullscreen requests without a trusted user gesture. When
  // Auto fullscreen is enabled, use the first real click/key press after the
  // OS loads. This is the earliest standards-compliant point at which Synnical
  // can remove browser chrome without lying about a zero-click capability.
  useEffect(() => {
    if (!os.autoFullscreen || typeof document === "undefined" || document.fullscreenElement) return
    let attempted = false
    const enter = () => {
      if (attempted || document.fullscreenElement) return
      attempted = true
      const target = document.documentElement
      if (target.requestFullscreen) void target.requestFullscreen({ navigationUI: "hide" }).catch(() => {})
      cleanup()
    }
    const cleanup = () => {
      window.removeEventListener("pointerdown", enter, true)
      window.removeEventListener("keydown", enter, true)
    }
    window.addEventListener("pointerdown", enter, true)
    window.addEventListener("keydown", enter, true)
    return cleanup
  }, [os.autoFullscreen])
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(() => isFullscreenLikeViewport())
  useEffect(() => {
    let timer: number | undefined
    const updateFullscreenState = () => {
      window.clearTimeout(timer)
      setIsBrowserFullscreen(isFullscreenLikeViewport())
      timer = window.setTimeout(() => setIsBrowserFullscreen(isFullscreenLikeViewport()), 120)
    }
    updateFullscreenState()
    document.addEventListener("fullscreenchange", updateFullscreenState)
    window.addEventListener("resize", updateFullscreenState)
    window.addEventListener("orientationchange", updateFullscreenState)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("fullscreenchange", updateFullscreenState)
      window.removeEventListener("resize", updateFullscreenState)
      window.removeEventListener("orientationchange", updateFullscreenState)
    }
  }, [])
  const [workspace, setWorkspace] = useState(() => {
    const saved = Math.floor(Number(readSetting(WORKSPACE_KEY, 1)) || 1)
    const ids = os.workspaces.map((row) => row.id)
    return ids.includes(saved) ? saved : ids[0] || 1
  })
  const [windows, setWindows] = useState<WindowRecord[]>(() => readWindows())
  const [startOpen, setStartOpen] = useState(false)
  const [startView, setStartView] = useState<"pinned" | "all">("pinned")
  const [startQuery, setStartQuery] = useState("")
  const [startFolderOpen, setStartFolderOpen] = useState<string | null>(null)
  const [startSearchHistory, setStartSearchHistory] = useState<string[]>(() => readJson<string[]>(START_SEARCH_HISTORY_KEY, []).filter((item) => typeof item === "string").slice(0, 12))
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickEdit, setQuickEdit] = useState(false)
  const [quickPresence, setQuickPresence] = useState("online")
  const [mediaUsage, setMediaUsage] = useState<Record<string, MediaUsageRow>>({})
  const [privacyHistory, setPrivacyHistory] = useState<MediaUsageRow[]>(() => readJson<MediaUsageRow[]>(PRIVACY_HISTORY_KEY, []).slice(0, 40))
  const [noticeOpen, setNoticeOpen] = useState(false)
  useEffect(() => {
    if (!user) return
    let cancelled=false
    void fetch("/api/features/presence", { credentials:"include", cache:"no-store" }).then(async (response)=>{
      const body=await response.json().catch(()=>({}))
      if (!cancelled && response.ok && typeof body?.config?.mode === "string") setQuickPresence(body.config.mode)
    }).catch(()=>{})
    return()=>{cancelled=true}
  },[user?.id])
  useEffect(() => {
    const onUsage = (event: Event) => {
      const detail=(event as CustomEvent<SynnicalMediaUsageDetail>).detail
      if (!detail || typeof detail.source !== "string") return
      const source=detail.source.slice(0,40)
      setMediaUsage((current)=>{
        const prior=current[source] || { source, microphone:false, camera:false, screen:false, at:Date.now() }
        const nextRow={ ...prior, ...(typeof detail.microphone === "boolean" ? {microphone:detail.microphone}:{}), ...(typeof detail.camera === "boolean" ? {camera:detail.camera}:{}), ...(typeof detail.screen === "boolean" ? {screen:detail.screen}:{}), at:Date.now() }
        const next={...current}
        if (nextRow.microphone || nextRow.camera || nextRow.screen) next[source]=nextRow
        else delete next[source]
        setPrivacyHistory((rows)=>{
          const history=[nextRow,...rows].slice(0,40)
          try { localStorage.setItem(PRIVACY_HISTORY_KEY, JSON.stringify(history)) } catch {}
          return history
        })
        return next
      })
    }
    window.addEventListener("synnical-media-usage", onUsage)
    return()=>window.removeEventListener("synnical-media-usage", onUsage)
  }, [])
  const [widgetsOpen, setWidgetsOpen] = useState(false)
  const [taskViewOpen, setTaskViewOpen] = useState(false)
  const [clipboardOpen, setClipboardOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [keyboardShift, setKeyboardShift] = useState(false)
  const [keyboardCaps, setKeyboardCaps] = useState(false)
  const [keyboardSymbols, setKeyboardSymbols] = useState(false)
  const [keyboardTheme, setKeyboardTheme] = useState<"glass" | "dark" | "light">(() => readSetting("a11y.keyboardTheme", "glass"))
  const [voiceTyping, setVoiceTyping] = useState(false)
  const [keyboardHint, setKeyboardHint] = useState("")
  const [notices, setNotices] = useState<Notice[]>(() => readNoticeRows())
  const [noticeHistory, setNoticeHistory] = useState<Notice[]>(() => readNoticeRows(NOTICE_HISTORY_KEY))
  const [noticeView, setNoticeView] = useState<"current" | "history">("current")
  const [agenda, setAgenda] = useState<AgendaItem[]>([])
  const [mediaState, setMediaState] = useState<Partial<Record<Panel, MediaState>>>({})
  const [taskbarProgress, setTaskbarProgress] = useState<Partial<Record<Panel, number | null>>>({})
  const [taskbarBadges, setTaskbarBadges] = useState<Partial<Record<Panel, number>>>({})
  const [focusEndAt, setFocusEndAt] = useState<number>(() => Math.max(0, Number(readJson<number>(FOCUS_SESSION_KEY, 0)) || 0))
  const [toastNotice, setToastNotice] = useState<Notice | null>(null)
  const [locked, setLocked] = useState(false)
  const [lockStage, setLockStage] = useState<"lock" | "signin">("lock")
  const [lockRequiresPassword, setLockRequiresPassword] = useState(true)
  const [unlockPassword, setUnlockPassword] = useState("")
  const [unlockPin, setUnlockPin] = useState("")
  const [unlockMode, setUnlockMode] = useState<"password" | "pin">("password")
  const [pinConfigured, setPinConfigured] = useState(false)
  const [unlockError, setUnlockError] = useState("")
  const [unlocking, setUnlocking] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotQuestion, setForgotQuestion] = useState("")
  const [forgotAnswer, setForgotAnswer] = useState("")
  const [forgotCode, setForgotCode] = useState("")
  const [forgotPassword, setForgotPassword] = useState("")
  const [forgotConfirm, setForgotConfirm] = useState("")
  const [forgotBusy, setForgotBusy] = useState(false)
  const [forgotError, setForgotError] = useState("")
  const [poweredOff, setPoweredOff] = useState(false)
  const [powerMenu, setPowerMenu] = useState(false)
  const [trayOverflow, setTrayOverflow] = useState(false)
  const [taskManagerOpen, setTaskManagerOpen] = useState(false)
  const [runOpen, setRunOpen] = useState(false)
  const [runQuery, setRunQuery] = useState("")
  const [captureOpen, setCaptureOpen] = useState(false)
  const [captureRecording, setCaptureRecording] = useState(false)
  const [captureError, setCaptureError] = useState("")
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null)
  const [desktopFolderOpen, setDesktopFolderOpen] = useState<string | null>(null)
  const [snapMenu, setSnapMenu] = useState<string | null>(null)
  const [altIndex, setAltIndex] = useState<number | null>(null)
  const [pinned, setPinned] = useState<Panel[]>(() => readJson<Panel[]>(PINNED_KEY, ["browser", "chat", "files", "games", "movies", "music", "ai", "settings"]))
  const [recents, setRecents] = useState<Recent[]>(() => readJson<Recent[]>(RECENTS_KEY, []))
  const [chatUnread, setChatUnread] = useState(0)
  const [onlineWidgetUsers, setOnlineWidgetUsers] = useState<OnlineWidgetUser[]>([])
  const [friendIds, setFriendIds] = useState<Set<string>>(() => new Set())
  const [pinnedChats, setPinnedChats] = useState<PinnedChatWidgetItem[]>([])
  const [recentGames, setRecentGames] = useState<RecentGameWidgetItem[]>(() => readJson<RecentGameWidgetItem[]>(RECENT_GAMES_WIDGET_KEY, []))
  const [gameInputCaptured, setGameInputCaptured] = useState(false)
  const [clipboardTick, setClipboardTick] = useState(0)
  const [wallpaperSlideIndex, setWallpaperSlideIndex] = useState(0)
  const [weather, setWeather] = useState<WeatherState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const desktopVideoRef = useRef<HTMLVideoElement | null>(null)
  const captureRecorderRef = useRef<MediaRecorder | null>(null)
  const captureStreamRef = useRef<MediaStream | null>(null)
  const captureChunksRef = useRef<Blob[]>([])
  const editableRef = useRef<EditableTarget | null>(null)
  const startupAppliedRef = useRef(false)
  const resizeRef = useRef<{ id: string; startX: number; startY: number; width: number; height: number; lastX: number; lastY: number } | null>(null)
  const zRef = useRef(Math.max(10, ...windows.map((win) => win.z || 0)))
  const snapTimer = useRef<number | null>(null)
  const now = useMinuteClock(os.clockSeconds || focusEndAt > Date.now())
  const taskbarMetric = TASKBAR_METRICS[os.taskbarSize]

  const activeWorkspace = os.workspaces.find((row) => row.id === workspace) || os.workspaces[0]
  const slideshowWallpaper = os.wallpaperSlideshow && BUILTIN_OS_WALLPAPERS.length > 0 && !activeWorkspace?.wallpaper && !WALLPAPER_VIDEO_RE.test(os.desktopWallpaper)
    ? BUILTIN_OS_WALLPAPERS[wallpaperSlideIndex % BUILTIN_OS_WALLPAPERS.length]
    : ""
  const desktopWallpaperUrl = activeWorkspace?.wallpaper || slideshowWallpaper || os.desktopWallpaper
  const desktopWallpaperIsVideo = WALLPAPER_VIDEO_RE.test(desktopWallpaperUrl)
  useEffect(() => {
    const video = desktopVideoRef.current
    if (!video) return
    video.muted = true
    video.loop = true
    video.playsInline = true
    const keepPlaying = () => {
      const root = document.documentElement
      const shouldPause = os.batterySaver || root.classList.contains("synnical-perf-mode") || root.classList.contains("synnical-battery-perf")
      if (shouldPause) {
        if (!video.paused) video.pause()
        return
      }
      if (document.visibilityState === "visible" && video.paused) void video.play().catch(() => {})
    }
    keepPlaying()
    const timer = window.setInterval(keepPlaying, 2_000)
    const observer = new MutationObserver(keepPlaying)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    video.addEventListener("pause", keepPlaying)
    video.addEventListener("stalled", keepPlaying)
    video.addEventListener("suspend", keepPlaying)
    document.addEventListener("visibilitychange", keepPlaying)
    return () => {
      window.clearInterval(timer)
      observer.disconnect()
      video.removeEventListener("pause", keepPlaying)
      video.removeEventListener("stalled", keepPlaying)
      video.removeEventListener("suspend", keepPlaying)
      document.removeEventListener("visibilitychange", keepPlaying)
    }
  }, [desktopWallpaperUrl, desktopWallpaperIsVideo, os.batterySaver])
  const desktopWallpaperStyle = wallpaperCss(desktopWallpaperUrl, os.desktopWallpaperFit)
  const lockWallpaperValue = os.lockWallpaperSlideshow && BUILTIN_OS_WALLPAPERS.length > 0 && !os.lockUseDesktopWallpaper ? BUILTIN_OS_WALLPAPERS[wallpaperSlideIndex % BUILTIN_OS_WALLPAPERS.length] : (os.lockUseDesktopWallpaper ? os.desktopWallpaper : os.lockWallpaper)
  const lockWallpaperIsVideo = WALLPAPER_VIDEO_RE.test(lockWallpaperValue)
  const lockWallpaperStyle = wallpaperCss(lockWallpaperValue, os.lockUseDesktopWallpaper ? os.desktopWallpaperFit : os.lockWallpaperFit)

  useEffect(() => {
    const gameFocus = (event: Event) => setGameInputCaptured(Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active))
    window.addEventListener("synnical-game-focus", gameFocus)
    return () => window.removeEventListener("synnical-game-focus", gameFocus)
  }, [])

  useEffect(() => {
    if (!os.wallpaperSlideshow || BUILTIN_OS_WALLPAPERS.length < 2 || activeWorkspace?.wallpaper || WALLPAPER_VIDEO_RE.test(os.desktopWallpaper)) return
    const advance = () => setWallpaperSlideIndex((current) => {
      if (!os.wallpaperShuffle) return (current + 1) % BUILTIN_OS_WALLPAPERS.length
      if (BUILTIN_OS_WALLPAPERS.length < 2) return current
      let next = Math.floor(Math.random() * BUILTIN_OS_WALLPAPERS.length)
      if (next === current % BUILTIN_OS_WALLPAPERS.length) next = (next + 1) % BUILTIN_OS_WALLPAPERS.length
      return next
    })
    const timer = window.setInterval(advance, os.wallpaperSlideshowMinutes * 60_000)
    return () => window.clearInterval(timer)
  }, [os.wallpaperSlideshow, os.wallpaperShuffle, os.wallpaperSlideshowMinutes, os.desktopWallpaper, activeWorkspace?.wallpaper])

  useEffect(() => {
    if (!user) { setFriendIds(new Set()); return }
    let cancelled = false
    void fetch("/api/friends/list", { credentials: "include", cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("friends unavailable")))
      .then((body) => { if (!cancelled) setFriendIds(new Set(Array.isArray(body?.friends) ? body.friends.map((row: any) => String(row.id || "")).filter(Boolean) : [])) })
      .catch(() => { if (!cancelled) setFriendIds(new Set()) })
    return () => { cancelled = true }
  }, [user?.id])

  useEffect(() => {
    const online = (event: Event) => {
      const users = (event as CustomEvent<{ users?: unknown }>).detail?.users
      if (Array.isArray(users)) setOnlineWidgetUsers(users.filter((row): row is OnlineWidgetUser => Boolean(row && typeof row === "object" && typeof (row as any).userId === "string")).slice(0, 100))
    }
    const pinned = (event: Event) => {
      const rows = (event as CustomEvent<{ pinned?: unknown }>).detail?.pinned
      if (Array.isArray(rows)) setPinnedChats(rows.filter((row): row is PinnedChatWidgetItem => Boolean(row && typeof row === "object" && typeof (row as any).id === "string" && typeof (row as any).name === "string")).slice(0, 6))
    }
    const games = (event: Event) => {
      const rows = (event as CustomEvent<{ games?: unknown }>).detail?.games
      if (Array.isArray(rows)) setRecentGames(rows.filter((row): row is RecentGameWidgetItem => Boolean(row && typeof row === "object" && typeof (row as any).id === "string" && typeof (row as any).name === "string")).slice(0, 8))
      else setRecentGames(readJson<RecentGameWidgetItem[]>(RECENT_GAMES_WIDGET_KEY, []))
    }
    window.addEventListener("synnical-chat-online-users", online)
    window.addEventListener("synnical-chat-pinned-widget", pinned)
    window.addEventListener("synnical-recent-games-changed", games)
    return () => { window.removeEventListener("synnical-chat-online-users", online); window.removeEventListener("synnical-chat-pinned-widget", pinned); window.removeEventListener("synnical-recent-games-changed", games) }
  }, [])

  useEffect(() => {
    hydrateOsSettings().then((next) => setOs(next))
    const handler = (event: Event) => setOs((event as CustomEvent<{ settings?: OsSettings }>).detail?.settings || readOsSettings())
    window.addEventListener("synnical-os-settings-changed", handler)
    return () => window.removeEventListener("synnical-os-settings-changed", handler)
  }, [user?.id])

  useEffect(() => {
    if (os.workspaces.some((row) => row.id === workspace)) return
    const fallback = os.workspaces[0]?.id || 1
    setWorkspace(fallback)
    writeSetting(WORKSPACE_KEY, fallback)
    setWindows((current) => {
      const next = current.map((win) => os.workspaces.some((row) => row.id === win.workspace) ? win : { ...win, workspace: fallback })
      try { localStorage.setItem(WINDOW_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [os.workspaces, workspace])

  useEffect(() => {
    if (os.restoreWindows) return
    setWindows([])
    try { localStorage.removeItem(WINDOW_KEY) } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      if (localStorage.getItem(FREE_DESKTOP_MIGRATION_KEY) === "true") return
      localStorage.setItem(FREE_DESKTOP_MIGRATION_KEY, "true")
      if (os.restoreWindows || os.desktopAlignGrid) {
        const next = { ...os, restoreWindows: false, desktopAlignGrid: false }
        setOs(next)
        void persistOsSettings(next)
      }
    } catch {}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const playTone = useCallback((kind: "open" | "notify" | "snap") => {
    if (os.uiSoundVolume <= 0) return
    try {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
      if (!AudioContextCtor) return
      const ctx = new AudioContextCtor()
      const osc = ctx.createOscillator(), gain = ctx.createGain()
      const frequency = kind === "notify" ? 660 : kind === "snap" ? 460 : 540
      osc.frequency.value = frequency
      gain.gain.setValueAtTime(Math.min(.08, os.uiSoundVolume / 1600), ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .09)
      osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .1)
      osc.onended = () => ctx.close().catch(() => {})
    } catch {}
  }, [os.uiSoundVolume])

  const persistWindows = useCallback((next: WindowRecord[]) => {
    setWindows(next)
    try { localStorage.setItem(WINDOW_KEY, JSON.stringify(next)) } catch {}
  }, [])
  const persistNotices = useCallback((next: Notice[]) => {
    const trimmed = next.slice(0, 80); setNotices(trimmed)
    try { localStorage.setItem(NOTICES_KEY, JSON.stringify(trimmed)) } catch {}
  }, [])
  const persistNoticeHistory = useCallback((next: Notice[]) => {
    const trimmed = next.slice(0, 120); setNoticeHistory(trimmed)
    try { localStorage.setItem(NOTICE_HISTORY_KEY, JSON.stringify(trimmed)) } catch {}
  }, [])
  const archiveNotices = useCallback((rows: Notice[]) => {
    if (!rows.length) return
    setNoticeHistory((current) => { const next = [...rows, ...current.filter((old) => !rows.some((row) => row.id === old.id))].slice(0, 120); try { localStorage.setItem(NOTICE_HISTORY_KEY, JSON.stringify(next)) } catch {}; return next })
  }, [])
  const dismissNotice = useCallback((id: string) => {
    setNotices((current) => { const found = current.find((row) => row.id === id); const next = current.filter((row) => row.id !== id); try { localStorage.setItem(NOTICES_KEY, JSON.stringify(next)) } catch {}; if (found && os.notificationHistory) archiveNotices([found]); return next })
  }, [archiveNotices, os.notificationHistory])
  const clearCurrentNotices = useCallback(() => { if (os.notificationHistory) archiveNotices(notices); persistNotices([]) }, [archiveNotices, notices, os.notificationHistory, persistNotices])
  const pushNotice = useCallback((title: string, body: string, panel?: Panel, priority: NotificationPriority = "normal") => {
    if (!os.notificationsEnabled) return
    const app = panel || "system"
    const rule = os.notificationRules[app] || { enabled: true, priority: "normal" as const }
    const effectivePriority: NotificationPriority = priority === "urgent" || priority === "priority" ? priority : rule.priority
    if (!notificationAllowed(os.focusAssist, rule.enabled, effectivePriority)) return
    const next: Notice = { id: uid("notice"), title: title.slice(0, 120), body: body.slice(0, 500), createdAt: Date.now(), panel, app, priority: effectivePriority }
    setNotices((current) => { const rows = [next, ...current].slice(0, 80); try { localStorage.setItem(NOTICES_KEY, JSON.stringify(rows)) } catch {}; return rows })
    if (panel && panel !== "chat") setTaskbarBadges((current) => ({ ...current, [panel]: Math.min(999, (current[panel] || 0) + 1) }))
    setToastNotice(next); playTone("notify")
  }, [os.focusAssist, os.notificationRules, os.notificationsEnabled, playTone])
  const cycleQuickPresence = useCallback(async () => {
    const modes=["online","available_to_play","looking_to_talk","busy"] as const
    const currentIndex=modes.indexOf(quickPresence as typeof modes[number])
    const mode=modes[(currentIndex+1+modes.length)%modes.length]
    try {
      const response=await fetch("/api/features/presence", { method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body:JSON.stringify({mode,modeExpiresAt:null}) })
      const body=await response.json().catch(()=>({}))
      if (!response.ok) throw new Error(body?.error||"Could not update presence")
      const config=body?.config && typeof body.config === "object" ? body.config : {mode,modeExpiresAt:null}
      setQuickPresence(typeof config.mode === "string" ? config.mode : mode)
      window.dispatchEvent(new CustomEvent("synnical-presence-config-changed", { detail:{config} }))
    } catch (error) { pushNotice("Presence not changed", error instanceof Error ? error.message : "Could not update presence") }
  },[quickPresence,pushNotice])
  useEffect(() => { if (!toastNotice) return; const timer = window.setTimeout(() => setToastNotice(null), 5000); return () => window.clearTimeout(timer) }, [toastNotice])
  useEffect(() => {
    const key = "synnical:os:last-seen-build:v1"
    try {
      if (localStorage.getItem(key) === SYNNICAL_BUILD) return
      localStorage.setItem(key, SYNNICAL_BUILD)
      const timer=window.setTimeout(()=>pushNotice(`What's new in Synnical OS ${SYNNICAL_VERSION}`, "Final OS upgrade installed: performance, SynnFlix progress, gaming input, workspaces, Files, accessibility and security changes are ready.", "settings", "priority"),700)
      return () => window.clearTimeout(timer)
    } catch {}
  }, [pushNotice])

  const recordRecent = useCallback((panel: Panel) => {
    setRecents((rows) => { const next = [{ panel, at: Date.now() }, ...rows.filter((row) => row.panel !== panel)].slice(0, 12); try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)) } catch {}; return next })
  }, [])

  const focusWindow = useCallback((id: string) => {
    setWindows((current) => {
      const target = current.find((win) => win.id === id)
      if (!target) return current
      const currentTop = Math.max(0, ...current.filter((win) => win.workspace === target.workspace && !win.minimized).map((win) => win.z))
      // Clicking inside an already-focused app must not rewrite the window list
      // and localStorage. That old path made every button/input click invalidate
      // the whole desktop shell before the app could handle the click.
      if (!target.minimized && target.z === currentTop) return current
      zRef.current = Math.max(zRef.current, currentTop) + 1
      const next = current.map((win) => win.id === id ? { ...win, z: zRef.current, minimized: false } : win)
      try { localStorage.setItem(WINDOW_KEY, JSON.stringify(next)) } catch {}
      onActivePanel?.(target.panel); recordRecent(target.panel)
      return next
    })
  }, [onActivePanel, recordRecent])

  const openPanel = useCallback((panel: Panel) => {
    if (!allowed.has(panel)) return
    if (panel !== "chat") setTaskbarBadges((current) => ({ ...current, [panel]: 0 }))
    setWindows((current) => {
      const existing = current.find((win) => win.panel === panel)
      if (existing) {
        zRef.current += 1
        onActivePanel?.(panel); recordRecent(panel)
        const next = current.map((win) => win.id === existing.id ? { ...win, workspace, minimized: false, z: zRef.current } : win)
        try { localStorage.setItem(WINDOW_KEY, JSON.stringify(next)) } catch {}
        return next
      }
      zRef.current += 1
      const restore = defaultRect(current.filter((win) => win.workspace === workspace).length, taskbarMetric.height)
      const nextWindow: WindowRecord = {
        id: uid(panel), panel,
        x: 0, y: 0,
        width: window.innerWidth,
        height: Math.max(MIN_HEIGHT, window.innerHeight - taskbarMetric.height),
        z: zRef.current, minimized: false, maximized: true, restore, workspace, snapGroup: null,
      }
      onActivePanel?.(panel); recordRecent(panel); playTone("open")
      const next = [...current, nextWindow]; try { localStorage.setItem(WINDOW_KEY, JSON.stringify(next)) } catch {}; return next
    })
    setStartOpen(false); setQuickOpen(false); setNoticeOpen(false); setWidgetsOpen(false); setTaskViewOpen(false); setContextMenu(null)
  }, [allowed, workspace, onActivePanel, recordRecent, playTone, taskbarMetric.height])

  useEffect(() => {
    const usable = windows.filter((win) => allowed.has(win.panel))
    if (usable.length !== windows.length) persistWindows(usable)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed])

  useEffect(() => {
    const top = windows.filter((win) => win.workspace === workspace && !win.minimized && allowed.has(win.panel)).sort((a, b) => b.z - a.z)[0]
    onActivePanel?.(top?.panel || "browser")
  }, [windows, workspace, allowed, onActivePanel])

  useEffect(() => {
    const rememberEditable = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (isEditableTarget(target) && !(target as HTMLElement).closest(".synnical-touch-keyboard")) {
        editableRef.current = target
        setKeyboardHint("")
      }
    }
    document.addEventListener("focusin", rememberEditable)
    return () => document.removeEventListener("focusin", rememberEditable)
  }, [])
  useEffect(() => {
    const external = (event: Event) => { const panel = (event as CustomEvent<{ panel?: unknown }>).detail?.panel; if (typeof panel === "string" && allowed.has(panel as Panel)) openPanel(panel as Panel) }
    window.addEventListener("synnical-open-panel", external); return () => window.removeEventListener("synnical-open-panel", external)
  }, [allowed, openPanel])
  useEffect(() => {
    if (startupAppliedRef.current || !user || !os.startupApps.length) return
    startupAppliedRef.current = true
    const timer = window.setTimeout(() => {
      for (const raw of os.startupApps) if (allowed.has(raw as Panel) && !os.hiddenLauncherApps.includes(raw)) openPanel(raw as Panel)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [user?.id, os.startupApps, os.hiddenLauncherApps, allowed, openPanel])
  useEffect(() => {
    if (!user) { setPinConfigured(false); return }
    let active = true
    fetch("/api/features/security", { credentials: "include", cache: "no-store" })
      .then((res) => res.ok ? res.json() : null)
      .then((body) => { if (active) setPinConfigured(body?.pinConfigured === true) })
      .catch(() => {})
    return () => { active = false }
  }, [user?.id])

  useEffect(() => {
    const lock = () => { if (!user) return; closeFlyouts(); setUnlockPassword(""); setUnlockPin(""); setUnlockMode("password"); setUnlockError(""); setForgotOpen(false); setLockRequiresPassword(true); setLockStage("lock"); setLocked(true) }
    window.addEventListener("synnical-os-lock", lock)
    return () => window.removeEventListener("synnical-os-lock", lock)
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!user || os.autoLockMinutes <= 0 || locked || poweredOff) return
    let timer = 0
    const arm = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        closeFlyouts()
        setUnlockPassword("")
        setUnlockPin("")
        setUnlockMode("password")
        setUnlockError("")
        setForgotOpen(false)
        setLockRequiresPassword(os.requirePasswordAfterAutoLock)
        setLockStage("lock")
        setLocked(true)
      }, os.autoLockMinutes * 60_000)
    }
    const activity = () => arm()
    for (const name of ["pointerdown","keydown","touchstart"] as const) window.addEventListener(name, activity, { passive: true, capture: true })
    arm()
    return () => { window.clearTimeout(timer); for (const name of ["pointerdown","keydown","touchstart"] as const) window.removeEventListener(name, activity, { capture: true } as EventListenerOptions) }
  }, [user?.id, os.autoLockMinutes, os.requirePasswordAfterAutoLock, locked, poweredOff]) // closeFlyouts intentionally reads current setters only

  useEffect(() => {
    const notify = (event: Event) => {
      const detail = (event as CustomEvent<{ title?: unknown; body?: unknown; panel?: unknown; priority?: unknown }>).detail
      if (typeof detail?.title !== "string") return
      const priority: NotificationPriority = detail.priority === "urgent" ? "urgent" : detail.priority === "priority" || detail.priority === true ? "priority" : "normal"
      pushNotice(detail.title, typeof detail.body === "string" ? detail.body : "", typeof detail.panel === "string" ? detail.panel as Panel : undefined, priority)
    }
    const unread = (event: Event) => { const total = Math.max(0, Number((event as CustomEvent<{ total?: unknown }>).detail?.total) || 0); setChatUnread(total); setTaskbarBadges((current) => ({ ...current, chat: total })) }
    const badge = (event: Event) => { const detail = (event as CustomEvent<{ panel?: unknown; count?: unknown }>).detail; if (typeof detail?.panel !== "string" || !allowed.has(detail.panel as Panel)) return; const count = Math.max(0, Math.round(Number(detail.count) || 0)); setTaskbarBadges((current) => ({ ...current, [detail.panel as Panel]: count })) }
    const progress = (event: Event) => { const detail = (event as CustomEvent<{ panel?: unknown; progress?: unknown; active?: unknown }>).detail; if (typeof detail?.panel !== "string" || !allowed.has(detail.panel as Panel)) return; const panel = detail.panel as Panel; if (detail.active === false) return setTaskbarProgress((current) => { const next = { ...current }; delete next[panel]; return next }); const raw = detail.progress; const value = raw === null || raw === undefined ? null : Math.max(0, Math.min(100, Number(raw) || 0)); setTaskbarProgress((current) => ({ ...current, [panel]: value })) }
    const media = (event: Event) => { const detail = (event as CustomEvent<{ panel?: unknown; title?: unknown; subtitle?: unknown; artwork?: unknown; playing?: unknown; canNext?: unknown; canPrevious?: unknown }>).detail; if (typeof detail?.panel !== "string" || !allowed.has(detail.panel as Panel)) return; setMediaState((current) => ({ ...current, [detail.panel as Panel]: { title: typeof detail.title === "string" ? detail.title.slice(0, 160) : "Media", subtitle: typeof detail.subtitle === "string" ? detail.subtitle.slice(0, 160) : undefined, artwork: typeof detail.artwork === "string" && (/^https:\/\//i.test(detail.artwork) || detail.artwork.startsWith("/")) ? detail.artwork.slice(0,2048) : undefined, playing: Boolean(detail.playing), canNext: Boolean(detail.canNext), canPrevious: Boolean(detail.canPrevious) } })) }
    const clip = (event: Event) => { const text = (event as CustomEvent<{ text?: unknown }>).detail?.text; if (typeof text === "string") writeClipboardHistory(text) }
    window.addEventListener("synnical-os-notify", notify); window.addEventListener("synnical-chat-unread", unread); window.addEventListener("synnical-taskbar-badge", badge); window.addEventListener("synnical-taskbar-progress", progress); window.addEventListener("synnical-media-state", media); window.addEventListener("synnical-clipboard-add", clip)
    return () => { window.removeEventListener("synnical-os-notify", notify); window.removeEventListener("synnical-chat-unread", unread); window.removeEventListener("synnical-taskbar-badge", badge); window.removeEventListener("synnical-taskbar-progress", progress); window.removeEventListener("synnical-media-state", media); window.removeEventListener("synnical-clipboard-add", clip) }
  }, [allowed, pushNotice])
  useEffect(() => { const changed = () => setClipboardTick((x) => x + 1); window.addEventListener("synnical-clipboard-changed", changed); return () => window.removeEventListener("synnical-clipboard-changed", changed) }, [])

  useEffect(() => {
    if (!os.desktopWeatherWidget) { setWeather(null); return }
    if (!navigator.geolocation) { setWeather({ error: "Location is unavailable in this browser." }); return }
    let cancelled = false
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const url = new URL("https://api.open-meteo.com/v1/forecast")
        url.searchParams.set("latitude", String(coords.latitude))
        url.searchParams.set("longitude", String(coords.longitude))
        url.searchParams.set("current", "temperature_2m,weather_code")
        url.searchParams.set("temperature_unit", "celsius")
        const response = await fetch(url, { cache: "no-store" })
        const body = await response.json().catch(() => ({}))
        if (!response.ok || !Number.isFinite(Number(body?.current?.temperature_2m))) throw new Error("Weather service unavailable")
        if (cancelled) return
        const code = Number(body?.current?.weather_code) || 0
        const label = code === 0 ? "Clear" : code <= 3 ? "Partly cloudy" : code <= 48 ? "Fog" : code <= 67 ? "Rain" : code <= 77 ? "Snow" : code <= 82 ? "Showers" : code <= 99 ? "Thunderstorms" : "Weather"
        setWeather({ temperature: Math.round(Number(body.current.temperature_2m)), weatherCode: code, label })
      } catch { if (!cancelled) setWeather({ error: "Weather could not be loaded." }) }
    }, () => { if (!cancelled) setWeather({ error: "Allow location access to show local weather." }) }, { maximumAge: 15 * 60_000, timeout: 8_000 })
    return () => { cancelled = true }
  }, [os.desktopWeatherWidget])

  useEffect(() => {
    if (!user) return
    const key = `synnical:os:startup-sound:${user.id}`
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1") } catch {}
    const onGesture = () => { playTone("open"); window.removeEventListener("pointerdown", onGesture, true); window.removeEventListener("keydown", onGesture, true) }
    window.addEventListener("pointerdown", onGesture, true); window.addEventListener("keydown", onGesture, true)
    return () => { window.removeEventListener("pointerdown", onGesture, true); window.removeEventListener("keydown", onGesture, true) }
  }, [user?.id, playTone])

  useEffect(() => {
    if (!focusEndAt) return
    const remaining = focusEndAt - Date.now()
    if (remaining <= 0) {
      setFocusEndAt(0); try { localStorage.removeItem(FOCUS_SESSION_KEY) } catch {}
      if (os.focusAssist !== "off") { const next = { ...os, focusAssist: "off" as const }; setOs(next); void persistOsSettings(next) }
      pushNotice("Focus session complete", "Your Synnical focus timer finished.", undefined, "urgent")
      return
    }
    const timer = window.setTimeout(() => setFocusEndAt((value) => value), Math.min(remaining + 50, 1000))
    return () => window.clearTimeout(timer)
  }, [focusEndAt, now, os, pushNotice])

  const startFocusSession = useCallback(() => {
    const end = Date.now() + os.focusSessionMinutes * 60_000
    setFocusEndAt(end); try { localStorage.setItem(FOCUS_SESSION_KEY, JSON.stringify(end)) } catch {}
    if (os.focusAssist === "off") { const next = { ...os, focusAssist: "priority" as const }; setOs(next); void persistOsSettings(next) }
  }, [os])
  const stopFocusSession = useCallback(() => { setFocusEndAt(0); try { localStorage.removeItem(FOCUS_SESSION_KEY) } catch {} }, [])

  const loadAgenda = useCallback(async () => {
    if (!user) return setAgenda([])
    const next: AgendaItem[] = []
    try {
      const [botRes, scheduledRes] = await Promise.all([fetch("/api/features/bot", { credentials: "include", cache: "no-store" }), fetch("/api/features/chat?action=scheduled", { credentials: "include", cache: "no-store" })])
      if (botRes.ok) { const body = await botRes.json(); for (const row of Array.isArray(body?.reminders) ? body.reminders : []) { const when = new Date(row.dueAt).getTime(); if (Number.isFinite(when) && when >= Date.now() - 60_000) next.push({ id: `reminder:${row.id}`, title: String(row.body || "Reminder").slice(0, 180), when, panel: "chat" }) } }
      if (scheduledRes.ok) { const body = await scheduledRes.json(); for (const row of Array.isArray(body?.scheduled) ? body.scheduled : []) { if (row.status !== "pending") continue; const when = new Date(row.sendAt).getTime(); if (Number.isFinite(when) && when >= Date.now() - 60_000) next.push({ id: `scheduled:${row.id}`, title: String(row.content || "Scheduled message").slice(0, 180), when, panel: "chat" }) } }
    } catch {}
    setAgenda(next.sort((a, b) => a.when - b.when).slice(0, 12))
  }, [user?.id])
  useEffect(() => { if (noticeOpen) void loadAgenda() }, [noticeOpen, loadAgenda])

  const minimizeWindow = useCallback((id: string) => setWindows((current) => { const next = current.map((win) => win.id === id ? { ...win, minimized: true } : win); try { localStorage.setItem(WINDOW_KEY, JSON.stringify(next)) } catch {}; return next }), [])
  const closeWindow = useCallback((id: string) => setWindows((current) => { const next = current.filter((win) => win.id !== id); try { localStorage.setItem(WINDOW_KEY, JSON.stringify(next)) } catch {}; return next }), [])
  const toggleAlwaysOnTop = useCallback((id: string) => setWindows((current) => { const next=current.map((win)=>win.id===id?{...win,alwaysOnTop:!win.alwaysOnTop}:win); try{localStorage.setItem(WINDOW_KEY,JSON.stringify(next))}catch{}; return next }), [])
  const compactWindow = useCallback((id: string, panel: Panel) => setWindows((current) => { const width=panel==="music"?420:520, height=panel==="music"?360:520; const next=current.map((win)=>win.id===id?{...win,maximized:false,snapGroup:null,width,height,x:clamp(win.x,0,Math.max(0,window.innerWidth-width)),y:clamp(win.y,0,Math.max(0,window.innerHeight-taskbarMetric.height-height))}:win); try{localStorage.setItem(WINDOW_KEY,JSON.stringify(next))}catch{}; return next }), [taskbarMetric.height])
  const closePanel = useCallback((panel: Panel) => setWindows((current) => { const next = current.filter((win) => win.panel !== panel); try { localStorage.setItem(WINDOW_KEY, JSON.stringify(next)) } catch {}; return next }), [])
  useEffect(() => {
    const repair = (event: Event) => {
      const panel=(event as CustomEvent<{panel?:unknown}>).detail?.panel
      if (typeof panel !== "string" || !allowed.has(panel as Panel)) return
      closePanel(panel as Panel)
      window.setTimeout(()=>openPanel(panel as Panel),50)
    }
    window.addEventListener("synnical-repair-panel", repair)
    return () => window.removeEventListener("synnical-repair-panel", repair)
  }, [allowed, closePanel, openPanel])
  const toggleMaximize = useCallback((id: string) => {
    const maxWidth = window.innerWidth, maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - taskbarMetric.height)
    setWindows((current) => { const next = current.map((win) => { if (win.id !== id) return win; if (win.maximized && win.restore) return { ...win, ...win.restore, restore: undefined, maximized: false, snapGroup: null }; return { ...win, restore: { x: win.x, y: win.y, width: win.width, height: win.height }, x: 0, y: 0, width: maxWidth, height: maxHeight, maximized: true, snapGroup: null } }); try { localStorage.setItem(WINDOW_KEY, JSON.stringify(next)) } catch {}; return next })
  }, [taskbarMetric.height])

  const snapWindowRect = useCallback((id: string, x: number, y: number, width: number, height: number) => {
    if (!os.snapWindows) return
    setWindows((current) => {
      const target = current.find((win) => win.id === id)
      if (!target) return current
      const rect = { x, y, width, height }
      const peers = os.snapGroups ? findSnapPeers(current, id, target.workspace, rect) : []
      const group = peers.length ? peers.find((peer) => peer.snapGroup)?.snapGroup || uid("snap-group") : null
      const peerIds = new Set(peers.map((peer) => peer.id))
      const next = current.map((win) => {
        if (win.id === id) return { ...win, restore: win.restore || { x: win.x, y: win.y, width: win.width, height: win.height }, ...rect, maximized: x === 0 && y === 0 && width === window.innerWidth, snapGroup: group }
        if (group && peerIds.has(win.id)) return { ...win, snapGroup: group }
        return win
      })
      try { localStorage.setItem(WINDOW_KEY, JSON.stringify(next)) } catch {}
      return next
    })
    playTone("snap")
  }, [os.snapGroups, os.snapWindows, playTone])
  const snapZone = useCallback((id: string, zone: "left" | "right" | "max" | "tl" | "tr" | "bl" | "br" | "wide" | "narrow") => {
    const w = window.innerWidth, h = Math.max(MIN_HEIGHT, window.innerHeight - taskbarMetric.height), half = Math.floor(w / 2), halfH = Math.floor(h / 2)
    if (zone === "max") return snapWindowRect(id, 0, 0, w, h)
    if (zone === "left") return snapWindowRect(id, 0, 0, half, h)
    if (zone === "right") return snapWindowRect(id, half, 0, w - half, h)
    if (zone === "wide") return snapWindowRect(id, 0, 0, Math.floor(w * .68), h)
    if (zone === "narrow") return snapWindowRect(id, Math.floor(w * .68), 0, Math.ceil(w * .32), h)
    const right = zone === "tr" || zone === "br", bottom = zone === "bl" || zone === "br"
    return snapWindowRect(id, right ? half : 0, bottom ? halfH : 0, right ? w - half : half, bottom ? h - halfH : halfH)
  }, [snapWindowRect, taskbarMetric.height])

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (dragRef.current) {
        const drag = dragRef.current, dx = event.clientX - drag.startX, dy = event.clientY - drag.startY
        drag.lastX = event.clientX; drag.lastY = event.clientY
        const direction = Math.sign(event.movementX)
        if (direction && drag.lastDirection && direction !== drag.lastDirection && Math.abs(event.movementX) > 3) drag.directionChanges += 1
        if (direction) drag.lastDirection = direction
        if (os.aeroShake && !drag.shaken && Date.now() - drag.shakeStarted < 900 && drag.directionChanges >= 5) {
          drag.shaken = true
          setWindows((current) => current.map((win) => win.id === drag.id ? win : win.workspace === workspace ? { ...win, minimized: true } : win))
        }
        const x = clamp(drag.baseX + dx, 0, Math.max(0, window.innerWidth - 120))
        const y = clamp(drag.baseY + dy, 0, Math.max(0, window.innerHeight - taskbarMetric.height - 38))
        const element = document.querySelector<HTMLElement>(`[data-synnical-window-id="${CSS.escape(drag.id)}"]`)
        if (element) { element.style.left = `${x}px`; element.style.top = `${y}px` }
      }
      if (resizeRef.current) {
        const resize = resizeRef.current
        resize.lastX = event.clientX; resize.lastY = event.clientY
        const width = clamp(resize.width + event.clientX - resize.startX, MIN_WIDTH, Math.max(MIN_WIDTH, window.innerWidth))
        const height = clamp(resize.height + event.clientY - resize.startY, MIN_HEIGHT, Math.max(MIN_HEIGHT, window.innerHeight - taskbarMetric.height))
        const element = document.querySelector<HTMLElement>(`[data-synnical-window-id="${CSS.escape(resize.id)}"]`)
        if (element) { element.style.width = `${width}px`; element.style.height = `${height}px` }
      }
    }
    const up = () => {
      const drag = dragRef.current, resize = resizeRef.current; dragRef.current = null; resizeRef.current = null
      if (drag) {
        if (os.snapWindows && drag.lastY <= 18) snapZone(drag.id, "max")
        else if (os.snapWindows && drag.lastX <= 18) snapZone(drag.id, "left")
        else if (os.snapWindows && drag.lastX >= window.innerWidth - 18) snapZone(drag.id, "right")
        else {
          const x = clamp(drag.baseX + drag.lastX - drag.startX, 0, Math.max(0, window.innerWidth - 120))
          const y = clamp(drag.baseY + drag.lastY - drag.startY, 0, Math.max(0, window.innerHeight - taskbarMetric.height - 38))
          setWindows((current) => { const next=current.map((win)=>win.id===drag.id?{...win,x,y,maximized:false,snapGroup:null}:win);try{localStorage.setItem(WINDOW_KEY,JSON.stringify(next))}catch{};return next })
        }
      }
      if (resize) {
        const width = clamp(resize.width + resize.lastX - resize.startX, MIN_WIDTH, Math.max(MIN_WIDTH, window.innerWidth))
        const height = clamp(resize.height + resize.lastY - resize.startY, MIN_HEIGHT, Math.max(MIN_HEIGHT, window.innerHeight - taskbarMetric.height))
        setWindows((current) => { const next=current.map((win)=>win.id===resize.id?{...win,width,height,maximized:false,snapGroup:null}:win);try{localStorage.setItem(WINDOW_KEY,JSON.stringify(next))}catch{};return next })
      }
    }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up)
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up) }
  }, [os.aeroShake, os.snapWindows, workspace, snapZone, taskbarMetric.height])

  const activeCandidates = useMemo(() => windows.filter((win) => win.workspace === workspace && !win.minimized).sort((a, b) => b.z - a.z), [windows, workspace])
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (gameInputCaptured || document.documentElement.dataset.synnicalGameFocus === "1") return
      if (poweredOff) return
      if (locked) { if (lockStage === "lock") { event.preventDefault(); setLockStage("signin") }; return }
      if (shortcutMatches(event, os.shortcuts.taskManager)) { event.preventDefault(); setTaskManagerOpen(true); return }
      if (shortcutMatches(event, os.shortcuts.run)) { event.preventDefault(); setRunOpen(true); setRunQuery(""); return }
      if (event.altKey && event.key === "Tab") {
        event.preventDefault(); if (!activeCandidates.length) return
        setAltIndex((current) => current == null ? Math.min(1, activeCandidates.length - 1) : (current + 1) % activeCandidates.length)
      }
      if (shortcutMatches(event, os.shortcuts.clipboard)) { event.preventDefault(); setClipboardOpen((v) => !v); setEmojiOpen(false) }
      if (shortcutMatches(event, os.shortcuts.emoji)) { event.preventDefault(); setEmojiOpen((v) => !v); setClipboardOpen(false) }
      if ((event.metaKey && event.key.toLowerCase() === "z") || (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "z")) { event.preventDefault(); const top = activeCandidates[0]; if (top && os.snapLayouts) setSnapMenu(top.id) }
      if (shortcutMatches(event, os.shortcuts.taskView)) { event.preventDefault(); setTaskViewOpen(true) }
      const topWindow = activeCandidates[0]
      if (topWindow && shortcutMatches(event, os.shortcuts.snapLeft)) { event.preventDefault(); snapZone(topWindow.id, "left"); return }
      if (topWindow && shortcutMatches(event, os.shortcuts.snapRight)) { event.preventDefault(); snapZone(topWindow.id, "right"); return }
      if (topWindow && shortcutMatches(event, os.shortcuts.maximize)) { event.preventDefault(); snapZone(topWindow.id, "max"); return }
      if (shortcutMatches(event, os.shortcuts.showDesktop)) { event.preventDefault(); showDesktop(); return }
      const workspaceDirection = shortcutMatches(event, os.shortcuts.workspaceLeft) ? -1 : shortcutMatches(event, os.shortcuts.workspaceRight) ? 1 : 0
      if (workspaceDirection) {
        event.preventDefault()
        setWorkspace((current) => {
          const ids = os.workspaces.map((row) => row.id)
          if (!ids.length) return current
          const index = Math.max(0, ids.indexOf(current))
          const nextIndex = workspaceDirection < 0 ? (index - 1 + ids.length) % ids.length : (index + 1) % ids.length
          const next = ids[nextIndex]
          writeSetting(WORKSPACE_KEY, next)
          return next
        })
      }
      if (event.key === "Escape") { setStartOpen(false); setQuickOpen(false); setNoticeOpen(false); setWidgetsOpen(false); setTaskViewOpen(false); setClipboardOpen(false); setEmojiOpen(false); setRunOpen(false); setTaskManagerOpen(false); if (!captureRecording) setCaptureOpen(false); setContextMenu(null); setSnapMenu(null) }
    }
    const up = (event: KeyboardEvent) => { if (event.key === "Alt" && altIndex != null) { const target = activeCandidates[altIndex]; setAltIndex(null); if (target) focusWindow(target.id) } }
    window.addEventListener("keydown", down); window.addEventListener("keyup", up)
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up) }
  }, [locked, lockStage, poweredOff, activeCandidates, altIndex, focusWindow, os.snapLayouts, os.workspaces, os.shortcuts, gameInputCaptured, snapZone, workspace])

  const filteredApps = useMemo(() => {
    const raw = startQuery.trim().toLowerCase()
    const needle = raw.replace(/^(?:please\s+)?(?:open|launch|start|show)(?:\s+my)?\s+/, "").trim()
    const aliases: Partial<Record<Panel, string[]>> = { movies: ["films","film","synnflix","movies","tv","shows"], browser: ["web","internet","browser"], files: ["explorer","file explorer","files"], games: ["gaming","game","games"], chat: ["messages","dm","dms","chat"], settings: ["preferences","settings"], discover: ["search","find","discover"], "geforce-now": ["geforce","gfn","geforce now"] }
    return launcherApps.filter((app) => !needle || app.label.toLowerCase().includes(needle) || app.id.toLowerCase().includes(needle) || aliases[app.id]?.some((alias)=>alias.includes(needle)||needle.includes(alias))).sort((a, b) => a.label.localeCompare(b.label))
  }, [launcherApps, startQuery])
  const rememberStartSearch = (query: string) => {
    if (!os.startSearchHistory) return
    const value = query.trim().slice(0, 160); if (!value) return
    setStartSearchHistory((current) => {
      const next = [value, ...current.filter((item) => item.toLowerCase() !== value.toLowerCase())].slice(0, 12)
      try { localStorage.setItem(START_SEARCH_HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }
  const searchAllSynnical = () => {
    const query=startQuery.trim(); if(!query)return
    rememberStartSearch(query)
    queueGlobalSearch(query) // synnical-global-search also queues until a lazy Search panel mounts.
    openPanel("discover"); setStartOpen(false); setStartFolderOpen(null)
  }
  const pinnedApps = useMemo(() => pinned.filter((id)=>!os.hiddenLauncherApps.includes(id)).map((id) => allowed.get(id)).filter((x): x is DesktopApp => Boolean(x)), [pinned, allowed, os.hiddenLauncherApps])
  const runningPanels = useMemo(() => new Set(windows.map((win) => win.panel)), [windows])
  const taskbarApps = useMemo(() => {
    const runningIds = new Set(windows.map((win)=>win.panel))
    const ids = [...pinned.filter((id) => allowed.has(id) && (!os.hiddenLauncherApps.includes(id) || runningIds.has(id))), ...windows.map((win) => win.panel).filter((id) => !pinned.includes(id))]
    return ids.map((id) => allowed.get(id)).filter((x): x is DesktopApp => Boolean(x))
  }, [pinned, windows, allowed, os.hiddenLauncherApps])
  const snapTaskbarGroups = useMemo(() => {
    const groups = new Map<string, WindowRecord[]>()
    for (const win of windows) {
      if (win.workspace !== workspace || !win.snapGroup) continue
      const rows = groups.get(win.snapGroup) || []; rows.push(win); groups.set(win.snapGroup, rows)
    }
    for (const [key, rows] of [...groups]) if (rows.length < 2) groups.delete(key)
    return groups
  }, [windows, workspace])
  const groupedPanels = useMemo(() => new Set([...snapTaskbarGroups.values()].flat().map((win) => win.panel)), [snapTaskbarGroups])
  const standaloneTaskbarApps = useMemo(() => taskbarApps.filter((app) => !groupedPanels.has(app.id)), [taskbarApps, groupedPanels])
  const recentApps = useMemo(() => recents.map((row) => ({ ...row, app: allowed.get(row.panel) })).filter((row) => row.app).slice(0, 6), [recents, allowed])
  const onlineFriends = useMemo(() => onlineWidgetUsers.filter((row) => friendIds.has(row.userId)).slice(0, 8), [onlineWidgetUsers, friendIds])
  const widgetLayout = os.widgetLayouts[String(workspace)] || {}
  const desktopLayout = os.desktopLayouts[String(workspace)] || { order: [], hidden: [], labels: {}, customIcons: {}, positions: {}, folders: [] }
  const desktopFolderItems = useMemo(() => new Set(desktopLayout.folders.flatMap((folder) => folder.items)), [desktopLayout.folders])
  const desktopApps = useMemo(() => {
    const hidden = new Set(desktopLayout.hidden)
    const order = new Map(desktopLayout.order.map((id, index) => [id, index]))
    const recent = new Map(recents.map((row) => [row.panel, row.at]))
    const rows = launcherApps.filter((app) => !hidden.has(app.id) && !desktopFolderItems.has(app.id))
    if (os.desktopSort === "name") return [...rows].sort((a,b) => (desktopLayout.labels[a.id] || a.label).localeCompare(desktopLayout.labels[b.id] || b.label))
    if (os.desktopSort === "type") return [...rows].sort((a,b) => a.id.localeCompare(b.id))
    if (os.desktopSort === "recent") return [...rows].sort((a,b) => (recent.get(b.id) || 0) - (recent.get(a.id) || 0) || a.label.localeCompare(b.label))
    return [...rows].sort((a,b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999) || launcherApps.indexOf(a) - launcherApps.indexOf(b))
  }, [launcherApps, desktopLayout.hidden, desktopLayout.order, desktopLayout.labels, desktopFolderItems, os.desktopSort, recents])
  const workspaceWindows = windows.filter((win) => win.workspace === workspace)
  const maxZ = workspaceWindows.length ? Math.max(...workspaceWindows.map((row) => row.z)) : 0
  const clipboardRows = useMemo(() => readJson<{ id: string; text: string; at: number; pinned?: boolean }[]>(CLIPBOARD_KEY, []), [clipboardTick])

  const updatePinned = (next: Panel[]) => { setPinned(next); try { localStorage.setItem(PINNED_KEY, JSON.stringify(next)) } catch {} }
  const saveStartFolders = (folders: OsSettings["startFolders"]) => { const next={...os,startFolders:folders};setOs(next);void persistOsSettings(next) }
  const createStartFolder = () => {
    const name=window.prompt("Start folder name", `Folder ${os.startFolders.length+1}`)?.trim(); if(!name)return
    const folder={id:`start-${uid("folder")}`.replace(/[^a-z0-9:_-]/gi,"-").slice(0,80),name:name.slice(0,40),apps:[] as string[]}
    saveStartFolders([...os.startFolders,folder].slice(0,12));setStartFolderOpen(folder.id)
  }
  const addAppToStartFolder = (panel: Panel) => {
    if (!os.startFolders.length) {
      const name=window.prompt("Create a Start folder", "Apps")?.trim(); if(!name)return
      const folder={id:`start-${uid("folder")}`.replace(/[^a-z0-9:_-]/gi,"-").slice(0,80),name:name.slice(0,40),apps:[panel] as string[]}
      saveStartFolders([...os.startFolders,folder].slice(0,12)); return
    }
    const answer=window.prompt(`Add ${allowed.get(panel)?.label || panel} to which Start folder?\n${os.startFolders.map((folder)=>folder.name).join(" · ")}`, os.startFolders[0]?.name || "")?.trim().toLowerCase(); if(!answer)return
    const folder=os.startFolders.find((row)=>row.name.toLowerCase()===answer); if(!folder)return window.alert("No Start folder with that name.")
    saveStartFolders(os.startFolders.map((row)=>row.id===folder.id?{...row,apps:[...new Set([...row.apps,panel])].slice(0,18)}:row))
  }
  const removeAppFromStartFolder = (folderId: string, panel: string) => saveStartFolders(os.startFolders.map((row)=>row.id===folderId?{...row,apps:row.apps.filter((id)=>id!==panel)}:row))
  const renameStartFolder = (folderId: string) => { const folder=os.startFolders.find((row)=>row.id===folderId);if(!folder)return;const name=window.prompt("Rename Start folder",folder.name)?.trim();if(name)saveStartFolders(os.startFolders.map((row)=>row.id===folderId?{...row,name:name.slice(0,40)}:row)) }
  const removeStartFolder = (folderId: string) => { saveStartFolders(os.startFolders.filter((row)=>row.id!==folderId));setStartFolderOpen(null) }
  const widgetRect = (id: string, index: number, fallbackWidth = 220, fallbackHeight = 145): WidgetRect => {
    const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth
    const viewportHeight = typeof window === "undefined" ? 720 : window.innerHeight
    const saved = widgetLayout[id]
    if (saved) {
      const width = clamp(saved.width, 160, Math.max(160, viewportWidth - 16))
      const height = clamp(saved.height, 100, Math.max(100, viewportHeight - taskbarMetric.height - 16))
      return {
        x: clamp(saved.x, 0, Math.max(0, viewportWidth - width - 8)),
        y: clamp(saved.y, 0, Math.max(0, viewportHeight - taskbarMetric.height - height - 8)),
        width,
        height,
      }
    }
    const columns = viewportWidth >= (fallbackWidth * 2 + 180) ? 2 : 1
    const column = index % columns
    const row = Math.floor(index / columns)
    const x = Math.max(8, viewportWidth - fallbackWidth - 24 - column * (fallbackWidth + 12))
    const y = Math.max(8, Math.min(24 + row * (fallbackHeight + 12), viewportHeight - taskbarMetric.height - fallbackHeight - 8))
    return { x, y, width: fallbackWidth, height: fallbackHeight }
  }
  const saveWidgetRect = (id: string, rect: WidgetRect) => {
    const next = { ...os, widgetLayouts: { ...os.widgetLayouts, [String(workspace)]: { ...widgetLayout, [id]: rect } } }
    setOs(next); void persistOsSettings(next)
  }
  const saveDesktopLayout = (patch: Partial<OsSettings["desktopLayouts"][string]>) => {
    const current = os.desktopLayouts[String(workspace)] || { order: [], hidden: [], labels: {}, customIcons: {}, positions: {}, folders: [] }
    const layout = { ...current, ...patch }
    const next = { ...os, desktopLayouts: { ...os.desktopLayouts, [String(workspace)]: layout } }
    setOs(next); void persistOsSettings(next)
  }
  const moveDesktopItemBefore = (source: string, target: string) => {
    if (!source || source === target) return
    const base = [...desktopLayout.order.filter((id) => id !== source && allowed.has(id as Panel))]
    for (const app of launcherApps) if (!base.includes(app.id) && app.id !== source) base.push(app.id)
    const index = Math.max(0, base.indexOf(target)); base.splice(index, 0, source)
    saveDesktopLayout({ order: base })
  }
  const setDesktopItemPosition = (id: string, x: number, y: number) => saveDesktopLayout({ positions: { ...desktopLayout.positions, [id]: { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) } } })
  const createDesktopFolder = () => {
    const name = window.prompt("Folder name", "New folder")?.trim().slice(0,60); if (!name) return
    saveDesktopLayout({ folders: [...desktopLayout.folders, { id: `folder:${uid("desktop")}`, name, items: [] }] })
  }
  const renameDesktopFolder = (id: string) => {
    const folder = desktopLayout.folders.find((row) => row.id === id); if (!folder) return
    const name = window.prompt("Folder name", folder.name)?.trim().slice(0,60); if (!name) return
    saveDesktopLayout({ folders: desktopLayout.folders.map((row) => row.id === id ? { ...row, name } : row) })
  }
  const deleteDesktopFolder = (id: string) => {
    saveDesktopLayout({ folders: desktopLayout.folders.filter((row) => row.id !== id) }); setDesktopFolderOpen((current) => current === id ? null : current)
  }
  const addAppToDesktopFolder = (folderId: string, panel: string) => {
    if (!allowed.has(panel as Panel)) return
    saveDesktopLayout({ folders: desktopLayout.folders.map((folder) => folder.id === folderId ? { ...folder, items: [...folder.items.filter((id) => id !== panel), panel].slice(0,50) } : { ...folder, items: folder.items.filter((id) => id !== panel) }) })
  }
  const removeAppFromDesktopFolder = (folderId: string, panel: string) => saveDesktopLayout({ folders: desktopLayout.folders.map((folder) => folder.id === folderId ? { ...folder, items: folder.items.filter((id) => id !== panel) } : folder) })
  const renameDesktopApp = (panel: Panel) => {
    const app = allowed.get(panel); if (!app) return
    const name = window.prompt("Shortcut name", desktopLayout.labels[panel] || app.label)?.trim().slice(0,60); if (!name) return
    saveDesktopLayout({ labels: { ...desktopLayout.labels, [panel]: name } })
  }
  const setDesktopAppIcon = (panel: Panel) => {
    const value = window.prompt("Custom shortcut icon URL (leave blank to restore the app icon)", desktopLayout.customIcons[panel] || "")
    if (value === null) return
    const icon = value.trim().slice(0,2048)
    if (icon && !icon.startsWith("/api/uploads/") && !icon.startsWith("/brand/") && !/^https:\/\//i.test(icon)) { pushNotice("Icon not changed", "Use a Synnical upload, /brand/ asset, or HTTPS image URL."); return }
    const next = { ...desktopLayout.customIcons }; if (icon) next[panel] = icon; else delete next[panel]
    saveDesktopLayout({ customIcons: next })
  }
  const hideDesktopApp = (panel: Panel) => saveDesktopLayout({ hidden: [...new Set([...desktopLayout.hidden, panel])] })
  const showAllDesktopApps = () => saveDesktopLayout({ hidden: [] })
  const saveWorkspaceRows = (rows: OsSettings["workspaces"]) => {
    const next = { ...os, workspaces: rows }
    setOs(next)
    void persistOsSettings(next)
  }
  const setWorkspaceSafe = (id: number) => {
    const next = os.workspaces.some((row) => row.id === id) ? id : os.workspaces[0]?.id || 1
    setWorkspace(next); writeSetting(WORKSPACE_KEY, next); setTaskViewOpen(false); setStartOpen(false)
  }
  const createWorkspace = () => {
    if (os.workspaces.length >= 9) { pushNotice("Workspace limit", "Synnical supports up to nine persistent workspaces."); return }
    const id = Math.max(0, ...os.workspaces.map((row) => row.id)) + 1
    saveWorkspaceRows([...os.workspaces, { id, name: `Desktop ${id}`, wallpaper: "" }])
    setWorkspace(id); writeSetting(WORKSPACE_KEY, id)
  }
  const renameWorkspace = (id: number) => {
    const row = os.workspaces.find((item) => item.id === id); if (!row) return
    const name = window.prompt("Workspace name", row.name)?.trim().slice(0, 40)
    if (!name) return
    saveWorkspaceRows(os.workspaces.map((item) => item.id === id ? { ...item, name } : item))
  }
  const setWorkspaceWallpaper = (id: number) => {
    const row = os.workspaces.find((item) => item.id === id); if (!row) return
    const value = window.prompt("Workspace wallpaper URL (leave blank to use the global wallpaper)", row.wallpaper || "")
    if (value === null) return
    const candidate = value.trim().slice(0, 2048)
    if (candidate && !candidate.startsWith("/api/uploads/") && !candidate.startsWith("/brand/") && !/^https:\/\//i.test(candidate)) { pushNotice("Wallpaper not changed", "Use a Synnical upload, built-in /brand/ wallpaper, or an HTTPS image URL."); return }
    saveWorkspaceRows(os.workspaces.map((item) => item.id === id ? { ...item, wallpaper: candidate } : item))
  }
  const removeWorkspace = (id: number) => {
    if (os.workspaces.length <= 1) { pushNotice("Workspace required", "Keep at least one workspace."); return }
    const remaining = os.workspaces.filter((row) => row.id !== id)
    const fallback = remaining[0].id
    persistWindows(windows.map((win) => win.workspace === id ? { ...win, workspace: fallback } : win))
    saveWorkspaceRows(remaining)
    if (workspace === id) { setWorkspace(fallback); writeSetting(WORKSPACE_KEY, fallback) }
  }
  const showDesktop = () => setWindows((current) => current.map((win) => win.workspace === workspace ? { ...win, minimized: true } : win))
  const activateSnapGroup = (group: string) => {
    setWindows((current) => {
      const rows = current.filter((win) => win.snapGroup === group && win.workspace === workspace)
      if (!rows.length) return current
      const currentMax = Math.max(0, ...current.map((win) => win.z))
      const active = rows.every((win) => !win.minimized) && rows.some((win) => win.z === currentMax)
      let z = currentMax
      const next = current.map((win) => {
        if (win.snapGroup !== group || win.workspace !== workspace) return win
        if (active) return { ...win, minimized: true }
        z += 1; return { ...win, minimized: false, z }
      })
      zRef.current = Math.max(zRef.current, z)
      try { localStorage.setItem(WINDOW_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }
  const openSettingsCategory = (category: string) => { openPanel("settings"); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("synnical-settings-category", { detail: { category } }))) }
  const sendMediaCommand = (panel: Panel, command: "toggle" | "next" | "previous") => window.dispatchEvent(new CustomEvent("synnical-media-command", { detail: { panel, command } }))
  const jumpList = (panel: Panel): Array<{ label: string; run: () => void }> => {
    if (panel === "browser") return [
      { label: "Home", run: () => { openPanel("browser"); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("synnical-browser-navigate", { detail: { value: readSetting("browser.homepage", "https://www.google.com") } }))) } },
    ]
    if (panel === "chat") return [{ label: "Compose message", run: () => { openPanel("chat"); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("synnical-chat-compose", { detail: { text: "" } }))) } }]
    if (panel === "files") return [{ label: "Recycle Bin", run: () => { openPanel("files"); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("synnical-files-open", { detail: { view: "recycle" } }))) } }]
    if (panel === "settings") return [{ label: "Personalization", run: () => openSettingsCategory("personalization") }, { label: "Notifications", run: () => openSettingsCategory("system") }]
    if (panel === "music") return [{ label: mediaState.music?.playing ? "Pause" : "Play", run: () => { openPanel("music"); sendMediaCommand("music", "toggle") } }, { label: "Next track", run: () => { openPanel("music"); sendMediaCommand("music", "next") } }]
    return [{ label: `Open ${allowed.get(panel)?.label || "app"}`, run: () => openPanel(panel) }]
  }

  const typeVirtual = (text: string) => {
    const target = editableRef.current
    if (!target || !document.contains(target)) {
      setKeyboardHint("Click a Synnical text box first. Cross-site embedded pages use their own keyboard handling.")
      return
    }
    target.focus()
    insertText(target, text)
    setKeyboardHint("")
  }
  const virtualBackspace = () => {
    const target = editableRef.current
    if (!target || !document.contains(target)) return setKeyboardHint("Click a Synnical text box first.")
    backspaceText(target); setKeyboardHint("")
  }
  const virtualEnter = () => {
    const target = editableRef.current
    if (!target || !document.contains(target)) return setKeyboardHint("Click a Synnical text box first.")
    if (target instanceof HTMLTextAreaElement || (!(target instanceof HTMLInputElement) && target.isContentEditable)) typeVirtual("\n")
    else if (target instanceof HTMLInputElement) target.form?.requestSubmit()
  }

  const loadRecoveryQuestion = async () => {
    if (!user) return
    setForgotError("")
    setForgotQuestion("")
    try {
      const res = await fetch(`/api/auth/forgot-password?username=${encodeURIComponent(user.username)}`, { cache: "no-store", credentials: "include" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.ready || typeof body.question !== "string") throw new Error("Password recovery is not configured for this account")
      setForgotQuestion(body.question)
    } catch (cause) { setForgotError(cause instanceof Error ? cause.message : "Could not load recovery question") }
  }
  const openForgot = () => { setForgotOpen(true); setForgotAnswer(""); setForgotCode(""); setForgotPassword(""); setForgotConfirm(""); void loadRecoveryQuestion() }
  const resetForgotPassword = async () => {
    if (!user) return
    setForgotError("")
    if (forgotPassword.length < 8) return setForgotError("New password must be at least 8 characters")
    if (forgotPassword !== forgotConfirm) return setForgotError("The new passwords do not match")
    setForgotBusy(true)
    try {
      const res = await fetch("/api/auth/forgot-password", { method: "POST", credentials: "include", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: user.username, securityAnswer: forgotAnswer, recoveryCode: forgotCode, newPassword: forgotPassword }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "Password recovery failed")
      setForgotOpen(false); setForgotAnswer(""); setForgotCode(""); setForgotPassword(""); setForgotConfirm(""); setUnlockPassword("")
      setUnlockError("Password reset. Sign in with your new password.")
    } catch (cause) { setForgotError(cause instanceof Error ? cause.message : "Password recovery failed") }
    finally { setForgotBusy(false) }
  }

  const unlock = async () => {
    if (!user) { setLocked(false); setLockStage("lock"); return }
    if (!unlockPassword) { setUnlockError("Enter your Synnical password."); return }
    setUnlocking(true); setUnlockError("")
    try {
      const res = await fetch("/api/features/security", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "verify-password", password: unlockPassword }) })
      if (!res.ok) { const body = await res.json().catch(() => ({})); setUnlockError(typeof body?.error === "string" ? body.error : "Password confirmation failed"); return }
      setUnlockPassword(""); setLocked(false); setLockStage("lock")
    } catch { setUnlockError("Could not verify your password.") } finally { setUnlocking(false) }
  }

  const unlockWithPin = async () => {
    if (!user || !pinConfigured) return
    if (!/^\d{4,8}$/.test(unlockPin)) { setUnlockError("Enter your 4-8 digit PIN."); return }
    setUnlocking(true); setUnlockError("")
    try {
      const res = await fetch("/api/features/security", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "verify-pin", pin: unlockPin }) })
      if (!res.ok) { const body = await res.json().catch(() => ({})); setUnlockError(typeof body?.error === "string" ? body.error : "PIN verification failed"); return }
      setUnlockPin(""); setLocked(false); setLockStage("lock")
    } catch { setUnlockError("Could not verify your PIN.") } finally { setUnlocking(false) }
  }

  const requestBluetooth = async () => {
    const nav = navigator as Navigator & { bluetooth?: { requestDevice: (options: any) => Promise<any> } }
    if (!nav.bluetooth?.requestDevice) return
    try { await nav.bluetooth.requestDevice({ acceptAllDevices: true }) } catch {}
  }

  const cycleKeyboardTheme = () => {
    const next = keyboardTheme === "glass" ? "dark" : keyboardTheme === "dark" ? "light" : "glass"
    setKeyboardTheme(next); writeSetting("a11y.keyboardTheme", next)
  }
  const startVoiceTyping = () => {
    const win = window as typeof window & { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }
    const Recognition = win.SpeechRecognition || win.webkitSpeechRecognition
    if (!Recognition) { setKeyboardHint("Voice typing is not supported by this browser."); return }
    try {
      const recognition = new Recognition()
      recognition.lang = navigator.language || "en-GB"
      recognition.continuous = false
      recognition.interimResults = false
      recognition.onstart = () => { setVoiceTyping(true); setKeyboardHint("Listening…") }
      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results || []).map((row: any) => row?.[0]?.transcript || "").join(" ").trim()
        if (transcript) typeVirtual(transcript)
      }
      recognition.onerror = (event: any) => setKeyboardHint(typeof event?.error === "string" ? `Voice typing: ${event.error}` : "Voice typing failed.")
      recognition.onend = () => { setVoiceTyping(false); setKeyboardHint("") }
      recognition.start()
    } catch { setVoiceTyping(false); setKeyboardHint("Voice typing could not start.") }
  }

  const stopCaptureStream = () => { captureStreamRef.current?.getTracks().forEach((track) => track.stop()); captureStreamRef.current = null; announceMediaUsage("capture", { screen:false }) }
  const takeWorkspaceScreenshot = async (copyForChat = false) => {
    setCaptureError("")
    if (!navigator.mediaDevices?.getDisplayMedia) { setCaptureError("Screen capture is not supported by this browser."); return }
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      captureStreamRef.current = stream
      announceMediaUsage("capture", { screen:true })
      const video = document.createElement("video")
      video.srcObject = stream; video.muted = true; video.playsInline = true
      await video.play()
      if (!video.videoWidth || !video.videoHeight) await new Promise<void>((resolve) => { video.onloadedmetadata = () => resolve(); setTimeout(resolve, 800) })
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, video.videoWidth); canvas.height = Math.max(1, video.videoHeight)
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
      if (!blob) throw new Error("Could not create screenshot")
      if (copyForChat && navigator.clipboard && "write" in navigator.clipboard && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
        openPanel("chat"); setCaptureOpen(false)
        pushNotice("Screenshot copied", "Paste it into a supported Chat attachment field or another app.", undefined, "normal")
        return
      }
      const url = URL.createObjectURL(blob), a = document.createElement("a")
      a.href=url; a.download=`synnical-screenshot-${new Date().toISOString().replace(/[:.]/g,"-")}.png`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),5000)
    } catch (cause) { setCaptureError(cause instanceof Error ? cause.message : "Screen capture was cancelled or failed.") }
    finally {
      stream?.getTracks().forEach((track)=>track.stop())
      if (captureStreamRef.current === stream) captureStreamRef.current=null
      announceMediaUsage("capture", { screen:false })
    }
  }
  const startScreenRecording = async () => {
    setCaptureError("")
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") { setCaptureError("Screen recording is not supported by this browser."); return }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      captureStreamRef.current = stream
      announceMediaUsage("capture", { screen:true }); captureChunksRef.current=[]
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? { mimeType: "video/webm;codecs=vp9" } : undefined)
      captureRecorderRef.current=recorder
      recorder.ondataavailable=(event)=>{if(event.data.size)captureChunksRef.current.push(event.data)}
      recorder.onstop=()=>{
        const blob=new Blob(captureChunksRef.current,{type:recorder.mimeType||"video/webm"}); captureChunksRef.current=[]; stopCaptureStream(); setCaptureRecording(false)
        if(!blob.size)return
        const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`synnical-recording-${new Date().toISOString().replace(/[:.]/g,"-")}.webm`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000)
      }
      stream.getVideoTracks()[0]?.addEventListener("ended",()=>{if(recorder.state!=="inactive")recorder.stop()},{once:true})
      recorder.start(500); setCaptureRecording(true)
    } catch (cause) { stopCaptureStream(); setCaptureRecording(false); setCaptureError(cause instanceof Error ? cause.message : "Screen recording was cancelled or failed.") }
  }
  const stopScreenRecording = () => { const recorder=captureRecorderRef.current; if(recorder && recorder.state!=="inactive") recorder.stop(); else { stopCaptureStream(); setCaptureRecording(false) } }

  const runCommand = (raw = runQuery) => {
    const query = raw.trim()
    if (!query) return
    const lower = query.toLowerCase()
    if (["snip", "screenshot", "capture", "screen capture", "record screen", "screen recording"].includes(lower)) { setRunOpen(false); setCaptureOpen(true); return }
    const aliases: Record<string, Panel> = {
      chat: "chat", messages: "chat", friends: "friends", browser: "browser", web: "browser",
      games: "games", gaming: "games", movies: "movies", films: "movies", synnflix: "movies",
      music: "music", files: "files", explorer: "files", settings: "settings", shop: "shop",
      ai: "ai", moderation: "moderation", calls: "calls", youtube: "youtube", geforce: "geforce-now", gfn: "geforce-now",
    }
    if (lower === "taskmgr" || lower === "task manager") { setTaskManagerOpen(true); setRunOpen(false); setRunQuery(""); return }
    const app = aliases[lower] || apps.find((row) => row.label.toLowerCase() === lower || row.id === lower)?.id
    if (app && allowed.has(app)) { openPanel(app); setRunOpen(false); setRunQuery(""); return }
    if (/^(https?:\/\/|[a-z0-9.-]+\.[a-z]{2,})(?:\/|$)/i.test(query)) {
      openPanel("browser")
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("synnical-browser-navigate", { detail: { url: /^https?:\/\//i.test(query) ? query : `https://${query}` } })), 80)
      setRunOpen(false); setRunQuery(""); return
    }
    setRunOpen(false); setRunQuery("")
    setStartOpen(true); setStartQuery(query)
  }

  const closeFlyouts = () => { setStartOpen(false); setQuickOpen(false); setNoticeOpen(false); setWidgetsOpen(false); setTaskViewOpen(false); setClipboardOpen(false); setEmojiOpen(false); setContextMenu(null); setPowerMenu(false); setTrayOverflow(false); setDesktopFolderOpen(null); setRunOpen(false) }

  if (poweredOff) return <div className="synnical-os-root grid h-[100dvh] w-full place-items-center bg-black text-white"><button onClick={() => setPoweredOff(false)} className="flex flex-col items-center gap-4 rounded-2xl p-8 hover:bg-white/[0.04]"><img src="/logo.svg" alt="Synnical" className="h-14 w-14" /><span className="text-sm text-white/60">Start Synnical</span></button></div>
  if (locked) return <div className="synnical-os-lock relative h-[100dvh] overflow-hidden bg-black text-white" style={lockWallpaperIsVideo ? undefined : lockWallpaperStyle} onClick={() => lockStage === "lock" && setLockStage("signin")}>
    {lockWallpaperIsVideo ? <video className="pointer-events-none absolute inset-[-2%] h-[104%] w-[104%] object-cover" src={lockWallpaperValue} autoPlay muted loop playsInline preload="auto" /> : null}
    <div className="absolute inset-0 bg-black/25 backdrop-blur-[1px]" />
    {lockStage === "lock" ? <div className="absolute inset-0 flex flex-col items-center justify-start pt-[18vh] text-center">{os.lockShowClock ? <><div className="text-7xl font-light tracking-tight drop-shadow-xl">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div><div className="mt-3 text-xl drop-shadow">{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</div></> : null}{os.lockShowNotifications && notices.length ? <div className="mt-8 w-[min(420px,90vw)] space-y-2 text-left">{notices.slice(0,3).map((notice)=><div key={notice.id} className="rounded-xl border border-white/15 bg-black/35 p-3 shadow-lg backdrop-blur"><p className="text-xs font-semibold">{notice.title}</p><p className="mt-1 line-clamp-2 text-[11px] text-white/70">{os.lockHideSensitiveNotificationText ? "Content hidden until you sign in" : notice.body}</p></div>)}</div> : null}{os.lockShowMedia ? Object.entries(mediaState).filter(([,state])=>Boolean(state)).slice(0,1).map(([panel,state])=><div key={panel} className="mt-5 flex w-[min(420px,90vw)] items-center gap-3 rounded-2xl border border-white/15 bg-black/35 p-3 text-left shadow-xl backdrop-blur-xl">{state!.artwork?<img src={state!.artwork} alt="" className="h-14 w-14 rounded-lg object-cover"/>:<Play className="h-6 w-6 text-white/70"/>}<div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{state!.title}</p><p className="truncate text-[10px] text-white/55">{state!.subtitle||allowed.get(panel as Panel)?.label||"Now Playing"}</p></div><button onClick={(e)=>{e.stopPropagation();sendMediaCommand(panel as Panel,"toggle")}} className="rounded-lg bg-white/10 px-3 py-2 text-[10px] hover:bg-white/20">{state!.playing?"Pause":"Play"}</button></div>) : null}{os.lockShowStatus?<div className="mt-3 flex items-center gap-3 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-[9px] text-white/55 backdrop-blur"><span>{system.online?"Synnical online":"Offline"}</span><span>•</span><span>{system.rtt!=null?`${system.rtt} ms`:"RTT unavailable"}</span>{system.batterySupported?<><span>•</span><span>{system.batteryLevel}%{system.charging?" charging":""}</span></>:null}</div>:null}<div className="mt-auto mb-14 text-xs text-white/65">Click or press a key to sign in</div></div> : <div className="absolute inset-0 grid place-items-center"><div className="w-[min(360px,90vw)] text-center"><div className="mx-auto grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-white/15 shadow-2xl">{user?.pfpUrl ? <img src={user.pfpUrl} alt="" className="h-full w-full object-cover" /> : <CircleUserRound className="h-12 w-12" />}</div><h1 className="mt-5 text-2xl font-semibold">{user?.displayName || user?.username || "Synnical"}</h1>{user && lockRequiresPassword ? <>{pinConfigured ? <div className="mt-5 flex justify-center gap-1 rounded-lg bg-black/25 p-1"><button onClick={() => { setUnlockMode("password"); setUnlockError("") }} className={cn("rounded-md px-3 py-1.5 text-xs", unlockMode === "password" ? "bg-white text-black" : "text-white/70 hover:bg-white/10")}>Password</button><button onClick={() => { setUnlockMode("pin"); setUnlockError("") }} className={cn("rounded-md px-3 py-1.5 text-xs", unlockMode === "pin" ? "bg-white text-black" : "text-white/70 hover:bg-white/10")}>PIN</button></div> : null}{unlockMode === "pin" && pinConfigured ? <input autoFocus inputMode="numeric" pattern="[0-9]*" maxLength={8} value={unlockPin} onChange={(e) => setUnlockPin(e.target.value.replace(/\D/g, "").slice(0,8))} onKeyDown={(e) => e.key === "Enter" && unlockWithPin()} placeholder="PIN" className="mt-3 h-10 w-full rounded-md border border-white/25 bg-black/30 px-3 text-center text-lg tracking-[0.35em] outline-none backdrop-blur focus:border-white/60" /> : <input autoFocus type="password" value={unlockPassword} onChange={(e) => setUnlockPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlock()} placeholder="Password" className={cn("h-10 w-full rounded-md border border-white/25 bg-black/30 px-3 text-sm outline-none backdrop-blur focus:border-white/60", pinConfigured ? "mt-3" : "mt-5")} />}{unlockError ? <p className="mt-2 text-xs text-red-300">{unlockError}</p> : null}<div className="mt-3 flex items-center justify-center gap-3"><button onClick={unlockMode === "pin" && pinConfigured ? unlockWithPin : unlock} disabled={unlocking} className="rounded-md bg-white px-5 py-2 text-sm font-medium text-black disabled:opacity-50">{unlocking ? "Checking…" : "Unlock"}</button>{unlockMode === "password" ? <button onClick={openForgot} className="rounded-md px-3 py-2 text-xs text-white/75 hover:bg-white/10">Forgot my password</button> : null}</div></> : <button onClick={() => { setLocked(false); setLockStage("lock") }} className="mt-5 rounded-md bg-white px-5 py-2 text-sm font-medium text-black">Continue</button>}</div></div>}
    {forgotOpen ? <div className="absolute inset-0 z-20 grid place-items-center bg-black/60 p-4 backdrop-blur-md" onClick={(e)=>e.stopPropagation()}><div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#17171b] p-5 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">Reset password</h2><p className="mt-1 text-xs text-white/40">@{user?.username}</p></div><button onClick={()=>setForgotOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10"><X className="h-4 w-4" /></button></div>{forgotQuestion ? <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-sm">{forgotQuestion}</p> : <p className="mt-4 text-xs text-white/45">Loading your recovery question…</p>}<div className="mt-3 space-y-2"><input type="password" value={forgotAnswer} onChange={(e)=>setForgotAnswer(e.target.value)} placeholder="Security answer" className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none" /><input value={forgotCode} onChange={(e)=>setForgotCode(e.target.value.toUpperCase())} placeholder="One-time recovery code" className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none" /><input type="password" value={forgotPassword} onChange={(e)=>setForgotPassword(e.target.value)} placeholder="New password" className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none" /><input type="password" value={forgotConfirm} onChange={(e)=>setForgotConfirm(e.target.value)} placeholder="Confirm new password" className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none" /></div>{forgotError ? <p className="mt-3 text-xs text-red-300">{forgotError}</p> : null}<button onClick={resetForgotPassword} disabled={forgotBusy || !forgotQuestion} className="mt-4 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-50">{forgotBusy ? "Resetting…" : "Reset password"}</button><p className="mt-3 text-[10px] leading-4 text-white/30">Your recovery answer alone is not enough. A valid one-time recovery code is also required.</p></div></div> : null}
  </div>

  const calendar = calendarCells(now)
  const taskbarCenter = os.taskbarAlignment === "center"
  const desktopGridColumns = isBrowserFullscreen ? DESKTOP_GRID_COLUMNS.fullscreen : DESKTOP_GRID_COLUMNS.normal
  const desktopBaseGridTile = os.desktopIconSize === "small"
    ? { width: 68, height: 64 }
    : os.desktopIconSize === "large"
      ? { width: 100, height: 92 }
      : { width: 82, height: 78 }
  const desktopGridItemCount = desktopApps.length + desktopLayout.folders.length
  const desktopGridRows = Math.max(1, Math.ceil(desktopGridItemCount / desktopGridColumns))
  const desktopGridAvailableHeight = typeof window === "undefined"
    ? 640
    : Math.max(180, Math.floor((window.visualViewport?.height || window.innerHeight) - taskbarMetric.height - 16))
  const desktopGridGap = desktopGridRows > 8 ? 2 : 4
  const desktopGridScale = Math.min(1, desktopGridAvailableHeight / Math.max(desktopBaseGridTile.height, desktopGridRows * (desktopBaseGridTile.height + desktopGridGap)))
  const desktopGridTile = {
    width: Math.max(os.desktopIconSize === "small" ? 58 : 66, Math.floor(desktopBaseGridTile.width * Math.max(0.78, desktopGridScale))),
    height: Math.max(os.desktopIconSize === "small" ? 54 : 60, Math.floor(desktopBaseGridTile.height * Math.max(0.78, desktopGridScale))),
  }

  return <div className={cn("synnical-os-root relative h-[100dvh] w-full overflow-hidden bg-[#111214] text-white", !os.animations && "synnical-os-no-animations", os.taskbarAutoHide && "synnical-taskbar-autohide", !os.transparency && "synnical-os-opaque", os.cursorTheme !== "system" && "synnical-os-custom-cursor")} style={{ filter: `brightness(${os.osBrightness / 100})`, "--synnical-glass-alpha": Math.max(.2, Math.min(1, os.glassStrength / 100)), "--synnical-taskbar-height": `${taskbarMetric.height}px`, "--synnical-os-animation-scale": os.animationSpeed / 100, "--synnical-cursor-size": os.cursorSize, "--synnical-cursor-theme": os.cursorTheme, cursor: osCursor(os.cursorTheme, os.cursorSize) } as CSSProperties} onMouseDown={() => { closeFlyouts() }} onContextMenu={(e) => { if ((e.target as HTMLElement).closest(".synnical-os-window,.synnical-taskbar")) return; e.preventDefault(); closeFlyouts(); setContextMenu({ kind: "desktop", x: e.clientX, y: e.clientY }) }}>
    {desktopWallpaperIsVideo ? <video ref={desktopVideoRef} key={desktopWallpaperUrl} className="synnical-live-wallpaper pointer-events-none absolute inset-[-2%] h-[104%] w-[104%] object-cover" src={desktopWallpaperUrl} autoPlay muted loop playsInline preload="auto" style={{ filter: `brightness(${(100 - os.wallpaperDim) / 100}) blur(${os.wallpaperBlur}px) saturate(${os.wallpaperSaturation}%)` }} /> : <div className="pointer-events-none absolute inset-[-2%]" style={{ ...desktopWallpaperStyle, filter: `brightness(${(100 - os.wallpaperDim) / 100}) blur(${os.wallpaperBlur}px) saturate(${os.wallpaperSaturation}%)` }} />}
    <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/20" />
    {os.nightLight ? <div className="pointer-events-none absolute inset-0 z-[50000] bg-orange-400 mix-blend-multiply" style={{ opacity: os.nightLightStrength / 250 }} /> : null}

    {os.showDesktopIcons ? <div className="absolute left-2 top-2 z-[4] grid content-start justify-start gap-x-1 overflow-hidden" style={{ gridTemplateColumns: `repeat(${desktopGridColumns}, ${desktopGridTile.width}px)`, gridAutoRows: `${desktopGridTile.height}px`, rowGap: desktopGridGap, bottom: taskbarMetric.height + 4 }}>
      {desktopApps.map((app) => { const Icon=app.icon; const label=desktopLayout.labels[app.id] || app.label; const customIcon=desktopLayout.customIcons[app.id]; const content=<button key={app.id} type="button" draggable onDragStart={(e)=>e.dataTransfer.setData("text/synnical-desktop-item",app.id)} onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{ e.preventDefault(); const source=e.dataTransfer.getData("text/synnical-desktop-item"); if(source)moveDesktopItemBefore(source,app.id) }} onDoubleClick={() => openPanel(app.id)} onContextMenu={(e)=>{e.preventDefault();e.stopPropagation();setContextMenu({kind:"app",x:e.clientX,y:e.clientY,panel:app.id,anchor:"pointer"})}} className="group flex h-[78px] w-[82px] flex-col items-center justify-center rounded px-1 py-1 text-center hover:bg-sky-400/15 focus:bg-sky-400/20" style={{ width: desktopGridTile.width, height: desktopGridTile.height }} title={label}><span className={cn("synnical-desktop-app-icon grid place-items-center text-white/90 transition-transform group-hover:scale-105", os.desktopIconSize === "small" ? "h-8 w-8" : os.desktopIconSize === "large" ? "h-14 w-14" : "h-11 w-11")} style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,.75)) drop-shadow(0 0 5px rgba(255,255,255,.16))" }}>{customIcon ? <img src={customIcon} alt="" className="h-full w-full object-contain" /> : <Icon className={cn(os.desktopIconSize === "small" ? "h-7 w-7" : os.desktopIconSize === "large" ? "h-12 w-12" : "h-10 w-10")} />}</span><span className="mt-1 max-w-full line-clamp-2 px-1 py-0.5 text-[11px] font-medium leading-3 text-white [text-shadow:0_1px_2px_#000,0_0_4px_#000,0_0_8px_rgba(0,0,0,.9)]">{label}</span></button>; return content })}
      {desktopLayout.folders.map((folder)=>{ const id=folder.id; return <button key={id} draggable onDragStart={(e)=>e.dataTransfer.setData("text/synnical-desktop-item",id)} onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault();const source=e.dataTransfer.getData("text/synnical-desktop-item");if(source&&!source.startsWith("folder:"))addAppToDesktopFolder(id,source)}} onDoubleClick={()=>setDesktopFolderOpen((current)=>current===id?null:id)} onContextMenu={(e)=>{e.preventDefault();e.stopPropagation();const action=window.prompt(`Folder: ${folder.name}\nType R to rename, D to delete`,"R")?.toUpperCase();if(action==="R")renameDesktopFolder(id);if(action==="D")deleteDesktopFolder(id)}} className="group flex h-[78px] w-[82px] flex-col items-center justify-center rounded px-1 py-1 text-center hover:bg-sky-400/15" style={{ width: desktopGridTile.width, height: desktopGridTile.height }}><Folder className="h-10 w-10 fill-amber-300/20 text-amber-200 drop-shadow" /><span className="mt-1 max-w-full line-clamp-2 text-[11px] text-white [text-shadow:0_1px_2px_#000,0_0_5px_#000]">{folder.name}</span></button>})}
    </div> : null}

    {desktopFolderOpen ? (()=>{ const folder=desktopLayout.folders.find((row)=>row.id===desktopFolderOpen); if(!folder)return null; return <div className="absolute left-24 top-24 z-[15000] w-80 rounded-2xl border border-white/15 bg-[#17171b]/96 p-3 shadow-2xl backdrop-blur-2xl" onMouseDown={(e)=>e.stopPropagation()}><div className="flex items-center gap-2"><Folder className="h-4 w-4 text-amber-200"/><strong className="min-w-0 flex-1 truncate text-sm">{folder.name}</strong><button onClick={()=>setDesktopFolderOpen(null)} className="grid h-7 w-7 place-items-center rounded hover:bg-white/10"><X className="h-3.5 w-3.5"/></button></div><div className="mt-3 grid grid-cols-3 gap-2">{folder.items.map((id)=>{const app=allowed.get(id as Panel);if(!app)return null;const Icon=app.icon;return <div key={id} className="group relative"><button onDoubleClick={()=>openPanel(app.id)} className="flex w-full flex-col items-center rounded-lg p-2 hover:bg-white/10"><Icon className="h-8 w-8"/><span className="mt-1 max-w-full truncate text-[10px]">{desktopLayout.labels[id]||app.label}</span></button><button onClick={()=>removeAppFromDesktopFolder(folder.id,id)} className="absolute right-0 top-0 hidden h-5 w-5 place-items-center rounded bg-black/70 text-white/50 group-hover:grid" title="Remove from folder"><X className="h-3 w-3"/></button></div>})}{!folder.items.length?<p className="col-span-3 py-6 text-center text-xs text-white/35">Drag desktop apps onto this folder.</p>:null}</div></div>})() : null}

    {os.showWidgets ? <>
      {os.desktopClockWidget ? <DesktopWidgetCard id="clock" title="Clock" icon={Timer} rect={widgetRect("clock",0,230,145)} onRect={(rect)=>saveWidgetRect("clock",rect)}><div className="text-4xl font-light tracking-tight">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(os.clockSeconds ? { second: "2-digit" as const } : {}) })}</div><div className="mt-1 text-xs text-white/65">{Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time"}</div>{os.additionalTimeZones.length ? <div className="mt-3 space-y-1 border-t border-white/10 pt-2">{os.additionalTimeZones.map((zone) => <div key={zone} className="flex justify-between gap-3 text-[10px]"><span className="truncate text-white/45">{zone}</span><span>{safeTimeZoneLabel(zone, now) || "Unavailable"}</span></div>)}</div> : null}</DesktopWidgetCard> : null}
      {os.desktopWeatherWidget ? <DesktopWidgetCard id="weather" title="Weather" icon={CloudSun} rect={widgetRect("weather",7,250,150)} onRect={(rect)=>saveWidgetRect("weather",rect)}>{weather && "temperature" in weather ? <div><div className="text-4xl font-light">{weather.temperature}°C</div><div className="mt-1 text-sm text-white/65">{weather.label}</div><p className="mt-3 text-[9px] text-white/30">Local weather · browser location permission</p></div> : <p className="text-xs leading-5 text-white/45">{weather && "error" in weather ? weather.error : "Loading local weather…"}</p>}</DesktopWidgetCard> : null}
      {os.desktopCalendarWidget ? <DesktopWidgetCard id="calendar" title="Calendar" icon={CalendarDays} rect={widgetRect("calendar",1,250,225)} onRect={(rect)=>saveWidgetRect("calendar",rect)}><div className="flex items-center gap-2 text-xs font-semibold">{now.toLocaleDateString([], { month: "long", year: "numeric" })}</div><div className="mt-3 grid grid-cols-7 gap-1 text-center text-[9px] text-white/45">{["S","M","T","W","T","F","S"].map((d,i)=><span key={`${d}-${i}`}>{d}</span>)}{calendar.map((d,i)=><span key={i} className={cn("grid h-6 place-items-center rounded-full", d.toDateString()===now.toDateString()&&"bg-sky-500 text-white", d.getMonth()!==now.getMonth()&&"text-white/20")}>{d.getDate()}</span>)}</div></DesktopWidgetCard> : null}
      {os.desktopRecentGamesWidget ? <DesktopWidgetCard id="recent-games" title="Recently played" icon={Gamepad2} rect={widgetRect("recent-games",2,250,160)} onRect={(rect)=>saveWidgetRect("recent-games",rect)}>{recentGames.length ? <div className="space-y-1.5">{recentGames.slice(0,4).map((game)=><button key={game.id} onClick={()=>{openPanel("games");window.setTimeout(()=>window.dispatchEvent(new CustomEvent("synnical-game-open",{detail:{gameKey:game.id}})),80)}} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-white/10"><Play className="h-3.5 w-3.5 text-emerald-300"/><span className="min-w-0 flex-1 truncate">{game.name}</span><span className="text-[9px] text-white/30">{new Date(game.at).toLocaleDateString()}</span></button>)}</div> : <p className="text-xs leading-5 text-white/40">Games you actually launch will appear here.</p>}</DesktopWidgetCard> : null}
      {os.desktopFriendsWidget ? <DesktopWidgetCard id="friends-online" title="Friends online" icon={Users} rect={widgetRect("friends-online",3,250,180)} onRect={(rect)=>saveWidgetRect("friends-online",rect)}>{onlineFriends.length ? <div className="space-y-1">{onlineFriends.map((friend)=><button key={friend.userId} onClick={()=>openPanel("friends")} className="flex w-full items-center gap-2 rounded-lg p-1.5 text-left hover:bg-white/10">{friend.pfpUrl?<img src={friend.pfpUrl} alt="" className="h-7 w-7 rounded-full object-cover"/>:<span className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-[10px]">{(friend.displayName||friend.username||"?")[0]?.toUpperCase()}</span>}<span className="min-w-0 flex-1 truncate text-xs">{friend.displayName||friend.username}</span><span className="h-2 w-2 rounded-full bg-emerald-400"/></button>)}</div> : <p className="text-xs text-white/40">No friends are online right now.</p>}</DesktopWidgetCard> : null}
      {os.desktopCreditsWidget ? <DesktopWidgetCard id="credits" title="Credit balance" icon={Coins} rect={widgetRect("credits",5,210,125)} onRect={(rect)=>saveWidgetRect("credits",rect)}><button onClick={()=>openPanel("shop")} className="flex w-full items-end justify-between rounded-xl p-2 text-left hover:bg-white/[0.06]"><div><div className="text-3xl font-light">{Number(user?.coins||0).toLocaleString()}</div><div className="mt-1 text-[10px] text-white/40">Synnical credits</div></div><Coins className="h-7 w-7 text-amber-300"/></button></DesktopWidgetCard> : null}
      {os.desktopPinnedChatWidget ? <DesktopWidgetCard id="pinned-chat" title="Pinned chats" icon={MessageSquare} rect={widgetRect("pinned-chat",6,250,175)} onRect={(rect)=>saveWidgetRect("pinned-chat",rect)}>{pinnedChats.length ? <div className="space-y-1">{pinnedChats.map((chat)=><button key={chat.id} onClick={()=>{openPanel("chat");window.setTimeout(()=>window.dispatchEvent(new CustomEvent("synnical-chat-open-message",{detail:{channelId:chat.id}})),80)}} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/10">{chat.avatar?<img src={chat.avatar} alt="" className="h-7 w-7 rounded-full object-cover"/>:<MessageSquare className="h-4 w-4 text-sky-300"/>}<span className="min-w-0 flex-1 truncate text-xs">{chat.name}</span>{chat.unread?<span className="grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold">{chat.unread>99?"99+":chat.unread}</span>:null}</button>)}</div>:<p className="text-xs text-white/40">Pin a DM in Chat and it will appear here.</p>}</DesktopWidgetCard> : null}
    </> : null}

    {windows.map((win) => {
      const app = allowed.get(win.panel); if (!app) return null
      const Icon = app.icon, visible = win.workspace === workspace && !win.minimized
      return <section key={win.id} data-synnical-window-id={win.id} className={cn("synnical-os-window synnical-window-open absolute overflow-hidden rounded-lg border border-white/15 bg-[#0d0d0f]/96 shadow-[0_20px_80px_rgba(0,0,0,.55)]", visible ? "block" : "hidden", win.z === maxZ && "is-focused")} style={{ left: win.x, top: win.y, width: win.width, height: win.height, zIndex: win.alwaysOnTop ? 100000 + win.z : win.z, borderRadius: os.windowCornerRadius, backgroundColor: `rgba(13,13,15,${os.windowTransparency / 100})` }} onMouseDown={(event) => { event.stopPropagation(); closeFlyouts(); if (win.z !== maxZ || win.minimized) focusWindow(win.id) }}>
        <header className="synnical-os-titlebar relative flex h-9 cursor-default select-none items-center gap-2 border-b border-white/8 bg-white/[0.025] px-2" onDoubleClick={() => toggleMaximize(win.id)} onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return
          if (win.maximized && win.restore) {
            const ratio = event.clientX / Math.max(1, win.width), restore = win.restore
            const x = clamp(event.clientX - restore.width * ratio, 0, Math.max(0, window.innerWidth - restore.width)), y = clamp(event.clientY - 18, 0, window.innerHeight - taskbarMetric.height - 38)
            const next = windows.map((item) => item.id === win.id ? { ...item, ...restore, x, y, maximized: false, restore: undefined } : item); persistWindows(next)
            dragRef.current = { id: win.id, startX: event.clientX, startY: event.clientY, baseX: x, baseY: y, lastX: event.clientX, lastY: event.clientY, lastDirection: 0, directionChanges: 0, shakeStarted: Date.now(), shaken: false }
          } else dragRef.current = { id: win.id, startX: event.clientX, startY: event.clientY, baseX: win.x, baseY: win.y, lastX: event.clientX, lastY: event.clientY, lastDirection: 0, directionChanges: 0, shakeStarted: Date.now(), shaken: false }
        }}>
          <Icon className="h-3.5 w-3.5 text-white/70" /><span className="min-w-0 flex-1 truncate text-[11px] font-medium text-white/75">{app.label}</span>
          <button type="button" aria-label="Minimize" onClick={() => minimizeWindow(win.id)} className="grid h-7 w-10 place-items-center hover:bg-white/10" title="Minimize"><span aria-hidden="true" className="block h-px w-2.5 bg-current" /></button>
          <div className="relative" onMouseEnter={() => { if (!os.snapLayouts) return; if (snapTimer.current) window.clearTimeout(snapTimer.current); snapTimer.current = window.setTimeout(() => setSnapMenu(win.id), 450) }} onMouseLeave={() => { if (snapTimer.current) window.clearTimeout(snapTimer.current); snapTimer.current = window.setTimeout(() => setSnapMenu((id) => id === win.id ? null : id), 300) }}>
            <button type="button" aria-label={win.maximized ? "Restore" : "Maximize"} onClick={() => toggleMaximize(win.id)} className="grid h-7 w-10 place-items-center hover:bg-white/10" title={win.maximized ? "Restore down" : "Maximize"}>{win.maximized ? <span aria-hidden="true" className="relative block h-2.5 w-2.5"><span className="absolute left-0 top-0 h-2 w-2 border border-current" /><span className="absolute bottom-0 right-0 h-2 w-2 border border-current bg-[#0d0d0f]" /></span> : <span aria-hidden="true" className="block h-2.5 w-2.5 border border-current" />}</button>
            {snapMenu === win.id ? <div className="absolute right-0 top-7 z-[60000] w-52 rounded-xl border border-white/15 bg-[#202024]/98 p-2 shadow-2xl backdrop-blur-2xl" onMouseEnter={() => { if (snapTimer.current) window.clearTimeout(snapTimer.current) }} onMouseLeave={() => setSnapMenu(null)}><div className="grid grid-cols-2 gap-2">{[["left","right"],["wide","narrow"],["tl","tr"],["bl","br"]].map((zones, i) => <div key={i} className="grid h-12 grid-cols-2 gap-1 rounded-lg border border-white/10 p-1">{zones.map((zone) => <button key={zone} onClick={() => { snapZone(win.id, zone as any); setSnapMenu(null) }} className="rounded bg-white/10 hover:bg-sky-500/60" aria-label={`Snap ${zone}`} />)}</div>)}</div><p className="mt-2 px-1 text-[9px] text-white/35">Snap layouts · system-key shortcut where the browser delivers it</p></div> : null}
          </div>
          <button type="button" aria-label="Close" onClick={() => closeWindow(win.id)} className="grid h-7 w-10 place-items-center hover:bg-[#c42b1c] hover:text-white" title="Close"><span aria-hidden="true" className="relative block h-2.5 w-2.5 before:absolute before:left-1/2 before:top-0 before:h-3 before:w-px before:-translate-x-1/2 before:rotate-45 before:bg-current after:absolute after:left-1/2 after:top-0 after:h-3 after:w-px after:-translate-x-1/2 after:-rotate-45 after:bg-current" /></button>
        </header>
        <div className="relative min-h-0 overflow-hidden bg-black" style={{ height: "calc(100% - 36px)" }}>{renderPanel(win.panel, openPanel)}</div>
        {!win.maximized ? <button type="button" aria-label="Resize window" className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize" onPointerDown={(event) => { event.stopPropagation(); resizeRef.current = { id: win.id, startX: event.clientX, startY: event.clientY, width: win.width, height: win.height, lastX: event.clientX, lastY: event.clientY } }} /> : null}
      </section>
    })}

    {taskViewOpen ? <div className="absolute inset-0 z-[30000] bg-black/55 p-8 backdrop-blur-md" onMouseDown={() => setTaskViewOpen(false)}><div className="mx-auto flex h-full max-w-6xl flex-col" onMouseDown={(e) => e.stopPropagation()}><div className="mb-8 flex flex-wrap items-start justify-center gap-3">{os.workspaces.map((desktop) => <div key={desktop.id} className={cn("w-44 rounded-xl border p-2", workspace === desktop.id ? "border-sky-400 bg-sky-400/10" : "border-white/15 bg-black/35")}><button onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const winId = e.dataTransfer.getData("text/synnical-window"); if (!winId) return; persistWindows(windows.map((win) => win.id === winId ? { ...win, workspace: desktop.id } : win)); setWorkspaceSafe(desktop.id) }} onClick={() => setWorkspaceSafe(desktop.id)} className="w-full text-left"><div className="h-20 rounded-lg bg-cover bg-center p-2" style={desktop.wallpaper ? wallpaperCss(desktop.wallpaper, os.desktopWallpaperFit) : undefined}><div className="text-[10px] text-white/70 [text-shadow:0_1px_2px_black]">{desktop.name}</div><div className="mt-2 flex flex-wrap gap-1">{windows.filter((w) => w.workspace === desktop.id).slice(0,6).map((w) => <span key={w.id} className="h-4 w-6 rounded bg-white/15" />)}</div></div></button><div className="mt-2 flex items-center gap-1"><button onClick={() => renameWorkspace(desktop.id)} className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-xs hover:bg-white/10" title="Rename workspace">{desktop.name}</button><button onClick={() => setWorkspaceWallpaper(desktop.id)} className="rounded px-1.5 py-1 text-[9px] text-white/45 hover:bg-white/10 hover:text-white" title="Workspace wallpaper">Wallpaper</button>{os.workspaces.length > 1 ? <button onClick={() => removeWorkspace(desktop.id)} className="grid h-6 w-6 place-items-center rounded text-white/35 hover:bg-red-500/20 hover:text-red-200" aria-label={`Remove ${desktop.name}`}><X className="h-3 w-3" /></button> : null}</div></div>)}<button onClick={createWorkspace} className="grid h-28 w-32 place-items-center rounded-xl border border-dashed border-white/20 text-xs text-white/55 hover:border-sky-400/50 hover:bg-sky-400/10 hover:text-white">+ New desktop</button></div><div className="flex flex-1 flex-wrap content-start justify-center gap-4 overflow-auto">{workspaceWindows.map((win) => { const app = allowed.get(win.panel); if (!app) return null; const Icon = app.icon; return <button draggable onDragStart={(e) => e.dataTransfer.setData("text/synnical-window", win.id)} key={win.id} onClick={() => { setTaskViewOpen(false); focusWindow(win.id) }} className="group relative h-44 w-72 rounded-xl border border-white/15 bg-[#111]/95 p-3 text-left shadow-xl hover:border-sky-400/60"><div className="h-32 overflow-hidden rounded-lg border border-white/10 bg-black/50 p-3"><div className="flex items-center gap-2 text-xs text-white/60"><Icon className="h-4 w-4" />{app.label}</div><div className="mt-4 h-16 rounded bg-white/[0.035]" /></div><div className="mt-2 flex items-center gap-2 text-xs"><Icon className="h-3.5 w-3.5" />{app.label}</div><span onClick={(e) => { e.stopPropagation(); closeWindow(win.id) }} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 opacity-0 group-hover:opacity-100"><X className="h-3.5 w-3.5" /></span></button>})}</div></div></div> : null}

    {altIndex != null && activeCandidates.length ? <div className="absolute inset-0 z-[40000] grid place-items-center pointer-events-none"><div className="flex max-w-[90vw] gap-3 rounded-2xl border border-white/15 bg-[#19191d]/95 p-4 shadow-2xl backdrop-blur-xl">{activeCandidates.slice(0,7).map((win, index) => { const app = allowed.get(win.panel); if (!app) return null; const Icon = app.icon; return <div key={win.id} className={cn("w-44 rounded-xl border p-3", index === altIndex ? "border-sky-400 bg-sky-400/10" : "border-white/10 bg-black/20")}><div className="h-20 rounded-lg bg-black/40" /><div className="mt-2 flex items-center gap-2 text-xs"><Icon className="h-4 w-4" />{app.label}</div></div>})}</div></div> : null}

    {widgetsOpen ? <aside className="absolute left-3 top-3 z-[20000] w-[min(420px,calc(100vw-24px))] overflow-y-auto rounded-2xl border border-white/15 bg-[#18181c]/92 p-4 shadow-2xl backdrop-blur-2xl custom-scroll" style={{ bottom: taskbarMetric.height + 8 }} onMouseDown={(e) => e.stopPropagation()}><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Widgets</h2><button onClick={() => setWidgetsOpen(false)} className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"><X className="h-4 w-4" /></button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4"><CalendarDays className="h-5 w-5 text-sky-300" /><div className="mt-6 text-4xl font-light">{now.getDate()}</div><div className="mt-1 text-sm">{now.toLocaleDateString([], { weekday: "long", month: "long" })}</div></div><div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4"><Network className="h-5 w-5 text-emerald-300" /><div className="mt-6 text-lg font-semibold">{system.online ? "Online" : "Offline"}</div><div className="mt-1 text-xs text-white/45">{system.effectiveType || system.networkType || "Browser connection"}{system.rtt != null ? ` · ${system.rtt} ms` : ""}</div></div><div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4 sm:col-span-2"><div className="text-xs font-semibold uppercase tracking-wider text-white/35">Recent apps</div><div className="mt-3 flex flex-wrap gap-2">{recentApps.map(({ panel, app }) => { const Icon = app!.icon; return <button key={panel} onClick={() => openPanel(panel)} className="flex items-center gap-2 rounded-lg bg-white/[0.05] px-3 py-2 text-xs hover:bg-white/10"><Icon className="h-4 w-4" />{app!.label}</button>})}</div></div><div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4 sm:col-span-2"><div className="text-xs font-semibold uppercase tracking-wider text-white/35">Synnical widgets</div><p className="mt-2 text-xs leading-5 text-white/45">Weather, news and stocks are not fabricated. Add real providers later if you want those cards to carry live data.</p></div></div></aside> : null}

    {noticeOpen ? <aside className="absolute right-0 top-0 z-[22000] flex w-[min(410px,100vw)] flex-col border-l border-white/15 bg-[#17171b]/94 shadow-2xl backdrop-blur-2xl" style={{ bottom: taskbarMetric.height }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="border-b border-white/10 p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</h2><button onClick={() => setNoticeOpen(false)} className="grid h-8 w-8 place-items-center rounded hover:bg-white/10"><X className="h-4 w-4" /></button></div>
        <div className="mt-4 grid grid-cols-7 text-center text-[10px] text-white/35">{["S","M","T","W","T","F","S"].map((d,i) => <span key={`${d}-${i}`}>{d}</span>)}{calendar.map((d, i) => { const current = d.getMonth() === now.getMonth(), today = d.toDateString() === now.toDateString(); return <span key={i} className={cn("mt-1 grid h-8 place-items-center rounded-full text-xs", !current && "text-white/20", today && "bg-sky-500 text-white")}>{d.getDate()}</span> })}</div>
        {os.additionalTimeZones.length ? <div className="mt-3 grid gap-1 rounded-xl border border-white/10 bg-black/20 p-2">{os.additionalTimeZones.map((zone) => <div key={zone} className="flex items-center justify-between gap-4 text-[10px]"><span className="truncate text-white/40">{zone}</span><span>{safeTimeZoneLabel(zone, now) || "Unavailable"}</span></div>)}</div> : null}
        <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3"><div className="flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Agenda</span><button onClick={() => void loadAgenda()} className="text-[9px] text-white/35 hover:text-white">Refresh</button></div>{agenda.length ? <div className="mt-2 space-y-1.5">{agenda.slice(0,5).map((item) => <button key={item.id} onClick={() => item.panel && openPanel(item.panel)} className="flex w-full items-start justify-between gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.06]"><span className="line-clamp-2 text-[10px] text-white/70">{item.title}</span><span className="shrink-0 text-[9px] text-white/30">{new Date(item.when).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></button>)}</div> : <p className="mt-2 text-[10px] text-white/30">No pending Synn Bot reminders or scheduled messages.</p>}</div>
      </div>
      <div className="flex items-center gap-1 border-b border-white/10 px-3 py-2"><button onClick={() => setNoticeView("current")} className={cn("rounded-lg px-3 py-1.5 text-xs", noticeView === "current" ? "bg-white/10 text-white" : "text-white/45 hover:text-white")}>Notifications {notices.length ? `(${notices.length})` : ""}</button><button onClick={() => setNoticeView("history")} className={cn("rounded-lg px-3 py-1.5 text-xs", noticeView === "history" ? "bg-white/10 text-white" : "text-white/45 hover:text-white")}><History className="mr-1 inline h-3 w-3" />History</button><div className="ml-auto">{noticeView === "current" && notices.length ? <button onClick={clearCurrentNotices} className="text-[10px] text-white/40 hover:text-white">Clear all</button> : noticeView === "history" && noticeHistory.length ? <button onClick={() => persistNoticeHistory([])} className="text-[10px] text-white/40 hover:text-white">Clear history</button> : null}</div></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 custom-scroll">{noticeView === "history" ? (noticeHistory.length ? noticeHistory.map((notice) => <div key={notice.id} className="mb-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 opacity-75"><div className="flex items-start gap-2"><Bell className="mt-0.5 h-4 w-4 text-white/35" /><div className="min-w-0 flex-1"><p className="text-[9px] uppercase tracking-wider text-white/25">{allowed.get(notice.panel as Panel)?.label || notice.app}</p><p className="mt-1 text-xs font-semibold">{notice.title}</p><p className="mt-1 text-[11px] leading-5 text-white/45">{notice.body}</p><p className="mt-2 text-[9px] text-white/25">Dismissed · {new Date(notice.createdAt).toLocaleString()}</p></div></div></div>) : <div className="grid min-h-48 place-items-center text-center"><div><History className="mx-auto h-8 w-8 text-white/20" /><p className="mt-3 text-xs text-white/35">No notification history</p></div></div>) : notices.length === 0 ? <div className="grid min-h-48 place-items-center text-center"><div><Bell className="mx-auto h-8 w-8 text-white/20" /><p className="mt-3 text-xs text-white/35">No new notifications</p></div></div> : (() => {
        const grouped = new Map<string, Notice[]>(); for (const notice of notices) { const rows = grouped.get(notice.app) || []; rows.push(notice); grouped.set(notice.app, rows) }
        return [...grouped.entries()].map(([appId, rows]) => <section key={appId} className="mb-4"><div className="mb-1.5 flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">{allowed.get(appId as Panel)?.label || (appId === "system" ? "Synnical OS" : appId)}<span className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[8px]">{rows.length}</span></div>{rows.map((notice) => <div key={notice.id} className={cn("mb-2 rounded-xl border bg-white/[0.045] p-3", notice.priority === "urgent" ? "border-red-400/35" : notice.priority === "priority" ? "border-sky-400/30" : "border-white/10")}><div className="flex items-start gap-2"><button onClick={() => { if (notice.panel && allowed.has(notice.panel)) openPanel(notice.panel) }} className="min-w-0 flex-1 text-left"><p className="text-xs font-semibold">{notice.title}</p><p className="mt-1 text-[11px] leading-5 text-white/45">{notice.body}</p><p className="mt-2 text-[9px] text-white/25">{notice.priority !== "normal" ? `${notice.priority} · ` : ""}{new Date(notice.createdAt).toLocaleString()}</p></button><button onClick={() => dismissNotice(notice.id)} className="grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-white/10" aria-label="Dismiss notification"><X className="h-3 w-3" /></button></div></div>)}</section>)
      })()}</div>
    </aside> : null}

    {quickOpen ? <aside className="absolute right-3 z-[23000] w-[min(390px,calc(100vw-24px))] rounded-2xl border border-white/15 bg-[#1b1b20]/94 p-4 shadow-2xl backdrop-blur-2xl" style={{ bottom: taskbarMetric.height + 8 }} onMouseDown={(e) => e.stopPropagation()}><div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-semibold">Quick Settings</p><p className="text-[9px] text-white/35">{quickEdit ? "Drag tiles to reorder" : "Synnical and browser-exposed controls"}</p></div><button onClick={()=>setQuickEdit((v)=>!v)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] hover:bg-white/10">{quickEdit ? "Done" : "Edit"}</button></div><div className="grid grid-cols-3 gap-2">{[
      { id:"wifi", label: system.online ? "Wi-Fi / network" : "Offline", icon: system.online ? Wifi : WifiOff, active: system.online, click: () => openSettingsCategory("network") },
      { id:"bluetooth", label:"Bluetooth", icon: Bluetooth, active:false, click: requestBluetooth },
      { id:"airplane", label:"Airplane mode", icon: AirVent, active:false, disabled:true, click: () => {} },
      { id:"battery", label:"Battery saver", icon: Battery, active:os.batterySaver, click: () => { const next={...os,batterySaver:!os.batterySaver}; setOs(next); persistOsSettings(next); writeSetting("performance.lowEndMode", next.batterySaver) } },
      { id:"access", label:"Accessibility", icon: Accessibility, active:false, click: () => openSettingsCategory("accessibility") },
      { id:"focus", label:"Focus assist", icon: Focus, active:os.focusAssist !== "off", click: () => { const next={...os,focusAssist:os.focusAssist === "off" ? "priority" as const : "off" as const}; setOs(next); persistOsSettings(next) } },
      { id:"notifications", label:"Notifications", icon: Bell, active:os.notificationsEnabled, click: () => { const next={...os,notificationsEnabled:!os.notificationsEnabled}; setOs(next); void persistOsSettings(next) } },
      { id:"night", label:"Night light", icon: Moon, active:os.nightLight, click: () => { const next={...os,nightLight:!os.nightLight}; setOs(next); persistOsSettings(next) } },
      { id:"theme", label:`Theme · ${theme}`, icon: Palette, active:theme === "blood", click: () => { const themes = ["blood","synnical","ocean","forest","sunset","midnight","lavender","cyberpunk","monochrome","amber"] as const; const index=themes.indexOf(theme); setTheme(themes[(index+1)%themes.length]) } },
      { id:"presence", label:`Presence · ${quickPresence.replaceAll("_"," ")}`, icon: CircleUserRound, active:quickPresence !== "online", click: () => void cycleQuickPresence() },
    ].sort((a,b)=>os.quickSettingsOrder.indexOf(a.id)-os.quickSettingsOrder.indexOf(b.id)).map((tile) => { const Icon = tile.icon; return <button key={tile.id} draggable={quickEdit} onDragStart={(e)=>{if(quickEdit)e.dataTransfer.setData("text/synnical-quick-tile",tile.id)}} onDragOver={(e)=>{if(quickEdit)e.preventDefault()}} onDrop={(e)=>{if(!quickEdit)return;e.preventDefault();const source=e.dataTransfer.getData("text/synnical-quick-tile");if(!source||source===tile.id)return;const nextOrder=[...os.quickSettingsOrder];const from=nextOrder.indexOf(source),to=nextOrder.indexOf(tile.id);if(from<0||to<0)return;nextOrder.splice(from,1);nextOrder.splice(to,0,source);const next={...os,quickSettingsOrder:nextOrder};setOs(next);void persistOsSettings(next)}} disabled={Boolean((tile as any).disabled)} onClick={()=>{if(!quickEdit)(tile as any).click?.()}} className={cn("relative flex min-h-16 flex-col justify-between rounded-xl border p-3 text-left text-[10px] transition", tile.active ? "border-sky-400/40 bg-sky-500/65" : "border-white/10 bg-white/[0.055] hover:bg-white/10", (tile as any).disabled && "cursor-not-allowed opacity-35", quickEdit && "cursor-grab outline outline-1 outline-white/15")}><Icon className="h-4 w-4" />{quickEdit?<Grip className="absolute right-2 top-2 h-3 w-3 text-white/35"/>:null}<span className="mt-2">{tile.label}</span></button>})}</div>{Object.values(mediaUsage).length ? <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3"><div className="flex items-center gap-2 text-[10px] font-semibold text-emerald-200"><LockKeyhole className="h-3.5 w-3.5"/>Privacy indicators</div>{Object.values(mediaUsage).map((row)=><div key={row.source} className="mt-2 flex items-center gap-2 text-[10px] text-white/55"><span className="min-w-20 capitalize">{row.source.replaceAll("-"," ")}</span>{row.microphone?<Mic className="h-3.5 w-3.5 text-emerald-300"/>:null}{row.camera?<Camera className="h-3.5 w-3.5 text-emerald-300"/>:null}{row.screen?<Monitor className="h-3.5 w-3.5 text-emerald-300"/>:null}</div>)}</div> : null}{privacyHistory.length ? <details className="mt-2 rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2"><summary className="cursor-pointer text-[9px] text-white/40">Recent Synnical privacy activity</summary><div className="mt-2 space-y-1">{privacyHistory.slice(0,6).map((row,index)=><div key={`${row.source}-${row.at}-${index}`} className="text-[9px] text-white/35">{new Date(row.at).toLocaleTimeString()} · {row.source} · {[row.microphone&&"microphone",row.camera&&"camera",row.screen&&"screen"].filter(Boolean).join(", ")||"capture ended"}</div>)}</div></details>:null}<div className="mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.045] p-3"><Timer className="h-4 w-4 text-sky-300" /><div className="min-w-0 flex-1"><p className="text-xs font-semibold">Focus session</p><p className="text-[10px] text-white/40">{focusEndAt > Date.now() ? `${Math.max(1, Math.ceil((focusEndAt-Date.now())/60000))} min remaining` : `${os.focusSessionMinutes} minute timer`}</p></div>{focusEndAt > Date.now() ? <button onClick={stopFocusSession} className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] hover:bg-white/10">Stop</button> : <button onClick={startFocusSession} className="rounded-lg bg-sky-500 px-3 py-1.5 text-[10px] font-semibold text-black">Start</button>}</div>{Object.entries(mediaState).filter(([,state])=>Boolean(state)).slice(0,1).map(([panel,state])=><div key={panel} className="mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.045] p-3"><Play className="h-4 w-4 text-emerald-300"/><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{state!.title}</p><p className="truncate text-[10px] text-white/40">{state!.subtitle || allowed.get(panel as Panel)?.label || "Now Playing"}</p></div><div className="flex gap-1">{state!.canPrevious?<button onClick={()=>sendMediaCommand(panel as Panel,"previous")} className="rounded px-2 py-1 text-[10px] hover:bg-white/10">◀</button>:null}<button onClick={()=>sendMediaCommand(panel as Panel,"toggle")} className="rounded px-2 py-1 text-[10px] hover:bg-white/10">{state!.playing?"Pause":"Play"}</button>{state!.canNext?<button onClick={()=>sendMediaCommand(panel as Panel,"next")} className="rounded px-2 py-1 text-[10px] hover:bg-white/10">▶</button>:null}</div></div>)}<div className="mt-4 space-y-4"><label className="grid grid-cols-[22px_1fr_42px] items-center gap-2"><Sun className="h-4 w-4 text-white/50" /><input type="range" min="35" max="125" value={os.osBrightness} onChange={(e) => { const next={...os,osBrightness:Number(e.target.value)}; setOs(next); persistOsSettings(next) }} /><span className="text-right text-[10px] text-white/40">{os.osBrightness}%</span></label><label className="grid grid-cols-[22px_1fr_42px] items-center gap-2">{os.uiSoundVolume ? <Volume2 className="h-4 w-4 text-white/50" /> : <VolumeX className="h-4 w-4 text-white/50" />}<input type="range" min="0" max="100" value={os.uiSoundVolume} onChange={(e) => { const next={...os,uiSoundVolume:Number(e.target.value)}; setOs(next); persistOsSettings(next) }} /><span className="text-right text-[10px] text-white/40">{os.uiSoundVolume}%</span></label></div><div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-[10px] text-white/45"><span>{system.online ? (system.networkType || system.effectiveType || "Online") : "Offline"}</span><span>{system.batterySupported ? `${system.batteryLevel}%${system.charging ? " · charging" : ""}` : "Battery unavailable"}</span><button onClick={() => openPanel("settings")} className="grid h-7 w-7 place-items-center rounded hover:bg-white/10"><Settings className="h-3.5 w-3.5" /></button></div></aside> : null}

    {clipboardOpen ? <aside className="absolute left-1/2 z-[24000] w-[min(360px,calc(100vw-24px))] -translate-x-1/2 rounded-2xl border border-white/15 bg-[#1b1b20]/96 shadow-2xl backdrop-blur-2xl" style={{ bottom: taskbarMetric.height + 8 }} onMouseDown={(e) => e.stopPropagation()}><div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div className="flex items-center gap-2"><Clipboard className="h-4 w-4" /><span className="text-sm font-semibold">Clipboard history</span></div><button onClick={clearUnpinnedClipboardHistory} className="text-[10px] text-white/40">Clear unpinned</button></div><div className="max-h-80 overflow-y-auto p-2 custom-scroll"><button onClick={async () => { try { const text=await navigator.clipboard.readText(); writeClipboardHistory(text) } catch {} }} className="mb-2 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-[11px] text-white/50 hover:bg-white/[0.07]">Read current clipboard (browser permission required)</button>{clipboardRows.map((row) => <div key={row.id} className="mb-2 flex items-stretch rounded-xl border border-white/10 bg-white/[0.04] hover:bg-white/[0.07]"><button onClick={() => { navigator.clipboard?.writeText(row.text).catch(()=>{}); typeVirtual(row.text); setClipboardOpen(false) }} className="min-w-0 flex-1 p-3 text-left text-xs"><p className="line-clamp-4 whitespace-pre-wrap">{row.text}</p><p className="mt-2 text-[9px] text-white/25">{row.pinned ? "Pinned · " : ""}{new Date(row.at).toLocaleString()}</p></button><button onClick={() => setClipboardPinned(row.id, !row.pinned)} className={cn("grid w-10 place-items-center border-l border-white/10 hover:bg-white/10", row.pinned && "text-sky-300")} title={row.pinned ? "Unpin clipboard item" : "Pin clipboard item"}>{row.pinned ? <PinOff className="h-3.5 w-3.5"/> : <Pin className="h-3.5 w-3.5"/>}</button></div>)}</div></aside> : null}

    {emojiOpen ? <aside className="absolute left-1/2 z-[24000] w-[min(420px,calc(100vw-24px))] -translate-x-1/2 rounded-2xl border border-white/15 bg-[#1b1b20]/96 p-3 shadow-2xl backdrop-blur-2xl" style={{ bottom: taskbarMetric.height + 8 }} onMouseDown={(e) => e.stopPropagation()}><div className="flex items-center gap-2 border-b border-white/10 pb-3"><Smile className="h-4 w-4" /><span className="text-sm font-semibold">Emoji · GIFs · symbols</span></div><div className="mt-3 grid grid-cols-8 gap-1">{"😀 😃 😄 😁 😂 🥹 😊 😎 🤩 😭 😡 ❤️ 🔥 ✨ 💀 👍 👎 🙏 🎉 🚀 🎮 🎵 🎬 💬 ⭐ ✅ ❌ ⚡ 🫡 🤝 👀 💯".split(" ").map((emoji) => <button key={emoji} onClick={() => { typeVirtual(emoji); writeClipboardHistory(emoji); setEmojiOpen(false) }} className="grid h-10 place-items-center rounded-lg text-xl hover:bg-white/10">{emoji}</button>)}</div><p className="mt-3 text-[10px] text-white/30">Win+. when available · Ctrl+Shift+E fallback. GIF search remains in Synnical's existing media pickers.</p></aside> : null}

    {keyboardOpen ? <div data-keyboard-theme={keyboardTheme} className="synnical-touch-keyboard absolute left-1/2 z-[24500] w-[min(820px,96vw)] -translate-x-1/2 rounded-2xl border border-white/15 bg-[#1b1b20]/96 p-3 shadow-2xl backdrop-blur-2xl" style={{ bottom: taskbarMetric.height + 8 }} onMouseDown={(e) => e.stopPropagation()}><div className="mb-2 flex items-center justify-between"><div className="flex items-center gap-2 text-xs"><Keyboard className="h-4 w-4" />Touch keyboard</div><div className="flex items-center gap-1"><button onClick={cycleKeyboardTheme} className="rounded px-2 py-1 text-[9px] text-white/55 hover:bg-white/10" title="Keyboard theme">{keyboardTheme}</button><button onClick={() => setKeyboardOpen(false)} className="grid h-7 w-7 place-items-center rounded hover:bg-white/10"><X className="h-4 w-4" /></button></div></div>{keyboardHint ? <p className="mb-2 rounded-lg bg-amber-400/10 px-3 py-2 text-[10px] text-amber-100">{keyboardHint}</p> : null}{(keyboardSymbols ? ["1234567890","@#$%&*()-","[]{}<>+=_",".,!?/:;\"'"] : ["1234567890","qwertyuiop","asdfghjkl","zxcvbnm"]).map((row, rowIndex) => <div key={`${keyboardSymbols}:${row}`} className="mb-1 flex justify-center gap-1">{row.split("").map((raw) => { const letter=/[a-z]/i.test(raw); const upper=letter && (keyboardCaps !== keyboardShift); const key=upper ? raw.toUpperCase() : raw; return <button key={`${rowIndex}:${raw}`} onPointerDown={(e)=>e.preventDefault()} onClick={() => { typeVirtual(key); if(keyboardShift)setKeyboardShift(false) }} className="h-9 min-w-9 rounded-lg bg-white/[0.08] px-3 text-sm hover:bg-white/15">{key}</button> })}</div>)}<div className="mt-1 flex justify-center gap-1"><button onPointerDown={(e)=>e.preventDefault()} onClick={()=>setKeyboardSymbols((v)=>!v)} className={cn("h-9 rounded-lg px-4 text-xs hover:bg-white/15",keyboardSymbols?"bg-sky-500/30":"bg-white/[0.08]")}>{keyboardSymbols?"ABC":"&123"}</button><button onPointerDown={(e)=>e.preventDefault()} onClick={()=>setKeyboardCaps((v)=>!v)} className={cn("grid h-9 w-11 place-items-center rounded-lg hover:bg-white/15",keyboardCaps?"bg-sky-500/30":"bg-white/[0.08]")} title="Caps Lock"><CaseUpper className="h-4 w-4" /></button><button onPointerDown={(e)=>e.preventDefault()} onClick={()=>setKeyboardShift((v)=>!v)} className={cn("h-9 rounded-lg px-4 text-xs hover:bg-white/15",keyboardShift?"bg-sky-500/30":"bg-white/[0.08]")}>Shift</button><button onPointerDown={(e)=>e.preventDefault()} onClick={()=>typeVirtual(" ")} className="h-9 min-w-48 flex-1 rounded-lg bg-white/[0.08] hover:bg-white/15">Space</button><button onPointerDown={(e)=>e.preventDefault()} onClick={startVoiceTyping} disabled={voiceTyping} className={cn("grid h-9 w-11 place-items-center rounded-lg bg-white/[0.08] hover:bg-white/15", voiceTyping && "bg-red-500/25 text-red-200")} title="Voice typing"><Mic className="h-4 w-4" /></button><button onPointerDown={(e)=>e.preventDefault()} onClick={virtualBackspace} className="grid h-9 w-12 place-items-center rounded-lg bg-white/[0.08] hover:bg-white/15" title="Backspace"><Delete className="h-4 w-4" /></button><button onPointerDown={(e)=>e.preventDefault()} onClick={virtualEnter} className="grid h-9 w-14 place-items-center rounded-lg bg-white/[0.08] hover:bg-white/15" title="Enter"><CornerDownLeft className="h-4 w-4" /></button></div><p className="mt-2 text-center text-[9px] text-white/25">Types into the last focused Synnical text field. Browser security prevents synthetic typing into cross-origin embedded pages.</p></div> : null}

    {startOpen ? <div className={cn("absolute bottom-14 z-[25000] h-[min(690px,calc(100vh-80px))] w-[min(660px,calc(100vw-20px))] overflow-hidden rounded-2xl border border-white/15 bg-[#19191d]/95 shadow-2xl backdrop-blur-2xl", taskbarCenter ? "left-1/2 -translate-x-1/2" : "left-3")} onMouseDown={(e) => e.stopPropagation()}>
      <div className="p-6 pb-3"><div className="flex h-10 items-center rounded-full border border-white/15 bg-black/30 px-3"><Search className="h-4 w-4 text-white/40" /><input autoFocus value={startQuery} onChange={(e) => setStartQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter"&&startQuery.trim())searchAllSynnical()}} placeholder="Search for apps, settings, and Synnical files" className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none" /></div></div>
      <div className="h-[calc(100%-124px)] overflow-y-auto px-6 pb-4 custom-scroll">{startQuery ? <div><div className="mb-3 text-xs font-semibold">Best match</div><div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{filteredApps.map((app) => { const Icon=app.icon; return <button key={app.id} onClick={() => openPanel(app.id)} className="flex min-h-20 flex-col items-center justify-center rounded-xl hover:bg-white/[0.07]"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.06]"><Icon className="h-5 w-5" /></span><span className="mt-2 max-w-full truncate text-[11px]">{app.label}</span></button>})}</div><button onClick={searchAllSynnical} className="mt-4 flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-left hover:bg-white/[0.07]"><Search className="h-4 w-4 text-sky-300"/><span className="min-w-0"><span className="block text-xs font-semibold">Search all Synnical</span><span className="block truncate text-[10px] text-white/40">People, chats, settings, files, games, SynnFlix, music and more for “{startQuery.trim()}”</span></span></button></div> : startView === "all" ? <div><button onClick={() => setStartView("pinned")} className="mb-4 flex items-center gap-2 text-xs text-white/60 hover:text-white"><ChevronRight className="h-3.5 w-3.5 rotate-180" />Back</button>{Array.from(new Set(filteredApps.map((app) => app.label[0]?.toUpperCase() || "#"))).map((letter) => <div key={letter} className="mb-4"><div className="mb-1 text-xs font-semibold text-sky-300">{letter}</div>{filteredApps.filter((app) => app.label[0]?.toUpperCase() === letter).map((app) => { const Icon=app.icon; return <button key={app.id} onClick={() => openPanel(app.id)} onContextMenu={(e) => { e.preventDefault(); setContextMenu({ kind:"app", x:e.clientX, y:e.clientY, panel:app.id }) }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs hover:bg-white/[0.07]"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.06]"><Icon className="h-4 w-4" /></span>{app.label}</button>})}</div>)}</div> : <div>{os.startSearchHistory && startSearchHistory.length ? <div className="mb-4"><div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-white/35">Recent searches</span><button onClick={()=>{setStartSearchHistory([]);try{localStorage.removeItem(START_SEARCH_HISTORY_KEY)}catch{}}} className="text-[9px] text-white/30 hover:text-white/60">Clear</button></div><div className="flex flex-wrap gap-1">{startSearchHistory.slice(0,6).map((item)=><button key={item} onClick={()=>setStartQuery(item)} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[9px] text-white/50 hover:bg-white/[0.08]">{item}</button>)}</div></div>:null}<div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold">Pinned</span><div className="flex gap-1"><button onClick={createStartFolder} className="flex items-center gap-1 rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[10px] hover:bg-white/10"><Folder className="h-3 w-3"/>New folder</button><button onClick={() => setStartView("all")} className="flex items-center gap-1 rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[10px] hover:bg-white/10">All apps <ChevronRight className="h-3 w-3" /></button></div></div><div className="grid grid-cols-4 gap-2 sm:grid-cols-6">{os.startFolders.map((folder)=><button key={folder.id} onClick={()=>setStartFolderOpen(folder.id)} className="flex min-h-20 flex-col items-center justify-center rounded-xl hover:bg-white/[0.07]"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.06]"><Folder className="h-5 w-5 text-amber-200"/></span><span className="mt-2 max-w-full truncate text-[10px]">{folder.name}</span></button>)}{pinnedApps.slice(0,18).map((app) => { const Icon=app.icon; return <button draggable onDragStart={(e) => e.dataTransfer.setData("text/synnical-panel", app.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const source=e.dataTransfer.getData("text/synnical-panel") as Panel; if (!source || source===app.id) return; const next=[...pinned]; const from=next.indexOf(source), to=next.indexOf(app.id); if(from<0||to<0)return; next.splice(from,1); next.splice(to,0,source); updatePinned(next) }} key={app.id} onClick={() => openPanel(app.id)} onContextMenu={(e) => { e.preventDefault(); setContextMenu({ kind:"app", x:e.clientX, y:e.clientY, panel:app.id }) }} className="flex min-h-20 flex-col items-center justify-center rounded-xl hover:bg-white/[0.07]"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.06]"><Icon className="h-5 w-5" /></span><span className="mt-2 max-w-full truncate text-[10px]">{app.label}</span></button>})}</div>{startFolderOpen ? (()=>{const folder=os.startFolders.find((row)=>row.id===startFolderOpen);if(!folder)return null;return <div className="mt-3 rounded-xl border border-white/10 bg-black/25 p-3"><div className="mb-2 flex items-center gap-2"><Folder className="h-4 w-4 text-amber-200"/><span className="flex-1 truncate text-xs font-semibold">{folder.name}</span><button onClick={()=>renameStartFolder(folder.id)} className="rounded px-2 py-1 text-[9px] hover:bg-white/10">Rename</button><button onClick={()=>removeStartFolder(folder.id)} className="rounded px-2 py-1 text-[9px] text-red-200 hover:bg-red-500/10">Delete</button><button onClick={()=>setStartFolderOpen(null)} className="grid h-6 w-6 place-items-center rounded hover:bg-white/10"><X className="h-3 w-3"/></button></div><div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{folder.apps.map((id)=>{const app=allowed.get(id as Panel);if(!app)return null;const Icon=app.icon;return <div key={id} className="relative"><button onClick={()=>openPanel(app.id)} className="flex min-h-16 w-full flex-col items-center justify-center rounded-lg hover:bg-white/[0.07]"><Icon className="h-5 w-5"/><span className="mt-1 max-w-full truncate text-[9px]">{app.label}</span></button><button onClick={()=>removeAppFromStartFolder(folder.id,id)} className="absolute right-0 top-0 grid h-5 w-5 place-items-center rounded-full bg-black/50 text-white/55 hover:bg-red-500/50" title="Remove from folder"><X className="h-2.5 w-2.5"/></button></div>})}{!folder.apps.length?<div className="col-span-full py-4 text-center text-[10px] text-white/35">Right-click an app and choose Add to Start folder.</div>:null}</div></div>})():null}{os.startRecommended && os.startRecentApps ? <><div className="mb-3 mt-6 flex items-center justify-between"><span className="text-xs font-semibold">Recommended</span><span className="text-[10px] text-white/30">Recent Synnical apps</span></div><div className="grid grid-cols-2 gap-2">{recentApps.slice(0,4).map(({panel,app,at}) => { const Icon=app!.icon; return <button key={panel} onClick={() => openPanel(panel)} className="flex items-center gap-3 rounded-xl p-2 text-left hover:bg-white/[0.07]"><span className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.06]"><Icon className="h-4.5 w-4.5" /></span><span className="min-w-0"><span className="block truncate text-xs">{app!.label}</span><span className="text-[9px] text-white/30">Opened {new Date(at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span></span></button>})}</div></> : null}</div>}</div>
      <div className="absolute inset-x-0 bottom-0 flex h-16 items-center border-t border-white/10 bg-black/15 px-8"><button onClick={() => { openPanel("profile"); setStartOpen(false) }} className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs hover:bg-white/10"><span className="grid h-8 w-8 place-items-center overflow-hidden rounded-full bg-white/10">{user?.pfpUrl ? <img src={user.pfpUrl} alt="" className="h-full w-full object-cover" /> : <CircleUserRound className="h-4 w-4" />}</span>{user?.displayName || user?.username || "Synnical"}</button>{user ? <button onClick={() => { setLocked(true);setLockStage("lock");setStartOpen(false) }} className="ml-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/70 hover:bg-white/10"><LockKeyhole className="h-3.5 w-3.5" />Lock</button> : null}<div className="ml-auto relative"><button onClick={() => setPowerMenu((v)=>!v)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10"><Power className="h-4 w-4" /></button>{powerMenu ? <div className="absolute bottom-11 right-0 w-44 rounded-xl border border-white/15 bg-[#202024] p-1.5 text-xs shadow-xl">{user ? <button onClick={() => logout()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><LogOut className="h-3.5 w-3.5" />Sign out</button> : null}<button onClick={() => { setLocked(true); setLockStage("lock"); setStartOpen(false) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><LockKeyhole className="h-3.5 w-3.5" />Lock</button><button onClick={() => location.reload()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><RefreshCcw className="h-3.5 w-3.5" />Restart Synnical</button><button onClick={() => { const url=new URL(location.href);url.searchParams.set("safe","1");url.searchParams.delete("recover");location.href=url.toString() }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><LockKeyhole className="h-3.5 w-3.5" />Restart in Safe Mode</button><button onClick={() => { const url=new URL(location.href);url.searchParams.set("recover","1");location.href=url.toString() }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><RefreshCcw className="h-3.5 w-3.5" />Recovery</button><button onClick={() => setPoweredOff(true)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><Power className="h-3.5 w-3.5" />Shut down Synnical</button></div> : null}</div></div>
    </div> : null}

    {toastNotice && !noticeOpen ? <button onMouseEnter={() => {}} onClick={() => { if (toastNotice.panel) openPanel(toastNotice.panel); setToastNotice(null) }} className="absolute right-3 z-[26000] w-[min(360px,calc(100vw-24px))] rounded-xl border border-white/15 bg-[#202024]/96 p-4 text-left shadow-2xl backdrop-blur-xl" style={{ bottom: taskbarMetric.height + 12 }}><div className="flex gap-3"><Bell className="mt-0.5 h-4 w-4 text-sky-300" /><div className="min-w-0"><p className="text-xs font-semibold">{toastNotice.title}</p><p className="mt-1 line-clamp-3 text-[11px] leading-5 text-white/45">{toastNotice.body}</p></div><X onClick={(e)=>{e.stopPropagation();setToastNotice(null)}} className="ml-auto h-3.5 w-3.5 text-white/35" /></div></button> : null}

    {runOpen ? <div className="fixed inset-0 z-[61000] grid place-items-center bg-black/35 p-4 backdrop-blur-sm" onMouseDown={()=>setRunOpen(false)}><div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#202024]/98 p-4 shadow-2xl" onMouseDown={(e)=>e.stopPropagation()}><div className="flex items-center gap-2"><Terminal className="h-5 w-5 text-sky-300"/><div><h2 className="text-sm font-semibold">Run</h2><p className="text-[10px] text-white/35">Open a Synnical app, alias, or web address.</p></div></div><div className="mt-4 flex gap-2"><input autoFocus value={runQuery} onChange={(e)=>setRunQuery(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter")runCommand();if(e.key==="Escape")setRunOpen(false)}} placeholder="chat, films, settings, example.com…" className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-sm outline-none focus:border-sky-400/60"/><button onClick={()=>runCommand()} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black">Open</button></div><p className="mt-3 text-[10px] text-white/30">Win/Search + R when delivered by the browser · Ctrl+Alt+R fallback · taskmgr opens Task Manager.</p></div></div> : null}

    {captureOpen ? <div className="fixed inset-0 z-[60600] grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onMouseDown={() => { if(!captureRecording)setCaptureOpen(false) }}><div className="w-[min(520px,94vw)] rounded-2xl border border-white/15 bg-[#18181c]/98 p-5 shadow-2xl" onMouseDown={(e)=>e.stopPropagation()}><div className="flex items-center gap-3"><Camera className="h-5 w-5 text-sky-300"/><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Synnical Capture</h2><p className="text-[10px] text-white/40">Uses the browser's real screen-share picker. Synnical cannot silently capture other apps or bypass ChromeOS privacy prompts.</p></div><button disabled={captureRecording} onClick={()=>setCaptureOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10 disabled:opacity-30"><X className="h-4 w-4"/></button></div><div className="mt-5 grid gap-2 sm:grid-cols-2"><button disabled={captureRecording} onClick={()=>void takeWorkspaceScreenshot(false)} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-left hover:bg-white/[0.08] disabled:opacity-40"><Camera className="h-5 w-5"/><div><div className="text-xs font-semibold">Screenshot</div><div className="text-[10px] text-white/40">Choose Synnical/window/screen, then save PNG.</div></div></button><button disabled={captureRecording} onClick={()=>void takeWorkspaceScreenshot(true)} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-left hover:bg-white/[0.08] disabled:opacity-40"><Clipboard className="h-5 w-5"/><div><div className="text-xs font-semibold">Copy for Chat</div><div className="text-[10px] text-white/40">Copy PNG to clipboard and open Chat.</div></div></button><button onClick={()=>captureRecording?stopScreenRecording():void startScreenRecording()} className={cn("sm:col-span-2 flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-semibold",captureRecording?"border-red-400/30 bg-red-500/10 text-red-200":"border-white/10 bg-white/[0.04] hover:bg-white/[0.08]")}>{captureRecording?<><Square className="h-4 w-4 fill-current"/>Stop & save recording</>:<><Video className="h-4 w-4"/>Start screen recording</>}</button></div>{captureError?<p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[11px] text-red-200">{captureError}</p>:null}</div></div> : null}

    {taskManagerOpen ? <div className="fixed inset-0 z-[60500] grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onMouseDown={()=>setTaskManagerOpen(false)}><div className="flex h-[min(620px,85vh)] w-[min(860px,94vw)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#18181c]/98 shadow-2xl" onMouseDown={(e)=>e.stopPropagation()}><header className="flex items-center gap-3 border-b border-white/10 px-4 py-3"><Activity className="h-5 w-5 text-emerald-300"/><div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Synnical Task Manager</h2><p className="text-[10px] text-white/35">Real Synnical windows and browser-visible metrics, not pretend operating-system processes.</p></div><button onClick={()=>setTaskManagerOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10"><X className="h-4 w-4"/></button></header><div className="grid grid-cols-2 gap-2 border-b border-white/10 p-3 text-xs sm:grid-cols-4"><div className="rounded-xl bg-white/[0.04] p-3"><div className="text-white/35">Windows</div><div className="mt-1 text-xl">{windows.length}</div></div><div className="rounded-xl bg-white/[0.04] p-3"><div className="text-white/35">Online</div><div className="mt-1 text-xl">{system.online?"Yes":"No"}</div></div><div className="rounded-xl bg-white/[0.04] p-3"><div className="text-white/35">RTT</div><div className="mt-1 text-xl">{system.rtt!=null?`${system.rtt} ms`:"n/a"}</div></div><div className="rounded-xl bg-white/[0.04] p-3"><div className="text-white/35">JS heap</div><div className="mt-1 text-xl">{(() => { const memory=(performance as any).memory; return memory?.usedJSHeapSize?`${Math.round(memory.usedJSHeapSize/1048576)} MB`:"n/a" })()}</div></div></div><div className="min-h-0 flex-1 overflow-y-auto p-3"><div className="mb-2 grid grid-cols-[minmax(150px,1fr)_100px_90px_90px] px-3 text-[9px] font-semibold uppercase tracking-wider text-white/30"><span>App</span><span>Workspace</span><span>Status</span><span>Action</span></div>{windows.length?windows.slice().sort((a,b)=>b.z-a.z).map((win)=>{const app=allowed.get(win.panel);if(!app)return null;const Icon=app.icon;return <div key={win.id} className="grid grid-cols-[minmax(150px,1fr)_100px_90px_90px] items-center rounded-xl px-3 py-2 text-xs hover:bg-white/[0.05]"><button onClick={()=>{setWorkspaceSafe(win.workspace);focusWindow(win.id);setTaskManagerOpen(false)}} className="flex min-w-0 items-center gap-2 text-left"><Icon className="h-4 w-4 shrink-0"/><span className="truncate">{app.label}</span></button><span className="truncate text-white/45">{os.workspaces.find((row)=>row.id===win.workspace)?.name||win.workspace}</span><span className={cn("text-[10px]",win.minimized?"text-white/35":"text-emerald-300")}>{win.minimized?"Minimized":"Running"}</span><button onClick={()=>closeWindow(win.id)} className="rounded-lg px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/10">End task</button></div>}):<p className="py-12 text-center text-xs text-white/35">No Synnical app windows are open.</p>}</div></div></div> : null}

    {contextMenu ? <div className="fixed z-[60000] min-w-52 rounded-xl border border-white/15 bg-[#202024]/97 p-1.5 text-xs shadow-2xl backdrop-blur-xl" style={{
      left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 230)),
      ...(contextMenu.kind === "app" && contextMenu.anchor === "taskbar"
        ? { top: Math.max(8, contextMenu.y - 8), transform: "translateY(-100%)" }
        : { top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 190)) }),
    }} onMouseDown={(e)=>e.stopPropagation()}>{contextMenu.kind === "desktop" ? <><button onClick={() => { const order=["small","medium","large"] as const; const next={...os,desktopIconSize:order[(order.indexOf(os.desktopIconSize)+1)%order.length]};setOs(next);void persistOsSettings(next);setContextMenu(null) }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 hover:bg-white/10">View: {os.desktopIconSize}<ChevronRight className="h-3.5 w-3.5" /></button><button onClick={() => { const order=["none","name","type","recent"] as const;const next={...os,desktopSort:order[(order.indexOf(os.desktopSort)+1)%order.length]};setOs(next);void persistOsSettings(next);setContextMenu(null) }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 hover:bg-white/10">Sort: {os.desktopSort}<ChevronRight className="h-3.5 w-3.5" /></button><button onClick={() => { const next={...os,desktopAlignGrid:!os.desktopAlignGrid};setOs(next);void persistOsSettings(next);setContextMenu(null) }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 hover:bg-white/10">{os.desktopAlignGrid?"Free-position icons":"Align icons to grid"}<Grid2X2 className="h-3.5 w-3.5" /></button><button onClick={() => { createDesktopFolder(); setContextMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><Folder className="h-3.5 w-3.5" />New folder</button>{desktopLayout.hidden.length?<button onClick={() => {showAllDesktopApps();setContextMenu(null)}} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><AppWindow className="h-3.5 w-3.5"/>Show hidden shortcuts</button>:null}<button onClick={() => setContextMenu(null)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><RefreshCcw className="h-3.5 w-3.5" />Refresh</button><button onClick={() => { setRunOpen(true); setRunQuery(""); setContextMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><Terminal className="h-3.5 w-3.5" />Run</button><button onClick={() => { setTaskManagerOpen(true); setContextMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><Activity className="h-3.5 w-3.5" />Task Manager</button><button onClick={() => { setCaptureOpen(true); setContextMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><Camera className="h-3.5 w-3.5" />Capture</button><div className="my-1 h-px bg-white/10" /><button onClick={() => openSettingsCategory("personalization")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><Monitor className="h-3.5 w-3.5" />Display settings</button><button onClick={() => openSettingsCategory("personalization")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><Settings className="h-3.5 w-3.5" />Personalize</button></> : (() => { const app=allowed.get(contextMenu.panel); if(!app)return null; const running=runningPanels.has(app.id), isPinned=pinned.includes(app.id); return <><button onClick={() => openPanel(app.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><ExternalLink className="h-3.5 w-3.5" />Open</button><div className="my-1 h-px bg-white/10" /><div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-white/30">Jump list</div>{jumpList(app.id).map((item) => <button key={item.label} onClick={() => { item.run(); setContextMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><ChevronRight className="h-3.5 w-3.5" />{item.label}</button>)}<div className="my-1 h-px bg-white/10" /><button onClick={() => { updatePinned(isPinned ? pinned.filter((id)=>id!==app.id) : [...pinned,app.id]); setContextMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10">{isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}{isPinned ? "Unpin from taskbar" : "Pin to taskbar"}</button><button onClick={() => { addAppToStartFolder(app.id); setContextMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><Folder className="h-3.5 w-3.5" />Add to Start folder</button>{contextMenu.anchor === "pointer" ? <><button onClick={() => { renameDesktopApp(app.id); setContextMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><CaseUpper className="h-3.5 w-3.5" />Rename shortcut</button><button onClick={() => { setDesktopAppIcon(app.id); setContextMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><AppWindow className="h-3.5 w-3.5" />Custom icon</button><button onClick={() => { hideDesktopApp(app.id); setContextMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><X className="h-3.5 w-3.5" />Hide shortcut</button><button onClick={() => { window.alert(`${desktopLayout.labels[app.id] || app.label}\nApp: ${app.id}\nWorkspace: ${activeWorkspace?.name || workspace}\nPinned: ${isPinned ? "Yes" : "No"}\nRunning: ${running ? "Yes" : "No"}`); setContextMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><Info className="h-3.5 w-3.5" />Properties</button></> : null}<button onClick={() => openSettingsCategory(app.id === "games" ? "gaming" : app.id === "settings" ? "system" : "apps")} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><Settings className="h-3.5 w-3.5" />App settings</button>{running ? (()=>{const win=windows.find((row)=>row.panel===app.id);return <><div className="my-1 h-px bg-white/10" />{win?<button onClick={() => { toggleAlwaysOnTop(win.id); setContextMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><Pin className="h-3.5 w-3.5" />{win.alwaysOnTop?"Turn off always on top":"Always on top"}</button>:null}{win && (app.id==="music"||app.id==="chat")?<button onClick={() => { compactWindow(win.id, app.id); setContextMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><AppWindow className="h-3.5 w-3.5" />{app.id==="music"?"Mini player size":"Compact chat size"}</button>:null}<button onClick={() => { closePanel(app.id); setContextMenu(null) }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/10"><X className="h-3.5 w-3.5" />Close window</button></>} )() : null}</> })()}</div> : null}



    <footer className={cn("synnical-taskbar absolute inset-x-0 bottom-0 z-[50000] backdrop-blur-2xl", !os.transparency && "synnical-taskbar-opaque")} style={{ height: taskbarMetric.height }} onMouseDown={(e)=>e.stopPropagation()}>
      <div className="relative flex h-full items-center px-2">
        {os.showWidgets ? <button onClick={() => { const next=!widgetsOpen; closeFlyouts(); setWidgetsOpen(next) }} className={cn("absolute left-2 grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10", widgetsOpen && "bg-white/10")} title="Widgets"><PanelTop className="h-4.5 w-4.5 text-sky-300" /></button> : null}
        <div className={cn("flex items-center gap-1", taskbarCenter ? "absolute left-1/2 -translate-x-1/2" : "ml-10")}>
          <button onClick={() => { const next=!startOpen; closeFlyouts(); setStartOpen(next); setStartView("pinned"); setStartQuery("") }} className={cn("grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10", startOpen && "bg-white/10")} aria-label="Start"><img src="/logo.svg" alt="" className="h-5 w-5" /></button>
          {os.showSearch ? <button onClick={() => { closeFlyouts(); setStartOpen(true); setStartQuery("") }} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10" title="Search"><Search className="h-4.5 w-4.5" /></button> : null}
          {os.showTaskView ? <button onClick={() => { const next=!taskViewOpen; closeFlyouts(); setTaskViewOpen(next) }} className={cn("grid h-9 w-9 place-items-center rounded-lg hover:bg-white/10", taskViewOpen && "bg-white/10")} title="Task View"><SquareStack className="h-4.5 w-4.5" /></button> : null}
          {[...snapTaskbarGroups.entries()].map(([group, rows]) => {
            const groupActive = rows.some((win) => !win.minimized && win.z === maxZ)
            const badge = rows.reduce((sum, win) => sum + (taskbarBadges[win.panel] || 0), 0)
            const progressValues = rows.map((win) => taskbarProgress[win.panel]).filter((value) => value !== undefined)
            const progress = progressValues.length ? (progressValues.some((value) => value === null) ? null : Math.max(...progressValues.map((value) => Number(value)))) : undefined
            return <button key={`group:${group}`} onClick={() => activateSnapGroup(group)} className={cn("synnical-taskbar-app relative flex items-center justify-center rounded-xl px-1", groupActive && "is-active")} style={{ height: taskbarMetric.button, minWidth: Math.max(46, taskbarMetric.button + 8) }} title={`Snap group · ${rows.map((win) => allowed.get(win.panel)?.label || win.panel).join(" + ")}`}>
              <span className="flex -space-x-1">{rows.slice(0,3).map((win) => { const GroupIcon = allowed.get(win.panel)?.icon; return GroupIcon ? <span key={win.id} className="grid h-6 w-6 place-items-center rounded-lg border border-white/15 bg-black/35"><GroupIcon className="h-3.5 w-3.5" /></span> : null })}</span>
              {badge > 0 ? <span className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[8px] font-bold">{badge > 99 ? "99+" : badge}</span> : null}
              {progress !== undefined ? <span className="absolute inset-x-1 bottom-0 h-0.5 overflow-hidden rounded bg-white/15"><span className={cn("block h-full bg-sky-300", progress === null && "animate-pulse")} style={{ width: `${progress === null ? 35 : progress}%` }} /></span> : <span className={cn("absolute bottom-0 h-0.5 rounded bg-sky-300 transition-all", groupActive ? "w-7" : "w-4 opacity-70")} />}
            </button>
          })}
          {standaloneTaskbarApps.map((app) => {
            const Icon=app.icon, win=windows.find((w)=>w.panel===app.id), running=Boolean(win), active=Boolean(win && win.workspace===workspace && !win.minimized && win.z===maxZ)
            const badge = app.id === "chat" ? Math.max(chatUnread, taskbarBadges.chat || 0) : taskbarBadges[app.id] || 0
            const progress = taskbarProgress[app.id]
            return <button draggable onDragStart={(e)=>e.dataTransfer.setData("text/synnical-panel",app.id)} onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{ const source=e.dataTransfer.getData("text/synnical-panel") as Panel; if(!source||source===app.id||!pinned.includes(source)||!pinned.includes(app.id))return; const next=[...pinned],from=next.indexOf(source),to=next.indexOf(app.id);next.splice(from,1);next.splice(to,0,source);updatePinned(next)}} key={app.id} onClick={() => { if(!win) openPanel(app.id); else if(win.workspace!==workspace) { setWorkspaceSafe(win.workspace); focusWindow(win.id) } else if(active) minimizeWindow(win.id); else focusWindow(win.id) }} onContextMenu={(e)=>{e.preventDefault();setContextMenu({kind:"app",x:e.clientX,y:e.clientY,panel:app.id,anchor:"taskbar"})}} className={cn("synnical-taskbar-app relative grid place-items-center rounded-xl", active && "is-active")} style={{ height: taskbarMetric.button, width: Math.max(38, taskbarMetric.button + 4) }} title={app.label}><Icon className="text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,.75)]" style={{ width: taskbarMetric.icon, height: taskbarMetric.icon }} />{badge > 0 ? <span className="absolute right-0 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[8px] font-bold">{badge>99?"99+":badge}</span> : null}{progress !== undefined ? <span className="absolute inset-x-1 bottom-0 h-0.5 overflow-hidden rounded bg-white/15"><span className={cn("block h-full bg-sky-300", progress === null && "animate-pulse")} style={{ width: `${progress === null ? 35 : progress}%` }} /></span> : running ? <span className={cn("absolute bottom-0 h-0.5 rounded bg-sky-300 transition-all", active ? "w-5" : "w-2.5 opacity-70")} /> : null}</button>
          })}
        </div>
        <div className="ml-auto flex h-full items-center gap-0.5">
          <button onClick={() => setTrayOverflow((v)=>!v)} className="grid h-8 w-7 place-items-center rounded hover:bg-white/10" title="Hidden icons"><ChevronUp className="h-3.5 w-3.5" /></button>
          {Object.values(mediaUsage).some((row)=>row.microphone)?<Mic className="h-3.5 w-3.5 text-emerald-300" aria-label="Synnical microphone in use"/>:null}{Object.values(mediaUsage).some((row)=>row.camera)?<Camera className="h-3.5 w-3.5 text-emerald-300" aria-label="Synnical camera in use"/>:null}{Object.values(mediaUsage).some((row)=>row.screen)?<Monitor className="h-3.5 w-3.5 text-emerald-300" aria-label="Synnical screen capture in use"/>:null}<button onClick={() => { const next=!quickOpen; closeFlyouts(); setQuickOpen(next) }} className={cn("flex h-9 items-center gap-1 rounded-lg px-2 hover:bg-white/10", quickOpen && "bg-white/10")} title="Quick Settings">{system.online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}{os.uiSoundVolume ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}{system.batterySupported ? system.charging ? <BatteryCharging className="h-3.5 w-3.5" /> : <Battery className="h-3.5 w-3.5" /> : <Battery className="h-3.5 w-3.5 opacity-35" />}</button>
          <button onClick={() => { const next=!keyboardOpen; closeFlyouts(); setKeyboardOpen(next) }} className="hidden h-8 w-8 place-items-center rounded hover:bg-white/10 md:grid" title="Touch keyboard"><Keyboard className="h-3.5 w-3.5" /></button>
          <span className="hidden px-1 text-[9px] text-white/45 lg:block">{(system.language || "EN").split("-")[0].toUpperCase()}</span>
          <button onClick={() => { const next=!noticeOpen; closeFlyouts(); setNoticeOpen(next) }} className={cn("relative min-w-[72px] rounded-lg px-2 py-1 text-right text-[10px] leading-3 hover:bg-white/10", noticeOpen && "bg-white/10")}><div>{now.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit", ...(os.clockSeconds ? {second:"2-digit" as const}:{})})}</div><div>{now.toLocaleDateString([], {month:"2-digit",day:"2-digit",year:"numeric"})}</div>{notices.length ? <span className="absolute left-0.5 top-1 h-1.5 w-1.5 rounded-full bg-sky-400" /> : null}</button>
          <button onClick={showDesktop} className="h-full w-2 border-l border-white/15 hover:bg-white/10" aria-label="Show desktop" title="Show desktop" />
        </div>
        {trayOverflow ? <div className="absolute right-24 grid grid-cols-4 gap-1 rounded-xl border border-white/15 bg-[#202024] p-2 shadow-xl" style={{ bottom: taskbarMetric.height + 4 }}><button onClick={() => setClipboardOpen(true)} className="grid h-9 w-9 place-items-center rounded hover:bg-white/10" title="Clipboard"><Clipboard className="h-4 w-4" /></button><button onClick={() => setEmojiOpen(true)} className="grid h-9 w-9 place-items-center rounded hover:bg-white/10" title="Emoji"><Smile className="h-4 w-4" /></button><button onClick={() => openPanel("settings")} className="grid h-9 w-9 place-items-center rounded hover:bg-white/10" title="Settings"><Settings className="h-4 w-4" /></button><button onClick={() => { setLocked(true);setLockStage("lock") }} className="grid h-9 w-9 place-items-center rounded hover:bg-white/10" title="Lock"><LockKeyhole className="h-4 w-4" /></button></div> : null}
      </div>
    </footer>
  </div>
}
