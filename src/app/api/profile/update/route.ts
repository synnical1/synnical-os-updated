import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { moderateTextContent } from "@/lib/content-moderation"
import { enforceRejectedModeration, moderationHttpStatus, moderationPublicError } from "@/lib/moderation-enforcement"
import { validateDisplayName } from "@/lib/profile-validation"

// PATCH /api/profile/update — update display name + bio + username (owner: 1-char username)
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { displayName, bio, username } = await req.json()

  const data: { displayName?: string; bio?: string; username?: string } = {}
  if (typeof displayName === "string") {
    const checked = validateDisplayName(displayName)
    if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
    data.displayName = checked.value
  }
  if (typeof bio === "string") {
    if (bio.length > 200) {
      return NextResponse.json({ error: "Bio too long (200 max)" }, { status: 400 })
    }
    data.bio = bio
  }
  if (typeof username === "string") {
    const u = username.trim().toLowerCase()
    const minLen = user.role === "OWNER" || user.role === "HEAD_ADMIN" || user.role === "ADMIN" ? 1 : 2
    if (u.length < minLen || u.length > 24) {
      return NextResponse.json({ error: `Username must be ${minLen}-24 chars` }, { status: 400 })
    }
    if (!/^[a-z0-9_.-]+$/.test(u)) {
      return NextResponse.json({ error: "Username may use letters, numbers, dots, underscores and hyphens" }, { status: 400 })
    }
    // Check if taken by someone else
    const existing = await db.user.findUnique({ where: { username: u } })
    if (existing && existing.id !== user.id) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 })
    }
    data.username = u
  }

  const moderationInput = Object.entries(data).map(([key, value]) => `${key}: ${value}`).join("\n")
  if (moderationInput) {
    const result = await moderateTextContent({ content: moderationInput, surface: "profile" })
    if (result.decision !== "allow") {
      const banned = await enforceRejectedModeration(user.id, result)
      return NextResponse.json(moderationPublicError(result, banned), { status: moderationHttpStatus(result, banned) })
    }
  }

  const updated = await db.user.update({ where: { id: user.id }, data })
  return NextResponse.json({ user: toSafeUser(updated) })
}
