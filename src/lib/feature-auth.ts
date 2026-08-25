import { db } from "@/lib/db"
import { canAccessPublicChannel } from "@/lib/channel-permissions"

export async function requireChannelAccess(channelId: string, userId: string, role: string) {
  const channel = await db.channel.findUnique({ where: { id: channelId } })
  if (!channel) return null
  if (channel.isDM || channel.isGroup) {
    const membership = await db.membership.findFirst({ where: { channelId, userId }, select: { id: true } })
    if (!membership) return null
  } else if (!canAccessPublicChannel(channel.allowedRoles, role)) {
    return null
  }
  return channel
}

export function isStaffRole(role: string) {
  return role === "OWNER" || role === "HEAD_ADMIN" || role === "ADMIN" || role === "MOD"
}

export function isAdminRole(role: string) {
  return role === "OWNER" || role === "HEAD_ADMIN" || role === "ADMIN"
}
