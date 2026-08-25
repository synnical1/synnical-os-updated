export type WallpaperFit = "fill" | "fit" | "stretch" | "center" | "tile"

export const LEGACY_OS_WALLPAPER = "/brand/wallpapers/samurai-cherry-blossom.png"
export const DEFAULT_OS_WALLPAPER = "/brand/wallpapers/synnical-static-ink-wallpaper.png"
export const BUILTIN_OS_WALLPAPERS = [] as const
const RETIRED_OS_WALLPAPERS = new Set([
  LEGACY_OS_WALLPAPER,
  "/brand/wallpapers/synnical-default-wallpaper.mp4",
  "/brand/wallpapers/sakura-samurai-1.png",
  "/brand/wallpapers/sakura-samurai-2.png",
  "/brand/wallpapers/sakura-samurai-3.png",
  "/brand/wallpapers/sakura-samurai-4.png",
])

export const OS_DEFAULTS = {
  enabled: true,
  taskbarAlignment: "center" as "center" | "left",
  taskbarAutoHide: false,
  taskbarSize: "medium" as "small" | "medium" | "large",
  showSearch: true,
  showTaskView: true,
  showWidgets: true,
  showDesktopIcons: true,
  desktopIconSize: "medium" as "small" | "medium" | "large",
  desktopAlignGrid: false,
  desktopSort: "none" as "none" | "name" | "type" | "recent",
  desktopLayouts: {} as Record<string, {
    order: string[]
    hidden: string[]
    labels: Record<string, string>
    customIcons: Record<string, string>
    positions: Record<string, { x: number; y: number }>
    folders: Array<{ id: string; name: string; items: string[] }>
  }>,
  snapWindows: true,
  snapLayouts: true,
  snapGroups: true,
  aeroShake: true,
  animations: true,
  animationSpeed: 100,
  transparency: true,
  windowTransparency: 96,
  windowCornerRadius: 8,
  glassStrength: 82,
  wallpaperDim: 0,
  wallpaperBlur: 0,
  wallpaperSaturation: 100,
  wallpaperSlideshow: false,
  wallpaperShuffle: false,
  wallpaperSlideshowMinutes: 10,
  focusAssist: "off" as "off" | "priority" | "alarms",
  focusSessionMinutes: 25,
  notificationRules: {} as Record<string, { enabled: boolean; priority: "normal" | "priority" | "urgent" }>,
  notificationHistory: true,
  nightLight: false,
  nightLightStrength: 28,
  osBrightness: 100,
  uiSoundVolume: 70,
  notificationsEnabled: true,
  cursorTheme: "system" as "system" | "light" | "dark" | "crosshair",
  cursorSize: 100,
  quickSettingsOrder: ["wifi", "bluetooth", "airplane", "battery", "access", "focus", "notifications", "night", "theme", "presence"] as string[],
  shortcuts: {
    taskManager: "Ctrl+Shift+Escape",
    run: "Ctrl+Alt+R",
    clipboard: "Ctrl+Shift+V",
    emoji: "Ctrl+Shift+E",
    taskView: "Ctrl+Alt+T",
    workspaceLeft: "Ctrl+Alt+ArrowLeft",
    workspaceRight: "Ctrl+Alt+ArrowRight",
    snapLeft: "Ctrl+Shift+ArrowLeft",
    snapRight: "Ctrl+Shift+ArrowRight",
    maximize: "Ctrl+Shift+ArrowUp",
    showDesktop: "Ctrl+Shift+D",
  } as Record<"taskManager" | "run" | "clipboard" | "emoji" | "taskView" | "workspaceLeft" | "workspaceRight" | "snapLeft" | "snapRight" | "maximize" | "showDesktop", string>,
  batterySaver: false,
  startRecentApps: true,
  startRecommended: true,
  startSearchHistory: true,
  startFolders: [] as Array<{ id: string; name: string; apps: string[] }>,
  restoreWindows: false,
  startupApps: [] as string[],
  hiddenLauncherApps: [] as string[],
  autoFullscreen: true,
  clockSeconds: false,
  additionalTimeZones: [] as string[],
  widgetDefaultsVersion: 1,
  desktopClockWidget: false,
  desktopWeatherWidget: false,
  desktopCalendarWidget: false,
  desktopRecentGamesWidget: false,
  desktopFriendsWidget: false,
  desktopCreditsWidget: false,
  desktopPinnedChatWidget: false,
  widgetLayouts: {} as Record<string, Record<string, { x: number; y: number; width: number; height: number }>>,
  workspaces: [
    { id: 1, name: "Desktop 1", wallpaper: "" },
    { id: 2, name: "Desktop 2", wallpaper: "" },
    { id: 3, name: "Desktop 3", wallpaper: "" },
  ] as Array<{ id: number; name: string; wallpaper: string }>,
  desktopWallpaper: DEFAULT_OS_WALLPAPER,
  desktopWallpaperFit: "fill" as WallpaperFit,
  lockUseDesktopWallpaper: true,
  lockWallpaper: DEFAULT_OS_WALLPAPER,
  lockWallpaperFit: "fill" as WallpaperFit,
  lockShowClock: true,
  lockShowNotifications: false,
  lockShowMedia: true,
  lockShowStatus: true,
  lockWallpaperSlideshow: false,
  autoLockMinutes: 0,
  requirePasswordAfterAutoLock: true,
  lockHideSensitiveNotificationText: true,
}

