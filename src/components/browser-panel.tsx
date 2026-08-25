"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ArrowLeft, ArrowRight, RotateCw, Globe, ExternalLink, Home,
  Star, StarOff, X, Clock, Search, Plus, Settings,
  ChevronDown, ChevronRight, Loader2, AlertCircle, FolderPlus, Download, EyeOff, Layers3, Trash2, PanelsTopLeft, Save,
} from "lucide-react"
import { QUICK_LINKS, SEARCH_ENGINES } from "@/lib/client-constants"
import { useBrowser, searchEngine } from "@/hooks/use-browser"
import { THEMES } from "@/lib/themes"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { ensureScramjetControllerRoute, useScramjetController } from "@/hooks/use-scramjet"
import { useSetting, readSetting, writeSetting } from "@/lib/settings-runtime"
import { featureApi } from "@/lib/feature-api"
import { isKnownAdUrl, shouldBlockProxyAdRequest } from "@/lib/ad-shield"
import { toast } from "sonner"

type Tab = {
  id: string
  url: string | null
  input: string
  title: string
  frame: any | null
  iframeEl: HTMLIFrameElement | null
  groupId?: string | null
}

const SEARCH_ENGINE_MIGRATION_KEY = "synnical:browser-search-default-v3"
const BLOOD_THEME_MIGRATION_KEY = "synnical:blood-default-v14"
const BROWSER_RUNTIME_MIGRATION_KEY = "synnical:browser-runtime-defaults-v21"
const DISCORD_INVITE_URL = "https://discord.com/invite/chromebook"

const NEW_TAB_ID = "new-tab"

function DiscordLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M19.2 5.3A16.6 16.6 0 0 0 15.1 4l-.5 1a14 14 0 0 0-5.2 0l-.5-1a16.6 16.6 0 0 0-4.1 1.3C2.2 9.1 1.5 12.8 1.9 16.5a16.8 16.8 0 0 0 5 2.5l1.2-1.7-1.8-.9.4-.3c3.4 1.6 7.2 1.6 10.6 0l.4.3-1.8.9 1.2 1.7a16.8 16.8 0 0 0 5-2.5c.5-4.3-.8-7.9-2.9-11.2ZM8.6 14.5c-1 0-1.9-.9-1.9-2s.8-2 1.9-2 1.9.9 1.9 2-.9 2-1.9 2Zm6.8 0c-1 0-1.9-.9-1.9-2s.8-2 1.9-2 1.9.9 1.9 2-.9 2-1.9 2Z" />
    </svg>
  )
}

