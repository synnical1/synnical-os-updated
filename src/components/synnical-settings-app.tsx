"use client"

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react"
import {
  Accessibility, AppWindow, BatteryCharging, Bell, Bluetooth, ChevronLeft, ChevronRight,
  Clock3, Gamepad2, Info, Laptop, Monitor, Network, Palette, Search, Shield, SlidersHorizontal,
  Sparkles, UserRound, Volume2, Wifi, Zap, Lock, MousePointer2, Camera, Mic,
  Sun, Moon, PanelBottom, Grid2X2, Wallpaper, RefreshCcw, CheckCircle2, Globe2, HardDrive,
  Clipboard, Focus, Power, Languages, Code2, Settings2, Eye, Keyboard, Maximize2,
} from "lucide-react"
import { SettingsPanel as LegacySettingsPanel } from "@/components/settings-panel"
import { useAuth } from "@/hooks/use-auth"
import { useSystemStatus } from "@/hooks/use-system-status"
import { OS_DEFAULTS, sanitizeOsSettings, hydrateOsSettings, persistOsSettings, readOsSettings, type OsSettings, type WallpaperFit } from "@/lib/os-settings"
import { readSetting, writeSetting } from "@/lib/settings-runtime"
import { SYNNICAL_BUILD, SYNNICAL_BUILD_DATE, SYNNICAL_VERSION } from "@/lib/build-info"
import { cn } from "@/lib/utils"
import { useBrowser } from "@/hooks/use-browser"
import { THEMES } from "@/lib/themes"
import { toast } from "sonner"
import { SYNNICAL_APPS } from "@/lib/app-registry"

type Category = "system" | "devices" | "network" | "personalization" | "apps" | "accounts" | "time" | "gaming" | "accessibility" | "privacy" | "update"
type LegacySection = "account" | "profiles" | "privacy" | "apps" | "devices" | "connections" | "appearance" | "accessibility" | "presence" | "voice" | "notifications" | "keybinds" | "language" | "streamer" | "advanced" | "security" | "data" | "chat" | "games" | "browser" | "music" | "ai" | "performance" | "profile" | "legal"

type CategoryItem = { id: Category; label: string; icon: ComponentType<{ className?: string }> }
const CATEGORIES: CategoryItem[] = [
  { id: "system", label: "System", icon: Laptop },
  { id: "devices", label: "Bluetooth & devices", icon: Bluetooth },
  { id: "network", label: "Network & internet", icon: Wifi },
  { id: "personalization", label: "Personalization", icon: Palette },
  { id: "apps", label: "Apps", icon: AppWindow },
  { id: "accounts", label: "Accounts", icon: UserRound },
  { id: "time", label: "Time & language", icon: Clock3 },
  { id: "gaming", label: "Gaming", icon: Gamepad2 },
  { id: "accessibility", label: "Accessibility", icon: Accessibility },
  { id: "privacy", label: "Privacy & security", icon: Shield },
  { id: "update", label: "Synnical Update", icon: RefreshCcw },
]

const SETTING_SEARCH: Array<{ category: Category; title: string; terms: string }> = [
  { category: "system", title: "Display", terms: "scale brightness night light graphics" },
  { category: "system", title: "Sound", terms: "volume audio microphone output input" },
  { category: "system", title: "Notifications & Focus", terms: "notifications focus do not disturb alerts" },
  { category: "system", title: "Power & battery", terms: "battery saver performance power" },
  { category: "system", title: "Storage & Clipboard", terms: "storage files data clipboard history" },
  { category: "personalization", title: "Background, colors & themes", terms: "wallpaper theme accent mica acrylic" },
  { category: "personalization", title: "Start & taskbar", terms: "start pinned recommended taskbar center auto hide widgets search" },
  { category: "personalization", title: "Desktop & snap layouts", terms: "desktop icons snap windows layouts groups aero shake" },
  { category: "devices", title: "Bluetooth & devices", terms: "bluetooth controller camera microphone mouse keyboard gamepad" },
  { category: "network", title: "Network & internet", terms: "wifi network ethernet vpn proxy airplane hotspot connection" },
  { category: "apps", title: "Apps & startup", terms: "installed apps defaults startup tools" },
  { category: "accounts", title: "Accounts & sign-in", terms: "account profile password sessions trusted recovery connections sync" },
  { category: "time", title: "Time & language", terms: "date clock timezone language region typing" },
  { category: "gaming", title: "Gaming", terms: "game mode captures controller fullscreen performance" },
  { category: "accessibility", title: "Accessibility", terms: "vision hearing text contrast pointer reduced motion readability" },
  { category: "privacy", title: "Privacy & security", terms: "privacy security camera microphone permissions lockdown sessions" },
  { category: "update", title: "Synnical Update & About", terms: "update version build about health" },
]

function Toggle({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)} className={cn("relative h-5 w-10 rounded-full border transition-colors", value ? "border-sky-400 bg-sky-500" : "border-white/20 bg-white/10")}><span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform", value ? "translate-x-5" : "translate-x-1")} /></button>
}

function SettingCard({ icon: Icon, title, desc, right, onClick, children }: { icon?: ComponentType<{ className?: string }>; title: string; desc?: string; right?: ReactNode; onClick?: () => void; children?: ReactNode }) {
  const Tag = onClick ? "button" : "div"
  return <Tag {...(onClick ? { type: "button", onClick } : {}) as any} className={cn("synn-settings-card flex w-full items-center gap-4 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3 text-left", onClick && "hover:bg-white/[0.065]")}>
    {Icon ? <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.06]"><Icon className="h-4.5 w-4.5 text-sky-300" /></span> : null}
    <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-white/90">{title}</span>{desc ? <span className="mt-0.5 block text-xs leading-5 text-white/45">{desc}</span> : null}{children}</span>
    {right ?? (onClick ? <ChevronRight className="h-4 w-4 shrink-0 text-white/30" /> : null)}
  </Tag>
}

