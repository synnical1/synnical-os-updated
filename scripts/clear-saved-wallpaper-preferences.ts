import "dotenv/config"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PrismaClient } from "@prisma/client"
import { sanitizeOsSettings, WALLPAPER_DEFAULT_VERSION } from "../src/lib/os-settings"

type PreferenceClient = Pick<PrismaClient, "userPreference">

/** Clear v1/v2 account wallpapers once, preserving all other OS preferences. */
export async function clearSavedWallpaperPreferences(db: PreferenceClient): Promise<number> {
  const rows = await db.userPreference.findMany({
    where: { key: "os.settings" },
    select: { userId: true, value: true },
  })
  let cleared = 0
  for (const row of rows) {
    let raw: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(row.value)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>
    } catch {
      // Malformed legacy settings are treated as pre-v3 and safely normalized.
    }
    const currentVersion = Number(raw.wallpaperDefaultVersion ?? 0)
    if (Number.isFinite(currentVersion) && currentVersion >= WALLPAPER_DEFAULT_VERSION) continue
    const settings = sanitizeOsSettings({
      ...raw,
      wallpaperDefaultVersion: WALLPAPER_DEFAULT_VERSION - 1,
    })
    await db.userPreference.update({
      where: { userId_key: { userId: row.userId, key: "os.settings" } },
      data: { value: JSON.stringify(settings) },
    })
    cleared++
  }
  return cleared
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const db = new PrismaClient()
  try {
    const cleared = await clearSavedWallpaperPreferences(db)
    process.stdout.write(`Cleared saved wallpaper preferences for ${cleared} account(s).\n`)
  } finally {
    await db.$disconnect()
  }
}
