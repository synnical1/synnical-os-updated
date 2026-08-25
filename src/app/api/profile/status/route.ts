import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { moderateTextContent } from "@/lib/content-moderation"
import { enforceRejectedModeration, moderationHttpStatus, moderationPublicError } from "@/lib/moderation-enforcement"

// PATCH /api/profile/status — set custom status text
export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { status } = await req.json()
  if (typeof status !== "string" || status.length > 100) {
    return NextResponse.json({ error: "Status too long (100 max)" }, { status: 400 })
  }
  const result = await moderateTextContent({ content: status, surface: "status" })
  if (result.decision !== "allow") {
    const banned = await enforceRejectedModeration(me.id, result)
    return NextResponse.json(moderationPublicError(result, banned), { status: moderationHttpStatus(result, banned) })
  }
  const updated = await db.user.update({ where: { id: me.id }, data: { status } })
  return NextResponse.json({ user: toSafeUser(updated) })
}
