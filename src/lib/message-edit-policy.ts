import { db } from "./db"
import { requireChannelAccess } from "./feature-auth"
import { isDmSendBlocked } from "./blocks"
import { isAccountLockedDown } from "./security-policy"

/** Edits publish new content and must observe the same restrictions as sends. */
export async function messageEditDenied(actor: { id: string; role: string; muted: boolean; mutedUntil: Date | null }, channelId: string): Promise<string | null> {
  if (actor.muted && (!actor.mutedUntil || actor.mutedUntil.getTime() > Date.now())) return "You are muted and cannot edit messages"
  if (await isAccountLockedDown(actor.id)) return "Account lockdown blocks message edits"
  const channel = await requireChannelAccess(channelId, actor.id, actor.role)
  if (!channel) return "You cannot access this channel"
  if (channel.isAnnouncement && !["OWNER", "ADMIN", "HEAD_ADMIN"].includes(actor.role)) return "Only administrators can edit announcements"
  if (channel.isDM) {
    const peer = await db.membership.findFirst({ where: { channelId, userId: { not: actor.id } }, select: { userId: true } })
    if (!peer || await isDmSendBlocked(actor.id, peer.userId)) return "Direct messages are blocked between these accounts"
  }
  return null
}
