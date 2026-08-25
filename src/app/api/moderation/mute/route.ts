import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { canModerate } from "@/lib/auth"
import { auditData } from "@/lib/audit-log"

// POST /api/moderation/mute — owner/admin/mod mutes a user
// body: { userId, durationMin? } (undefined = indefinite)
export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canModerate(me.role)) return NextResponse.json({ error: "You can't mute users" }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { userId?: unknown; durationMin?: unknown; reason?: unknown }
  const userId = typeof body.userId === "string" ? body.userId : ""
  const durationMin = typeof body.durationMin === "number" && Number.isFinite(body.durationMin) && body.durationMin > 0 ? Math.round(body.durationMin) : undefined
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : ""
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 })

  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })
  const rank = (r: string) => r === "OWNER" ? 5 : r === "HEAD_ADMIN" ? 4 : r === "ADMIN" ? 3 : r === "MOD" ? 2 : 1
  if (rank(target.role) >= rank(me.role)) return NextResponse.json({ error: "Can't mute a user of equal or higher role" }, { status: 403 })

  const mutedUntil = durationMin ? new Date(Date.now() + durationMin * 60 * 1000) : null
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { muted: true, mutedUntil } })
    await tx.auditLog.create({ data: auditData({
      category: "MODERATION",
      action: "USER_MUTED",
      actor: me,
      target: { id: target.id, username: target.username },
      reason: reason || "Staff mute",
      before: { muted: target.muted, mutedUntil: target.mutedUntil?.toISOString() || null },
      after: { muted: true, mutedUntil: mutedUntil?.toISOString() || null },
      metadata: { durationMin: durationMin ?? null },
    }) })
  })
  return NextResponse.json({ ok: true, muted: true, mutedUntil })
}
