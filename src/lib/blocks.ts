import { db } from "@/lib/db"

export const FRIEND_DECLINE_BLOCK_MS = 3 * 24 * 60 * 60 * 1000

export async function cleanupExpiredBlocks(userId?: string): Promise<void> {
  const now = new Date()
  await db.block.deleteMany({
    where: {
      expiresAt: { not: null, lte: now },
      ...(userId ? { OR: [{ blockerId: userId }, { blockedId: userId }] } : {}),
    },
  })
}

export async function isDmSendBlocked(senderId: string, recipientId: string): Promise<boolean> {
  await cleanupExpiredBlocks(senderId)
  const now = new Date()
  const active = await db.block.findFirst({
    where: {
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        {
          OR: [
            // A manual block closes DMs in both directions until the blocker removes it.
            { blockerId: senderId, blockedId: recipientId, source: "manual" },
            { blockerId: recipientId, blockedId: senderId, source: "manual" },
            // Declining a request is directional: the requester cannot message
            // the person who declined them for three days.
            { blockerId: recipientId, blockedId: senderId, source: "friend_decline" },
          ],
        },
      ],
    },
    select: { id: true },
  })
  return Boolean(active)
}

// Kept for older callers that only need a conservative pair-level answer.
export async function isDmBlockedBetween(userA: string, userB: string): Promise<boolean> {
  return (await isDmSendBlocked(userA, userB)) || (await isDmSendBlocked(userB, userA))
}
