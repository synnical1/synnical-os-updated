"use client"

import { useEffect, useState, lazy, Suspense, type ComponentType } from "react"
import { TopBar } from "@/components/top-bar"
import { ErrorBoundary, useGlobalErrorHandler } from "@/components/error-boundary"
import { MessageSquare, Globe, User, Settings, Shield, Music, Bot, Mailbox, Gamepad2, ShoppingCart, PanelLeftClose, Clapperboard, Search, FlaskConical, PanelsTopLeft, ShoppingBasket, Workflow, PhoneCall, Code2, Folder, Monitor, Cloud, Tv } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/hooks/use-auth"
import { readSetting, writeSetting } from "@/lib/settings-runtime"
import { AuthScreen } from "@/components/auth-screen"
import { PresenceBridge } from "@/components/presence-bridge"
import { AutomationBridge } from "@/components/automation-bridge"
import { CommandPalette } from "@/components/command-palette"
import { DesktopShell } from "@/components/desktop-shell"
import { SecuritySetupScreen } from "@/components/security-setup-screen"
import { YouTubeIcon, GeForceNowIcon } from "@/components/brand-app-icons"
import { hydrateOsSettings } from "@/lib/os-settings"

// Lazy load panels — only load what the user actually opens
const DiscoveryPanel = lazy(() => import("@/components/discovery-panel").then(m => ({ default: m.DiscoveryPanel })))
const ChatPanel = lazy(() => import("@/components/chat-panel").then(m => ({ default: m.ChatPanel })))
const FriendsPanel = lazy(() => import("@/components/friends-panel").then(m => ({ default: m.FriendsPanel })))
const TempMailPanel = lazy(() => import("@/components/temp-mail-panel").then(m => ({ default: m.TempMailPanel })))
const ProfilePanel = lazy(() => import("@/components/profile-panel").then(m => ({ default: m.ProfilePanel })))
const SynnicalSettingsApp = lazy(() => import("@/components/synnical-settings-app").then(m => ({ default: m.SynnicalSettingsApp })))
const SynnicalFilesPanel = lazy(() => import("@/components/synnical-files-panel").then(m => ({ default: m.SynnicalFilesPanel })))
const MusicPanel = lazy(() => import("@/components/music-panel").then(m => ({ default: m.MusicPanel })))
const AIPanel = lazy(() => import("@/components/ai-panel").then(m => ({ default: m.AIPanel })))
const ShopPanel = lazy(() => import("@/components/shop-panel").then(m => ({ default: m.ShopPanel })))
const GamesPanel = lazy(() => import("@/components/games-panel").then(m => ({ default: m.GamesPanel })))
const StaffAccountsPanel = lazy(() => import("@/components/staff-accounts-panel").then(m => ({ default: m.StaffAccountsPanel })))
const SynnFlixPanel = lazy(() => import("@/components/synnflix-panel").then(m => ({ default: m.SynnFlixPanel })))
const SynnimePanel = lazy(() => import("@/components/synnime-panel").then(m => ({ default: m.SynnimePanel })))
const SynnDrivePanel = lazy(() => import("@/components/synn-drive-panel").then(m => ({ default: m.SynnDrivePanel })))
const SynnicalLabPanel = lazy(() => import("@/components/synnical-lab-panel").then(m => ({ default: m.SynnicalLabPanel })))
const SpacesPanel = lazy(() => import("@/components/spaces-panel").then(m => ({ default: m.SpacesPanel })))
const MarketPanel = lazy(() => import("@/components/market-panel").then(m => ({ default: m.MarketPanel })))
const AutomationsPanel = lazy(() => import("@/components/automations-panel").then(m => ({ default: m.AutomationsPanel })))
const CreatorStudioPanel = lazy(() => import("@/components/creator-studio-panel").then(m => ({ default: m.CreatorStudioPanel })))
const CallsPanel = lazy(() => import("@/components/calls-panel").then(m => ({ default: m.CallsPanel })))
const DeveloperPanel = lazy(() => import("@/components/developer-panel").then(m => ({ default: m.DeveloperPanel })))
const YouTubePanel = lazy(() => import("@/components/youtube-panel").then(m => ({ default: m.YouTubePanel })))
const GeForceNowPanel = lazy(() => import("@/components/geforce-now-panel").then(m => ({ default: m.GeForceNowPanel })))
const LinuxVmPanel = lazy(() => import("@/components/linux-vm-panel").then(m => ({ default: m.LinuxVmPanel })))
// BrowserPanel loaded directly (was causing issues with lazy loading)
import { BrowserPanel } from "@/components/browser-panel"

