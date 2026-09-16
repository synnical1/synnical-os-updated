import { constants } from "node:fs"
import { open } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

const MIME: Record<string, string> = {
  ".gif": "image/gif", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif",
  ".webm": "video/webm", ".mp4": "video/mp4", ".mov": "video/quicktime",
  ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav",
}

/** Serve only media files in the upload root, never nested paths or symlinks. */
export async function serveUpload(root: string, segments: string[], req: Request): Promise<Response> {
  const name = segments[0] || ""
  const mime = MIME[path.extname(name).toLowerCase()]
  if (segments.length !== 1 || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(name) || name.includes("..") || !mime) {
    return new Response("Not found", { status: 404 })
  }
  let file
  try {
    file = await open(path.join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW)
    const info = await file.stat()
    if (!info.isFile()) { await file.close(); return new Response("Not found", { status: 404 }) }
    const headers = new Headers({
      "Content-Type": mime, "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": `inline; filename="${name}"`,
    })
    let start = 0, end = info.size - 1, status = 200
    const range = req.headers.get("range")
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (match && (match[1] || match[2])) {
        if (!match[1]) start = Math.max(0, info.size - Number(match[2]))
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
      }
      if (!match || !(match[1] || match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
        await file.close()
        headers.set("Content-Range", `bytes */${info.size}`)
        return new Response(null, { status: 416, headers })
      }
      status = 206
      headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`)
    }
    headers.set("Content-Length", String(Math.max(0, end - start + 1)))
    if (req.method === "HEAD" || info.size === 0) { await file.close(); return new Response(null, { status, headers }) }
    const stream = file.createReadStream({ start, end, autoClose: true })
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers })
  } catch {
    await file?.close().catch(() => {})
    return new Response("Not found", { status: 404 })
  }
}
