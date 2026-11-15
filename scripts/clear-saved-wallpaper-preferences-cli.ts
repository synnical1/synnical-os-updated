import "dotenv/config"
import { PrismaClient } from "@prisma/client"
import { clearSavedWallpaperPreferences } from "./clear-saved-wallpaper-preferences"

async function main() {
  const db = new PrismaClient()
  try {
    const cleared = await clearSavedWallpaperPreferences(db)
    process.stdout.write(`Cleared saved wallpaper preferences for ${cleared} account(s).\n`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((error) => {
  console.error("[wallpaper preference cleanup] failed", error)
  process.exitCode = 1
})