export type Panel = "discover" | "chat" | "friends" | "moderation" | "temp-mail" | "browser" | "music" | "ai" | "games" | "shop" | "profile" | "settings" | "movies" | "synnime" | "drive" | "lab" | "spaces" | "market" | "automations" | "creator" | "calls" | "developer" | "files" | "youtube" | "geforce-now" | "linux-vm" | "auth"

const APP_NAV: { id: Panel; label: string; icon: ComponentType<{ className?: string }>; modOnly?: boolean; authOnly?: boolean; labOnly?: boolean }[] = [
  { id: "discover", label: "Search", icon: Search, authOnly: true },
  { id: "browser", label: "Browser", icon: Globe },
  { id: "games", label: "Games", icon: Gamepad2 },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "movies", label: "SynnFlix", icon: Clapperboard },
  { id: "synnime", label: "Synnime", icon: Tv },
  { id: "music", label: "Music", icon: Music },
  { id: "ai", label: "AI Assistant", icon: Bot },
  { id: "youtube", label: "YouTube", icon: YouTubeIcon },
  { id: "geforce-now", label: "GeForce NOW", icon: GeForceNowIcon },
  { id: "linux-vm", label: "Synn VM", icon: Monitor, authOnly: true },
  { id: "drive", label: "Synn Drive", icon: Cloud, authOnly: true },
  { id: "files", label: "Synnical Files", icon: Folder, authOnly: true },
  { id: "spaces", label: "Spaces", icon: PanelsTopLeft, authOnly: true },
  { id: "calls", label: "Calls", icon: PhoneCall, authOnly: true },
  { id: "automations", label: "Automations", icon: Workflow, authOnly: true },
  { id: "temp-mail", label: "Temp Mail", icon: Mailbox },
  { id: "shop", label: "Shop", icon: ShoppingCart, authOnly: true },
  { id: "market", label: "Marketplace", icon: ShoppingBasket, authOnly: true },
  { id: "developer", label: "Developer", icon: Code2, authOnly: true },
  { id: "moderation", label: "Moderation", icon: Shield, modOnly: true },
  { id: "lab", label: "Synnical Lab", icon: FlaskConical, authOnly: true, labOnly: true },
  { id: "profile", label: "Profile", icon: User, authOnly: true },
  { id: "settings", label: "Settings", icon: Settings, authOnly: true },
]

// Classic mode keeps a short rail. OS mode uses desktop icons, Start and the
// taskbar, so every permitted app can be a first-class application there.
const CORE_NAV = new Set<Panel>(["discover", "browser", "games", "chat", "movies", "synnime", "music", "ai", "linux-vm"])

// Track which panels have been mounted at least once so we only mount
// a panel after the user first opens it (lazy mounting). Once mounted,
// the panel stays mounted but is hidden via CSS — preserving its state
// (game progress, scroll position, form input, iframe state, etc.)
function usePanelMountState() {
  // Chat mounts in the background after authentication so its live socket can
  // count messages even while another panel is open.
  const [mounted, setMounted] = useState<Set<Panel>>(new Set(["browser" as Panel, "chat" as Panel]))
  const markMounted = (p: Panel) => {
    setMounted((prev) => {
      if (prev.has(p)) return prev
      const next = new Set(prev)
      next.add(p)
      return next
    })
  }
  return { mounted, markMounted }
}

