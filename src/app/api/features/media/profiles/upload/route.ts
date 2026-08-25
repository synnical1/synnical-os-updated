import { NextRequest, NextResponse } from "next/server"
import { mkdir, unlink, writeFile } from "fs/promises"
import path from "path"
import sharp from "sharp"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { uploadsDir } from "@/lib/uploads"
import { ownedMediaProfile, profileDataJson, profileFromRecord } from "@/lib/synnflix-profiles-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BYTES = 8 * 1024 * 1024
const MAX_EDGE = 8192

function uploadedName(url: string | null): string | null {
  if (!url?.startsWith("/api/uploads/")) return null
  const name = path.basename(url.split("?")[0] || "")
  return /^[A-Za-z0-9._-]+$/.test(name) ? name : null
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const form = await req.formData()
    const profileId = form.get("profileId")
    const file = form.get("file")
    const record = await ownedMediaProfile(me.id, profileId)
    if (!record) return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose an image" }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "Profile image must be 8 MB or smaller" }, { status: 413 })

    const input = Buffer.from(await file.arrayBuffer())
    try {
      const metadata = await sharp(input, { animated: false, failOn: "error", limitInputPixels: MAX_EDGE * MAX_EDGE }).metadata()
      if (!metadata.width || !metadata.height || metadata.width > MAX_EDGE || metadata.height > MAX_EDGE || !["jpeg", "png", "webp", "avif"].includes(metadata.format || "")) {
        return NextResponse.json({ error: "Use a JPG, PNG, WebP or AVIF image" }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: "That image could not be decoded safely" }, { status: 400 })
    }

    const sanitized = await sharp(input, { animated: false, failOn: "error", limitInputPixels: MAX_EDGE * MAX_EDGE })
      .rotate()
      .resize(512, 512, { fit: "cover", position: "attention" })
      .webp({ quality: 88, effort: 4 })
      .toBuffer()
    const dir = uploadsDir()
    await mkdir(dir, { recursive: true })
    const filename = `${me.id}-synnflix-${record.id}-${Date.now()}.webp`
    await writeFile(path.join(dir, filename), sanitized)
    const url = `/api/uploads/${filename}?v=${Date.now()}`

    const current = profileFromRecord(record)
    const updated = await db.featureRecord.update({
      where: { id: record.id },
      data: { dataJson: profileDataJson({ ...current, avatarUrl: url }) },
    })
    const previous = uploadedName(current.avatarUrl)
    if (previous && previous !== filename) await unlink(path.join(/* turbopackIgnore: true */ dir, previous)).catch(() => {})
    return NextResponse.json({ profile: profileFromRecord(updated) })
  } catch (error) {
    console.error("[synnflix/profile-upload] failed", error)
    return NextResponse.json({ error: "Profile image upload failed" }, { status: 500 })
  }
}
