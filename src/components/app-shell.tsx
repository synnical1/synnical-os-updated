"use client"

import { startChatRealtime } from "@/lib/chat-realtime"
import { ImageViewer } from "./image-viewer"
import { useEffect, useState, lazy, Suspense, type ComponentType } from "react"
import { ErrorBoundary, useGlobalErrorHandler } from "@/components/error-boundary"
import { MessageSquare, Globe, User, Settings, Shield, Music, Bot, Mailbox, Gamepad2, ShoppingCart, PanelLeftClose, Clapperboard, Search, FlaskConical, PanelsTopLeft, ShoppingBasket, Workflow, PhoneCall, Code2, Folder, Monitor, Cloud, Tv } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { AuthScreen } from "@/components/auth-screen"
import { PresenceBridge } from "@/components/presence-bridge"
import { AutomationBridge } from "@/components/automation-bridge"
import { CommandPalette } from "@/components/command-palette"
import { DesktopShell } from "@/components/desktop-shell"
import { YouTubeIcon, GeForceNowIcon } from "@/components/brand-app-icons"

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
const CineBPanel = lazy(() => import("@/components/cineb-panel").then(m => ({ default: m.CineBPanel })))
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

export type Panel = "discover" | "chat" | "friends" | "moderation" | "temp-mail" | "browser" | "music" | "ai" | "games" | "shop" | "profile" | "settings" | "movies" | "cineb" | "synnime" | "drive" | "lab" | "spaces" | "market" | "automations" | "creator" | "calls" | "developer" | "files" | "youtube" | "geforce-now" | "linux-vm" | "auth"

const SAFE_MODE_APPS = new Set<Panel>(["settings", "files", "profile", "auth"])

const APP_NAV: { id: Panel; label: string; icon: ComponentType<{ className?: string }>; modOnly?: boolean; authOnly?: boolean; labOnly?: boolean }[] = [
  { id: "discover", label: "Search", icon: Search, authOnly: true },
  { id: "browser", label: "Browser", icon: Globe },
  { id: "games", label: "Games", icon: Gamepad2 },
  { id: "friends", label: "Friends", icon: User, authOnly: true },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "movies", label: "SynnFlix", icon: Clapperboard },
  { id: "cineb", label: "SynnFlix CineB", icon: Clapperboard },
  { id: "synnime", label: "Synnime", icon: Tv },
  { id: "music", label: "Music", icon: Music },
  { id: "ai", label: "AI Assistant", icon: Bot },
  { id: "youtube", label: "YouTube", icon: YouTubeIcon },
  { id: "geforce-now", label: "GeForce NOW", icon: GeForceNowIcon },
  { id: "linux-vm", label: "SynnVM", icon: Monitor, authOnly: true },
  { id: "drive", label: "Synn Drive", icon: Cloud, authOnly: true },
  { id: "files", label: "Synnical Files", icon: Folder, authOnly: true },
  { id: "spaces", label: "Spaces", icon: PanelsTopLeft, authOnly: true },
  { id: "calls", label: "Calls", icon: PhoneCall, authOnly: true },
  { id: "automations", label: "Automations", icon: Workflow, authOnly: true },
  { id: "temp-mail", label: "Temp Mail", icon: Mailbox },
  { id: "shop", label: "Shop", icon: ShoppingCart, authOnly: true },
  { id: "market", label: "Marketplace", icon: ShoppingBasket, authOnly: true },
  { id: "creator", label: "Creator Studio", icon: PanelsTopLeft, authOnly: true },
  { id: "developer", label: "Developer", icon: Code2, authOnly: true },
  { id: "moderation", label: "User Management", icon: Shield, modOnly: true },
  { id: "lab", label: "Synnical Lab", icon: FlaskConical, authOnly: true, labOnly: true },
  { id: "profile", label: "Profile", icon: User, authOnly: true },
  { id: "settings", label: "Settings", icon: Settings, authOnly: true },
]

