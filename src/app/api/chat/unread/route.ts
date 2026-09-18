import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { db } from "@/lib/db"
import { canAccessPublicChannel } from "@/lib/channel-permissions"
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const channels = await db.channel.findMany({ where: { OR: [{ isDM: false, isGroup: false }, { memberships: { some: { userId: user.id } } }] }, select: { id: true, isDM: true, isGroup: true, allowedRoles: true } })
  const prefs = await db.channelPreference.findMany({ where: { userId: user.id } })
  const byChannel = new Map(prefs.map(row => [row.channelId, row]))
  const blocks = await db.block.findMany({ where: { OR: [{ blockerId: user.id }, { blockedId: user.id }], AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }] } })
  const excluded = [user.id, ...blocks.map(row => row.blockerId === user.id ? row.blockedId : row.blockerId)]
  const unread: Record<string, number> = {}, mentions: Record<string, boolean> = {}
  for (const channel of channels) {
    if (!channel.isDM && !channel.isGroup && !canAccessPublicChannel(channel.allowedRoles, user.role)) continue
    const pref = byChannel.get(channel.id)
    const read = pref?.lastReadAt || (pref?.lastReadMessageId ? (await db.message.findFirst({ where: { id: pref.lastReadMessageId, channelId: channel.id }, select: { createdAt: true } }))?.createdAt : null) || user.createdAt
    const where = { channelId: channel.id, deleted: false, userId: { notIn: excluded }, createdAt: { gt: read } }
    const [count, mention] = await Promise.all([
      db.message.count({ where }),
      // Mention IDs are complete JSON strings, so similar IDs cannot match.
      db.message.findFirst({ where: { ...where, mentionedUserIds: { contains: JSON.stringify(user.id) } }, select: { id: true } }),
    ])
    unread[channel.id] = Math.min(count, 999)
    mentions[channel.id] = Boolean(mention)
  }
  return NextResponse.json({ unread, mentions }, { headers: { "Cache-Control": "private, no-store" } })
}
