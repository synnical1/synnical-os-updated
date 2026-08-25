import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { canModerate } from "@/lib/auth"
import { auditData } from "@/lib/audit-log"

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canModerate(me.role)) return NextResponse.json({ error: "You can't unmute users" }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { userId?: unknown; reason?: unknown }
  const userId = typeof body.userId === "string" ? body.userId : ""
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : ""
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 })
  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })

  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { muted: false, mutedUntil: null } })
    await tx.auditLog.create({ data: auditData({
      category: "MODERATION",
      action: "USER_UNMUTED",
      actor: me,
      target: { id: target.id, username: target.username },
      reason: reason || "Staff unmute",
      before: { muted: target.muted, mutedUntil: target.mutedUntil?.toISOString() || null },
      after: { muted: false, mutedUntil: null },
    }) })
  })
  return NextResponse.json({ ok: true })
}
