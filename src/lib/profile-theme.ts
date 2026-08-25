export type ProfileThemeStyle = "solid" | "gradient"

export const DEFAULT_PROFILE_THEME = {
  primary: "#111111",
  accent: "#2b2b2b",
  style: "solid" as ProfileThemeStyle,
}

const HEX = /^#[0-9a-f]{6}$/i

export function normalizeProfileColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback
  const color = value.trim()
  return HEX.test(color) ? color.toLowerCase() : fallback
}

export function normalizeProfileThemeStyle(value: unknown): ProfileThemeStyle {
  return value === "gradient" ? "gradient" : "solid"
}

export function profileThemeBackground(primary: string, accent: string, style: ProfileThemeStyle): string {
  if (style === "gradient") return `linear-gradient(145deg, ${primary} 0%, ${accent} 100%)`
  return primary
}

function luminance(hex: string): number {
  const value = normalizeProfileColor(hex, "#111111").slice(1)
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

export function profileThemeTextColor(primary: string, accent: string): "#111111" | "#ffffff" {
  return (luminance(primary) + luminance(accent)) / 2 > 0.48 ? "#111111" : "#ffffff"
}
