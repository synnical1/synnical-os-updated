import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { auditData } from "@/lib/audit-log"

const rank: Record<string, number> = { MEMBER: 0, MOD: 1, ADMIN: 2, HEAD_ADMIN: 3, OWNER: 4 }

function activeUntil(createdAt: Date, duration: number | null): Date | null | false {
  if (duration === null) return null
  const expires = new Date(createdAt.getTime() + Math.max(0, duration) * 60_000)
  return expires.getTime() > Date.now() ? expires : false
}

export async function POST(req: NextRequest) {
  const actor = await getCurrentUser()
  if (!actor || (rank[actor.role] ?? -1) < rank.MOD) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { userId } = await req.json().catch(() => ({}))
  if (typeof userId !== "string" || !userId) return NextResponse.json({ error: "User required" }, { status: 400 })
  if (userId === actor.id) return NextResponse.json({ error: "You cannot unban your own account" }, { status: 409 })

  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) return NextResponse.json({ error: "Account not found" }, { status: 404 })
  if ((rank[actor.role] ?? -1) <= (rank[target.role] ?? 0)) return NextResponse.json({ error: "You cannot unban an equal or higher staff role" }, { status: 403 })

  const permanentBans = await db.infraction.findMany({
    where: { userId, type: { in: ["BAN", "AUTO_BAN"] }, duration: null },
    orderBy: { createdAt: "desc" },
  })
  if (!permanentBans.length) return NextResponse.json({ error: "This account has no active permanent ban" }, { status: 409 })

  const result = await db.$transaction(async (tx) => {
    const revoked = await tx.infraction.updateMany({
      where: { id: { in: permanentBans.map((row) => row.id) } },
      data: { duration: 0 },
    })
    const identities = await tx.bannedIdentity.deleteMany({ where: { sourceUserId: userId } })

    const muteRows = await tx.infraction.findMany({
      where: { userId, type: { in: ["MUTE", "AUTO_MUTE"] } },
      orderBy: { createdAt: "desc" },
    })
    let muted = false
    let mutedUntil: Date | null = null
    for (const row of muteRows) {
      const until = activeUntil(row.createdAt, row.duration)
      if (until === false) continue
      muted = true
      if (until === null) { mutedUntil = null; break }
      if (!mutedUntil || until.getTime() > mutedUntil.getTime()) mutedUntil = until
    }

    await tx.user.update({ where: { id: userId }, data: { muted, mutedUntil } })
    await tx.infraction.create({ data: { userId, issuerId: actor.id, type: "UNBAN", reason: `Ban revoked by @${actor.username}`, duration: 0 } })
    await tx.auditLog.create({ data: auditData({
      category: "MODERATION",
      action: "USER_UNBANNED",
      actor,
      target: { id: target.id, username: target.username },
      reason: "Permanent ban revoked from Moderation",
      before: { muted: target.muted, mutedUntil: target.mutedUntil?.toISOString() || null, banIds: permanentBans.map((row) => row.id), banTypes: permanentBans.map((row) => row.type) },
      after: { muted, mutedUntil: mutedUntil?.toISOString() || null, activePermanentBans: 0 },
      metadata: { revokedBans: revoked.count, removedIdentityBans: identities.count },
    }) })
    return { revoked: revoked.count, identities: identities.count, muted, mutedUntil }
  })

  return NextResponse.json({ ok: true, userId, username: target.username, ...result })
}