export function AppShell() {
  const [bootMode, setBootMode] = useState<"normal" | "safe" | "recover" | null>(null)
  const safeMode = bootMode === "safe"
  useEffect(() => {
    const safe = new URLSearchParams(window.location.search).get("safe") === "1"
    const recover = new URLSearchParams(window.location.search).get("recover") === "1"
    setBootMode(recover ? "recover" : safe ? "safe" : "normal")
  }, [])
  const [panel, setPanel] = useState<Panel>("browser")
  const { user, refresh } = useAuth()
  useEffect(() => { if (user) return startChatRealtime(user.id, refresh) }, [user?.id, refresh])
  const [labVisible, setLabVisible] = useState(false)

  // Catch global unhandled errors and promise rejections
  useGlobalErrorHandler()

  const isMod = user?.role === "OWNER" || user?.role === "HEAD_ADMIN" || user?.role === "ADMIN" || user?.role === "MOD"
  const visibleApps = APP_NAV.filter((item) => (!safeMode || SAFE_MODE_APPS.has(item.id)) && (!item.modOnly || isMod) && (!item.authOnly || Boolean(user)) && (!item.labOnly || labVisible))

  useEffect(() => {
    if (!user || panel !== "auth") return
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

  // Other tools (for example Music) can hand a URL to the real proxied
  // Browser without opening a new top-level tab.
  useEffect(() => {
    const openBrowser = (event: Event) => {
      const detail = (event as CustomEvent<{ value?: unknown; url?: unknown; href?: unknown }>).detail
      const value = detail?.value ?? detail?.url ?? detail?.href
      if (typeof value !== "string" || !value.trim()) return

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

      setPanel(target)
    }
    window.addEventListener("synnical-open-panel", openPanel)
    return () => window.removeEventListener("synnical-open-panel", openPanel)
  }, [isMod, user, labVisible]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      const navigationType = typeof performance !== "undefined"
        ? (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type
        : undefined
      if (!event.persisted && navigationType !== "back_forward") return
      setPanel("browser")

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
    const visibility = () => window.dispatchEvent(new CustomEvent("synnical-chat-visibility", {
      detail: { visible: panel === "chat" && document.visibilityState === "visible" },
    }))
    document.addEventListener("visibilitychange", visibility)
    return () => {
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [panel])

  const renderDesktopPanel = (target: Panel, openPanel: (target: Panel) => void) => safeMode && !SAFE_MODE_APPS.has(target) ? null : (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--synnical-accent)] border-t-transparent" /></div>}>
      {target === "discover" ? <ErrorBoundary name="Search"><DiscoveryPanel onPanel={openPanel} /></ErrorBoundary> : null}
      {target === "chat" ? <ErrorBoundary name="Chat">{user ? <ChatPanel key={user.id} /> : <AuthScreen embedded />}</ErrorBoundary> : null}
      {target === "friends" ? <ErrorBoundary name="Friends"><FriendsPanel /></ErrorBoundary> : null}
      {target === "spaces" ? <ErrorBoundary name="Spaces"><SpacesPanel /></ErrorBoundary> : null}
      {target === "moderation" && isMod ? <ErrorBoundary name="Moderation"><StaffAccountsPanel /></ErrorBoundary> : null}
      {target === "temp-mail" ? <ErrorBoundary name="Temp Mail"><TempMailPanel /></ErrorBoundary> : null}
      {target === "browser" ? <ErrorBoundary name="Browser"><BrowserPanel /></ErrorBoundary> : null}
      {target === "movies" ? <ErrorBoundary name="SynnFlix"><SynnFlixPanel /></ErrorBoundary> : null}
      {target === "cineb" ? <ErrorBoundary name="SynnFlix CineB"><CineBPanel /></ErrorBoundary> : null}
      {target === "synnime" ? <ErrorBoundary name="Synnime"><SynnimePanel /></ErrorBoundary> : null}
      {target === "music" ? <ErrorBoundary name="Music"><MusicPanel key={user?.id || "guest"} /></ErrorBoundary> : null}
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


  if (bootMode === null) return null
  if (bootMode === "recover") return <main className="min-h-screen bg-black text-white p-8 space-y-4"><h1 className="text-2xl">Synnical Recovery</h1><p>Reset this browser's OS preferences or start with essential apps. Account records and uploads are kept.</p><button className="rounded border p-3" onClick={() => { for (const key of Object.keys(localStorage)) if (key.startsWith("synnical:os:") && !key.includes("settings-snapshots")) localStorage.removeItem(key); location.assign("/?safe=1") }}>Reset local OS preferences</button><a className="block underline" href="/?safe=1">Start Safe Mode</a><a className="block underline" href="/">Start normally</a></main>
  return (
    <>
      {safeMode && <a href="/" className="fixed right-3 top-2 z-[30000] rounded bg-amber-950 px-3 py-1 text-xs text-white">Safe Mode · Exit</a>}
      {!safeMode && <PresenceBridge />}
      {!safeMode && <AutomationBridge />}
      <CommandPalette /><ImageViewer />
      <DesktopShell apps={visibleApps} renderPanel={renderDesktopPanel} onActivePanel={setPanel} />
    </>
  )
}
