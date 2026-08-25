import "dotenv/config"
import { db } from "../src/lib/db"

const MIGRATION_KEY = "2026-08-17-global-credit-reset-v1"

async function main() {
  const already = await db.systemMigration.findUnique({ where: { key: MIGRATION_KEY } })
  if (already) {
    console.log(`GLOBAL_CREDIT_RESET_ALREADY_APPLIED: ${already.appliedAt.toISOString()}`)
    return
  }

  const result = await db.$transaction(async (tx) => {
    const raced = await tx.systemMigration.findUnique({ where: { key: MIGRATION_KEY } })
    if (raced) return { resetUsers: 0, totalDelta: 0, raced: true }

    const users = await tx.user.findMany({ select: { id: true, username: true, coins: true } })
    let resetUsers = 0
    let totalDelta = 0

    for (const user of users) {
      const before = Number(user.coins) || 0
      if (before === 0) continue
      resetUsers += 1
      totalDelta += -before
      await tx.user.update({ where: { id: user.id }, data: { coins: 0 } })
      await tx.currencyTransaction.create({
        data: {
          userId: user.id,
          amount: -before,
          type: "GLOBAL_RESET",
          description: "One-time global credit balance reset (2026-08-17)",
        },
      })
      await tx.creditAudit.create({
        data: {
          actorId: "system",
          actorUsername: "system",
          targetId: user.id,
          targetUsername: user.username,
          delta: -before,
          beforeBalance: before,
          afterBalance: 0,
          reason: "One-time global credit balance reset (2026-08-17)",
        },
      })
    }

    await tx.systemMigration.create({
      data: {
        key: MIGRATION_KEY,
        details: JSON.stringify({ resetUsers, totalDelta, targetBalance: 0 }),
      },
    })
    return { resetUsers, totalDelta, raced: false }
  })

  console.log(`GLOBAL_CREDIT_RESET_OK: users=${result.resetUsers} delta=${result.totalDelta} target=0`)
}

main().finally(async () => { await db.$disconnect() })
