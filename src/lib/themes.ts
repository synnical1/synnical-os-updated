export type ThemeId =
  | "synnical"
  | "blood"
  | "ocean"
  | "forest"
  | "sunset"
  | "midnight"
  | "lavender"
  | "cyberpunk"
  | "monochrome"
  | "amber"

export interface ThemeDef {
  id: ThemeId
  name: string
  colors: string[]
  vars: Record<string, string>
}

function darkTheme(id: ThemeId, name: string, accent: string, hover: string, soft: string): ThemeDef {
  return {
    id, name, colors: ["#000000", accent, soft],
    vars: {
      "--synnical-accent": accent,
      "--synnical-accent-hover": hover,
      "--synnical-accent-soft": soft,
      "--synnical-bg": "#000000",
      "--synnical-surface": "#070707",
      "--synnical-surface-2": "#101010",
      "--synnical-border": "#242424",
      "--synnical-text": "#f7f7f7",
      "--synnical-muted": "#8a8a8a",
    },
  }
}

export const THEMES: ThemeDef[] = [
  darkTheme("blood", "Blood", "#dc2626", "#ef4444", "#1f0909"),
  darkTheme("synnical", "OLED Black", "#ffffff", "#e8e8e8", "#151515"),
  darkTheme("ocean", "Ocean", "#2563eb", "#3b82f6", "#07142e"),
  darkTheme("forest", "Forest", "#16a34a", "#22c55e", "#071b0e"),
  darkTheme("sunset", "Sunset", "#ea580c", "#f97316", "#261006"),
  darkTheme("midnight", "Midnight", "#4f46e5", "#6366f1", "#0d0b26"),
  darkTheme("lavender", "Lavender", "#9333ea", "#a855f7", "#1b0928"),
  darkTheme("cyberpunk", "Cyberpunk", "#db2777", "#ec4899", "#260817"),
  darkTheme("monochrome", "Monochrome", "#a3a3a3", "#d4d4d4", "#171717"),
  darkTheme("amber", "Amber", "#d97706", "#f59e0b", "#241504"),
]

const BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]))

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && BY_ID.has(value as ThemeId)
}

export function getTheme(id: string): ThemeDef {
  return BY_ID.get(id as ThemeId) || BY_ID.get("blood")!
}

export function applyTheme(id: string) {
  if (typeof document === "undefined") return
  const theme = getTheme(id)
  const root = document.documentElement
  root.dataset.synnicalTheme = theme.id

  for (const [key, value] of Object.entries(theme.vars)) root.style.setProperty(key, value)

  const v = theme.vars
  root.style.setProperty("--background", v["--synnical-bg"])
  root.style.setProperty("--foreground", v["--synnical-text"])
  root.style.setProperty("--card", v["--synnical-surface"])
  root.style.setProperty("--card-foreground", v["--synnical-text"])
  root.style.setProperty("--popover", v["--synnical-surface"])
  root.style.setProperty("--popover-foreground", v["--synnical-text"])
  root.style.setProperty("--primary", v["--synnical-accent"])
  root.style.setProperty("--primary-foreground", theme.id === "synnical" ? "#000000" : "#ffffff")
  root.style.setProperty("--secondary", v["--synnical-surface-2"])
  root.style.setProperty("--secondary-foreground", v["--synnical-text"])
  root.style.setProperty("--muted", v["--synnical-surface-2"])
  root.style.setProperty("--muted-foreground", v["--synnical-muted"])
  root.style.setProperty("--border", v["--synnical-border"])
  root.style.setProperty("--input", v["--synnical-border"])
  root.style.setProperty("--ring", v["--synnical-accent"])
  root.style.setProperty("--accent", v["--synnical-accent-soft"])
  root.style.setProperty("--accent-foreground", "#ffffff")
  root.style.setProperty("--destructive", "#ef4444")
  root.style.setProperty("--sidebar", "#030303")
  root.style.setProperty("--sidebar-foreground", "#f7f7f7")
  root.style.setProperty("--sidebar-border", "#242424")
  root.style.setProperty("--sidebar-accent", v["--synnical-accent-soft"])
  root.style.setProperty("--sidebar-accent-foreground", "#ffffff")
}