// Safe UUID generator — crypto.randomUUID is only available in secure contexts
// (HTTPS or localhost). On HTTP it throws "crypto.randomUUID is not a function",
// which crashes the entire browser panel. This polyfill falls back to a
// RFC4122 v4 UUID generated from crypto.getRandomValues (available everywhere)
// or Math.random as a last resort.
function safeUUID(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
  } catch {}
  // Fallback: RFC4122 v4 UUID
  try {
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      const buf = new Uint8Array(16)
      crypto.getRandomValues(buf)
      buf[6] = (buf[6] & 0x0f) | 0x40
      buf[8] = (buf[8] & 0x3f) | 0x80
      const hex = Array.from(buf, b => b.toString(16).padStart(2, "0"))
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`
    }
  } catch {}
  // Last resort: Math.random-based UUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    const v = c === "x" ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

type ObservedNavigationKind = "init" | "location" | "history" | "hashchange"

type TabNavigationHistory = {
  entries: string[]
  index: number
  pendingCommit: boolean
  traversing: boolean
}

type FramePolicy = {
  blockPopups: (url: string) => boolean
}

const INVALID_NAVIGATION_VALUE = /^(?:undefined|null|\[object Object\])\/?$/i
const TRAILING_PLACEHOLDER_PATH = /(?:\/(?:undefined|null))+\/?$/i

function safeHttpNavigationUrl(value: unknown, base?: string): string {
  const raw = typeof value === "string" ? value.trim() : ""
  if (!raw || INVALID_NAVIGATION_VALUE.test(raw)) return ""

  try {
    const url = base ? new URL(raw, base) : new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return ""
    if (!url.hostname || /^(?:undefined|null)$/i.test(url.hostname)) return ""

    // A few sites build links from an optional route segment. When that value
    // is absent they emit `/undefined/` (or `/null/`) and send the proxy to a
    // guaranteed 404. Keep the valid parent route instead.
    url.pathname = url.pathname.replace(TRAILING_PLACEHOLDER_PATH, "/")
    return url.href
  } catch {
    return ""
  }
}

function shouldResolveAnchorInBrowser(rawHref: string): boolean {
  const value = rawHref.trim()
  if (!value) return false
  if (TRAILING_PLACEHOLDER_PATH.test(value.split(/[?#]/, 1)[0])) return true
  // Scramjet 2.0.67 can resolve relative anchors against the proxy transport
  // origin instead of the upstream page. Resolve those anchors ourselves.
  return !/^[a-z][a-z\d+.-]*:/i.test(value)
}

function framePlugins(tabId: string, onNavigate: (url: string, kind: ObservedNavigationKind) => void, policy: FramePolicy, blockAds: boolean): any[] {
  const plugins: any[] = []
  try {
    const ManagedPlugin = (globalThis as any).$scramjetController?.ManagedPlugin
    if (ManagedPlugin) {
      class NavigationObserverPlugin extends ManagedPlugin {
        constructor() { super(`synnical-navigation-observer-${tabId}`, []) }
        install(frame: any) {
          super.install(frame)
          // Follow Scramjet's upstream UrlWatcherPlugin contract. The iframe's
          // window.location is the same-origin /~/ transport URL, while the
          // client owns the real upstream URL and lifecycle navigation events.
          this.tap(frame.hooks.init.post, (context: any) => {
            if (!context?.isTopLevel) return

            const notify = () => {
              const url = safeHttpNavigationUrl(String(context?.client?.url?.href || ""))
              if (url) onNavigate(url, "init")
            }

            notify()
            this.tap(context.client.hooks.lifecycle.navigate, (navigationContext: any, props: any) => {
              const url = safeHttpNavigationUrl(String(props?.url || ""))
              const kind = String(navigationContext?.type || "location") as ObservedNavigationKind
              if (url) onNavigate(url, kind)
            })
            context.window.addEventListener("hashchange", notify, { capture: true })

            context.window.document.addEventListener("click", (event: MouseEvent) => {
              if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
              const target = event.target as Element | null
              const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null
              if (!anchor || anchor.hasAttribute("download")) return
              const targetName = String(anchor.getAttribute("target") || "").trim().toLowerCase()
              if (targetName && targetName !== "_self") return

              const rawHref = String(anchor.getAttribute("href") || "").trim()
              if (!shouldResolveAnchorInBrowser(rawHref)) return
              const currentUrl = safeHttpNavigationUrl(String(context?.client?.url?.href || ""))
              const destination = safeHttpNavigationUrl(rawHref, currentUrl)
              if (!destination) return

              event.preventDefault()
              event.stopImmediatePropagation()
              context.client.url = destination
            }, { capture: true })

            if (blockAds) {
              this.tap(frame.hooks.fetch.intercept, (request: any, result: any) => {
                const parsed = request?.parsed || {}
                const destination = String(parsed.destination || request?.request?.destination || "")
                const isIframe = Boolean(parsed.isIframe || request?.request?.isIframe)
                const parentFrameName = parsed.parentFrameName ?? request?.request?.parentFrameName
                const rawUrl = String(parsed.url?.href || request?.request?.rawUrl?.href || request?.request?.url || "")
                if (shouldBlockProxyAdRequest({ url: rawUrl, destination, isIframe, parentFrameName }, true)) {
                  result.response = { body: "", status: 204, statusText: "No Content", headers: new Headers() }
                }
              }, { after: ["scramjet-http-cache"] })
            }
          })
        }
      }
      plugins.push(new NavigationObserverPlugin())

      class PopupGuardPlugin extends ManagedPlugin {
        constructor() { super(`synnical-popup-guard-${tabId}`, []) }
        install(frame: any) {
          super.install(frame)

          this.tap(frame.hooks.init.post, (context: any) => {
            if (!context?.isTopLevel || !context.window) return
            const proxiedWindow = context.window as Window
            const originalOpen = proxiedWindow.open.bind(proxiedWindow)
            const guardedOpen = (value?: string | URL, target?: string, features?: string) => {
              const raw = value == null ? "" : String(value)
              if (blockAds && isKnownAdUrl(raw)) return null
              if (policy.blockPopups(String(context?.client?.url?.href || ""))) return null
              return originalOpen(raw, target, features)
            }
            try {
              Object.defineProperty(proxiedWindow, "open", { configurable: true, writable: true, value: guardedOpen })
            } catch {
              try { proxiedWindow.open = guardedOpen as typeof proxiedWindow.open } catch {}
            }
          })
        }
      }
      plugins.push(new PopupGuardPlugin())
    }
  } catch (error) {
    console.debug("[Browser] Navigation observer is unavailable:", error)
  }
  return plugins
}

function applyFrameView(iframe: HTMLIFrameElement, zoomLevel: number, imageBlur: boolean): void {
  const safeZoom = Math.min(200, Math.max(50, zoomLevel))
  iframe.style.filter = imageBlur ? "blur(8px)" : "none"
  iframe.style.transform = `scale(${safeZoom / 100})`
  iframe.style.transformOrigin = "top left"
  iframe.style.width = `${10000 / safeZoom}%`
  iframe.style.height = `${10000 / safeZoom}%`
}

function searchEngineMark(id: string): string {
  if (id === "duckduckgo") return "/brand/shortcuts/duckduckgo.svg"
  if (id === "brave") return "/brand/shortcuts/brave.svg"
  return "/brand/shortcuts/google.svg"
}

function newTab(initialUrl = ""): Tab {
  const url = initialUrl.trim()
  return { id: safeUUID(), url: url || null, input: url, title: url || "New Tab", frame: null, iframeEl: null }
}

function normalizeUrl(raw: string, engineId: string): string {
  const v = raw.trim()
  if (!v) return ""
  if (/^about:blank$/i.test(v) || /^blank$/i.test(v)) return "about:blank"
  if (/^https?:\/\/[^/]/i.test(v)) return safeHttpNavigationUrl(v)
  if (/^[\w-]+(\.[\w-]+)+/.test(v)) return safeHttpNavigationUrl("https://" + v)
  return searchEngine(engineId).url + encodeURIComponent(v)
}

type BrowserPanelProps = {
  initialUrl?: string
  onUrlChange?: (url: string) => void
  embedded?: boolean
  embeddedLabel?: string
}

export function BrowserPanel({ initialUrl = "", onUrlChange, embedded = false, embeddedLabel = "page" }: BrowserPanelProps = {}) {
  const {
    searchEngineId, setSearchEngine, homepage, setHomepage,
    bookmarks, addBookmark, removeBookmark, replaceBookmarks,
    isBookmarked, recordVisit, history, clearHistory, removeHistory, replaceHistory,
    bookmarksBarCollapsed, setBookmarksBarCollapsed,
    antiTabClose, setAntiTabClose,
    imageBlur, setImageBlur,
    theme, setTheme,
  } = useBrowser()

  // ── Browser settings (wired to settings runtime) ──
  // These sync BOTH ways: settings page writes → browser panel reads, and vice versa
  const [sSearchEngine, setSSearchEngine] = useSetting<string>("browser.searchEngine", "duckduckgo")
  const [sHomepage, setSHomepage] = useSetting<string>("browser.homepage", "")
  const [blockPopups] = useSetting<boolean>("browser.blockPopups", true)
  const [blockAds] = useSetting<boolean>("ads.enabled", true)
  const [enableJs] = useSetting<boolean>("browser.enableJs", true)
  const [clearOnExit] = useSetting<boolean>("browser.clearOnExit", false)
  const [zoomLevel] = useSetting<number>("browser.zoom", 100)
  const [newTabBehavior] = useSetting<string>("browser.newTab", "blank")

  // Sync settings ↔ zustand store for searchEngine and homepage
  useEffect(() => {
    if (sSearchEngine && sSearchEngine !== searchEngineId) {
      setSearchEngine(sSearchEngine)
    }
  }, [sSearchEngine]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sHomepage !== homepage) {
      setHomepage(sHomepage)
    }
  }, [sHomepage]) // eslint-disable-line react-hooks/exhaustive-deps

  // When zustand store changes (e.g. from browser settings popover), sync back to settings
  useEffect(() => {
    if (searchEngineId && searchEngineId !== sSearchEngine) {
      setSSearchEngine(searchEngineId)
    }
  }, [searchEngineId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Older builds silently wrote Google as the default. Migrate that persisted
  // value once so existing users stop hitting Google's VPS-IP challenge. Google
  // remains selectable after the migration.
  useEffect(() => {
    try {
      if (localStorage.getItem(SEARCH_ENGINE_MIGRATION_KEY)) return
      setSearchEngine("duckduckgo")
      setSSearchEngine("duckduckgo")
      localStorage.setItem(SEARCH_ENGINE_MIGRATION_KEY, "1")
    } catch {}
  }, [setSearchEngine, setSSearchEngine])

  // Existing installs could retain the old Blossom/pink selection forever.
  // Migrate once to the new OLED midnight default, while leaving users free to
  // choose a different theme afterwards.
  useEffect(() => {
    try {
      if (localStorage.getItem(BLOOD_THEME_MIGRATION_KEY)) return
      setTheme("blood")
      const oldProfileColor = localStorage.getItem("synnical:settings:profile.customColor")
      if (oldProfileColor === JSON.stringify("#ec4899") || oldProfileColor === JSON.stringify("#f472b6")) {
        localStorage.removeItem("synnical:settings:profile.customColor")
      }
      localStorage.setItem(BLOOD_THEME_MIGRATION_KEY, "1")
    } catch {}
  }, [setTheme])

  // A prior Settings value could leave JavaScript disabled indefinitely and
  // make modern sites appear blank. Restore that production-safe default once;
  // the user can still change it afterwards.
  useEffect(() => {
    try {
      if (localStorage.getItem(BROWSER_RUNTIME_MIGRATION_KEY)) return
      writeSetting("browser.enableJs", true)
      localStorage.setItem(BROWSER_RUNTIME_MIGRATION_KEY, "1")
    } catch {}
  }, [])

  useEffect(() => {
    if (homepage !== sHomepage) {
      setSHomepage(homepage)
    }
  }, [homepage]) // eslint-disable-line react-hooks/exhaustive-deps

  // This setting promises history clearing only. pagehide covers reloads and
  // closes; cleanup covers panel removal during client-side navigation.
  useEffect(() => {
    const onExit = () => { if (clearOnExit) clearHistory() }
    window.addEventListener("pagehide", onExit)
    return () => {
      window.removeEventListener("pagehide", onExit)
      onExit()
    }
  }, [clearOnExit, clearHistory])

  useEffect(() => {
    const onClearHistory = () => clearHistory()
    window.addEventListener("synnical-browser-clear-history", onClearHistory)
    return () => window.removeEventListener("synnical-browser-clear-history", onClearHistory)
  }, [clearHistory])

  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(initialUrl)])
  const [activeId, setActiveId] = useState(tabs[0].id)
  const [loading, setLoading] = useState(Boolean(initialUrl.trim()))
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [frameError, setFrameError] = useState<string | null>(null)
  const [browserFeatures, setBrowserFeatures] = useState<any>(null)
  const [browserGroups, setBrowserGroups] = useState<any[]>([])
  const [splitTabId, setSplitTabId] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState("")
  const [historyQuery, setHistoryQuery] = useState("")
  const [temporaryProfile, setTemporaryProfile] = useState(false)
  const tempSessionIdRef = useRef<string | null>(null)
  const normalCookieSnapshotRef = useRef<any>(null)
  const featureLoadDoneRef = useRef(false)

  const { status: ctrlStatus, controller, error: ctrlError, retry } = useScramjetController() as any

  const resetBrowserSession = useCallback(() => {
    const freshTab = newTab(initialUrl)
    setTabs([freshTab])
    setActiveId(freshTab.id)
    setLoading(Boolean(initialUrl.trim()))
    setShowHistory(false)
    setShowSettings(false)
    setFrameError(null)
    setBrowserFeatures(null)
    setBrowserGroups([])
    setSplitTabId(null)
    setWorkspaceId("")
    setHistoryQuery("")
  }, [initialUrl])

  useEffect(() => {
    const onReset = () => resetBrowserSession()
    window.addEventListener("synnical-browser-reset", onReset)
    return () => window.removeEventListener("synnical-browser-reset", onReset)
  }, [resetBrowserSession])

  const refreshBrowserFeatures = useCallback(() => {
    featureApi.browser.state().then((state: any) => {
      setBrowserFeatures(state)
      setBrowserGroups(Array.isArray(state.groups) ? state.groups : [])
      if (!featureLoadDoneRef.current) {
        featureLoadDoneRef.current = true
        if (Array.isArray(state.bookmarks)) replaceBookmarks(state.bookmarks.map((row: any) => ({ id: row.id, title: row.title, url: row.url, createdAt: new Date(row.createdAt).getTime() })))
        if (Array.isArray(state.history)) replaceHistory(state.history.map((row: any) => ({ id: row.id, title: row.title, url: row.url, visitedAt: new Date(row.visitedAt).getTime() })))
      }
    }).catch(() => {})
  }, [replaceBookmarks, replaceHistory])

  useEffect(() => { refreshBrowserFeatures() }, [refreshBrowserFeatures])

  const managedDownload = useCallback(async (url: string, filename: string) => {
    let downloadId = ""
    const taskbarProgress = (progress: number | null, active = true) => window.dispatchEvent(new CustomEvent("synnical-taskbar-progress", { detail: { panel: "browser", progress, active } }))
    taskbarProgress(null, true)
    try {
      const response = await fetch(url, { credentials: "include" })
      if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status})`)
      const declared = Number(response.headers.get("content-length") || 0)
      const maxManagedBytes = 200 * 1024 * 1024
      if (declared > maxManagedBytes) {
        // Very large files are handed to the browser to avoid buffering hundreds
        // of MB in Synnical's renderer. The history still records the handoff,
        // but byte progress is intentionally unavailable for this capability case.
        const started: any = await featureApi.browser.action("download-start", { url, filename, bytesTotal: declared })
        downloadId = started.download?.id || ""
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = filename
        anchor.rel = "noreferrer"
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        if (downloadId) await featureApi.browser.action("download-update", { id: downloadId, status: "complete", bytesReceived: 0, error: "Handed to browser because file exceeds the 200 MiB in-app progress limit." })
        taskbarProgress(100, false)
        window.dispatchEvent(new CustomEvent("synnical-os-notify", { detail: { title: "Download handed to browser", body: filename, panel: "browser", priority: "normal" } }))
        refreshBrowserFeatures()
        return
      }
      const started: any = await featureApi.browser.action("download-start", { url, filename, bytesTotal: declared || undefined })
      downloadId = started.download?.id || ""
      const reader = response.body.getReader()
      const chunks: ArrayBuffer[] = []
      let received = 0
      let lastReported = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          received += value.byteLength
          if (received > maxManagedBytes) throw new Error("Download exceeded the 200 MiB in-app progress limit")
          const copy = new Uint8Array(value.byteLength)
          copy.set(value)
          chunks.push(copy.buffer)
          if (downloadId && received - lastReported >= 1024 * 1024) {
            lastReported = received
            taskbarProgress(declared > 0 ? Math.min(99, Math.round(received / declared * 100)) : null, true)
            void featureApi.browser.action("download-update", { id: downloadId, status: "started", bytesReceived: received }).then(refreshBrowserFeatures).catch(() => {})
          }
        }
      }
      const blob = new Blob(chunks, { type: response.headers.get("content-type") || "application/octet-stream" })
      const blobUrl = URL.createObjectURL(blob)
      try {
        const anchor = document.createElement("a")
        anchor.href = blobUrl
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000)
      }
      if (downloadId) await featureApi.browser.action("download-update", { id: downloadId, status: "complete", bytesReceived: received })
      taskbarProgress(100, false)
      window.dispatchEvent(new CustomEvent("synnical-os-notify", { detail: { title: "Download complete", body: filename, panel: "browser", priority: "normal" } }))
      refreshBrowserFeatures()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download failed"
      if (downloadId) await featureApi.browser.action("download-update", { id: downloadId, status: "failed", error: message }).catch(() => {})
      taskbarProgress(0, false)
      window.dispatchEvent(new CustomEvent("synnical-os-notify", { detail: { title: "Download failed", body: `${filename}: ${message}`, panel: "browser", priority: "normal" } }))
      refreshBrowserFeatures()
      toast.error(message)
    }
  }, [refreshBrowserFeatures])

  const viewportRef = useRef<HTMLDivElement>(null)
  const pendingNavigationRef = useRef<{ tabId: string; rawUrl: string } | null>(null)
  const frameMapRef = useRef(new Map<string, { frame: any; iframe: HTMLIFrameElement }>())
  const framePromiseRef = useRef(new Map<string, Promise<any | null>>())
  const navigationTimeoutRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const navigationHistoryRef = useRef(new Map<string, TabNavigationHistory>())
  const guardedFrameWindowsRef = useRef(new WeakSet<Window>())
  const [, setNavigationRevision] = useState(0)
  const frameGenerationRef = useRef(0)

  const active = tabs.find((t) => t.id === activeId) || tabs[0]

  const permissionFor = useCallback((url: string | null | undefined) => {
    if (!url) return null
    try {
      const origin = new URL(url).origin
      return browserFeatures?.permissions?.find((row: any) => row.origin === origin) || null
    } catch { return null }
  }, [browserFeatures])
  const popupBlockedFor = useCallback((url: string | null | undefined) => {
    const permission = permissionFor(url)
    if (permission?.popups === "allow") return false
    if (permission?.popups === "block") return true
    return blockPopups
  }, [permissionFor, blockPopups])
  const framePolicyRef = useRef({ popupBlockedFor })
  useEffect(() => {
    framePolicyRef.current = { popupBlockedFor }
  }, [popupBlockedFor])

  const updateTab = useCallback((id: string, patch: Partial<Tab>) =>
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t))), [])

  const observeNavigation = useCallback((tabId: string, url: string, kind: ObservedNavigationKind | "explicit") => {
    url = safeHttpNavigationUrl(url)
    if (!url) return
    let navigation = navigationHistoryRef.current.get(tabId)
    if (!navigation) {
      navigation = { entries: [], index: -1, pendingCommit: false, traversing: false }
      navigationHistoryRef.current.set(tabId, navigation)
    }

    if (navigation.traversing && kind === "init") {
      navigation.entries[navigation.index] = url
      navigation.traversing = false
      navigation.pendingCommit = false
    } else if (kind === "init" && navigation.pendingCommit) {
      if (navigation.index >= 0) navigation.entries[navigation.index] = url
      navigation.pendingCommit = false
    } else if (navigation.index < 0) {
      navigation.entries = [url]
      navigation.index = 0
    } else if (navigation.entries[navigation.index] !== url) {
      navigation.entries = navigation.entries.slice(0, navigation.index + 1)
      navigation.entries.push(url)
      navigation.index = navigation.entries.length - 1
    }

    if (kind === "explicit" || kind === "location") navigation.pendingCommit = true

    updateTab(tabId, { url, input: url, title: url })
    onUrlChange?.(url)
    setNavigationRevision((revision) => revision + 1)
  }, [onUrlChange, updateTab])

  const releaseFrame = useCallback((tabId: string) => {
    const live = frameMapRef.current.get(tabId)
    if (live?.iframe) {
      try {
        live.iframe.src = "about:blank"
        live.iframe.remove()
      } catch {}
    }
    frameMapRef.current.delete(tabId)
    framePromiseRef.current.delete(tabId)
    const timeout = navigationTimeoutRef.current.get(tabId)
    if (timeout) clearTimeout(timeout)
    navigationTimeoutRef.current.delete(tabId)
  }, [])

  // --- Create a Scramjet Frame for a tab (lazy, on first navigation) ---
  const ensureFrame = useCallback(async (tabId: string): Promise<Tab["frame"] | null> => {
    const tab = tabs.find((t) => t.id === tabId)
    const viewport = viewportRef.current
    if (!tab || !viewport || !controller) return null
    const existing = frameMapRef.current.get(tabId)
    if (existing) return existing.frame
    if (tab.frame) return tab.frame

    const pending = framePromiseRef.current.get(tabId)
    if (pending) return pending

    const creation = (async () => {
      try {
        const generation = frameGenerationRef.current
        const raced = frameMapRef.current.get(tabId)
        if (raced) return raced.frame
        if (generation !== frameGenerationRef.current) return null

        const iframe = document.createElement("iframe")
        iframe.className = "absolute inset-0 w-full h-full border-none bg-black"
        applyFrameView(iframe, zoomLevel, imageBlur)
        iframe.setAttribute("allow", "autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-read; clipboard-write")
        iframe.setAttribute("referrerPolicy", "strict-origin-when-cross-origin")
        iframe.addEventListener("load", () => {
          const currentSrc = iframe.getAttribute("src") || iframe.src
          if (!currentSrc) return
          if (currentSrc === "about:blank" && tab.url !== "about:blank") return
          const timeout = navigationTimeoutRef.current.get(tabId)
          if (timeout) clearTimeout(timeout)
          navigationTimeoutRef.current.delete(tabId)
          setLoading(false)
          try {
            const proxiedWindow = iframe.contentWindow
            if (proxiedWindow && !guardedFrameWindowsRef.current.has(proxiedWindow)) {
              guardedFrameWindowsRef.current.add(proxiedWindow)
              // Attach at Window capture phase, ahead of Scramjet's document
              // click handler. The original relative href is retained in
              // scramjet-attr-href while the visible href points at /~/sj/.
              const onProxiedClick = (click: MouseEvent) => {
                if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return
                const targetNode = click.target as (Node & { parentElement?: Element | null }) | null
                const target = targetNode?.nodeType === 1 ? targetNode as unknown as Element : targetNode?.parentElement || null
                const anchor = target ? Element.prototype.closest.call(target, "a[href]") as HTMLAnchorElement | null : null
                if (!anchor) return
                const getAttribute = (name: string) => Element.prototype.getAttribute.call(anchor, name)
                const hasAttribute = (name: string) => Element.prototype.hasAttribute.call(anchor, name)
                const href = anchor.href
                const looksDownload = hasAttribute("download") || /\.(zip|pdf|exe|msi|dmg|apk|tar|gz|7z|rar|mp3|mp4|webm|png|jpe?g|webp)(?:[?#]|$)/i.test(href)
                if (looksDownload && !temporaryProfile) {
                  Event.prototype.preventDefault.call(click)
                  Event.prototype.stopImmediatePropagation.call(click)
                  const filename = anchor.download || new URL(href).pathname.split("/").filter(Boolean).pop() || "download"
                  void managedDownload(href, filename)
                  return
                }

                const targetName = String(getAttribute("target") || "").trim().toLowerCase()
                if (targetName && targetName !== "_self") return
                const rawHref = String(getAttribute("scramjet-attr-href") || getAttribute("href") || "").trim()
                if (!shouldResolveAnchorInBrowser(rawHref)) return

                const navigation = navigationHistoryRef.current.get(tabId)
                const currentUrl = navigation && navigation.index >= 0
                  ? navigation.entries[navigation.index]
                  : tab.url || ""
                const destination = safeHttpNavigationUrl(rawHref, currentUrl)
                const live = frameMapRef.current.get(tabId)
                if (!destination || !live) return

                Event.prototype.preventDefault.call(click)
                Event.prototype.stopImmediatePropagation.call(click)
                setLoading(true)
                observeNavigation(tabId, destination, "location")
                live.frame.go(destination)
              }
              // Use the host realm's native EventTarget method. Scramjet wraps
              // the frame realm's addEventListener and otherwise re-wraps this
              // controller callback as if it belonged to the upstream site.
              EventTarget.prototype.addEventListener.call(proxiedWindow, "click", onProxiedClick as EventListener, { capture: true })
            }
          } catch {}
        })
        if (!viewport.isConnected || generation !== frameGenerationRef.current) return null
        viewport.appendChild(iframe)
        try {
          const frame = controller.createFrame(iframe, {
            plugins: framePlugins(
              tabId,
              (url, kind) => observeNavigation(tabId, url, kind),
              {
                blockPopups: (url) => framePolicyRef.current.popupBlockedFor(url),
              },
              blockAds,
            ),
          })
          frameMapRef.current.set(tabId, { frame, iframe })
          updateTab(tabId, { frame, iframeEl: iframe })
          return frame
        } catch (error) {
          try { iframe.remove() } catch {}
          throw error
        }
      } catch (err) {
        console.error("[Browser] Failed to create frame:", err)
        setFrameError(err instanceof Error ? err.message : "Failed to create browser frame")
        return null
      } finally {
        framePromiseRef.current.delete(tabId)
      }
    })()
    framePromiseRef.current.set(tabId, creation)
    return creation
  }, [tabs, controller, imageBlur, zoomLevel, temporaryProfile, managedDownload, updateTab, observeNavigation])

  // --- Navigate a specific tab. Keeping the id explicit avoids the stale-state
  // bug where a newly opened tab navigated the previously active tab. ---
  const navigateTab = useCallback(async (tabId: string, rawUrl: string) => {
    setFrameError(null)
    const url = normalizeUrl(rawUrl, searchEngineId)
    if (!url) return

    // If controller isn't ready, show error
    if (ctrlStatus !== "ready" || !controller) {
      if (ctrlStatus === "loading" || ctrlStatus === "idle") {
        pendingNavigationRef.current = { tabId, rawUrl }
        setFrameError(null)
        setLoading(true)
        if (ctrlStatus === "idle") retry()
      } else {
        setFrameError("Proxy not ready. Click retry below.")
      }
      return
    }

    // Service workers may be suspended after the Browser initially reports
    // ready. Reattach Scramjet's in-memory route immediately before assigning
    // an iframe URL so the first navigation works without a manual retry.
    let routeRecovered = false
    try {
      routeRecovered = await ensureScramjetControllerRoute(controller)
    } catch (err) {
      setLoading(false)
      setFrameError(err instanceof Error ? err.message : "Proxy route is unavailable")
      return
    }

    const frame = await ensureFrame(tabId)
    if (!frame) return

    try {
      const oldTimeout = navigationTimeoutRef.current.get(tabId)
      if (oldTimeout) clearTimeout(oldTimeout)
      setLoading(true)
      navigationTimeoutRef.current.set(tabId, setTimeout(() => {
        navigationTimeoutRef.current.delete(tabId)
        setLoading(false)
        setFrameError(
          `This page did not finish loading within ${embedded ? 20 : 30} seconds. ` +
          "Try again once. If only this site fails, it may not work through Synnical right now.",
        )
      }, embedded ? 20_000 : 30_000))
      observeNavigation(tabId, url, "explicit")
      frame.go(url)
      if (routeRecovered) {
        // Chromium can retain the first assignment on about:blank for a brief
        // moment after a sleeping worker's MessagePort is replaced. Repeat the
        // same navigation once after the channel settles; this is scoped to a
        // proven recovery and never duplicates ordinary navigations.
        window.setTimeout(() => {
          const live = frameMapRef.current.get(tabId)
          if (!live || live.frame !== frame) return
          try {
            if (live.iframe.contentWindow?.location.href === "about:blank") frame.go(url)
          } catch {}
        }, 500)
      }
      if (!temporaryProfile) {
        recordVisit(url, url)
        void featureApi.browser.action("record-history", { url, title: url }).then(refreshBrowserFeatures).catch(() => {})
      } else if (tempSessionIdRef.current) {
        void featureApi.browser.action("record-history", { url, title: url, tempSessionId: tempSessionIdRef.current }).catch(() => {})
      }
    } catch (err) {
      const timeout = navigationTimeoutRef.current.get(tabId)
      if (timeout) clearTimeout(timeout)
      navigationTimeoutRef.current.delete(tabId)
      setLoading(false)
      console.error("[Browser] Navigation error:", err)
      setFrameError(err instanceof Error ? err.message : "Navigation failed")
    }
  }, [ensureFrame, searchEngineId, recordVisit, ctrlStatus, controller, retry, observeNavigation, embedded, temporaryProfile, refreshBrowserFeatures])

  const navigate = useCallback((rawUrl: string) => {
    navigateTab(active.id, rawUrl)
  }, [active.id, navigateTab])

  // Zoom and image blur are presentation-only settings, so update every open
  // frame in place instead of making the user reload it.
  useEffect(() => {
    for (const { iframe } of frameMapRef.current.values()) {
      applyFrameView(iframe, zoomLevel, imageBlur)
    }
  }, [zoomLevel, imageBlur])

  // Frames are created lazily. This also restores the active page after a
  // permission-policy change removed its previous frame.
  useEffect(() => {
    if (!active.url || active.frame) return
    if (frameMapRef.current.has(active.id) || framePromiseRef.current.has(active.id)) return
    if (ctrlStatus === "ready") void navigateTab(active.id, active.url)
  }, [active.id, active.url, active.frame, ctrlStatus, navigateTab])

  useEffect(() => {
    if (ctrlStatus !== "ready" || !pendingNavigationRef.current) return
    const pending = pendingNavigationRef.current
    if (!tabs.some((tab) => tab.id === pending.tabId)) return
    pendingNavigationRef.current = null
    navigateTab(pending.tabId, pending.rawUrl)
  }, [ctrlStatus, tabs, navigateTab])

  useEffect(() => {
    if (embedded) return
    const onGlobalNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ value?: unknown; url?: unknown; href?: unknown }>).detail
      const value = detail?.value ?? detail?.url ?? detail?.href
      if (typeof value === "string" && value.trim()) navigate(value)
    }
    window.addEventListener("synnical-browser-navigate", onGlobalNavigate)
    return () => window.removeEventListener("synnical-browser-navigate", onGlobalNavigate)
  }, [navigate, embedded])

  const toggleBookmarkSynced = useCallback(async () => {
    if (!active.input || temporaryProfile) return
    const existing = bookmarks.find((item) => item.url === active.input)
    if (existing) { removeBookmark(existing.id); await featureApi.browser.action("delete-bookmark", { id: existing.id }).catch(() => {}) }
    else { addBookmark({ title: active.title || active.input, url: active.input }); await featureApi.browser.action("save-bookmark", { title: active.title || active.input, url: active.input }).catch(() => {}) }
    refreshBrowserFeatures()
  }, [active.input, active.title, temporaryProfile, bookmarks, removeBookmark, addBookmark, refreshBrowserFeatures])

  const clearHistorySynced = useCallback(async () => {
    clearHistory()
    await featureApi.browser.action("clear-history", {}).catch(() => {})
    refreshBrowserFeatures()
  }, [clearHistory, refreshBrowserFeatures])

  const removeHistorySynced = useCallback(async (id: string) => {
    removeHistory(id)
    await featureApi.browser.action("delete-history", { id }).catch(() => {})
    refreshBrowserFeatures()
  }, [removeHistory, refreshBrowserFeatures])

  const setSitePermission = useCallback(async (field: "popups" | "notifications" | "storage", value: string) => {
    if (!active.url) return
    let origin = ""; try { origin = new URL(active.url).origin } catch { return }
    const current = permissionFor(active.url) || { popups: "ask", notifications: "ask", storage: "allow" }
    await featureApi.browser.action("set-permission", { origin, ...current, [field]: value })
    refreshBrowserFeatures()
  }, [active.url, permissionFor, refreshBrowserFeatures])

  const toggleTemporaryProfile = useCallback(async () => {
    if (!controller) return
    frameGenerationRef.current += 1
    for (const tabId of Array.from(frameMapRef.current.keys())) releaseFrame(tabId)
    setTabs((previous) => previous.map((tab) => ({ ...tab, frame: null, iframeEl: null })))
    if (!temporaryProfile) {
      normalCookieSnapshotRef.current = controller.cookieJar?.dump?.() || null
      controller.cookieJar?.clear?.()
      await controller.persistCookies?.()
      tempSessionIdRef.current = `temp-${safeUUID()}`
      setTemporaryProfile(true)
    } else {
      const tempId = tempSessionIdRef.current
      controller.cookieJar?.clear?.()
      if (normalCookieSnapshotRef.current) controller.cookieJar?.load?.(normalCookieSnapshotRef.current)
      await controller.persistCookies?.()
      if (tempId) await featureApi.browser.action("clear-history", { tempSessionId: tempId }).catch(() => {})
      normalCookieSnapshotRef.current = null
      tempSessionIdRef.current = null
      setTemporaryProfile(false)
    }
  }, [controller, temporaryProfile, releaseFrame])

  const createGroup = useCallback(async () => {
    const name = window.prompt("Tab group name")?.trim()
    if (!name) return
    const group = { id: safeUUID(), name: name.slice(0, 80), collapsed: false }
    const next = [...browserGroups, group]
    setBrowserGroups(next)
    await featureApi.browser.action("save-groups", { groups: next }).catch(() => {})
    updateTab(active.id, { groupId: group.id })
  }, [browserGroups, active.id, updateTab])

  const saveWorkspace = useCallback(async (template?: "school" | "gaming") => {
    const templateTabs = template === "school" ? [
      { url: "https://classroom.google.com", input: "https://classroom.google.com", title: "Google Classroom" },
      { url: "https://en.wikipedia.org", input: "https://en.wikipedia.org", title: "Wikipedia" },
      { url: "https://www.desmos.com/calculator", input: "https://www.desmos.com/calculator", title: "Desmos" },
    ] : template === "gaming" ? [
      { url: "https://discord.com/app", input: "https://discord.com/app", title: "Discord" },
      { url: "https://www.youtube.com", input: "https://www.youtube.com", title: "YouTube" },
      { url: "https://store.steampowered.com", input: "https://store.steampowered.com", title: "Steam" },
    ] : tabs.map((tab) => ({ id: tab.id, url: tab.url, input: tab.input, title: tab.title, groupId: tab.groupId || null }))
    const suggested = template === "school" ? "School" : template === "gaming" ? "Gaming" : "My workspace"
    const name = window.prompt("Workspace name", suggested)?.trim()
    if (!name) return
    await featureApi.browser.action("save-workspace", { name, layout: splitTabId && splitTabId !== activeId ? "split" : "tabs", tabs: templateTabs, notes: { groups: browserGroups } })
    refreshBrowserFeatures(); toast.success("Browser workspace saved")
  }, [tabs, splitTabId, activeId, browserGroups, refreshBrowserFeatures])

  const loadWorkspace = useCallback((id: string) => {
    const workspace = browserFeatures?.workspaces?.find((row: any) => row.id === id)
    if (!workspace || !Array.isArray(workspace.tabs) || !workspace.tabs.length) return
    frameGenerationRef.current += 1
    for (const tabId of Array.from(frameMapRef.current.keys())) releaseFrame(tabId)
    const restored: Tab[] = workspace.tabs.slice(0, 50).map((row: any) => ({ id: safeUUID(), url: typeof row.url === "string" ? row.url : null, input: typeof row.input === "string" ? row.input : (row.url || ""), title: typeof row.title === "string" ? row.title : (row.url || "New Tab"), groupId: typeof row.groupId === "string" ? row.groupId : null, frame: null, iframeEl: null }))
    setTabs(restored); setActiveId(restored[0].id); setSplitTabId(workspace.layout === "split" && restored.length > 1 ? restored[1].id : null)
    const groups = Array.isArray(workspace.notes?.groups) ? workspace.notes.groups : []
    setBrowserGroups(groups); void featureApi.browser.action("save-groups", { groups }).catch(() => {})
    toast.success(`Loaded ${workspace.name}`)
  }, [browserFeatures?.workspaces, releaseFrame])

  const traverseNavigation = useCallback((delta: -1 | 1) => {
    const navigation = navigationHistoryRef.current.get(active.id)
    const frame = frameMapRef.current.get(active.id)?.frame || active.frame
    if (!navigation || !frame) return
    const nextIndex = navigation.index + delta
    if (nextIndex < 0 || nextIndex >= navigation.entries.length) return

    const previousIndex = navigation.index
    navigation.index = nextIndex
    navigation.traversing = true
    navigation.pendingCommit = false
    const target = navigation.entries[nextIndex]
    updateTab(active.id, { url: target, input: target, title: target })
    onUrlChange?.(target)
    setNavigationRevision((revision) => revision + 1)
    try {
      frame.go(target)
    } catch {
      navigation.index = previousIndex
      navigation.traversing = false
      setNavigationRevision((revision) => revision + 1)
    }
  }, [active.frame, active.id, onUrlChange, updateTab])

  const back = useCallback(() => traverseNavigation(-1), [traverseNavigation])
  const forward = useCallback(() => traverseNavigation(1), [traverseNavigation])
  const reload = useCallback(() => { try { active.frame?.reload() } catch {} }, [active.frame])

  const activeNavigation = navigationHistoryRef.current.get(active.id)
  const canGoBack = Boolean(active.frame && activeNavigation && activeNavigation.index > 0)
  const canGoForward = Boolean(active.frame && activeNavigation && activeNavigation.index < activeNavigation.entries.length - 1)

  const goHome = useCallback(() => {
    if (homepage) navigate(homepage)
    else updateTab(active.id, { url: null, input: "", title: "New Tab" })
  }, [homepage, navigate, active.id, updateTab])

  const openNewTab = useCallback(() => {
    const t = newTab()
    setTabs((prev) => [...prev, t])
    setActiveId(t.id)
    if (newTabBehavior === "blank") {
      pendingNavigationRef.current = { tabId: t.id, rawUrl: "about:blank" }
    } else if (newTabBehavior === "homepage" && homepage) {
      pendingNavigationRef.current = { tabId: t.id, rawUrl: homepage }
    } else if (newTabBehavior === "search") {
      const se = searchEngine(sSearchEngine)
      pendingNavigationRef.current = { tabId: t.id, rawUrl: se.url.replace(/\?q=.*/, "") }
    }
  }, [newTabBehavior, homepage, sSearchEngine])

  const closeTab = useCallback((id: string) => {
    if (splitTabId === id) setSplitTabId(null)
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      const closing = prev.find((t) => t.id === id)
      const liveFrame = frameMapRef.current.get(id)
      const iframe = liveFrame?.iframe || closing?.iframeEl
      if (iframe) {
        try {
          iframe.src = "about:blank"
          iframe.remove()
        } catch {}
      }
      frameMapRef.current.delete(id)
      framePromiseRef.current.delete(id)
      const timeout = navigationTimeoutRef.current.get(id)
      if (timeout) clearTimeout(timeout)
      navigationTimeoutRef.current.delete(id)
      const next = prev.filter((t) => t.id !== id)
      if (next.length === 0) {
        const fresh = newTab()
        setActiveId(fresh.id)
        return [fresh]
      }
      if (id === activeId) {
        const newActive = next[Math.max(0, idx - 1)]
        setActiveId(newActive.id)
      }
      return next
    })
  }, [activeId, splitTabId])

  useEffect(() => () => {
    for (const [tabId, { iframe }] of frameMapRef.current.entries()) {
      try { iframe.remove() } catch {}
      }
    frameMapRef.current.clear()
    framePromiseRef.current.clear()
    for (const timeout of navigationTimeoutRef.current.values()) clearTimeout(timeout)
    navigationTimeoutRef.current.clear()
  }, [])

  useEffect(() => {
    for (const t of tabs) {
      if (t.iframeEl) t.iframeEl.style.display = t.id === activeId ? "block" : "none"
    }
  }, [tabs, activeId])

  const splitTab = splitTabId && splitTabId !== activeId ? tabs.find((tab) => tab.id === splitTabId) || null : null
  useEffect(() => {
    if (!splitTab?.url || splitTab.frame || frameMapRef.current.has(splitTab.id) || framePromiseRef.current.has(splitTab.id)) return
    if (ctrlStatus !== "ready") return
    void ensureFrame(splitTab.id)
  }, [splitTab?.id, splitTab?.url, splitTab?.frame, ctrlStatus, ensureFrame])

  useEffect(() => {
    const safeZoom = Math.min(200, Math.max(50, zoomLevel))
    for (const tab of tabs) {
      const iframe = tab.iframeEl
      if (!iframe) continue
      const isPrimary = tab.id === activeId
      const isSecondary = Boolean(splitTab && tab.id === splitTab.id)
      if (!isPrimary && !isSecondary) { iframe.style.display = "none"; continue }
      iframe.style.display = "block"
      iframe.style.top = "0"
      iframe.style.height = `${10000 / safeZoom}%`
      if (splitTab) {
        iframe.style.left = isPrimary ? "0" : "50%"
        iframe.style.width = `${5000 / safeZoom}%`
      } else {
        iframe.style.left = "0"
        iframe.style.width = `${10000 / safeZoom}%`
      }
    }
  }, [tabs, activeId, splitTab?.id, zoomLevel, imageBlur])

  useEffect(() => {
    if (!antiTabClose) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [antiTabClose])

  const popout = () => {
    if (active.input) window.open(active.input, "_blank", "width=1280,height=720")
  }

  const bookmarked = active.input ? isBookmarked(active.input) : false

  const scramjetLoading = ctrlStatus === "loading"
  const scramjetError = ctrlStatus === "error"
  const scramjetReady = ctrlStatus === "ready"

  return (
    <div className="synnical-browser h-full flex flex-col synnical-bg">
      {/* Tab strip */}
      <div className={cn("h-9 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--synnical-border)] bg-[var(--synnical-surface)] overflow-x-auto", embedded && "hidden")}>
        {tabs.map((t) => (
          <div
            key={t.id}
            onClick={() => setActiveId(t.id)}
            className={cn(
              "group flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs cursor-pointer max-w-[180px] transition-colors",
              t.id === activeId ? "bg-[var(--synnical-surface-2)] text-[var(--synnical-text)]" : "text-[var(--synnical-muted)] hover:bg-[var(--synnical-surface-2)]",
            )}
          >
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate flex-1">{t.title || "New Tab"}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(t.id) }}
              className="opacity-0 group-hover:opacity-100 hover:bg-[#2a2a2a] rounded p-0.5"
              aria-label="Close tab"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        <button onClick={openNewTab} className="p-1.5 hover:bg-[var(--synnical-surface-2)] rounded text-[var(--synnical-muted)] hover:text-[var(--synnical-text)] shrink-0" aria-label="New tab">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Omnibox + controls */}
      <div className={cn("h-11 shrink-0 flex items-center gap-1 px-2 border-b border-[var(--synnical-border)] bg-[var(--synnical-surface)]", embedded && "hidden")}>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={back} disabled={!canGoBack} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={forward} disabled={!canGoForward} aria-label="Forward">
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={reload} disabled={!active.frame} aria-label="Reload">
          <RotateCw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goHome} aria-label="Home">
          <Home className="h-4 w-4" />
        </Button>

        <form className="flex-1 flex items-center" onSubmit={(e) => { e.preventDefault(); navigate(active.input) }}>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--synnical-muted)]" />
            <Input
              value={active.input}
              onChange={(e) => updateTab(active.id, { input: e.target.value })}
              placeholder="Search or enter address"
              className="h-8 pl-8 pr-16 text-sm bg-[var(--synnical-surface-2)] border-[var(--synnical-border)]"
              autoComplete="off"
              spellCheck={false}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {scramjetLoading && <Loader2 className="h-3 w-3 animate-spin text-[var(--synnical-accent)]" />}
              {scramjetReady && <span className="h-2 w-2 rounded-full bg-emerald-400" title="Ready" />}
              {scramjetError && <AlertCircle className="h-3 w-3 text-red-500" />}
            </div>
          </div>
        </form>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void toggleBookmarkSynced()}
          aria-label="Bookmark"
        >
          {bookmarked ? <Star className="h-4 w-4 text-amber-500" /> : <StarOff className="h-4 w-4" />}
        </Button>

        <Popover open={showHistory} onOpenChange={setShowHistory}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="History">
              <Clock className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-1">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-xs font-medium text-[var(--synnical-muted)]">History</span>
              {history.length > 0 && (
                <button onClick={() => void clearHistorySynced()} className="text-[10px] text-[var(--synnical-accent)] hover:underline">Clear all</button>
              )}
            </div>
            <div className="px-2 pb-1"><Input value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} placeholder="Search history" className="h-7 text-xs" /></div>
            <div className="max-h-72 overflow-y-auto">
              {history.length === 0 ? (
                <p className="p-3 text-xs text-[var(--synnical-muted)] text-center">No history yet</p>
              ) : history.filter((h) => !historyQuery.trim() || `${h.title} ${h.url}`.toLowerCase().includes(historyQuery.toLowerCase())).map((h) => (
                <div key={h.id} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--synnical-surface-2)]">
                  <button className="flex-1 min-w-0 text-left" onClick={() => { navigate(h.url); setShowHistory(false) }}>
                    <p className="text-xs truncate">{h.title}</p>
                    <p className="text-[10px] text-[var(--synnical-muted)] truncate">{h.url}</p>
                  </button>
                  <button onClick={() => void removeHistorySynced(h.id)} className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[var(--synnical-surface-2)] rounded">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={popout} disabled={!active.input} aria-label="Pop out">
          <ExternalLink className="h-4 w-4" />
        </Button>

        <Popover open={showSettings} onOpenChange={setShowSettings}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Browser settings">
              <Settings className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-3 space-y-3">
            <p className="text-xs font-semibold uppercase text-[var(--synnical-muted)]">Browser Settings</p>
            <div className="space-y-1.5">
              <p className="text-xs text-[var(--synnical-muted)]">Search engine</p>
              <select
                value={searchEngineId}
                onChange={(e) => { setSearchEngine(e.target.value); setSSearchEngine(e.target.value) }}
                className="w-full h-7 rounded-md bg-[var(--synnical-surface-2)] border border-[var(--synnical-border)] text-xs px-2"
              >
                {SEARCH_ENGINES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-[var(--synnical-muted)]">Theme</p>
              <div className="grid grid-cols-3 gap-1.5">
                {THEMES.slice(0, 6).map((t) => (
                  <button key={t.id} onClick={() => setTheme(t.id)} className={cn("flex flex-col items-center gap-1 p-2 rounded-md border text-[10px]", theme === t.id ? "border-white bg-white text-black" : "border-[var(--synnical-border)] hover:bg-[var(--synnical-surface-2)]")}>
                    <span className="h-4 w-4 rounded-full" style={{ background: t.colors[1] }} />
                    {t.name}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[var(--synnical-muted)] mt-1">More themes in Settings → Appearance</p>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs">Image blur</span>
              <button onClick={() => setImageBlur(!imageBlur)} className={cn("h-5 w-9 rounded-full transition-colors relative", imageBlur ? "bg-[var(--synnical-accent)]" : "bg-[var(--synnical-surface-2)]")}>
                <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform", imageBlur ? "translate-x-4" : "translate-x-0.5")} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs">Anti tab close</span>
              <button onClick={() => setAntiTabClose(!antiTabClose)} className={cn("h-5 w-9 rounded-full transition-colors relative", antiTabClose ? "bg-[var(--synnical-accent)]" : "bg-[var(--synnical-surface-2)]")}>
                <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform", antiTabClose ? "translate-x-4" : "translate-x-0.5")} />
              </button>
            </div>
            <div className="border-t border-[var(--synnical-border)] pt-2 space-y-2">
              <button onClick={() => void toggleTemporaryProfile()} className={cn("flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-xs", temporaryProfile ? "border-purple-400/50 bg-purple-500/10 text-purple-200" : "border-[var(--synnical-border)]")}><span><EyeOff className="mr-1.5 inline h-3.5 w-3.5" />Temporary profile</span><span>{temporaryProfile ? "ON" : "OFF"}</span></button>
              <button onClick={() => void createGroup()} className="flex w-full items-center rounded-md border border-[var(--synnical-border)] px-2 py-1.5 text-xs"><Layers3 className="mr-1.5 h-3.5 w-3.5" />Create tab group</button>
              <div className="space-y-1 rounded-md border border-[var(--synnical-border)] p-2"><p className="text-[10px] font-semibold text-[var(--synnical-muted)]"><PanelsTopLeft className="mr-1 inline h-3 w-3" />Split-screen website</p><select value={splitTabId || ""} onChange={(event) => setSplitTabId(event.target.value || null)} className="w-full rounded border border-[var(--synnical-border)] bg-black p-1 text-xs"><option value="">Off</option>{tabs.filter((tab) => tab.id !== activeId && tab.url).map((tab) => <option key={tab.id} value={tab.id}>{tab.title || tab.url}</option>)}</select></div>
              <div className="space-y-1 rounded-md border border-[var(--synnical-border)] p-2"><p className="text-[10px] font-semibold text-[var(--synnical-muted)]"><Save className="mr-1 inline h-3 w-3" />Workspaces</p><div className="flex gap-1"><button onClick={() => void saveWorkspace()} className="flex-1 rounded border border-[var(--synnical-border)] px-2 py-1 text-[10px]">Save current</button><button onClick={() => void saveWorkspace("school")} className="rounded border border-[var(--synnical-border)] px-2 py-1 text-[10px]">School</button><button onClick={() => void saveWorkspace("gaming")} className="rounded border border-[var(--synnical-border)] px-2 py-1 text-[10px]">Gaming</button></div>{browserFeatures?.workspaces?.length ? <div className="flex gap-1"><select value={workspaceId} onChange={(e)=>setWorkspaceId(e.target.value)} className="min-w-0 flex-1 rounded border border-[var(--synnical-border)] bg-black p-1 text-[10px]"><option value="">Choose saved workspace</option>{browserFeatures.workspaces.map((w:any)=><option key={w.id} value={w.id}>{w.name} · {w.tabs?.length || 0} tabs</option>)}</select><button disabled={!workspaceId} onClick={()=>loadWorkspace(workspaceId)} className="rounded border border-[var(--synnical-border)] px-2 text-[10px] disabled:opacity-30">Load</button><button disabled={!workspaceId} onClick={async()=>{await featureApi.browser.action("delete-workspace",{id:workspaceId});setWorkspaceId("");refreshBrowserFeatures()}} className="rounded border border-red-500/20 px-2 text-[10px] text-red-300 disabled:opacity-30">×</button></div> : null}</div>
              {active.url && (() => { const permission = permissionFor(active.url) || { popups: "ask", notifications: "ask", storage: "allow" }; return <div className="space-y-1 rounded-md border border-[var(--synnical-border)] p-2"><p className="truncate text-[10px] font-semibold">Site permissions · {(() => { try { return new URL(active.url!).hostname } catch { return "site" } })()}</p>{([['popups','Popups',['ask','allow','block']],['notifications','Notifications',['ask','allow','block']],['storage','Storage',['allow','block']]] as const).map(([field,label,options]) => <label key={field} className="flex items-center justify-between gap-2 text-[10px]"><span>{label}</span><select value={permission[field]} onChange={(event) => void setSitePermission(field, event.target.value)} className="rounded border border-[var(--synnical-border)] bg-black px-1 py-0.5">{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>)}</div> })()}
              {browserGroups.length > 0 && <div className="space-y-1"><p className="text-[10px] font-semibold text-[var(--synnical-muted)]">Active tab group</p><select value={active.groupId || ""} onChange={(event) => updateTab(active.id, { groupId: event.target.value || null })} className="w-full rounded border border-[var(--synnical-border)] bg-black p-1 text-xs"><option value="">No group</option>{browserGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></div>}
              {browserFeatures?.downloads?.length > 0 && <div className="max-h-24 overflow-y-auto rounded-md border border-[var(--synnical-border)] p-1"><p className="px-1 text-[10px] font-semibold text-[var(--synnical-muted)]"><Download className="mr-1 inline h-3 w-3" />Recent downloads</p>{browserFeatures.downloads.slice(0,5).map((download: any) => { const total = Number(download.bytesTotal || 0); const received = Number(download.bytesReceived || 0); const pct = total > 0 ? Math.min(100, Math.round(received / total * 100)) : null; return <div key={download.id} className="px-1 py-1 text-[10px]"><div className="flex justify-between gap-2"><span className="truncate">{download.filename}</span><span className="shrink-0 text-[var(--synnical-muted)]">{download.status}{pct !== null && download.status === "started" ? ` · ${pct}%` : ""}</span></div>{download.status === "started" && <div className="mt-1 h-1 overflow-hidden rounded bg-white/10"><div className="h-full bg-white transition-[width]" style={{ width: `${pct ?? 8}%` }} /></div>}{download.error && <p className="mt-0.5 truncate text-[9px] text-amber-300" title={download.error}>{download.error}</p>}</div> })}</div>}
            </div>
          </PopoverContent>
        </Popover>

      </div>

      {/* Bookmarks bar */}
      <div className={cn("h-7 shrink-0 flex items-center gap-1 px-1 border-b border-[var(--synnical-border)] bg-[var(--synnical-surface)]", embedded && "hidden")}>
        <button onClick={() => setBookmarksBarCollapsed(!bookmarksBarCollapsed)} className="text-gray-500 hover:text-white p-1 shrink-0" aria-label="Toggle bookmarks bar">
          {bookmarksBarCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {!bookmarksBarCollapsed && (
          <div className="flex items-center gap-1 overflow-x-auto custom-scroll flex-1">
            {bookmarks.length === 0 ? (
              <span className="text-[10px] text-gray-600 px-1">No bookmarks yet</span>
            ) : bookmarks.map((b) => (
              <button key={b.id} onClick={() => navigate(b.url)} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded hover:bg-[var(--synnical-surface-2)] whitespace-nowrap text-gray-400 hover:text-white group">
                <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>{b.title}</span>
                <span onClick={(e) => { e.stopPropagation(); removeBookmark(b.id) }} className="opacity-0 group-hover:opacity-100 hover:text-red-400 cursor-pointer">
                  <X className="h-2.5 w-2.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Viewport — Scramjet proxy area */}
      <div className="flex-1 relative min-h-0" ref={viewportRef}>
        {splitTab && <div className="pointer-events-none absolute bottom-0 left-1/2 top-0 z-20 w-px bg-white/15" />}
        {!active.url && (
          <NewTabPage
            onNavigate={navigate}
            bookmarks={bookmarks}
            scramjetStatus={ctrlStatus}
            scramjetError={ctrlError}
            onRetry={retry}
            searchEngineId={searchEngineId}
            setSearchEngine={(id) => { setSearchEngine(id); setSSearchEngine(id) }}
          />
        )}

        {active.url && loading && !active.frame && !frameError && !scramjetError && (
          <div className="absolute inset-0 z-30 grid place-items-center bg-black text-center">
            <div className="max-w-xs px-6">
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-white" />
              <p className="mt-3 text-sm font-medium text-white/85">Loading {embeddedLabel}</p>
              <p className="mt-1 text-xs text-white/45">Starting the secure in-app connection…</p>
            </div>
          </div>
        )}

        {/* Scramjet init error or frame error overlay */}
        {((scramjetError && active.url) || frameError) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black z-40">
            <div className="max-w-md text-center p-6">
              <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-[var(--synnical-text)] mb-1">
                {embedded ? "This page could not load" : frameError ? "Navigation error" : "Proxy failed to start"}
              </h3>
              <p className="text-xs text-[var(--synnical-muted)] mb-4">{embedded ? "Retry this page. If it keeps failing, the provider may be temporarily unavailable." : frameError || ctrlError}</p>
              <div className="flex gap-2 justify-center">
                {frameError && (
                  <Button size="sm" variant="outline" onClick={() => { setFrameError(null); navigate(active.input) }}>
                    Retry navigation
                  </Button>
                )}
                {!frameError && (
                  <Button size="sm" variant="outline" onClick={retry}>Retry proxy</Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function NewTabPage({
  onNavigate, bookmarks,
  scramjetStatus, scramjetError, onRetry,
  searchEngineId, setSearchEngine,
}: {
  onNavigate: (url: string) => void
  bookmarks: { id: string; title: string; url: string }[]
  scramjetStatus: "idle" | "loading" | "ready" | "error"
  scramjetError?: string
  onRetry: () => void
  searchEngineId: string
  setSearchEngine: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(now)
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now)

  return (
    <div className="browser-home absolute inset-0 z-30 h-full overflow-y-auto text-white">
      <main className="browser-newtab relative mx-auto flex min-h-full w-full max-w-5xl items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-3xl">
          <div className="text-center">
            <p className="browser-clock text-[clamp(3.6rem,10vw,7.2rem)] font-light leading-none tracking-[-0.065em] text-white">{time}</p>
            <p className="mt-2 text-[13px] text-[#777777]">{date}</p>
          </div>

          <form className="mx-auto mt-8 max-w-2xl" onSubmit={(event) => { event.preventDefault(); onNavigate(query) }}>
            <div className="browser-search relative focus-within:border-white">
              <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/38" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or enter an address" className="h-[52px] border-0 bg-transparent pl-11 pr-14 text-[15px] shadow-none focus-visible:ring-0" autoFocus />
              <button type="submit" className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white text-black transition-colors hover:bg-[#e8e8e8]" aria-label="Search">
                <Search className="h-4 w-4" />
              </button>
            </div>
          </form>

          <div className="mt-3 flex items-center justify-center gap-1" aria-label="Choose a search engine">
            {SEARCH_ENGINES.filter((engine) => ["duckduckgo", "brave", "google"].includes(engine.id)).map((engine) => (
              <button key={engine.id} type="button" onClick={() => setSearchEngine(engine.id)} title={`Use ${engine.name}`} className={cn(
                "browser-engine flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors",
                searchEngineId === engine.id ? "is-active border-white text-white bg-[#111111]" : "border-transparent text-white/45 hover:text-white/80",
              )}>
                <span className="grid h-5 w-5 place-items-center rounded-full bg-white"><img src={searchEngineMark(engine.id)} alt="" className="h-3.5 w-3.5 object-contain" /></span>
                <span className="hidden sm:inline">{engine.name}</span>
              </button>
            ))}
          </div>

          <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer" className="browser-community-link mx-auto mt-6 flex w-fit items-center gap-2.5 rounded-full px-4 py-2 text-sm font-medium text-white">
            <DiscordLogo className="h-5 w-5 shrink-0" />
            <span>Join LUCIDE Discord</span>
            <ExternalLink className="h-3.5 w-3.5 opacity-55" />
          </a>

          <section className="mx-auto mt-7 max-w-2xl" aria-labelledby="shortcut-heading">
            <h2 id="shortcut-heading" className="sr-only">Shortcuts</h2>
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-4 sm:gap-x-5">
              {QUICK_LINKS.map((link) => (
                <button key={link.url} onClick={() => onNavigate(link.url)} className="browser-shortcut group flex w-[66px] min-w-0 flex-col items-center gap-2" title={link.name}>
                  <span className="browser-shortcut-icon grid h-11 w-11 place-items-center rounded-[14px]">
                    <img src={link.thumbnail} alt="" className="h-[21px] w-[21px] object-contain brightness-0 invert opacity-90 group-hover:opacity-100" loading="eager" />
                  </span>
                  <span className="w-full truncate text-center text-[10px] text-white/55 group-hover:text-white/90">{link.name}</span>
                </button>
              ))}
            </div>
          </section>

          {bookmarks.length > 0 && (
            <section className="mx-auto mt-8 max-w-2xl border-t border-white/[0.07] pt-4" aria-labelledby="bookmark-heading">
              <h2 id="bookmark-heading" className="mb-2 text-center text-[10px] font-medium uppercase tracking-[0.16em] text-white/30">Bookmarks</h2>
              <div className="flex flex-wrap justify-center gap-1.5">
                {bookmarks.map((bookmark) => (
                  <button key={bookmark.id} onClick={() => onNavigate(bookmark.url)} className="flex max-w-40 items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.035] px-3 py-1.5 text-xs text-white/55 hover:bg-white/[0.07] hover:text-white">
                    <Star className="h-3 w-3 shrink-0 text-white/65" />
                    <span className="truncate">{bookmark.title}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {scramjetStatus === "loading" && <div className="mx-auto mt-5 h-0.5 w-24 overflow-hidden rounded bg-white/10"><span className="block h-full w-1/2 animate-pulse rounded bg-white" /></div>}
          {scramjetStatus === "error" && (
            <div className="mx-auto mt-5 max-w-lg rounded-lg border border-red-400/20 bg-red-500/10 px-4 py-3 text-center text-xs text-red-200">
              Couldn’t start the browser. <button onClick={onRetry} className="font-semibold underline">Try again</button>
              {scramjetError && <p className="mt-1 break-words text-[10px] text-white/40">{scramjetError}</p>}
            </div>
          )}
        </div>
      </main>
      </div>
  )
}
