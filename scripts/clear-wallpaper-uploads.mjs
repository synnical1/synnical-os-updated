import { readdir, unlink } from "node:fs/promises"

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
