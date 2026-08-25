import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { canModerate } from "@/lib/auth"
import { AUTO_PUNISHMENTS } from "@/lib/constants"
import { banKnownIdentities } from "@/lib/identity-ban"
import { auditData } from "@/lib/audit-log"

// POST /api/infractions/create — warn/mute/ban a user (mod+ only)
// body: { userId, type, reason, durationMin? }
export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canModerate(me.role)) return NextResponse.json({ error: "Only moderators can issue infractions" }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { userId?: unknown; type?: unknown; reason?: unknown; durationMin?: unknown }
  const userId = typeof body.userId === "string" ? body.userId : ""
  const type = typeof body.type === "string" ? body.type.toUpperCase() : ""
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : ""
  const durationMin = typeof body.durationMin === "number" && Number.isFinite(body.durationMin) && body.durationMin > 0 ? Math.round(body.durationMin) : undefined
  if (!userId || !["WARN", "MUTE", "BAN"].includes(type) || !reason) return NextResponse.json({ error: "Invalid input" }, { status: 400 })

  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })
  const rank = (r: string) => r === "OWNER" ? 5 : r === "HEAD_ADMIN" ? 4 : r === "ADMIN" ? 3 : r === "MOD" ? 2 : 1
  if (rank(target.role) >= rank(me.role)) return NextResponse.json({ error: "Can't infract a user of equal or higher role" }, { status: 403 })

  const newWarnCount = type === "WARN" ? target.warnCount + 1 : target.warnCount
  const automatic = type === "WARN"
    ? newWarnCount >= AUTO_PUNISHMENTS.WARN_THRESHOLD_PERM_BAN ? { type: "AUTO_BAN", duration: null as number | null, message: `User auto-banned (${newWarnCount} warnings)` }
      : newWarnCount >= AUTO_PUNISHMENTS.WARN_THRESHOLD_24H_MUTE ? { type: "AUTO_MUTE", duration: 1440, message: `User auto-muted for 24h (${newWarnCount} warnings)` }
      : newWarnCount >= AUTO_PUNISHMENTS.WARN_THRESHOLD_1H_MUTE ? { type: "AUTO_MUTE", duration: 60, message: `User auto-muted for 1h (${newWarnCount} warnings)` }
      : null
    : null

  const now = Date.now()
  const directMuteUntil = type === "MUTE" && durationMin ? new Date(now + durationMin * 60_000) : null
  const autoMuteUntil = automatic?.type === "AUTO_MUTE" && automatic.duration ? new Date(now + automatic.duration * 60_000) : null

  const result = await db.$transaction(async (tx) => {
    const infraction = await tx.infraction.create({ data: { userId, issuerId: me.id, type, reason, duration: durationMin || null } })

    if (type === "WARN") await tx.user.update({ where: { id: userId }, data: { warnCount: newWarnCount } })
    if (type === "MUTE") await tx.user.update({ where: { id: userId }, data: { muted: true, mutedUntil: directMuteUntil } })
    if (type === "BAN") {
      await tx.user.update({ where: { id: userId }, data: { muted: true, mutedUntil: null } })
      await tx.session.deleteMany({ where: { userId } })
    }

    await tx.auditLog.create({ data: auditData({
      category: "MODERATION",
      action: type === "WARN" ? "WARNING_ISSUED" : type === "MUTE" ? "USER_MUTED" : "USER_BANNED",
      actor: me,
      target: { id: target.id, username: target.username },
      reason,
      before: { warnCount: target.warnCount, muted: target.muted, mutedUntil: target.mutedUntil?.toISOString() || null },
      after: type === "WARN"
        ? { warnCount: newWarnCount }
        : type === "MUTE"
          ? { muted: true, mutedUntil: directMuteUntil?.toISOString() || null }
          : { muted: true, mutedUntil: null, sessionsRevoked: true },
      metadata: { infractionId: infraction.id, durationMin: durationMin ?? null },
    }) })

    if (automatic) {
      const autoReason = automatic.type === "AUTO_BAN"
        ? `Automatic ban: ${newWarnCount} warnings reached`
        : `Automatic ${automatic.duration === 1440 ? "24h" : "1h"} mute: ${newWarnCount} warnings`
      await tx.infraction.create({ data: { userId, issuerId: me.id, type: automatic.type, reason: autoReason, duration: automatic.duration } })
      if (automatic.type === "AUTO_BAN") {
        await tx.user.update({ where: { id: userId }, data: { muted: true, mutedUntil: null } })
        await tx.session.deleteMany({ where: { userId } })
      } else {
        await tx.user.update({ where: { id: userId }, data: { muted: true, mutedUntil: autoMuteUntil } })
      }
      await tx.auditLog.create({ data: auditData({
        category: "MODERATION",
        action: automatic.type === "AUTO_BAN" ? "AUTO_BAN_TRIGGERED" : "AUTO_MUTE_TRIGGERED",
        actor: me,
        target: { id: target.id, username: target.username },
        reason: autoReason,
        before: { warnCount: target.warnCount, muted: target.muted, mutedUntil: target.mutedUntil?.toISOString() || null },
        after: automatic.type === "AUTO_BAN"
          ? { warnCount: newWarnCount, muted: true, mutedUntil: null, sessionsRevoked: true }
          : { warnCount: newWarnCount, muted: true, mutedUntil: autoMuteUntil?.toISOString() || null },
        metadata: { trigger: "warn-threshold", durationMin: automatic.duration },
      }) })
    }

    return { infraction, autoPunishment: automatic ? { type: automatic.type, message: automatic.message } : null }
  })

  // Identity bans live in their own durable identity table and intentionally run
  // after the moderation transaction. The audit entry and account state are
  // already durable even if this external enforcement step throws.
  if (type === "BAN") await banKnownIdentities(userId, `Staff infraction ban: ${reason.slice(0, 160)}`)
  if (automatic?.type === "AUTO_BAN") await banKnownIdentities(userId, `Automatic ban after ${newWarnCount} warnings`)

  return NextResponse.json({ ok: true, ...result })
}