export type OsSettings = typeof OS_DEFAULTS

function wallpaperValue(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  const trimmed = value.trim().slice(0, 2048)
  if (!trimmed) return ""
  if (RETIRED_OS_WALLPAPERS.has(trimmed)) return DEFAULT_OS_WALLPAPER
  if (trimmed.startsWith("/api/uploads/") || trimmed.startsWith("/brand/") || /^https:\/\//i.test(trimmed)) return trimmed
  return fallback
}

export function sanitizeOsSettings(input: unknown): OsSettings {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {}
  const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => typeof v === "string" && values.includes(v as T) ? v as T : fallback
  const num = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback
  }
  const bool = (key: keyof OsSettings) => typeof value[key] === "boolean" ? value[key] as boolean : OS_DEFAULTS[key] as boolean
  const widgetDefaultsVersion = num(value.widgetDefaultsVersion, 0, 1, 0)
  const widgetBool = (key: keyof OsSettings) => widgetDefaultsVersion >= 1 ? bool(key) : false
  return {
    enabled: bool("enabled"),
    taskbarAlignment: oneOf(value.taskbarAlignment, ["center", "left"] as const, OS_DEFAULTS.taskbarAlignment),
    taskbarAutoHide: bool("taskbarAutoHide"),
    taskbarSize: oneOf(value.taskbarSize, ["small", "medium", "large"] as const, OS_DEFAULTS.taskbarSize),
    showSearch: bool("showSearch"),
    showTaskView: bool("showTaskView"),
    showWidgets: bool("showWidgets"),
    showDesktopIcons: bool("showDesktopIcons"),
    desktopIconSize: oneOf(value.desktopIconSize, ["small", "medium", "large"] as const, OS_DEFAULTS.desktopIconSize),
    desktopAlignGrid: bool("desktopAlignGrid"),
    desktopSort: oneOf(value.desktopSort, ["none", "name", "type", "recent"] as const, OS_DEFAULTS.desktopSort),
    desktopLayouts: (() => {
      const source = value.desktopLayouts && typeof value.desktopLayouts === "object" ? value.desktopLayouts as Record<string, unknown> : {}
      const result: OsSettings["desktopLayouts"] = {}
      for (const [workspaceId, raw] of Object.entries(source).slice(0, 9)) {
        if (!/^\d{1,4}$/.test(workspaceId) || !raw || typeof raw !== "object") continue
        const row = raw as Record<string, unknown>
        const cleanIds = (input: unknown, limit = 100) => Array.isArray(input) ? input.filter((item): item is string => typeof item === "string" && /^[a-z0-9:_-]{1,100}$/i.test(item)).slice(0, limit) : []
        const labels: Record<string, string> = {}
        if (row.labels && typeof row.labels === "object") for (const [key, label] of Object.entries(row.labels as Record<string, unknown>).slice(0,100)) if (/^[a-z0-9:_-]{1,100}$/i.test(key) && typeof label === "string" && label.trim()) labels[key] = label.trim().slice(0,60)
        const customIcons: Record<string, string> = {}
        if (row.customIcons && typeof row.customIcons === "object") for (const [key, icon] of Object.entries(row.customIcons as Record<string, unknown>).slice(0,100)) if (/^[a-z0-9:_-]{1,100}$/i.test(key) && typeof icon === "string" && (/^https:\/\//i.test(icon) || icon.startsWith("/api/uploads/") || icon.startsWith("/brand/"))) customIcons[key] = icon.slice(0,2048)
        const positions: Record<string, { x: number; y: number }> = {}
        if (row.positions && typeof row.positions === "object") for (const [key, pos] of Object.entries(row.positions as Record<string, unknown>).slice(0,100)) {
          if (!/^[a-z0-9:_-]{1,100}$/i.test(key) || !pos || typeof pos !== "object") continue
          const p = pos as Record<string, unknown>, x = Number(p.x), y = Number(p.y)
          if (Number.isFinite(x) && Number.isFinite(y)) positions[key] = { x: Math.max(0, Math.min(10000, Math.round(x))), y: Math.max(0, Math.min(10000, Math.round(y))) }
        }
        const folders = Array.isArray(row.folders) ? row.folders.flatMap((folder) => {
          if (!folder || typeof folder !== "object") return []
          const f = folder as Record<string, unknown>, id = typeof f.id === "string" ? f.id.slice(0,100) : "", name = typeof f.name === "string" ? f.name.trim().slice(0,60) : ""
          return id && name && /^[a-z0-9:_-]+$/i.test(id) ? [{ id, name, items: cleanIds(f.items, 50) }] : []
        }).slice(0,30) : []
        result[workspaceId] = { order: cleanIds(row.order), hidden: cleanIds(row.hidden), labels, customIcons, positions, folders }
      }
      return result
    })(),
    snapWindows: bool("snapWindows"),
    snapLayouts: bool("snapLayouts"),
    snapGroups: bool("snapGroups"),
    aeroShake: bool("aeroShake"),
    animations: bool("animations"),
    animationSpeed: num(value.animationSpeed, 50, 200, OS_DEFAULTS.animationSpeed),
    transparency: bool("transparency"),
    windowTransparency: num(value.windowTransparency, 70, 100, OS_DEFAULTS.windowTransparency),
    windowCornerRadius: num(value.windowCornerRadius, 0, 20, OS_DEFAULTS.windowCornerRadius),
    glassStrength: num(value.glassStrength, 20, 100, OS_DEFAULTS.glassStrength),
    wallpaperDim: num(value.wallpaperDim, 0, 75, OS_DEFAULTS.wallpaperDim),
    wallpaperBlur: num(value.wallpaperBlur, 0, 24, OS_DEFAULTS.wallpaperBlur),
    wallpaperSaturation: num(value.wallpaperSaturation, 0, 180, OS_DEFAULTS.wallpaperSaturation),
    wallpaperSlideshow: bool("wallpaperSlideshow"),
    wallpaperShuffle: bool("wallpaperShuffle"),
    wallpaperSlideshowMinutes: num(value.wallpaperSlideshowMinutes, 1, 120, OS_DEFAULTS.wallpaperSlideshowMinutes),
    focusAssist: oneOf(value.focusAssist, ["off", "priority", "alarms"] as const, OS_DEFAULTS.focusAssist),
    focusSessionMinutes: num(value.focusSessionMinutes, 5, 180, OS_DEFAULTS.focusSessionMinutes),
    notificationRules: (() => {
      const source = value.notificationRules && typeof value.notificationRules === "object" ? value.notificationRules as Record<string, unknown> : {}
      const result: Record<string, { enabled: boolean; priority: "normal" | "priority" | "urgent" }> = {}
      for (const [key, raw] of Object.entries(source).slice(0, 80)) {
        if (!/^[a-z0-9-]{1,40}$/i.test(key) || !raw || typeof raw !== "object") continue
        const row = raw as Record<string, unknown>
        result[key] = { enabled: row.enabled !== false, priority: oneOf(row.priority, ["normal", "priority", "urgent"] as const, "normal") }
      }
      return result
    })(),
    notificationHistory: bool("notificationHistory"),
    nightLight: bool("nightLight"),
    nightLightStrength: num(value.nightLightStrength, 0, 100, OS_DEFAULTS.nightLightStrength),
    osBrightness: num(value.osBrightness, 35, 125, OS_DEFAULTS.osBrightness),
    uiSoundVolume: num(value.uiSoundVolume, 0, 100, OS_DEFAULTS.uiSoundVolume),
    notificationsEnabled: bool("notificationsEnabled"),
    cursorTheme: oneOf(value.cursorTheme, ["system", "light", "dark", "crosshair"] as const, OS_DEFAULTS.cursorTheme),
    cursorSize: num(value.cursorSize, 75, 175, OS_DEFAULTS.cursorSize),
    quickSettingsOrder: (() => {
      const allowed = ["wifi", "bluetooth", "airplane", "battery", "access", "focus", "notifications", "night", "theme", "presence"]
      const rows = Array.isArray(value.quickSettingsOrder) ? value.quickSettingsOrder.filter((item): item is string => typeof item === "string" && allowed.includes(item)) : []
      const unique = [...new Set(rows)]
      return [...unique, ...allowed.filter((id) => !unique.includes(id))]
    })(),
    shortcuts: (() => {
      const source = value.shortcuts && typeof value.shortcuts === "object" ? value.shortcuts as Record<string, unknown> : {}
      const clean = (key: keyof typeof OS_DEFAULTS.shortcuts) => {
        const raw = source[key]
        if (typeof raw !== "string") return OS_DEFAULTS.shortcuts[key]
        const combo = raw.trim().slice(0, 64)
        return /^(?:(?:Ctrl|Alt|Shift|Meta)\+){1,4}(?:[A-Za-z0-9.]|Escape|Tab|ArrowLeft|ArrowRight|ArrowUp|ArrowDown)$/.test(combo) ? combo : OS_DEFAULTS.shortcuts[key]
      }
      return { taskManager: clean("taskManager"), run: clean("run"), clipboard: clean("clipboard"), emoji: clean("emoji"), taskView: clean("taskView"), workspaceLeft: clean("workspaceLeft"), workspaceRight: clean("workspaceRight"), snapLeft: clean("snapLeft"), snapRight: clean("snapRight"), maximize: clean("maximize"), showDesktop: clean("showDesktop") }
    })(),
    batterySaver: bool("batterySaver"),
    startRecentApps: bool("startRecentApps"),
    startRecommended: bool("startRecommended"),
    startSearchHistory: bool("startSearchHistory"),
    startFolders: (() => {
      if (!Array.isArray(value.startFolders)) return OS_DEFAULTS.startFolders
      return value.startFolders.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return []
        const row = raw as Record<string, unknown>
        const id = typeof row.id === "string" ? row.id.trim().slice(0,80) : ""
        const name = typeof row.name === "string" ? row.name.trim().slice(0,40) : ""
        const apps = Array.isArray(row.apps) ? [...new Set(row.apps.filter((app): app is string => typeof app === "string" && /^[a-z0-9-]{1,40}$/i.test(app)))].slice(0,18) : []
        return id && name && /^[a-z0-9:_-]+$/i.test(id) ? [{ id, name, apps }] : []
      }).slice(0,12)
    })(),
    restoreWindows: bool("restoreWindows"),
    startupApps: Array.isArray(value.startupApps) ? value.startupApps.filter((item): item is string => typeof item === "string" && /^[a-z0-9-]{1,40}$/i.test(item)).slice(0, 12) : OS_DEFAULTS.startupApps,
    hiddenLauncherApps: Array.isArray(value.hiddenLauncherApps) ? [...new Set(value.hiddenLauncherApps.filter((item): item is string => typeof item === "string" && /^[a-z0-9-]{1,40}$/i.test(item)))].slice(0, 24) : OS_DEFAULTS.hiddenLauncherApps,
    autoFullscreen: bool("autoFullscreen"),
    clockSeconds: bool("clockSeconds"),
    additionalTimeZones: (() => {
      const rows = Array.isArray(value.additionalTimeZones) ? value.additionalTimeZones : []
      const valid: string[] = []
      for (const raw of rows) {
        if (typeof raw !== "string" || valid.length >= 4) continue
        const zone = raw.trim().slice(0, 80)
        if (!zone || valid.includes(zone)) continue
        try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(new Date()); valid.push(zone) } catch {}
      }
      return valid
    })(),
    widgetDefaultsVersion: 1,
    desktopClockWidget: widgetBool("desktopClockWidget"),
    desktopWeatherWidget: widgetBool("desktopWeatherWidget"),
    desktopCalendarWidget: widgetBool("desktopCalendarWidget"),
    desktopRecentGamesWidget: widgetBool("desktopRecentGamesWidget"),
    desktopFriendsWidget: widgetBool("desktopFriendsWidget"),
    desktopCreditsWidget: widgetBool("desktopCreditsWidget"),
    desktopPinnedChatWidget: widgetBool("desktopPinnedChatWidget"),
    widgetLayouts: (() => {
      const source = value.widgetLayouts && typeof value.widgetLayouts === "object" ? value.widgetLayouts as Record<string, unknown> : {}
      const result: OsSettings["widgetLayouts"] = {}
      for (const [workspaceId, raw] of Object.entries(source).slice(0, 9)) {
        if (!/^\d{1,4}$/.test(workspaceId) || !raw || typeof raw !== "object") continue
        const layout: Record<string, { x: number; y: number; width: number; height: number }> = {}
        for (const [widgetId, item] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) {
          if (widgetId === "continue-watching" || !/^[a-z0-9-]{1,40}$/i.test(widgetId) || !item || typeof item !== "object") continue
          const row = item as Record<string, unknown>
          const x = Number(row.x), y = Number(row.y), width = Number(row.width), height = Number(row.height)
          if (![x,y,width,height].every(Number.isFinite)) continue
          layout[widgetId] = {
            x: Math.max(0, Math.min(10000, Math.round(x))),
            y: Math.max(0, Math.min(10000, Math.round(y))),
            width: Math.max(160, Math.min(640, Math.round(width))),
            height: Math.max(100, Math.min(520, Math.round(height))),
          }
        }
        result[workspaceId] = layout
      }
      return result
    })(),
    workspaces: (() => {
      const source = Array.isArray(value.workspaces) ? value.workspaces : OS_DEFAULTS.workspaces
      const result: Array<{ id: number; name: string; wallpaper: string }> = []
      const seen = new Set<number>()
      for (const raw of source) {
        if (!raw || typeof raw !== "object" || result.length >= 9) continue
        const row = raw as Record<string, unknown>
        const id = Math.floor(Number(row.id))
        if (!Number.isSafeInteger(id) || id < 1 || id > 9999 || seen.has(id)) continue
        seen.add(id)
        const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 40) : `Desktop ${id}`
        const wallpaper = wallpaperValue(row.wallpaper, "")
        result.push({ id, name, wallpaper })
      }
      return result.length ? result : [{ id: 1, name: "Desktop 1", wallpaper: "" }]
    })(),
    desktopWallpaper: wallpaperValue(value.desktopWallpaper, OS_DEFAULTS.desktopWallpaper),
    desktopWallpaperFit: oneOf(value.desktopWallpaperFit, ["fill", "fit", "stretch", "center", "tile"] as const, OS_DEFAULTS.desktopWallpaperFit),
    lockUseDesktopWallpaper: bool("lockUseDesktopWallpaper"),
    lockWallpaper: wallpaperValue(value.lockWallpaper, OS_DEFAULTS.lockWallpaper),
    lockWallpaperFit: oneOf(value.lockWallpaperFit, ["fill", "fit", "stretch", "center", "tile"] as const, OS_DEFAULTS.lockWallpaperFit),
    lockShowClock: bool("lockShowClock"),
    lockShowNotifications: bool("lockShowNotifications"),
    lockShowMedia: bool("lockShowMedia"),
    lockShowStatus: bool("lockShowStatus"),
    lockWallpaperSlideshow: bool("lockWallpaperSlideshow"),
    autoLockMinutes: num(value.autoLockMinutes, 0, 240, OS_DEFAULTS.autoLockMinutes),
    requirePasswordAfterAutoLock: bool("requirePasswordAfterAutoLock"),
    lockHideSensitiveNotificationText: bool("lockHideSensitiveNotificationText"),
  }
}

