import { db } from "./db"

export function friendshipPairKey(a: string, b: string) {
  return [a, b].sort().join(":")
}

export function friendshipLevel(xp: number) {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 10)) + 1)
}

export function friendshipLevelFloor(level: number) {
  return Math.max(0, Math.pow(Math.max(1, level) - 1, 2) * 10)
}

export function friendshipLevelCeiling(level: number) {
  return Math.pow(Math.max(1, level), 2) * 10
}

export function unlockedFriendshipTitles(xp: number, messageCount = 0) {
  const level = friendshipLevel(xp)
  const out = ["New Duo"]
  if (messageCount >= 25 || level >= 2) out.push("Regulars")
  if (messageCount >= 100 || level >= 4) out.push("Partners in Crime")
  if (messageCount >= 250 || level >= 6) out.push("Ride or Dies")
  if (messageCount >= 500 || level >= 8) out.push("OG Duo")
  if (messageCount >= 1000 || level >= 12) out.push("Legendary Duo")
  return out
}

async function acceptedFriendship(a: string, b: string) {
  return db.friendship.findFirst({
    where: { status: "ACCEPTED", OR: [{ requesterId: a, receiverId: b }, { requesterId: b, receiverId: a }] },
    select: { id: true, createdAt: true },
  })
}

async function historicDmStats(a: string, b: string) {
  const mine = await db.membership.findMany({
    where: { userId: a, channel: { isDM: true } },
    select: { channelId: true },
  })
  if (!mine.length) return { messageCount: 0, lastInteractionAt: null as Date | null }
  const shared = await db.membership.findFirst({
    where: { userId: b, channelId: { in: mine.map((row) => row.channelId) }, channel: { isDM: true } },
    select: { channelId: true },
  })
  if (!shared) return { messageCount: 0, lastInteractionAt: null as Date | null }
  const [messageCount, last] = await Promise.all([
    db.message.count({ where: { channelId: shared.channelId, userId: { in: [a, b] }, deleted: false } }),
    db.message.findFirst({ where: { channelId: shared.channelId, userId: { in: [a, b] }, deleted: false }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ])
  return { messageCount, lastInteractionAt: last?.createdAt || null }
}

export async function ensureFriendshipBond(a: string, b: string) {
  if (a === b) return null
  const friendship = await acceptedFriendship(a, b)
  if (!friendship) return null
  const pairKey = friendshipPairKey(a, b)
  const existing = await db.friendshipBond.findUnique({ where: { pairKey } })
  if (existing) return existing
  const [userAId, userBId] = [a, b].sort()
  const historic = await historicDmStats(a, b)
  const bootstrapXp = Math.min(historic.messageCount, 400)
  const bond = await db.friendshipBond.upsert({
    where: { pairKey },
    update: {},
    create: {
      pairKey,
      userAId,
      userBId,
      xp: bootstrapXp,
      messageCount: historic.messageCount,
      lastInteractionAt: historic.lastInteractionAt || friendship.createdAt,
      lastXpAt: historic.lastInteractionAt,
    },
  })
  await ensureFriendshipMilestones(bond)
  return bond
}

async function milestone(pairKey: string, code: string, label: string) {
  await db.friendshipMilestone.upsert({
    where: { pairKey_code: { pairKey, code } },
    create: { pairKey, code, label },
    update: {},
  }).catch(() => {})
}

export async function ensureFriendshipMilestones(bond: { pairKey: string; xp: number; messageCount: number }) {
  if (bond.messageCount >= 10) await milestone(bond.pairKey, "messages-10", "10 messages together")
  if (bond.messageCount >= 50) await milestone(bond.pairKey, "messages-50", "50 messages together")
  if (bond.messageCount >= 100) await milestone(bond.pairKey, "messages-100", "100 messages together")
  if (bond.messageCount >= 500) await milestone(bond.pairKey, "messages-500", "500 messages together")
  const level = friendshipLevel(bond.xp)
  if (level >= 5) await milestone(bond.pairKey, "level-5", "Duo level 5")
  if (level >= 10) await milestone(bond.pairKey, "level-10", "Duo level 10")
}

export async function recordFriendshipMessage(senderId: string, friendId: string) {
  const bond = await ensureFriendshipBond(senderId, friendId)
  if (!bond) return null
  const now = new Date()
  const xpGain = !bond.lastXpAt || now.getTime() - bond.lastXpAt.getTime() >= 60_000 ? 1 : 0
  const updated = await db.friendshipBond.update({
    where: { id: bond.id },
    data: {
      messageCount: { increment: 1 },
      xp: xpGain ? { increment: xpGain } : undefined,
      lastInteractionAt: now,
      lastXpAt: xpGain ? now : undefined,
    },
  })
  await ensureFriendshipMilestones(updated)
  return updated
}
