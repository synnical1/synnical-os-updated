import { db } from "../src/lib/db"

async function main() {
  if (process.env.SYNNICAL_CONFIRM_DELETE_EXACT_S !== "YES_DELETE_EXACT_S") {
    console.log('Skipped exact-username deletion. Set SYNNICAL_CONFIRM_DELETE_EXACT_S=YES_DELETE_EXACT_S only for an intentional one-off maintenance run.')
    return
  }
  // This intentionally matches only the exact login username field. An
  // unrelated account whose visible profile label is "s" is never selected.
  const target = await db.user.findUnique({ where: { username: "s" } })
  if (!target) {
    console.log('Exact username "s" was already available; no account was deleted.')
    return
  }

  await db.$transaction([
    db.session.deleteMany({ where: { userId: target.id } }),
    db.user.delete({ where: { id: target.id } }),
  ])
  console.log(`Deleted account ${target.id} with exact username "s"; the username is now available.`)
}

main()
  .catch((error) => {
    console.error('Could not delete the exact username "s" account:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await db.$disconnect()
  })
