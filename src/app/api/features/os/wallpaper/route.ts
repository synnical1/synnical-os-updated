import { NextRequest, NextResponse } from "next/server"
import { mkdir, unlink, writeFile } from "fs/promises"
import path from "path"
import sharp, { type Metadata } from "sharp"
import { getCurrentUser } from "@/lib/auth-server"
import { getPreference, setPreference } from "@/lib/feature-platform"
import { uploadsDir } from "@/lib/uploads"
import { OS_DEFAULTS, sanitizeOsSettings } from "@/lib/os-settings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_VIDEO_BYTES = 80 * 1024 * 1024
const MAX_EDGE = 8192
const VIDEO_TYPES = new Map([
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"],
] as const)

function uploadName(url: string | undefined): string | null {
  if (!url?.startsWith("/api/uploads/")) return null
  const name = path.basename(url.split("?")[0] || "")
  return name && /^[A-Za-z0-9._-]+$/.test(name) ? name : null
}

function videoExtension(file: File, input: Buffer): string | null {
  const typeExt = VIDEO_TYPES.get(file.type as "video/mp4" | "video/webm" | "video/quicktime")
  const name = file.name.toLowerCase()
  const nameExt = name.endsWith(".webm") ? "webm" : name.endsWith(".mov") ? "mov" : name.endsWith(".mp4") ? "mp4" : null
  const ext = typeExt || nameExt
  if (!ext) return null
  const isWebm = input.length > 4 && input[0] === 0x1a && input[1] === 0x45 && input[2] === 0xdf && input[3] === 0xa3
  const isIsoVideo = input.length > 12 && input.subarray(4, 8).toString("ascii") === "ftyp"
  if (ext === "webm") return isWebm ? ext : null
  return isIsoVideo ? ext : null
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const form = await req.formData()
    const target = form.get("target")
    const file = form.get("file")
    if ((target !== "desktop" && target !== "lock") || !(file instanceof File)) {
      return NextResponse.json({ error: "Choose a desktop or lock-screen wallpaper" }, { status: 400 })
    }
    if (file.size > MAX_VIDEO_BYTES) return NextResponse.json({ error: "Wallpaper must be 80 MB or smaller" }, { status: 413 })
    const input = Buffer.from(await file.arrayBuffer())
    const videoExt = videoExtension(file, input)
    const isVideo = Boolean(videoExt)
    if (!file.size) return NextResponse.json({ error: "Wallpaper file is empty" }, { status: 400 })
    if (isVideo && file.size > MAX_VIDEO_BYTES) return NextResponse.json({ error: "Video wallpaper must be 80 MB or smaller" }, { status: 413 })
    if (!isVideo && file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Image wallpaper must be 12 MB or smaller" }, { status: 413 })

    const dir = uploadsDir()
    await mkdir(dir, { recursive: true })
    let filename: string
    if (isVideo) {
      filename = `${user.id}-os-${target}-wallpaper-${Date.now()}.${videoExt}`
      await writeFile(path.join(dir, filename), input)
    } else {
    let metadata: Metadata
    try {
      metadata = await sharp(input, { animated: false, failOn: "error", limitInputPixels: MAX_EDGE * MAX_EDGE }).metadata()
    } catch {
      return NextResponse.json({ error: "Use a JPG, PNG, WebP, AVIF, MP4, WebM or MOV wallpaper" }, { status: 400 })
    }
    if (!metadata.width || !metadata.height || metadata.width > MAX_EDGE || metadata.height > MAX_EDGE || !["jpeg", "png", "webp", "avif"].includes(metadata.format || "")) {
      return NextResponse.json({ error: "Use a JPG, PNG, WebP or AVIF image up to 8192px per edge" }, { status: 400 })
    }

    // Wallpaper is private personalization data, not public profile media. It
    // still gets decoded, metadata-stripped, bounded and re-encoded before it
    // is written to the persistent uploads directory.
    const sanitized = await sharp(input, { animated: false, failOn: "error", limitInputPixels: MAX_EDGE * MAX_EDGE })
      .rotate()
      .resize({ width: 3840, height: 2160, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 90, effort: 4 })
      .toBuffer()

      filename = `${user.id}-os-${target}-wallpaper-${Date.now()}.webp`
    await writeFile(path.join(dir, filename), sanitized)
    }
    const url = `/api/uploads/${filename}?v=${Date.now()}`

    const currentRaw = await getPreference<Record<string, unknown> | null>(user.id, "os.settings", null)
    const current = sanitizeOsSettings(currentRaw || OS_DEFAULTS)
    const previous = target === "desktop" ? current.desktopWallpaper : current.lockWallpaper
    const next = sanitizeOsSettings(target === "desktop"
      ? { ...current, desktopWallpaper: url }
      : { ...current, lockWallpaper: url, lockUseDesktopWallpaper: false })
    await setPreference(user.id, "os.settings", next)

    const previousName = uploadName(previous)
    if (previousName && previousName.startsWith(`${user.id}-os-`)) {
      const stillUsed = next.desktopWallpaper.includes(previousName) || next.lockWallpaper.includes(previousName)
      if (!stillUsed) await unlink(path.join(/* turbopackIgnore: true */ dir, previousName)).catch(() => {})
    }

    return NextResponse.json({ url, settings: next }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    console.error("[os/wallpaper] upload failed", error)
    return NextResponse.json({ error: "Wallpaper upload failed" }, { status: 500 })
  }
}