export function AppShell() {
  const [panel, setPanel] = useState<Panel>("browser")
  const { mounted, markMounted } = usePanelMountState()
  const { user } = useAuth()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSetting("layout.sidebarCollapsed", false))
  const [gameFocus, setGameFocus] = useState(false)
  const [chatUnread, setChatUnread] = useState(0)
  const [labVisible, setLabVisible] = useState(false)
  const [osMode, setOsMode] = useState(readSetting("layout.osMode", true))

  // Catch global unhandled errors and promise rejections
  useGlobalErrorHandler()

  const isMod = user?.role === "OWNER" || user?.role === "HEAD_ADMIN" || user?.role === "ADMIN" || user?.role === "MOD"
  const gameFocusVisible = gameFocus && (panel === "games" || panel === "geforce-now")
  const visibleApps = APP_NAV.filter((item) => (!item.modOnly || isMod) && (!item.authOnly || Boolean(user)) && (!item.labOnly || labVisible))
  const visibleNav = visibleApps.filter((item) => CORE_NAV.has(item.id))

  useEffect(() => {
    if (!user || panel !== "auth") return
    markMounted("profile")
    setPanel("profile")
  }, [user, panel]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) { setLabVisible(false); return }
    let cancelled = false
    fetch("/api/features/lab", { credentials: "include", cache: "no-store" })
      .then(async (res) => res.ok ? res.json() : null)
      .then((body) => { if (!cancelled) setLabVisible(Boolean(body?.eligible || body?.admin)) })
      .catch(() => { if (!cancelled) setLabVisible(false) })
    return () => { cancelled = true }
  }, [user?.id])

  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: unknown }>).detail
      if (detail?.key === "layout.osMode") setOsMode(readSetting("layout.osMode", true))
    }
    window.addEventListener("synnical-setting-changed", changed)
    return () => window.removeEventListener("synnical-setting-changed", changed)
  }, [])

  // Synnical OS is the default experience. Signed-in users sync the same OS
  // preference through the account-backed OS settings endpoint; Classic remains
  // a deliberate fallback, not the default shell.
  useEffect(() => {
    if (!user) {
      const local = readSetting("layout.osMode", true)
      setOsMode(local)
      return
    }
    let cancelled = false
    hydrateOsSettings().then((settings) => {
      if (cancelled) return
      const enabled = settings.enabled !== false
      writeSetting("layout.osMode", enabled)
      setOsMode(enabled)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [user?.id])

  const switchPanel = (p: Panel) => {
    markMounted(p)
    setPanel(p)
  }

  // Other tools (for example Music) can hand a URL to the real proxied
  // Browser without opening a new top-level tab.
  useEffect(() => {
    const openBrowser = (event: Event) => {
      const detail = (event as CustomEvent<{ value?: unknown; url?: unknown; href?: unknown }>).detail
      const value = detail?.value ?? detail?.url ?? detail?.href
      if (typeof value !== "string" || !value.trim()) return
      markMounted("browser")
      setPanel("browser")
      window.dispatchEvent(new CustomEvent("synnical-open-panel", { detail: { panel: "browser" } }))
      requestAnimationFrame(() => {
        window.dispatchEvent(new CustomEvent("synnical-browser-navigate", { detail: { value } }))
      })
    }
    window.addEventListener("synnical-open-browser", openBrowser)
    return () => window.removeEventListener("synnical-open-browser", openBrowser)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const openPanel = (event: Event) => {
      const requested = (event as CustomEvent<{ panel?: unknown }>).detail?.panel
      if (typeof requested !== "string") return
      const target = requested as Panel
      const targetNav = APP_NAV.find((item) => item.id === target)
      if (!targetNav) return
      if (targetNav.modOnly && !isMod) return
      if (targetNav.authOnly && !user) return
      if (targetNav.labOnly && !labVisible) return
      markMounted(target)
      setPanel(target)
    }
    window.addEventListener("synnical-open-panel", openPanel)
    return () => window.removeEventListener("synnical-open-panel", openPanel)
  }, [isMod, user, labVisible]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (event: Event) => setGameFocus(Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active))
    window.addEventListener("synnical-game-focus", handler)
    return () => window.removeEventListener("synnical-game-focus", handler)
  }, [])

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      const navigationType = typeof performance !== "undefined"
        ? (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type
        : undefined
      if (!event.persisted && navigationType !== "back_forward") return
      setPanel("browser")
      markMounted("browser")
      window.dispatchEvent(new CustomEvent("synnical-browser-reset"))
    }
    window.addEventListener("pageshow", onPageShow)
    return () => window.removeEventListener("pageshow", onPageShow)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.synnicalPanel = panel
    window.dispatchEvent(new CustomEvent("synnical-panel-changed", { detail: { panel } }))
    window.dispatchEvent(new CustomEvent("synnical-chat-visibility", {
      detail: { visible: panel === "chat" && document.visibilityState === "visible" },
    }))
  }, [panel])

  useEffect(() => {
    const receiveUnread = (event: Event) => {
      const value = Number((event as CustomEvent<{ total?: unknown }>).detail?.total)
      setChatUnread(Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0)
    }
    const visibility = () => window.dispatchEvent(new CustomEvent("synnical-chat-visibility", {
      detail: { visible: panel === "chat" && document.visibilityState === "visible" },
    }))
    window.addEventListener("synnical-chat-unread", receiveUnread)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      window.removeEventListener("synnical-chat-unread", receiveUnread)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [panel])

  const renderDesktopPanel = (target: Panel, openPanel: (target: Panel) => void) => (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--synnical-accent)] border-t-transparent" /></div>}>
      {target === "discover" ? <ErrorBoundary name="Search"><DiscoveryPanel onPanel={openPanel} /></ErrorBoundary> : null}
      {target === "chat" ? <ErrorBoundary name="Chat">{user ? <ChatPanel /> : <AuthScreen embedded />}</ErrorBoundary> : null}
      {target === "friends" ? <ErrorBoundary name="Friends"><FriendsPanel /></ErrorBoundary> : null}
      {target === "spaces" ? <ErrorBoundary name="Spaces"><SpacesPanel /></ErrorBoundary> : null}
      {target === "moderation" && isMod ? <ErrorBoundary name="Moderation"><StaffAccountsPanel /></ErrorBoundary> : null}
      {target === "temp-mail" ? <ErrorBoundary name="Temp Mail"><TempMailPanel /></ErrorBoundary> : null}
      {target === "browser" ? <ErrorBoundary name="Browser"><BrowserPanel /></ErrorBoundary> : null}
      {target === "movies" ? <ErrorBoundary name="SynnFlix"><SynnFlixPanel /></ErrorBoundary> : null}
      {target === "synnime" ? <ErrorBoundary name="Synnime"><SynnimePanel /></ErrorBoundary> : null}
      {target === "music" ? <ErrorBoundary name="Music"><MusicPanel /></ErrorBoundary> : null}
      {target === "ai" ? <ErrorBoundary name="AI"><AIPanel /></ErrorBoundary> : null}
      {target === "automations" ? <ErrorBoundary name="Automations"><AutomationsPanel /></ErrorBoundary> : null}
      {target === "games" ? <ErrorBoundary name="Games"><GamesPanel /></ErrorBoundary> : null}
      {target === "market" ? <ErrorBoundary name="Marketplace"><MarketPanel /></ErrorBoundary> : null}
      {target === "creator" ? <ErrorBoundary name="Creator Studio"><CreatorStudioPanel /></ErrorBoundary> : null}
      {target === "calls" ? <ErrorBoundary name="Calls"><CallsPanel /></ErrorBoundary> : null}
      {target === "developer" ? <ErrorBoundary name="Developer"><DeveloperPanel /></ErrorBoundary> : null}
      {target === "youtube" ? <ErrorBoundary name="YouTube"><YouTubePanel /></ErrorBoundary> : null}
      {target === "geforce-now" ? <ErrorBoundary name="GeForce NOW"><GeForceNowPanel /></ErrorBoundary> : null}
      {target === "linux-vm" ? <ErrorBoundary name="Synn VM"><LinuxVmPanel /></ErrorBoundary> : null}
      {target === "drive" ? <ErrorBoundary name="Synn Drive"><SynnDrivePanel /></ErrorBoundary> : null}
      {target === "files" ? <ErrorBoundary name="Synnical Files"><SynnicalFilesPanel /></ErrorBoundary> : null}
      {target === "shop" ? <ErrorBoundary name="Shop"><ShopPanel /></ErrorBoundary> : null}
      {target === "profile" ? <ErrorBoundary name="Profile"><ProfilePanel /></ErrorBoundary> : null}
      {target === "auth" ? <ErrorBoundary name="Authentication"><AuthScreen embedded /></ErrorBoundary> : null}
      {target === "lab" && labVisible ? <ErrorBoundary name="Synnical Lab"><SynnicalLabPanel /></ErrorBoundary> : null}
      {target === "settings" ? <ErrorBoundary name="Synnical Settings"><SynnicalSettingsApp /></ErrorBoundary> : null}
    </Suspense>
  )

  if (user?.securitySetupRequired) return <SecuritySetupScreen />

  return (
    <>
      <PresenceBridge />
      <AutomationBridge />
      <CommandPalette />
      {osMode ? (
        <DesktopShell
          apps={visibleApps}
          renderPanel={renderDesktopPanel}
          onActivePanel={(active) => setPanel(active)}
        />
      ) : <div className={cn("synnical-shell flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col bg-black relative isolate overflow-hidden", gameFocusVisible && "game-focus-mode")}>
      <div className="synnical-starfield" aria-hidden="true" />
      <div className="synnical-meteors" aria-hidden="true"><span /><span /><span /><span /><span /><span /></div>
      {!gameFocusVisible && <TopBar panel={panel} onPanel={switchPanel} onDesktop={() => { writeSetting("layout.osMode", true); setOsMode(true) }} />}

      <div className="relative z-10 flex-1 flex min-h-0">
        {/* Icon rail — the collapse button is the single source of truth. */}
        <nav className={cn("synnical-side-rail min-h-0 shrink-0 border-r border-[var(--synnical-border)] bg-black flex flex-col items-center py-2 gap-0.5 overflow-hidden transition-all", gameFocusVisible && "hidden", sidebarCollapsed ? "w-14" : "")} style={!sidebarCollapsed ? { width: "60px" } : undefined} aria-label="Main navigation">
          {/* Collapse toggle button */}
          <button
            onClick={() => { setSidebarCollapsed(!sidebarCollapsed); writeSetting("layout.sidebarCollapsed", !sidebarCollapsed) }}
            className="mb-1 text-[var(--synnical-muted)] hover:text-[var(--synnical-accent)] p-1"
            aria-label="Toggle sidebar"
          >
            <PanelLeftClose className={cn("h-3.5 w-3.5", sidebarCollapsed && "rotate-180")} />
          </button>
          {visibleNav.map((item) => {
            const Icon = item.icon
            const active = panel === item.id
            return (
              <button
                key={item.id}
                onClick={() => switchPanel(item.id)}
                aria-label={item.label}
                title={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "synnical-nav-button group relative flex items-center justify-center h-9 w-10 rounded-lg transition-colors",
                  active ? "bg-white text-black" : "text-[#9b9b9b] hover:bg-[#111111] hover:text-white"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.id === "chat" && chatUnread > 0 && (
                  <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white shadow-[0_0_8px_rgba(239,68,68,.65)]">
                    {chatUnread > 99 ? "99+" : chatUnread}
                  </span>
                )}
                <span className="pointer-events-none absolute left-full ml-2 rounded-md border border-[var(--synnical-border)] bg-[var(--synnical-surface-2)] px-2 py-1 text-[11px] text-[var(--synnical-text)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 whitespace-nowrap z-50">{item.label}</span>
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 bg-white" />
                )}
              </button>
            )
          })}
        </nav>

        {/* Panel content — all mounted panels stay in DOM, hidden via CSS */}
        <main className="synnical-main flex-1 min-w-0 min-h-0 overflow-hidden relative">
          <Suspense fallback={<div className="flex items-center justify-center h-full"><div className="h-6 w-6 border-2 border-[var(--synnical-accent)] border-t-transparent rounded-full animate-spin" /></div>}>
            {/* Each panel is always rendered once mounted, but hidden when inactive */}
            <div className={cn("absolute inset-0", panel === "discover" ? "block" : "hidden")}>
              {mounted.has("discover") && <ErrorBoundary name="Search"><DiscoveryPanel onPanel={switchPanel} /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "chat" ? "block" : "hidden")}>
              {mounted.has("chat") && <ErrorBoundary name="Chat">{user ? <ChatPanel /> : <AuthScreen embedded />}</ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "friends" ? "block" : "hidden")}>
              {mounted.has("friends") && <ErrorBoundary name="Friends"><FriendsPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "spaces" ? "block" : "hidden")}>
              {mounted.has("spaces") && <ErrorBoundary name="Spaces"><SpacesPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "moderation" && isMod ? "block" : "hidden")}>
              {mounted.has("moderation") && isMod && <ErrorBoundary name="Moderation"><StaffAccountsPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "temp-mail" ? "block" : "hidden")}>
              {mounted.has("temp-mail") && <ErrorBoundary name="Temp Mail"><TempMailPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "browser" ? "block" : "hidden")}>
              {mounted.has("browser") && <ErrorBoundary name="Browser"><BrowserPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "movies" ? "block" : "hidden")}>
              {mounted.has("movies") && <ErrorBoundary name="SynnFlix"><SynnFlixPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "synnime" ? "block" : "hidden")}>
              {mounted.has("synnime") && <ErrorBoundary name="Synnime"><SynnimePanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "music" ? "block" : "hidden")}>
              {mounted.has("music") && <ErrorBoundary name="Music"><MusicPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "ai" ? "block" : "hidden")}>
              {mounted.has("ai") && <ErrorBoundary name="AI"><AIPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "automations" ? "block" : "hidden")}>
              {mounted.has("automations") && <ErrorBoundary name="Automations"><AutomationsPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "games" ? "block" : "hidden")}>
              {mounted.has("games") && <ErrorBoundary name="Games"><GamesPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "market" ? "block" : "hidden")}>
              {mounted.has("market") && <ErrorBoundary name="Marketplace"><MarketPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "creator" ? "block" : "hidden")}>
              {mounted.has("creator") && <ErrorBoundary name="Creator Studio"><CreatorStudioPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "calls" ? "block" : "hidden")}>
              {mounted.has("calls") && <ErrorBoundary name="Calls"><CallsPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "developer" ? "block" : "hidden")}>
              {mounted.has("developer") && <ErrorBoundary name="Developer"><DeveloperPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "youtube" ? "block" : "hidden")}>
              {mounted.has("youtube") && <ErrorBoundary name="YouTube"><YouTubePanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "geforce-now" ? "block" : "hidden")}>
              {mounted.has("geforce-now") && <ErrorBoundary name="GeForce NOW"><GeForceNowPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "linux-vm" ? "block" : "hidden")}>
              {mounted.has("linux-vm") && <ErrorBoundary name="Synn VM"><LinuxVmPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "drive" ? "block" : "hidden")}>
              {mounted.has("drive") && <ErrorBoundary name="Synn Drive"><SynnDrivePanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "files" ? "block" : "hidden")}>
              {mounted.has("files") && <ErrorBoundary name="Synnical Files"><SynnicalFilesPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "shop" ? "block" : "hidden")}>
              {mounted.has("shop") && <ErrorBoundary name="Shop"><ShopPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "profile" ? "block" : "hidden")}>
              {mounted.has("profile") && <ErrorBoundary name="Profile"><ProfilePanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "auth" ? "block" : "hidden")}>
              {mounted.has("auth") && <ErrorBoundary name="Authentication"><AuthScreen embedded /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "lab" && labVisible ? "block" : "hidden")}>
              {mounted.has("lab") && labVisible && <ErrorBoundary name="Synnical Lab"><SynnicalLabPanel /></ErrorBoundary>}
            </div>
            <div className={cn("absolute inset-0", panel === "settings" ? "block" : "hidden")}>
              {mounted.has("settings") && <ErrorBoundary name="Synnical Settings"><SynnicalSettingsApp /></ErrorBoundary>}
            </div>
          </Suspense>
        </main>
      </div>

      </div>}
    </>
  )
}
