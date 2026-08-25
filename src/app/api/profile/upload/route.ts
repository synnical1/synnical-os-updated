import { NextRequest, NextResponse } from "next/server"
import { mkdir, writeFile, unlink } from "fs/promises"
import path from "path"
import { uploadsDir } from "@/lib/uploads"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { queueMedia } from "@/lib/media-approvals"
import { moderateAndSanitizeImage, PROFILE_UPLOAD_MAX_BYTES } from "@/lib/content-moderation"
import {
  moderationHttpStatus,
  moderationPublicError,
  enforceRejectedModeration,
} from "@/lib/moderation-enforcement"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Not logged in" }, { status: 401 })
    }

    const form = await req.formData()
    const type = form.get("type")
    const file = form.get("file")

    if (!(file instanceof File) || typeof type !== "string") {
      return NextResponse.json({ error: "Missing file" }, { status: 400 })
    }
    if (type !== "pfp" && type !== "banner") {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 })
    }
    if (file.size > PROFILE_UPLOAD_MAX_BYTES) {
      const maxMegabytes = Math.floor(PROFILE_UPLOAD_MAX_BYTES / (1024 * 1024))
      return NextResponse.json({ error: `Image too large (${maxMegabytes} MB max)` }, { status: 413 })
    }

    const checked = await moderateAndSanitizeImage(Buffer.from(await file.arrayBuffer()), type)
    if (!checked.buffer || !checked.extension) {
      return NextResponse.json(moderationPublicError(checked.result, false), { status: moderationHttpStatus(checked.result, false) })
    }

    const isStaff = new Set(["OWNER", "HEAD_ADMIN", "ADMIN", "MOD"]).has(user.role)

    // Member profile media is never published immediately. Sharp has already
    // decoded, bounded, stripped and re-encoded it; staff reviews the sanitized
    // WebP from a private queue before it can become public. Verified staff
    // uploads publish immediately and never enter their own approval queue.
    if (!isStaff) {
      const pending = await queueMedia({
        userId: user.id,
        username: user.username,
        type,
        animated: Boolean(checked.animated),
        automatedCode: checked.result.code,
      }, checked.buffer)
      // Keep one stable client contract for both immediate publication and
      // approval-queue responses. Older profile panels always apply
      // `result.user`; returning the unchanged, sanitised current user is safe
      // and prevents those clients from writing `undefined` into auth state.
      return NextResponse.json({
        pending: true,
        approval: { id: pending.id, status: "pending" },
        user: toSafeUser(user),
      }, { status: 202 })
    }
    // An upstream vision quota outage must not lock the database-verified
    // staff out of updating their own profiles. This narrow exception is only
    // possible after Sharp has safely decoded, stripped and re-encoded the
    // file and the full animation scan has succeeded. Malformed media,
    // animations beyond the configured limits and explicit unsafe verdicts
    // never carry a sanitized buffer and therefore cannot use this path.
    const staffProviderOutageFallback =
      isStaff &&
      checked.result.code === "MODERATION_UNAVAILABLE" &&
      Boolean(checked.buffer && checked.extension)

    if (checked.result.decision !== "allow" && !staffProviderOutageFallback) {
      const banned = await enforceRejectedModeration(user.id, checked.result)
      return NextResponse.json(moderationPublicError(checked.result, banned), { status: moderationHttpStatus(checked.result, banned) })
    }
    if (staffProviderOutageFallback) {
      console.warn(`[moderation/image] verified staff ${user.id} published sanitized ${type} media during a classifier outage`)
    }

    // Resolve to an absolute directory and guarantee it exists. Previously this
    // was a bare relative path, so the folder depended on the process's working
    // directory — under PM2 that is not always the project root.
    const dir = uploadsDir()
    await mkdir(dir, { recursive: true })

    const filename = `${user.id}-${type}-${Date.now()}${checked.extension}`
    const target = path.join(dir, filename)
    await writeFile(target, checked.buffer)

    // Remove the previous file so the uploads folder doesn't grow forever.
    const previous = type === "banner" ? user.bannerUrl : user.pfpUrl
    if (previous?.startsWith("/api/uploads/")) {
      const oldName = path.basename(previous.split("?")[0])
      if (oldName && oldName !== filename) {
        await unlink(path.join(dir, oldName)).catch(() => {})
      }
    }

    // Cache-busting query so the browser shows the new image immediately
    // instead of the previously cached avatar.
    const url = `/api/uploads/${filename}?v=${Date.now()}`

    const updated = await db.user.update({
      where: { id: user.id },
      data:
        type === "banner"
          ? { bannerUrl: url, bannerIsGif: Boolean(checked.animated) }
          : { pfpUrl: url, pfpIsGif: Boolean(checked.animated) },
    })

    // Return a SANITISED user. The previous version returned the raw Prisma
    // record, which included the user's `passwordHash` in the HTTP response.
    return NextResponse.json({ url, user: toSafeUser(updated) })
  } catch (err) {
    console.error("[upload] failed:", err)
    return NextResponse.json({ error: "Upload failed" }, { status: 500 })
  }
}