const KEY = "synnical:os:settings:v4"
const LEGACY_KEY = "synnical:os:settings:v3"
const OWNER_KEY = "synnical:os:settings-owner:v1"

export function readOsSettings(): OsSettings {
  if (typeof window === "undefined") return OS_DEFAULTS
  try {
    const current = localStorage.getItem(KEY)
    const legacy = localStorage.getItem(LEGACY_KEY)
    const parsed = JSON.parse(current || legacy || "{}")
    const settings = sanitizeOsSettings(parsed)
    if (!current) {
      try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch {}
    } else if (parsed && typeof parsed === "object") {
      const raw = { ...(parsed as Record<string, unknown>) }
      let changed = Object.prototype.hasOwnProperty.call(raw, "desktopContinueWatchingWidget")
      delete raw.desktopContinueWatchingWidget
      if (raw.widgetLayouts && typeof raw.widgetLayouts === "object") {
        const layouts = { ...(raw.widgetLayouts as Record<string, unknown>) }
        for (const [workspaceId, workspace] of Object.entries(layouts)) {
          if (!workspace || typeof workspace !== "object" || !Object.prototype.hasOwnProperty.call(workspace, "continue-watching")) continue
          const nextWorkspace = { ...(workspace as Record<string, unknown>) }
          delete nextWorkspace["continue-watching"]
          layouts[workspaceId] = nextWorkspace
          changed = true
        }
        raw.widgetLayouts = layouts
      }
      if (changed) {
        try { localStorage.setItem(KEY, JSON.stringify(raw)) } catch {}
      }
    }
    return settings
  } catch { return OS_DEFAULTS }
}

