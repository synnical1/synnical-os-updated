import "dotenv/config"
import path from "node:path"
import { clearWallpaperUploads } from "./clear-wallpaper-uploads.mjs"

async function main() {
  const configured = process.env.UPLOAD_DIR || "./uploads"
  const directory = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
  const removed = await clearWallpaperUploads(directory)
  process.stdout.write(`Cleared ${removed} saved wallpaper upload(s).\n`)
}

main().catch((error) => {
  console.error("[wallpaper cleanup] failed", error)
  process.exitCode = 1
})
