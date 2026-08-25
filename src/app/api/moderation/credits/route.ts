import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { auditData } from "@/lib/audit-log"

const rank: Record<string, number> = { MEMBER: 0, MOD: 1, ADMIN: 2, HEAD_ADMIN: 3, OWNER: 4 }
const MAX_ADJUSTMENT = 1_000_000
const MAX_BALANCE = 2_000_000_000

export async function POST(req: NextRequest) {
  const actor = await getCurrentUser()
  if (!actor || (rank[actor.role] ?? -1) < rank.MOD) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { userId?: unknown; delta?: unknown; reason?: unknown }
  const userId = typeof body.userId === "string" ? body.userId : ""
  const delta = Number(body.delta)
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 240) : ""
  if (!userId || !Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > MAX_ADJUSTMENT) {
    return NextResponse.json({ error: `Adjustment must be a whole number from -${MAX_ADJUSTMENT.toLocaleString()} to ${MAX_ADJUSTMENT.toLocaleString()}, excluding 0.` }, { status: 400 })
  }
  if (userId === actor.id) return NextResponse.json({ error: "You cannot adjust your own credits" }, { status: 409 })

  try {
    const updated = await db.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: userId } })
      if (!target) throw new Error("ACCOUNT_NOT_FOUND")
      if ((rank[actor.role] ?? -1) <= (rank[target.role] ?? 0)) throw new Error("ROLE_FORBIDDEN")

      const before = target.coins
      const after = before + delta
      if (after < 0) throw new Error("NEGATIVE_BALANCE")
      if (after > MAX_BALANCE) throw new Error("BALANCE_LIMIT")

      const user = await tx.user.update({ where: { id: target.id }, data: { coins: after } })
      const description = reason
        ? `Staff credit adjustment by @${actor.username}: ${reason}`
        : `Staff credit adjustment by @${actor.username}`
      await tx.currencyTransaction.create({
        data: { userId: target.id, amount: delta, type: "STAFF_ADJUSTMENT", description },
      })
      await tx.creditAudit.create({
        data: {
          actorId: actor.id,
          actorUsername: actor.username,
          targetId: target.id,
          targetUsername: target.username,
          delta,
          beforeBalance: before,
          afterBalance: after,
          reason: reason || "Staff credit adjustment",
        },
      })
      await tx.auditLog.create({ data: auditData({
        category: "ECONOMY",
        action: delta > 0 ? "CREDITS_ADDED" : "CREDITS_REMOVED",
        actor,
        target: { id: target.id, username: target.username },
        reason: reason || "Staff credit adjustment",
        before: { coins: before },
        after: { coins: after },
        metadata: { delta },
      }) })
      return user
    })
    return NextResponse.json({ user: toSafeUser(updated) })
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (code === "ACCOUNT_NOT_FOUND") return NextResponse.json({ error: "Account not found" }, { status: 404 })
    if (code === "ROLE_FORBIDDEN") return NextResponse.json({ error: "You cannot adjust credits for an equal or higher staff role" }, { status: 403 })
    if (code === "NEGATIVE_BALANCE") return NextResponse.json({ error: "That removal would make the account balance negative" }, { status: 409 })
    if (code === "BALANCE_LIMIT") return NextResponse.json({ error: "That adjustment would exceed the account credit limit" }, { status: 409 })
    console.error("[staff credits] adjustment failed", error)
    return NextResponse.json({ error: "Credit adjustment failed" }, { status: 500 })
  }
}