export function writeOsSettings(settings: OsSettings) {
  if (typeof window === "undefined") return
  try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch {}
  window.dispatchEvent(new CustomEvent("synnical-os-settings-changed", { detail: { settings } }))
}

export async function persistOsSettings(settings: OsSettings) {
  writeOsSettings(settings)
  try {
    const res = await fetch("/api/features/os", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings }) })
    if (!res.ok) return settings
    const body = await res.json().catch(() => null)
    const saved = sanitizeOsSettings(body?.settings || settings)
    writeOsSettings(saved)
    return saved
  } catch { return settings }
}

export async function hydrateOsSettings() {
  const local = readOsSettings()
  try {
    const res = await fetch("/api/features/os", { credentials: "include", cache: "no-store" })
    if (!res.ok) return local
    const body = await res.json().catch(() => null)
    if (!body?.signedIn) return local
    let owner = ""
    try { owner = localStorage.getItem(OWNER_KEY) || "" } catch {}
    if (body.hasSaved !== true) {
      const seed = !owner || owner === body.accountId ? local : OS_DEFAULTS
      const saved = await persistOsSettings(seed)
      try { localStorage.setItem(OWNER_KEY, String(body.accountId || "signed-in")) } catch {}
      return saved
    }
    const saved = sanitizeOsSettings(body.settings || OS_DEFAULTS)
    writeOsSettings(saved)
    try { localStorage.setItem(OWNER_KEY, String(body.accountId || "signed-in")) } catch {}
    return saved
  } catch { return local }
}

export function wallpaperCss(url: string, fit: WallpaperFit): { backgroundImage?: string; backgroundSize: string; backgroundPosition: string; backgroundRepeat: string } {
  const safeUrl = url ? `url(${JSON.stringify(url)})` : undefined
  if (fit === "fit") return { backgroundImage: safeUrl, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat" }
  if (fit === "stretch") return { backgroundImage: safeUrl, backgroundSize: "100% 100%", backgroundPosition: "center", backgroundRepeat: "no-repeat" }
  if (fit === "center") return { backgroundImage: safeUrl, backgroundSize: "auto", backgroundPosition: "center", backgroundRepeat: "no-repeat" }
  if (fit === "tile") return { backgroundImage: safeUrl, backgroundSize: "auto", backgroundPosition: "left top", backgroundRepeat: "repeat" }
  return { backgroundImage: safeUrl, backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" }
}
