import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { TRUSTED_REQUIREMENTS } from "@/lib/constants"

// GET /api/account/stats — returns account standing + statistics + trusted status
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const accountAgeDays = Math.floor((Date.now() - me.createdAt.getTime()) / (1000 * 60 * 60 * 24))

  // Count infractions in last 30 days
  const thirtyDaysAgo = new Date(Date.now() - TRUSTED_REQUIREMENTS.NO_INFRACTION_DAYS * 24 * 60 * 60 * 1000)
  const [recentInfractions, totalInfractions, messageCount] = await Promise.all([
    db.infraction.count({ where: { userId: me.id, createdAt: { gte: thirtyDaysAgo } } }),
    db.infraction.count({ where: { userId: me.id } }),
    db.message.count({ where: { userId: me.id, deleted: false } }),
  ])

  // User.messageCount is kept as a fast denormalized counter for older code,
  // but account/profile statistics use the durable Message table so historical
  // drift can no longer show the wrong number. Repair the cache opportunistically.
  if (me.messageCount !== messageCount) {
    void db.user.update({ where: { id: me.id }, data: { messageCount } }).catch(() => {})
  }

  // Trusted = old enough + enough messages + no recent infractions
  // Existing users (created before this system) are grandfathered as trusted
  const isTrusted =
    me.role === "OWNER" ||
    me.role === "HEAD_ADMIN" ||
    me.role === "ADMIN" ||
    me.role === "MOD" ||
    (accountAgeDays >= TRUSTED_REQUIREMENTS.MIN_ACCOUNT_AGE_DAYS &&
     messageCount >= TRUSTED_REQUIREMENTS.MIN_MESSAGES &&
     recentInfractions === 0)

  return NextResponse.json({
    stats: {
      accountAgeDays,
      messageCount,
      warnCount: me.warnCount,
      totalInfractions,
      recentInfractions,
      isTrusted,
      role: me.role,
      createdAt: me.createdAt.toISOString(),
    },
    requirements: TRUSTED_REQUIREMENTS,
  })
}
