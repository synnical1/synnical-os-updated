import { NextRequest, NextResponse } from "next/server"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { safeGameSlug } from "@/lib/local-games"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MIME: Record<string, string> = {
  ".html":"text/html; charset=utf-8",".htm":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".wasm":"application/wasm",".svg":"image/svg+xml",
  ".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif",".ico":"image/x-icon",
  ".mp3":"audio/mpeg",".ogg":"audio/ogg",".wav":"audio/wav",".mp4":"video/mp4",".webm":"video/webm",
  ".woff":"font/woff",".woff2":"font/woff2",".ttf":"font/ttf",".otf":"font/otf",".bin":"application/octet-stream",
}

function gameRoot() { return path.resolve(process.env.GAMES_DIR || "/var/lib/synnical/games") }

function safeRelative(parts: string[]) {
  const decoded = parts.map((part) => decodeURIComponent(part))
  if (!decoded.length || decoded.some((part) => !part || part === "." || part === ".." || part.includes("/") || part.includes("\\") || part.includes("\0"))) return null
  return decoded.join(path.sep)
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ slug: string; path: string[] }> }) {
  const { slug: rawSlug, path: parts } = await ctx.params
  const slug = safeGameSlug(rawSlug)
  const relative = safeRelative(parts || [])
  if (!slug || !relative) return NextResponse.json({ error: "Invalid game path" }, { status: 400 })

  const root = path.join(gameRoot(), slug)
  const candidate = path.resolve(root, relative)
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return NextResponse.json({ error: "Invalid game path" }, { status: 400 })

  try {
    const meta = await stat(candidate)
    if (!meta.isFile() || meta.size > 128 * 1024 * 1024) return NextResponse.json({ error: "Game asset unavailable" }, { status: 404 })
    const body = await readFile(candidate)
    const ext = path.extname(candidate).toLowerCase()
    const headers = new Headers({
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "private, no-cache" : "public, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Referrer-Policy": "no-referrer",
    })
    if (ext === ".html" || ext === ".htm") {
      headers.set("Content-Security-Policy", "default-src 'self' blob: data: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https:; style-src 'self' 'unsafe-inline' blob: data: https:; img-src 'self' blob: data: https:; media-src 'self' blob: data: https:; font-src 'self' blob: data: https:; connect-src 'self' https: wss:; frame-src https:; object-src 'none'; base-uri 'self'; form-action 'none'")
    }
    return new Response(body, { status: 200, headers })
  } catch {
    return NextResponse.json({ error: "Game asset not found" }, { status: 404 })
  }
}
