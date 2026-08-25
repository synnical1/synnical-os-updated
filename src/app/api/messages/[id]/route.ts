import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { canDeleteMessage, type MessageRole } from "@/lib/message-permissions"
import { auditData } from "@/lib/audit-log"

// DELETE /api/messages/[id] — authors and staff following the role hierarchy.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const message = await db.message.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, username: true, role: true } },
      channel: { select: { name: true, isDM: true, isGroup: true, memberships: { where: { userId: me.id }, select: { id: true } } } },
    },
  })
  if (!message) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if ((message.channel.isDM || message.channel.isGroup) && message.channel.memberships.length === 0) {
    return NextResponse.json({ error: "You cannot access this channel" }, { status: 403 })
  }

  const allowed = canDeleteMessage(
    me.role as MessageRole,
    me.id,
    message.user?.role as MessageRole | undefined,
    message.userId,
  )
  if (!allowed) {
    return NextResponse.json({ error: "You cannot delete a message from this role" }, { status: 403 })
  }

  await db.$transaction(async (tx) => {
    await tx.message.update({ where: { id }, data: { deleted: true, content: "", gifUrl: null } })
    if (message.userId && message.userId !== me.id && ["MOD", "ADMIN", "HEAD_ADMIN", "OWNER"].includes(me.role)) {
      await tx.auditLog.create({ data: auditData({
        category: "MODERATION",
        action: "MESSAGE_DELETED_BY_STAFF",
        actor: me,
        target: { id: message.userId, username: message.user?.username || message.username },
        before: { messageId: message.id, content: message.content, gifUrl: message.gifUrl },
        after: { deleted: true },
        metadata: { channelId: message.channelId, channelName: message.channel.name },
      }) })
    }
  })
  return NextResponse.json({ ok: true, id, channelId: message.channelId })
}
