import { NextRequest } from "next/server"
import { uploadsDir } from "@/lib/uploads"
import { serveUpload } from "@/lib/upload-serving"
import { getCurrentUser } from "@/lib/auth-server"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const segments = (await params).path
  const name = segments[0] || ""
  const privateWallpaper = /-os-(?:desktop|lock)-wallpaper-/.test(name)
  const privateChatMedia = /-(?:chat-image|voice)-/.test(name)

  if (privateWallpaper || privateChatMedia) {
    const user = await getCurrentUser()
    if (!user) return new Response("Not found", { status: 404 })

    if (privateWallpaper && !name.startsWith(`${user.id}-os-`)) {
      return new Response("Not found", { status: 404 })
    }

    if (privateChatMedia) {
      const url = `/api/uploads/${name}`
      const record = name.includes("-chat-image-")
        ? await db.chatImageUpload.findUnique({ where: { url }, select: { expiresAt: true } })
        : await db.voiceUpload.findUnique({ where: { url }, select: { expiresAt: true } })
      if (!record || record.expiresAt.getTime() <= Date.now()) {
        return new Response("Not found", { status: 404 })
      }
    }

    const response = await serveUpload(uploadsDir(), segments, req, "private, no-store")
    response.headers.set("Vary", "Cookie")
    return response
  }

  return serveUpload(uploadsDir(), segments, req)
}

export const HEAD = GET
