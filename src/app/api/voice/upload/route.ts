import { NextRequest, NextResponse } from "next/server"
import { mkdir, writeFile } from "fs/promises"
import path from "path"
import { uploadsDir } from "@/lib/uploads"
import { getCurrentUser } from "@/lib/auth-server"
import { transcribeAndModerateAudio } from "@/lib/content-moderation"
import { enforceRejectedModeration, moderationHttpStatus, moderationPublicError } from "@/lib/moderation-enforcement"
import { db } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB ≈ several minutes of Opus

const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
}

/**
 * POST /api/voice/upload
 *
 * The voice recorder component called `api.uploadVoice()`, but neither the
 * client helper nor this endpoint existed — voice messages failed every time.
 * Recordings are stored in the same uploads directory as avatars and served
 * back through /api/uploads/<file>.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 })

    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Missing recording" }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Recording too long (10 MB max)" }, { status: 413 })
    }

    // Browsers report types like "audio/webm;codecs=opus".
    const baseType = file.type.split(";")[0].trim().toLowerCase()
    const ext = EXT_BY_MIME[baseType]
    if (!ext) {
      return NextResponse.json({ error: "Unsupported audio format" }, { status: 415 })
    }

    const moderated = await transcribeAndModerateAudio(file)
    if (moderated.result.decision !== "allow") {
      const banned = await enforceRejectedModeration(user.id, moderated.result)
      return NextResponse.json(moderationPublicError(moderated.result, banned), { status: moderationHttpStatus(moderated.result, banned) })
    }

    const dir = uploadsDir()
    await mkdir(dir, { recursive: true })

    const filename = `${user.id}-voice-${Date.now()}${ext}`
    await writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()))
    const url = `/api/uploads/${filename}`
    const transcript = moderated.transcript || ""
    await db.voiceUpload.create({
      data: { userId: user.id, url, transcript, expiresAt: new Date(Date.now() + 30 * 60_000) },
    })
    await db.voiceUpload.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {})

    return NextResponse.json({ url, transcript, moderated: true })
  } catch (err) {
    console.error("[voice-upload] failed:", err)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
