import { db } from "../src/lib/db"

async function main() {
  if (process.env.SYNNICAL_CONFIRM_FULL_UNBAN !== "YES_CLEAR_ALL_BANS") {
    console.log('Skipped full unban. Set SYNNICAL_CONFIRM_FULL_UNBAN=YES_CLEAR_ALL_BANS only for an intentional maintenance run.')
    return
  }
  const bans = await db.infraction.findMany({
    where: { type: { in: ["BAN", "AUTO_BAN"] } },
    select: { userId: true },
  })
  const userIds = [...new Set(bans.map((ban) => ban.userId))]

  await db.$transaction([
    db.infraction.deleteMany({ where: { type: { in: ["BAN", "AUTO_BAN"] } } }),
    ...(userIds.length > 0
      ? [db.user.updateMany({ where: { id: { in: userIds } }, data: { muted: false, mutedUntil: null } })]
      : []),
  ])

  console.log(`Cleared all BAN/AUTO_BAN records and unlocked ${userIds.length} account(s).`)
}

main()
  .catch((error) => {
    console.error("Account ban recovery failed:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
  })
