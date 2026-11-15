import "dotenv/config"
import { readdir, unlink } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** Remove only files created by the OS desktop/lock wallpaper uploader. */
export async function clearWallpaperUploads(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return []
    throw error
  })
  const wallpaperFile = /-os-(?:desktop|lock)-wallpaper-\d+\.(?:webp|png|jpe?g|avif|mp4|webm|mov)$/i
  let removed = 0
  for (const entry of entries) {
    if (!entry.isFile() || !wallpaperFile.test(entry.name)) continue
    await unlink(path.join(directory, entry.name))
    removed += 1
  }
  return removed
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const configured = process.env.UPLOAD_DIR || "./uploads"
  const directory = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
  const removed = await clearWallpaperUploads(directory)
  process.stdout.write(`Cleared ${removed} saved wallpaper upload(s).\n`)
}
