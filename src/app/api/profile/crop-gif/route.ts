import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { AnimatedGifCropError, cropAnimatedGif, normalizeGifCrop } from "@/lib/animated-gif"
import { GIF_UPLOAD_MAX_BYTES, GIF_UPLOAD_MAX_LABEL } from "@/lib/media-limits"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 })

    const form = await req.formData()
    const file = form.get("file")
    const type = form.get("type")
    const rawCrop = form.get("crop")
    if (!(file instanceof File) || (type !== "pfp" && type !== "banner") || typeof rawCrop !== "string") {
      return NextResponse.json({ error: "Missing GIF crop data" }, { status: 400 })
    }
    if (file.size > GIF_UPLOAD_MAX_BYTES) return NextResponse.json({ error: GIF_UPLOAD_MAX_LABEL }, { status: 413 })

    let parsed: unknown
    try { parsed = JSON.parse(rawCrop) } catch { parsed = null }
    const crop = normalizeGifCrop(parsed)
    if (!crop) return NextResponse.json({ error: "Invalid crop selection" }, { status: 400 })

    const result = await cropAnimatedGif(Buffer.from(await file.arrayBuffer()), crop)
    return new Response(result.buffer, {
      status: 200,
      headers: {
        "Content-Type": "image/gif",
        "Content-Length": String(result.buffer.length),
        "Cache-Control": "no-store",
        "X-Synnical-Gif-Frames": String(result.pages),
      },
    })
  } catch (error) {
    if (error instanceof AnimatedGifCropError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("[profile-gif-crop] failed:", error)
    return NextResponse.json({ error: "GIF crop failed" }, { status: 500 })
  }
}
