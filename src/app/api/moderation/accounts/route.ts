import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { banKnownIdentities } from "@/lib/identity-ban"
import { auditData } from "@/lib/audit-log"

const rank: Record<string, number> = { MEMBER: 0, MOD: 1, ADMIN: 2, HEAD_ADMIN: 3, OWNER: 4 }

export async function GET() {
  const actor = await getCurrentUser()
  if (!actor || (rank[actor.role] ?? -1) < rank.MOD) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const users = await db.user.findMany({ orderBy: { username: "asc" } })
  return NextResponse.json({ users: users.map(toSafeUser) })
}

export async function DELETE(req: NextRequest) {
  const actor = await getCurrentUser()
  if (!actor || (rank[actor.role] ?? -1) < rank.MOD) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const { userId, action } = await req.json().catch(() => ({}))
  if (typeof userId !== "string" || !["delete", "ban"].includes(action)) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  if (userId === actor.id) return NextResponse.json({ error: "You cannot remove your own account" }, { status: 409 })
  const target = await db.user.findUnique({ where: { id: userId } })
  if (!target) return NextResponse.json({ error: "Account not found" }, { status: 404 })
  if ((rank[actor.role] ?? -1) <= (rank[target.role] ?? 0)) return NextResponse.json({ error: "You cannot remove an equal or higher staff role" }, { status: 403 })
  if (action === "ban") await banKnownIdentities(userId, `Staff ban by @${actor.username}`)
  await db.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { userId } })

    // r10 account-owned data is intentionally explicit because several mega-expansion
    // tables are snapshot/shared records rather than Prisma User relations.
    const ownedSpaces = await tx.socialSpace.findMany({ where: { ownerId: userId }, select: { id: true } })
    const ownedSpaceIds = ownedSpaces.map((row) => row.id)
    if (ownedSpaceIds.length) {
      await tx.socialSpaceItem.deleteMany({ where: { spaceId: { in: ownedSpaceIds } } })
      await tx.socialSpaceMember.deleteMany({ where: { spaceId: { in: ownedSpaceIds } } })
      await tx.socialSpace.deleteMany({ where: { id: { in: ownedSpaceIds } } })
    }
    await tx.socialSpaceItem.deleteMany({ where: { creatorId: userId } })
    await tx.socialSpaceMember.deleteMany({ where: { userId } })

    const ownedRules = await tx.automationRule.findMany({ where: { userId }, select: { id: true } })
    const ownedRuleIds = ownedRules.map((row) => row.id)
    if (ownedRuleIds.length) await tx.automationRun.deleteMany({ where: { ruleId: { in: ownedRuleIds } } })
    await tx.automationRun.deleteMany({ where: { userId } })
    await tx.automationRule.deleteMany({ where: { userId } })

    const ownedProjects = await tx.creatorProject.findMany({ where: { ownerId: userId }, select: { id: true } })
    const ownedProjectIds = ownedProjects.map((row) => row.id)
    if (ownedProjectIds.length) {
      await tx.creatorProjectVersion.deleteMany({ where: { projectId: { in: ownedProjectIds } } })
      await tx.creatorProject.deleteMany({ where: { id: { in: ownedProjectIds } } })
    }
    await tx.creatorProjectVersion.deleteMany({ where: { authorId: userId } })
    await tx.creatorFollow.deleteMany({ where: { OR: [{ followerId: userId }, { creatorId: userId }] } })

    // Never strand other users' credits when the deleted account owns an active shared pot.
    const ownedPots = await tx.sharedCreditPot.findMany({ where: { ownerId: userId }, select: { id: true, name: true, status: true } })
    const activeOwnedPotIds = ownedPots.filter((row) => row.status === "active").map((row) => row.id)
    if (activeOwnedPotIds.length) {
      const refunds = await tx.sharedCreditContribution.groupBy({
        by: ["userId"],
        where: { potId: { in: activeOwnedPotIds }, userId: { not: userId } },
        _sum: { amount: true },
      })
      for (const refund of refunds) {
        const amount = Math.max(0, refund._sum.amount || 0)
        if (!amount) continue
        const restored = await tx.user.updateMany({ where: { id: refund.userId }, data: { coins: { increment: amount } } })
        if (restored.count) await tx.currencyTransaction.create({ data: { userId: refund.userId, amount, type: "shared_pot_refund", description: "Refunded because the shared-pot owner account was removed" } })
      }
    }
    const ownedPotIds = ownedPots.map((row) => row.id)
    if (ownedPotIds.length) await tx.sharedCreditContribution.deleteMany({ where: { potId: { in: ownedPotIds } } })

    // Contributions by the deleted account to somebody else's still-active pot are burned
    // with the account, not gifted to the pot owner. Claimed pots remain historical.
    const contributed = await tx.sharedCreditContribution.groupBy({ by: ["potId"], where: { userId }, _sum: { amount: true } })
    for (const contribution of contributed) {
      const pot = await tx.sharedCreditPot.findUnique({ where: { id: contribution.potId }, select: { id: true, ownerId: true, status: true, balance: true } })
      const amount = Math.max(0, contribution._sum.amount || 0)
      if (pot && pot.ownerId !== userId && pot.status === "active" && amount) {
        await tx.sharedCreditPot.update({ where: { id: pot.id }, data: { balance: Math.max(0, pot.balance - amount) } })
      }
    }
    await tx.sharedCreditContribution.deleteMany({ where: { userId } })
    if (ownedPotIds.length) await tx.sharedCreditPot.deleteMany({ where: { id: { in: ownedPotIds } } })

    await tx.featureRecord.deleteMany({ where: { userId } })
    await tx.persona.deleteMany({ where: { userId } })
    await tx.presenceSample.deleteMany({ where: { userId } })
    await tx.mediaProgress.deleteMany({ where: { userId } })
    await tx.browserWorkspace.deleteMany({ where: { userId } })
    await tx.developerToken.deleteMany({ where: { userId } })
    await tx.creditGoal.deleteMany({ where: { userId } })
    await tx.creditVault.deleteMany({ where: { userId } })

    await tx.marketplaceListing.updateMany({ where: { sellerId: userId, status: { in: ["active", "processing"] } }, data: { status: "cancelled_account_deleted", cancelledAt: new Date() } })
    await tx.tradeOffer.updateMany({ where: { OR: [{ senderId: userId }, { recipientId: userId }], status: { in: ["pending", "processing"] } }, data: { status: "cancelled_account_deleted" } })
    await tx.cosmeticOwnershipEvent.updateMany({ where: { fromUserId: userId }, data: { fromUserId: null } })
    await tx.cosmeticOwnershipEvent.updateMany({ where: { toUserId: userId }, data: { toUserId: null } })

    const friendshipBonds = await tx.friendshipBond.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] }, select: { pairKey: true } })
    const pairKeys = friendshipBonds.map((row) => row.pairKey)
    if (pairKeys.length) {
      await tx.friendshipMemory.deleteMany({ where: { pairKey: { in: pairKeys } } })
      await tx.friendshipGoal.deleteMany({ where: { pairKey: { in: pairKeys } } })
      await tx.friendshipMilestone.deleteMany({ where: { pairKey: { in: pairKeys } } })
      await tx.friendshipBond.deleteMany({ where: { pairKey: { in: pairKeys } } })
    }
    await tx.friendMeta.deleteMany({ where: { OR: [{ userId }, { friendId: userId }] } })
    await tx.auditLog.create({ data: auditData({
      category: "ACCOUNT",
      action: action === "ban" ? "ACCOUNT_BANNED_DELETED" : "ACCOUNT_DELETED",
      actor,
      target: { id: target.id, username: target.username },
      before: { role: target.role, muted: target.muted, coins: target.coins },
      after: { deleted: true, identityBanned: action === "ban" },
    }) })
    await tx.user.delete({ where: { id: userId } })
  })
  return NextResponse.json({ ok: true, action, releasedUsername: target.username })
}
