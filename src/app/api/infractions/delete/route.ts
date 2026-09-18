import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { mayModerate } from "@/lib/moderation-service"
import { auditData } from "@/lib/audit-log"

// DELETE /api/infractions/delete — delete an infraction record (admin+ only).
// The infraction row may be removed, but the append-only audit entry remains.
export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (me.role !== "OWNER" && me.role !== "HEAD_ADMIN" && me.role !== "ADMIN") return NextResponse.json({ error: "Only admins can delete infractions" }, { status: 403 })
  const body = await req.json().catch(() => ({})) as { id?: unknown }
  const id = typeof body.id === "string" ? body.id : ""
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })

  const infraction = await db.infraction.findUnique({ where: { id }, include: { user: { select: { id: true, username: true, role: true } } } })
  if (!infraction) return NextResponse.json({ error: "Infraction not found" }, { status: 404 })
  if (!mayModerate(me, infraction.user)) return NextResponse.json({ error: "Cannot alter an equal or higher role's infractions" }, { status: 403 })
  const active = infraction.duration === null || infraction.createdAt.getTime() + infraction.duration * 60_000 > Date.now()
  if (active && ["BAN", "AUTO_BAN", "MUTE", "AUTO_MUTE"].includes(infraction.type)) return NextResponse.json({ error: "Revoke the restriction using Unban or Unmute before deleting its record" }, { status: 409 })
  await db.$transaction(async (tx) => {
    await tx.auditLog.create({ data: auditData({
      category: "MODERATION",
      action: "INFRACTION_RECORD_REMOVED",
      actor: me,
      target: { id: infraction.user.id, username: infraction.user.username },
      reason: infraction.reason,
      before: { id: infraction.id, type: infraction.type, duration: infraction.duration, createdAt: infraction.createdAt.toISOString() },
      after: { removed: true },
    }) })
    await tx.infraction.delete({ where: { id } })
    if (infraction.type === "WARN") await tx.user.updateMany({ where: { id: infraction.userId, warnCount: { gt: 0 } }, data: { warnCount: { decrement: 1 } } })
  })
  return NextResponse.json({ ok: true })
}