function SectionHeader({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack?: () => void }) {
  return <div className="mb-5 flex items-start gap-3">{onBack ? <button onClick={onBack} className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10"><ChevronLeft className="h-4 w-4" /></button> : null}<div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{subtitle ? <p className="mt-1 text-sm text-white/45">{subtitle}</p> : null}</div></div>
}

const WALLPAPER_VIDEO_RE = /\.(?:mp4|webm|mov)(?:\?|$)/i

function WallpaperPreview({ src }: { src: string }) {
  return <div className="aspect-video overflow-hidden rounded-lg border border-white/10 bg-black/30">
    {src && WALLPAPER_VIDEO_RE.test(src)
      ? <video src={src} muted loop playsInline autoPlay preload="metadata" className="h-full w-full object-cover" />
      : <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: src ? `url(${JSON.stringify(src)})` : undefined }} />}
  </div>
}

export function SynnicalSettingsApp() {
  const { user } = useAuth()
  const theme = useBrowser((state) => state.theme)
  const setTheme = useBrowser((state) => state.setTheme)
  const status = useSystemStatus()
  const [category, setCategory] = useState<Category>("system")
  const [query, setQuery] = useState("")
  const [legacy, setLegacy] = useState<LegacySection | null>(null)
  const [legacyTitle, setLegacyTitle] = useState("")
  const [os, setOs] = useState<OsSettings>(() => readOsSettings())
  const [loaded, setLoaded] = useState(false)
  const [wallpaperBusy, setWallpaperBusy] = useState<"desktop" | "lock" | null>(null)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [revokeOthers, setRevokeOthers] = useState(true)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [snapshots, setSnapshots] = useState<Array<{ id: string; at: string; settings: OsSettings }>>([])
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(`synnical:os:settings-snapshots:v1:${user?.id}`) || "[]"); setSnapshots(Array.isArray(saved) ? saved.slice(0, 5).map((row) => ({ id: String(row.id), at: String(row.at), settings: sanitizeOsSettings(row.settings) })) : []) } catch { setSnapshots([]) }
  }, [user?.id])
  const createSettingsSnapshot = () => {
    const next = [{ id: crypto.randomUUID(), at: new Date().toISOString(), settings: sanitizeOsSettings(os) }, ...snapshots].slice(0, 5)
    localStorage.setItem(`synnical:os:settings-snapshots:v1:${user?.id}`, JSON.stringify(next)); setSnapshots(next)
  }
  const restoreSettingsSnapshot = async (settings: OsSettings) => {
    const next = sanitizeOsSettings(settings); setOs(next); await persistOsSettings(next); toast.success("OS settings restored")
  }
  const exportSettings = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: "synnical-os-settings-v1", settings: sanitizeOsSettings(os) }, null, 2)], { type: "application/json" }))
    const a = document.createElement("a"); a.href = url; a.download = "synnical-os-settings.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
  const importSettings = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > 256 * 1024) throw new Error("Settings backup must be under 256 KiB")
      const parsed = JSON.parse(await file.text())
      if (parsed?.format !== "synnical-os-settings-v1" || !parsed.settings || typeof parsed.settings !== "object" || Array.isArray(parsed.settings)) throw new Error("Invalid Synnical settings backup")
      const next = sanitizeOsSettings(parsed.settings)
      createSettingsSnapshot(); await restoreSettingsSnapshot(next)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Import failed") }
  }
  const repairApp = (panel: string) => window.dispatchEvent(new CustomEvent("synnical-repair-panel", { detail: { panel } }))
  const clearBrowserCache = async () => {
    try {
      if ("caches" in window) for (const key of await caches.keys()) if (/synnical|scramjet/i.test(key)) await caches.delete(key)
      window.dispatchEvent(new CustomEvent("synnical-browser-reset")); toast.success("Browser runtime cache cleared; account history and bookmarks kept")
    } catch { toast.error("Browser cache could not be cleared") }
  }

  useEffect(() => { hydrateOsSettings().then((next) => { setOs(next); document.documentElement.dataset.synnicalAppearance = next.appearanceMode; setLoaded(true) }) }, [user?.id])
  useEffect(() => {
    const handler = (event: Event) => setOs((event as CustomEvent<{ settings?: OsSettings }>).detail?.settings || readOsSettings())
    window.addEventListener("synnical-os-settings-changed", handler)
    return () => window.removeEventListener("synnical-os-settings-changed", handler)
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const value = (event as CustomEvent<{ category?: unknown }>).detail?.category
      if (typeof value !== "string" || !CATEGORIES.some((item) => item.id === value)) return
      setCategory(value as Category)
      setLegacy(null)
    }
    window.addEventListener("synnical-settings-category", handler)
    return () => window.removeEventListener("synnical-settings-category", handler)
  }, [])
  useEffect(() => {
    if (!legacy) return
    const timer = window.setTimeout(() => window.dispatchEvent(new CustomEvent("synnical-settings-open", { detail: { section: legacy } })), 0)
    return () => window.clearTimeout(timer)
  }, [legacy])

  const patchOs = async <K extends keyof OsSettings>(key: K, value: OsSettings[K]) => {
    const next = sanitizeOsSettings({ ...os, [key]: value })
    setOs(next)
    if (key === "appearanceMode") document.documentElement.dataset.synnicalAppearance = next.appearanceMode
    await persistOsSettings(next)
  }
  const patchNotificationRule = async (app: string, patch: Partial<{ enabled: boolean; priority: "normal" | "priority" | "urgent" }>) => {
    const current = os.notificationRules[app] || { enabled: true, priority: "normal" as const }
    const next = { ...os, notificationRules: { ...os.notificationRules, [app]: { ...current, ...patch } } }
    setOs(next); await persistOsSettings(next)
  }
  const uploadWallpaper = async (target: "desktop" | "lock", file: File | null) => {
    if (!file) return
    setWallpaperBusy(target)
    try {
      const form = new FormData()
      form.set("target", target)
      form.set("file", file)
      const response = await fetch("/api/features/os/wallpaper", { method: "POST", credentials: "include", body: form })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Wallpaper upload failed")
      const next = await hydrateOsSettings()
      setOs(next)
      toast.success(target === "desktop" ? "Desktop wallpaper updated" : "Lock screen wallpaper updated")
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Wallpaper upload failed") }
    finally { setWallpaperBusy(null) }
  }
  const changePassword = async () => {
    if (newPassword !== confirmPassword) return toast.error("The new passwords do not match")
    setPasswordBusy(true)
    try {
      const response = await fetch("/api/features/security", { method: "POST", credentials: "include", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "change-password", password: currentPassword, newPassword, revokeOthers }) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Password change failed")
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("")
      toast.success(revokeOthers ? "Password changed. Other devices were signed out." : "Password changed")
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Password change failed") }
    finally { setPasswordBusy(false) }
  }
  const openLegacy = (section: LegacySection, title: string) => { setQuery(""); setLegacyTitle(title); setLegacy(section) }
  const categories = CATEGORIES
  const q = query.trim().toLowerCase()
  const searchResults = useMemo(() => q ? SETTING_SEARCH.filter((item) => `${item.title} ${item.terms} ${CATEGORIES.find((row) => row.id === item.category)?.label || ""}`.toLowerCase().includes(q)) : [], [q])
  const matches = (text: string) => !q || text.toLowerCase().includes(q)
  const legacyView = legacy ? <div className="synnical-settings-legacy h-full min-h-0"><SectionHeader title={legacyTitle} onBack={() => setLegacy(null)} /><div className="h-[calc(100%-52px)] min-h-0 overflow-hidden rounded-xl border border-white/10"><LegacySettingsPanel /></div></div> : null

  const system = <div className="space-y-2">
    <SectionHeader title="System" subtitle="Display, sound, notifications, power, multitasking and Synnical OS behavior." />
    {matches("Display scale brightness night light") && <SettingCard icon={Monitor} title="Display" desc={`Synnical display brightness ${os.osBrightness}% · UI scale ${readSetting("accessibility.uiZoom", 100)}%`} onClick={() => openLegacy("appearance", "Display & appearance")} />}
    {matches("fullscreen startup display") && <SettingCard icon={Maximize2} title="Auto fullscreen" desc="Enter true browser fullscreen on the first click or key press after Synnical OS loads. Browsers do not permit zero-click fullscreen on a normal webpage." right={<Toggle value={os.autoFullscreen} onChange={(v) => patchOs("autoFullscreen", v)} label="Auto fullscreen" />} />}
    {matches("Sound output input volume mixer") && <SettingCard icon={Volume2} title="Sound" desc={`Synnical interface sound level ${os.uiSoundVolume}% · media device controls stay inside each app`} onClick={() => openLegacy("voice", "Sound")} />}
    {matches("Notifications focus") && <SettingCard icon={Bell} title="Notifications" desc={`Focus mode: ${os.focusAssist === "off" ? "Off" : os.focusAssist}`} onClick={() => openLegacy("notifications", "Notifications")} />}
    {matches("Focus do not disturb") && <SettingCard icon={Focus} title="Focus" desc="Do Not Disturb filtering plus the duration used by Quick Settings focus sessions."><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="flex items-center justify-between gap-3 text-xs text-white/60">Mode<select value={os.focusAssist} onChange={(e) => patchOs("focusAssist", e.target.value as OsSettings["focusAssist"])} className="rounded-md border border-white/10 bg-[#111] px-2 py-1.5 text-xs"><option value="off">Off</option><option value="priority">Priority only</option><option value="alarms">Alarms only</option></select></label><label className="flex items-center justify-between gap-3 text-xs text-white/60">Session length<select value={os.focusSessionMinutes} onChange={(e)=>patchOs("focusSessionMinutes",Number(e.target.value))} className="rounded-md border border-white/10 bg-[#111] px-2 py-1.5 text-xs">{[15,25,30,45,60,90].map((minutes)=><option key={minutes} value={minutes}>{minutes} min</option>)}</select></label></div></SettingCard>}
    {matches("Notifications priority apps history") && <SettingCard icon={Bell} title="Per-app notifications" desc="Choose which Synnical apps may notify you and which alerts bypass Priority-only Focus."><div className="mt-3 space-y-2">{(["chat","calls","browser","music","games","movies"] as const).map((app) => { const rule=os.notificationRules[app]||{enabled:true,priority:"normal" as const}; return <div key={app} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2"><span className="text-xs capitalize">{app === "movies" ? "SynnFlix" : app}</span><select value={rule.priority} disabled={!rule.enabled} onChange={(e)=>void patchNotificationRule(app,{priority:e.target.value as "normal"|"priority"|"urgent"})} className="rounded border border-white/10 bg-[#111] px-2 py-1 text-[10px] disabled:opacity-35"><option value="normal">Normal</option><option value="priority">Priority</option><option value="urgent">Urgent</option></select><Toggle value={rule.enabled} onChange={(value)=>void patchNotificationRule(app,{enabled:value})} label={`${app} notifications`} /></div>})}<label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/60">Keep dismissed notification history<Toggle value={os.notificationHistory} onChange={(value)=>void patchOs("notificationHistory",value)} label="Notification history" /></label></div></SettingCard>}
    {matches("Power battery saver") && <SettingCard icon={BatteryCharging} title="Power & battery" desc={status.batterySupported ? `${status.batteryLevel}% ${status.charging ? "· Charging" : ""}` : "Battery details are not exposed by this browser. Battery Saver still controls Synnical low-end mode."} right={<Toggle value={os.batterySaver} onChange={(v) => patchOs("batterySaver", v)} label="Battery Saver" />} />}
    {matches("Storage data") && <SettingCard icon={HardDrive} title="Storage" desc="Manage Synnical account data, history and stored browser records." onClick={() => openLegacy("data", "Storage")} />}
    {matches("Multitasking snap windows desktops") && <SettingCard icon={Grid2X2} title="Multitasking" desc={`Snap windows ${os.snapWindows ? "On" : "Off"} · Snap layouts ${os.snapLayouts ? "On" : "Off"}`} onClick={() => setCategory("personalization")} />}
    {matches("Clipboard") && <SettingCard icon={Clipboard} title="Clipboard" desc="Open Synnical clipboard history with the system-key shortcut when the browser delivers it, or Ctrl+Shift+V." />}
    {matches("About version") && <SettingCard icon={Info} title="About" desc={`Synnical OS ${SYNNICAL_VERSION} · ${SYNNICAL_BUILD}`} onClick={() => setCategory("update")} />}
  </div>

  const personalization = <div className="space-y-2">
    <SectionHeader title="Personalization" subtitle="Background, colors, Start, taskbar, desktop and lock screen." />
    <SettingCard icon={os.appearanceMode === "dark" ? Moon : Sun} title="Appearance mode" desc="Light and Dark change the base surfaces while your Synnical theme keeps control of accent colors."><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => void patchOs("appearanceMode", "light")} aria-pressed={os.appearanceMode === "light"} className={cn("rounded-lg border px-3 py-2 text-xs", os.appearanceMode === "light" ? "border-sky-400 bg-sky-400/10" : "border-white/10 bg-white/[0.03]")}><Sun className="mx-auto mb-1 h-4 w-4" />Light</button><button type="button" onClick={() => void patchOs("appearanceMode", "dark")} aria-pressed={os.appearanceMode === "dark"} className={cn("rounded-lg border px-3 py-2 text-xs", os.appearanceMode === "dark" ? "border-sky-400 bg-sky-400/10" : "border-white/10 bg-white/[0.03]")}><Moon className="mx-auto mb-1 h-4 w-4" />Dark</button></div></SettingCard>
    <SettingCard icon={MousePointer2} title="Cursor" desc="In-app pointer style and size."><div className="mt-2 flex gap-3"><select aria-label="Cursor theme" value={os.cursorTheme} onChange={(e) => void patchOs("cursorTheme", e.target.value as OsSettings["cursorTheme"])} className="bg-[#111]">{["system", "light", "dark", "crosshair"].map((value) => <option key={value}>{value}</option>)}</select><input aria-label="Cursor size" type="range" min={75} max={175} step={5} value={os.cursorSize} onChange={(e) => void patchOs("cursorSize", Number(e.target.value))} /><span>{os.cursorSize}%</span></div></SettingCard>
    <SettingCard icon={Search} title="Search history" desc="Remember recent Start searches on this device." right={<Toggle label="Search history" value={os.startSearchHistory} onChange={(value) => void patchOs("startSearchHistory", value)} />} />
    <SettingCard icon={SlidersHorizontal} title="Quick Settings order" desc="Move a control earlier in the Quick Settings panel."><div className="mt-2 flex flex-wrap gap-2">{os.quickSettingsOrder.map((id, index) => <button key={id} disabled={index === 0} onClick={() => { const next = [...os.quickSettingsOrder]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; void patchOs("quickSettingsOrder", next) }} className="rounded border border-white/20 p-2 text-xs disabled:opacity-40">↑ {id}</button>)}</div></SettingCard>
    <SettingCard icon={Wallpaper} title="Desktop background" desc="Upload your own image or video wallpaper."><div className="mt-3 grid gap-3 sm:grid-cols-[180px_1fr]"><WallpaperPreview src={os.desktopWallpaper} /><div className="space-y-2"><label className="flex cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs hover:bg-white/[0.09]">{wallpaperBusy === "desktop" ? "Uploading…" : "Browse image or video"}<input type="file" accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,video/quicktime" disabled={Boolean(wallpaperBusy)} onChange={(e)=>{ const file=e.target.files?.[0]||null; void uploadWallpaper("desktop",file); e.currentTarget.value="" }} className="hidden" /></label><label className="flex items-center justify-between gap-3 text-xs text-white/60">Choose a fit<select value={os.desktopWallpaperFit} onChange={(e)=>patchOs("desktopWallpaperFit",e.target.value as WallpaperFit)} className="rounded border border-white/10 bg-[#111] px-2 py-1"><option value="fill">Fill</option><option value="fit">Fit</option><option value="stretch">Stretch</option><option value="center">Center</option><option value="tile">Tile</option></select></label><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void patchOs("desktopWallpaper", OS_DEFAULTS.desktopWallpaper)} className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] hover:bg-white/[0.06]">Reset to default</button></div><p className="text-[10px] leading-4 text-white/30">Uploaded images are re-encoded before use. Uploaded videos are stored with unguessable media URLs associated with your account and played muted as live wallpapers.</p></div></div></SettingCard>
    <SettingCard icon={Palette} title="Colors & themes" desc="Choose a Synnical theme. Changes apply immediately across the OS."><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{THEMES.map((item)=><button key={item.id} onClick={()=>setTheme(item.id)} className={cn("rounded-xl border p-2 text-left transition-colors",theme===item.id?"border-sky-400/70 bg-sky-400/10":"border-white/10 bg-black/20 hover:bg-white/[0.05]")}><div className="flex gap-1">{item.colors.map((color)=><span key={color} className="h-5 flex-1 rounded" style={{backgroundColor:color}} />)}</div><span className="mt-2 block text-xs">{item.name}</span></button>)}</div></SettingCard>
    <SettingCard icon={PanelBottom} title="Taskbar" desc="Alignment, Search, Task View, Widgets and auto-hide."><div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Alignment<select value={os.taskbarAlignment} onChange={(e) => patchOs("taskbarAlignment", e.target.value as "center" | "left")} className="rounded border border-white/10 bg-[#111] px-2 py-1"><option value="center">Center</option><option value="left">Left</option></select></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Size<select value={os.taskbarSize} onChange={(e) => patchOs("taskbarSize", e.target.value as OsSettings["taskbarSize"])} className="rounded border border-white/10 bg-[#111] px-2 py-1"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Auto-hide<Toggle value={os.taskbarAutoHide} onChange={(v) => patchOs("taskbarAutoHide", v)} label="Auto-hide taskbar" /></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Search<Toggle value={os.showSearch} onChange={(v) => patchOs("showSearch", v)} label="Show Search" /></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Task View<Toggle value={os.showTaskView} onChange={(v) => patchOs("showTaskView", v)} label="Show Task View" /></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Widgets<Toggle value={os.showWidgets} onChange={(v) => patchOs("showWidgets", v)} label="Show Widgets" /></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Clock seconds<Toggle value={os.clockSeconds} onChange={(v) => patchOs("clockSeconds", v)} label="Clock seconds" /></label>
    </div></SettingCard>
    <SettingCard icon={Sparkles} title="Visual effects" desc="Synnical OS animation, liquid glass and wallpaper readability controls."><div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Animations<Toggle value={os.animations} onChange={(v) => patchOs("animations", v)} label="OS animations" /></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Transparency<Toggle value={os.transparency} onChange={(v) => patchOs("transparency", v)} label="Acrylic transparency" /></label>
      <label className="text-xs text-white/60">Glass strength <span className="text-white/35">{os.glassStrength}%</span><input className="mt-1 w-full" type="range" min="20" max="100" value={os.glassStrength} onChange={(e)=>patchOs("glassStrength",Number(e.target.value))} /></label>
      <label className="text-xs text-white/60">Wallpaper dim <span className="text-white/35">{os.wallpaperDim}%</span><input className="mt-1 w-full" type="range" min="0" max="75" value={os.wallpaperDim} onChange={(e)=>patchOs("wallpaperDim",Number(e.target.value))} /></label>
      <label className="text-xs text-white/60">Wallpaper blur <span className="text-white/35">{os.wallpaperBlur}px</span><input className="mt-1 w-full" type="range" min="0" max="24" value={os.wallpaperBlur} onChange={(e)=>patchOs("wallpaperBlur",Number(e.target.value))} /></label>
      <label className="text-xs text-white/60">Wallpaper saturation <span className="text-white/35">{os.wallpaperSaturation}%</span><input className="mt-1 w-full" type="range" min="0" max="180" value={os.wallpaperSaturation} onChange={(e)=>patchOs("wallpaperSaturation",Number(e.target.value))} /></label>
    </div></SettingCard>
    <SettingCard icon={Grid2X2} title="Start" desc="Recommended and recently used app behavior."><div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Recent apps<Toggle value={os.startRecentApps} onChange={(v) => patchOs("startRecentApps", v)} label="Recent apps" /></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Recommended<Toggle value={os.startRecommended} onChange={(v) => patchOs("startRecommended", v)} label="Recommended apps" /></label>
    </div></SettingCard>
    <SettingCard icon={Grid2X2} title="Desktop" desc="Icons, alignment and window behavior."><div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Show desktop icons<Toggle value={os.showDesktopIcons} onChange={(v) => patchOs("showDesktopIcons", v)} label="Desktop icons" /></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Align icons to grid<Toggle value={os.desktopAlignGrid} onChange={(v) => patchOs("desktopAlignGrid", v)} label="Align to grid" /></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Icon size<select value={os.desktopIconSize} onChange={(e) => patchOs("desktopIconSize", e.target.value as OsSettings["desktopIconSize"])} className="rounded border border-white/10 bg-[#111] px-2 py-1"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Restore windows<Toggle value={os.restoreWindows} onChange={(v) => patchOs("restoreWindows", v)} label="Restore windows" /></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Clock widget<Toggle value={os.desktopClockWidget} onChange={(v) => patchOs("desktopClockWidget", v)} label="Desktop clock widget" /></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Calendar widget<Toggle value={os.desktopCalendarWidget} onChange={(v) => patchOs("desktopCalendarWidget", v)} label="Desktop calendar widget" /></label>
    </div></SettingCard>
    <SettingCard icon={SlidersHorizontal} title="Snap windows" desc="Snap Assist, layouts, groups and Aero Shake."><div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Snap windows<Toggle value={os.snapWindows} onChange={(v) => patchOs("snapWindows", v)} label="Snap windows" /></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Snap layouts<Toggle value={os.snapLayouts} onChange={(v) => patchOs("snapLayouts", v)} label="Snap layouts" /></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Snap groups<Toggle value={os.snapGroups} onChange={(v) => patchOs("snapGroups", v)} label="Snap groups" /></label>
      <label className="flex items-center justify-between gap-3 text-xs text-white/60">Aero Shake<Toggle value={os.aeroShake} onChange={(v) => patchOs("aeroShake", v)} label="Aero Shake" /></label>
    </div></SettingCard>
    <SettingCard icon={Sun} title="Night light" desc="Adds a warm Synnical OS display tint. It does not change your physical monitor color temperature." right={<Toggle value={os.nightLight} onChange={(v) => patchOs("nightLight", v)} label="Night light" />} />
    <SettingCard icon={Lock} title="Lock screen" desc="Choose a separate lock-screen background and what appears before sign-in."><div className="mt-3 grid gap-3 sm:grid-cols-[180px_1fr]"><WallpaperPreview src={os.lockUseDesktopWallpaper ? os.desktopWallpaper : os.lockWallpaper} /><div className="space-y-2"><label className="flex items-center justify-between gap-3 text-xs text-white/60">Use desktop wallpaper<Toggle value={os.lockUseDesktopWallpaper} onChange={(v)=>patchOs("lockUseDesktopWallpaper",v)} label="Use desktop wallpaper on lock screen" /></label>{!os.lockUseDesktopWallpaper ? <><label className="flex cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs hover:bg-white/[0.09]">{wallpaperBusy === "lock" ? "Uploading…" : "Browse lock-screen image or video"}<input type="file" accept="image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm,video/quicktime" disabled={Boolean(wallpaperBusy)} onChange={(e)=>{ const file=e.target.files?.[0]||null; void uploadWallpaper("lock",file); e.currentTarget.value="" }} className="hidden" /></label><label className="flex items-center justify-between gap-3 text-xs text-white/60">Choose a fit<select value={os.lockWallpaperFit} onChange={(e)=>patchOs("lockWallpaperFit",e.target.value as WallpaperFit)} className="rounded border border-white/10 bg-[#111] px-2 py-1"><option value="fill">Fill</option><option value="fit">Fit</option><option value="stretch">Stretch</option><option value="center">Center</option><option value="tile">Tile</option></select></label></> : null}<label className="flex items-center justify-between gap-3 text-xs text-white/60">Show clock<Toggle value={os.lockShowClock} onChange={(v)=>patchOs("lockShowClock",v)} label="Show lock-screen clock" /></label><label className="flex items-center justify-between gap-3 text-xs text-white/60">Show notifications<Toggle value={os.lockShowNotifications} onChange={(v)=>patchOs("lockShowNotifications",v)} label="Show notifications on lock screen" /></label>{os.lockShowNotifications ? <label className="flex items-center justify-between gap-3 text-xs text-white/60">Hide sensitive text<Toggle value={os.lockHideSensitiveNotificationText} onChange={(v)=>patchOs("lockHideSensitiveNotificationText",v)} label="Hide sensitive notification text" /></label> : null}<button onClick={()=>window.dispatchEvent(new CustomEvent("synnical-os-lock"))} className="w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs hover:bg-white/[0.09]">Lock now</button></div></div></SettingCard>
  </div>

  const devices = <div className="space-y-2"><SectionHeader title="Bluetooth & devices" subtitle="Browser-visible input, camera, microphone and controller capabilities." />
    <SettingCard icon={Bluetooth} title="Bluetooth" desc={typeof navigator !== "undefined" && "bluetooth" in navigator ? "Web Bluetooth is available. Device pairing still requires an explicit browser permission prompt." : "This browser does not expose Web Bluetooth to Synnical."} />
    <SettingCard icon={Gamepad2} title="Controllers" desc={`${typeof navigator !== "undefined" ? navigator.getGamepads?.().filter(Boolean).length || 0 : 0} controller(s) currently visible to the browser.`} onClick={() => openLegacy("games", "Controllers & gaming devices")} />
    <SettingCard icon={Camera} title="Cameras" desc="Camera access is controlled by your browser permission prompt." onClick={() => openLegacy("devices", "Camera & devices")} />
    <SettingCard icon={Mic} title="Microphone" desc="Microphone input and voice settings." onClick={() => openLegacy("voice", "Microphone & audio")} />
    <SettingCard icon={MousePointer2} title="Mouse & pointer" desc="Synnical pointer size and interface accessibility settings." onClick={() => openLegacy("accessibility", "Mouse & pointer")} />
    <SettingCard icon={Keyboard} title="Typing & keyboard" desc="Keybinds and keyboard behavior." onClick={() => openLegacy("keybinds", "Keyboard")} />
  </div>

  const network = <div className="space-y-2"><SectionHeader title="Network & internet" subtitle="Real browser connectivity plus Synnical Browser/proxy controls." />
    <SettingCard icon={status.online ? Wifi : Network} title={status.online ? "Connected" : "Offline"} desc={[status.networkType || status.effectiveType || "Browser network", status.downlink != null ? `${status.downlink} Mbps estimate` : "", status.rtt != null ? `${status.rtt} ms RTT estimate` : ""].filter(Boolean).join(" · ")} />
    <SettingCard icon={Wifi} title="Wi-Fi" desc="Web pages cannot read nearby Wi-Fi SSIDs or control your system Wi-Fi radio. Synnical shows only browser-exposed connection information." />
    <SettingCard icon={Globe2} title="Proxy" desc="Configure the real Synnical Browser and proxy runtime." onClick={() => openLegacy("browser", "Proxy & browser")} />
    <SettingCard icon={Shield} title="VPN & privacy routing" desc="Shows only routing controls Synnical can genuinely provide." onClick={() => openLegacy("browser", "Network privacy")} />
    <SettingCard icon={Network} title="Advanced network settings" desc={`Online: ${status.online ? "Yes" : "No"} · Data saver signal: ${status.saveData ? "On" : "Off"}`} />
  </div>

  const apps = <div className="space-y-2"><SectionHeader title="Apps" subtitle="Synnical applications, startup behavior and defaults." />
    <SettingCard icon={AppWindow} title="Installed Synnical apps" desc="Every permitted app is available directly from the desktop, Start, Search and taskbar. There is no separate Tools folder in OS mode." />
    <SettingCard icon={AppWindow} title="First-party app library" desc="Hide apps from the launcher and choose which apps open at startup (up to 12)."><div className="mt-3 space-y-2">{SYNNICAL_APPS.filter((app) => !("authOnly" in app) || user).map((app) => <div key={app.id} className="flex items-center gap-3 text-xs"><span className="flex-1">{app.label}</span><label><input type="checkbox" checked={!os.hiddenLauncherApps.includes(app.id)} onChange={(e) => void patchOs("hiddenLauncherApps", e.target.checked ? os.hiddenLauncherApps.filter((id) => id !== app.id) : [...os.hiddenLauncherApps, app.id])} /> Show</label><label><input type="checkbox" disabled={!os.startupApps.includes(app.id) && os.startupApps.length >= 12} checked={os.startupApps.includes(app.id)} onChange={(e) => void patchOs("startupApps", e.target.checked ? [...os.startupApps, app.id] : os.startupApps.filter((id) => id !== app.id))} /> Startup</label><button onClick={() => repairApp(app.id)} className="text-sky-300">Repair / restart app</button></div>)}</div></SettingCard>
    <SettingCard icon={RefreshCcw} title="App maintenance" desc="Restarting an app discards its unsaved view state. Browser cache cleanup preserves account records."><button onClick={() => void clearBrowserCache()} className="mt-2 rounded border border-white/20 p-2 text-xs">Clear cache</button></SettingCard>
    <SettingCard icon={Settings2} title="App settings" desc="Chat, Browser, Music, AI and other Synnical app settings." onClick={() => openLegacy("apps", "App settings")} />
  </div>

  const accounts = <div className="space-y-2"><SectionHeader title="Accounts" subtitle="Your profile, sign-in, sessions and linked Synnical identity." />
    <div className="mb-4 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5"><div className="grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-white/10">{user?.pfpUrl ? <img src={user.pfpUrl} className="h-full w-full object-cover" alt="" /> : <UserRound className="h-6 w-6 text-white/50" />}</div><div><p className="text-lg font-semibold">{user?.displayName || user?.username || "Synnical account"}</p><p className="text-xs text-white/40">{user ? `@${user.username} · ${user.role}` : "Not signed in"}</p></div></div>
    <SettingCard icon={UserRound} title="Your info" desc="Profile, display name, avatar and public identity." onClick={() => openLegacy("account", "Your info")} />
    <SettingCard icon={Lock} title="Change password" desc="Confirm your current password, choose a new one, and optionally sign out other devices."><div className="mt-3 grid gap-2"><input type="password" autoComplete="current-password" value={currentPassword} onChange={(e)=>setCurrentPassword(e.target.value)} placeholder="Current password" className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs outline-none" /><input type="password" autoComplete="new-password" value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} placeholder="New password" className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs outline-none" /><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} placeholder="Confirm new password" className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs outline-none" /><label className="flex items-center justify-between gap-3 text-xs text-white/60">Sign out other devices<Toggle value={revokeOthers} onChange={setRevokeOthers} label="Sign out other devices after password change" /></label><button disabled={passwordBusy || !currentPassword || !newPassword || !confirmPassword} onClick={()=>void changePassword()} className="rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-black disabled:opacity-40">{passwordBusy?"Changing password…":"Change password"}</button></div></SettingCard>
    <SettingCard icon={Shield} title="Security & recovery" desc="Recovery question, one-time recovery codes, sessions, trusted devices and account lockdown." onClick={() => openLegacy("security", "Security & recovery")} />
    <SettingCard icon={Globe2} title="Connected accounts" desc="Manage Synnical profile connections." onClick={() => openLegacy("connections", "Connections")} />
    <SettingCard icon={HardDrive} title="Settings backup & restore" desc="OS preferences only; passwords and sessions are excluded. Uploaded wallpapers still require their original media server."><div className="mt-3 flex gap-3 text-xs"><button onClick={exportSettings}>Export JSON</button><label className="cursor-pointer">Import JSON<input type="file" accept="application/json,.json" className="hidden" onChange={(e) => { void importSettings(e.target.files?.[0]); e.currentTarget.value = "" }} /></label><button onClick={createSettingsSnapshot}>Create restore point</button></div>{snapshots.map((row) => <button key={row.id} className="mt-2 block text-xs text-sky-300" onClick={() => { if (window.confirm("Replace current OS preferences with this restore point?")) void restoreSettingsSnapshot(row.settings) }}>Restore {new Date(row.at).toLocaleString()}</button>)}</SettingCard>
    <SettingCard icon={Sparkles} title="Sync Synnical OS settings" desc={user ? "Core OS preferences are stored on your Synnical account and also cached locally." : "Sign in to sync OS preferences between devices."} />
  </div>

  const time = <div className="space-y-2"><SectionHeader title="Time & language" subtitle="Date, time, extra clocks, region, language and typing." />
    <SettingCard icon={Clock3} title="Date & time" desc={`${new Date().toLocaleString()} · ${Intl.DateTimeFormat().resolvedOptions().timeZone || "Browser timezone"}`}><div className="mt-3 space-y-2"><div className="flex flex-wrap gap-2">{os.additionalTimeZones.map((zone)=><button key={zone} onClick={()=>void patchOs("additionalTimeZones",os.additionalTimeZones.filter((item)=>item!==zone))} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10px] hover:bg-red-500/10" title="Remove extra clock">{zone} ×</button>)}{!os.additionalTimeZones.length ? <span className="text-[10px] text-white/30">No extra clocks yet.</span> : null}</div><select defaultValue="" onChange={(e)=>{ const zone=e.target.value; if(zone&&!os.additionalTimeZones.includes(zone)) void patchOs("additionalTimeZones",[...os.additionalTimeZones,zone].slice(0,4)); e.currentTarget.value="" }} className="w-full rounded border border-white/10 bg-[#111] px-2 py-1.5 text-xs"><option value="">Add another clock…</option>{["Europe/London","America/New_York","America/Los_Angeles","Asia/Tokyo","Asia/Dubai","Australia/Sydney","Europe/Paris","Asia/Kolkata"].filter((zone)=>!os.additionalTimeZones.includes(zone)).map((zone)=><option key={zone} value={zone}>{zone}</option>)}</select></div></SettingCard>
    <SettingCard icon={Languages} title="Language & region" desc={`${status.language || "Browser language"}`} onClick={() => openLegacy("language", "Language & region")} />
    <SettingCard icon={Keyboard} title="Typing" desc="Keyboard shortcuts and text-entry behavior." onClick={() => openLegacy("keybinds", "Typing")} />
  </div>

  const gaming = <div className="space-y-2"><SectionHeader title="Gaming" subtitle="Game Mode, controls, captures and fullscreen behavior." />
    <SettingCard icon={Gamepad2} title="Game Mode" desc="Cloud-game launch, immersive controls and gameplay preferences." onClick={() => openLegacy("games", "Game Mode")} />
    <SettingCard icon={Camera} title="Captures" desc="Private Synnical game screenshots are available in Synnical Files." onClick={() => window.dispatchEvent(new CustomEvent("synnical-open-panel", { detail: { panel: "files" } }))} />
    <SettingCard icon={Zap} title="Performance" desc="Low-End Device Mode and automatic performance scaling." onClick={() => openLegacy("performance", "Gaming performance")} />
  </div>

  const accessibility = <div className="space-y-2"><SectionHeader title="Accessibility" subtitle="Vision, hearing and interaction settings." />
    <SettingCard icon={Eye} title="Vision" desc="Text size, UI zoom, contrast, reduced motion and readability." onClick={() => openLegacy("accessibility", "Vision")} />
    <SettingCard icon={Volume2} title="Hearing" desc="Audio and voice controls available inside Synnical." onClick={() => openLegacy("voice", "Hearing & audio")} />
    <SettingCard icon={MousePointer2} title="Interaction" desc="Pointer, focus outlines, spacing and simplified UI." onClick={() => openLegacy("accessibility", "Interaction")} />
  </div>

  const privacy = <div className="space-y-2"><SectionHeader title="Privacy & security" subtitle="Privacy visibility, sessions, permissions and account protection." />
    <SettingCard icon={Shield} title="Synnical Security" desc="Sessions, trusted devices, recovery, lockdown and security timeline." onClick={() => openLegacy("security", "Synnical Security")} />
    <SettingCard icon={Eye} title="Privacy" desc="Per-friend visibility rules, view-as and safety controls." onClick={() => openLegacy("privacy", "Privacy")} />
    <SettingCard icon={Camera} title="Camera & microphone permissions" desc="The browser remains the authority for hardware permission prompts; Synnical never fabricates permission state." onClick={() => openLegacy("devices", "App permissions")} />
    <SettingCard icon={Code2} title="Developer access" desc="Scoped Synnical API tokens are handled in Developer tools." onClick={() => window.dispatchEvent(new CustomEvent("synnical-open-panel", { detail: { panel: "developer" } }))} />
  </div>

  const update = <div className="space-y-3"><SectionHeader title="Synnical Update" subtitle="Installed Synnical OS build and update status for this server." />
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-6"><CheckCircle2 className="h-10 w-10 text-emerald-400" /><h2 className="mt-4 text-xl font-semibold">You're on the installed server build</h2><p className="mt-2 text-sm text-white/45">Synnical does not invent a remote update result. This page reports the build currently served by your Synnical server.</p><div className="mt-5 grid gap-2 rounded-xl border border-white/10 bg-black/20 p-4 text-xs"><div className="flex justify-between gap-4"><span className="text-white/35">Version</span><span>{SYNNICAL_VERSION}</span></div><div className="flex justify-between gap-4"><span className="text-white/35">Build</span><span className="truncate">{SYNNICAL_BUILD}</span></div><div className="flex justify-between gap-4"><span className="text-white/35">Build date</span><span>{SYNNICAL_BUILD_DATE}</span></div></div></div>
    <SettingCard icon={RefreshCcw} title="Check server health" desc="Open Synnical's real system health surface instead of a fake internet updater." onClick={() => window.dispatchEvent(new CustomEvent("synnical-open-panel", { detail: { panel: "discover" } }))} />
    <SettingCard icon={Sparkles} title="What's New" desc="Recovery fixes connect Files, security, settings and desktop controls while preserving the August 25 Music and Synn VM changes." />
    <SettingCard icon={Clock3} title="Update history" desc={`Installed: ${SYNNICAL_VERSION} · ${SYNNICAL_BUILD_DATE}. Recovery base: August 25, 2026 (839d810). Earlier installation history was not recovered.`} />
    <SettingCard icon={Info} title="About Synnical OS" desc={`Synnical OS ${SYNNICAL_VERSION}`} />
  </div>

  const content: Record<Category, ReactNode> = { system, devices, network, personalization, apps, accounts, time, gaming, accessibility, privacy, update }
  const searchView = q ? <div><SectionHeader title="Settings search" subtitle={searchResults.length ? `${searchResults.length} result${searchResults.length === 1 ? "" : "s"} for “${query.trim()}”` : `No settings found for “${query.trim()}”`} />{searchResults.length ? <div className="space-y-2">{searchResults.map((result) => <button key={`${result.category}:${result.title}`} onClick={() => { setCategory(result.category); setQuery(""); setLegacy(null) }} className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-4 text-left hover:bg-white/[0.065]"><Search className="h-4 w-4 text-sky-300" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{result.title}</span><span className="mt-1 block text-xs text-white/40">{CATEGORIES.find((row) => row.id === result.category)?.label}</span></span><ChevronRight className="h-4 w-4 text-white/30" /></button>)}</div> : null}</div> : null

  return <div className="synnical-settings-app flex h-full min-h-0 bg-[#0c0c0e] text-white">
    <aside className="w-[250px] shrink-0 overflow-y-auto border-r border-white/10 bg-white/[0.02] p-3 custom-scroll">
      <div className="mb-4 flex items-center gap-3 rounded-xl p-2"><div className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-white/10">{user?.pfpUrl ? <img src={user.pfpUrl} className="h-full w-full object-cover" alt="" /> : <UserRound className="h-5 w-5" />}</div><div className="min-w-0"><p className="truncate text-sm font-semibold">{user?.displayName || user?.username || "Synnical"}</p><p className="truncate text-[11px] text-white/35">{user ? `@${user.username}` : "Local session"}</p></div></div>
      <div className="mb-3 flex h-9 items-center rounded-lg border border-white/10 bg-black/25 px-2"><Search className="h-3.5 w-3.5 text-white/35" /><input name="settings-search" autoComplete="off" inputMode="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a setting" className="min-w-0 flex-1 bg-transparent px-2 text-xs outline-none" /></div>
      <nav className="space-y-0.5">{categories.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => { setQuery(""); setCategory(id); setLegacy(null) }} className={cn("relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors", category === id && !legacy ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/[0.06] hover:text-white")}><Icon className="h-4 w-4" />{label}{category === id && !legacy ? <span className="absolute left-0 h-4 w-0.5 rounded bg-sky-400" /> : null}</button>)}</nav>
      {!loaded ? <p className="mt-4 px-3 text-[10px] text-white/25">Syncing Synnical OS settings…</p> : null}
    </aside>
    <main className="min-w-0 flex-1 overflow-y-auto p-5 md:p-8 custom-scroll"><div className="mx-auto max-w-4xl">{searchView || legacyView || content[category]}</div></main>
  </div>
}
