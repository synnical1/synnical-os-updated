import { NextRequest, NextResponse } from "next/server"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { getCurrentUser } from "@/lib/auth-server"
import { moderateAndSanitizeImage, PROFILE_UPLOAD_MAX_BYTES } from "@/lib/content-moderation"
import { db } from "@/lib/db"
import { uploadsDir } from "@/lib/uploads"
import { GIF_UPLOAD_MAX_BYTES, GIF_UPLOAD_MAX_LABEL } from "@/lib/media-limits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 })

    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Missing image" }, { status: 400 })
    }
    const input = Buffer.from(await file.arrayBuffer())
    const hasGifSignature = input.subarray(0, 6).toString("ascii") === "GIF87a" || input.subarray(0, 6).toString("ascii") === "GIF89a"
    if ((hasGifSignature || file.type === "image/gif" || /\.gif$/i.test(file.name)) && file.size > GIF_UPLOAD_MAX_BYTES) {
      return NextResponse.json({ error: GIF_UPLOAD_MAX_LABEL }, { status: 413 })
    }
    if (file.size > PROFILE_UPLOAD_MAX_BYTES) {
      const maxMegabytes = Math.floor(PROFILE_UPLOAD_MAX_BYTES / (1024 * 1024))
      return NextResponse.json({ error: `Image too large (${maxMegabytes} MB max)` }, { status: 413 })
    }

    const checked = await moderateAndSanitizeImage(input, "chat")
    if (!checked.buffer || !checked.extension) {
      return NextResponse.json({ error: checked.result.reason || "Image could not be processed" }, { status: 400 })
    }

    const dir = uploadsDir()
    await mkdir(dir, { recursive: true })
    const filename = `${user.id}-chat-image-${Date.now()}${checked.extension}`
    await writeFile(path.join(dir, filename), checked.buffer)
    const url = `/api/uploads/${filename}`
    await db.chatImageUpload.create({
      data: { userId: user.id, url, expiresAt: new Date(Date.now() + 30 * 60_000) },
    })
    await db.chatImageUpload.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {})

    return NextResponse.json({ url, mime: checked.mime || "image/webp", animated: Boolean(checked.animated) })
  } catch (error) {
    console.error("[chat-image-upload] failed:", error)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
