import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { moderateTextContent } from "@/lib/content-moderation"
import { enforceRejectedModeration, moderationHttpStatus, moderationPublicError } from "@/lib/moderation-enforcement"

// PATCH /api/messages/edit — edit your own message
// body: { id, content }
export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id, content } = await req.json()
  if (typeof id !== "string" || typeof content !== "string") {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }
  const text = content.trim()
  if (text.length === 0 || text.length > 2000) {
    return NextResponse.json({ error: "Invalid content" }, { status: 400 })
  }

  const msg = await db.message.findUnique({ where: { id } })
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (msg.userId !== me.id) {
    return NextResponse.json({ error: "Can only edit your own messages" }, { status: 403 })
  }

  const recent = await db.message.findMany({
    where: { channelId: msg.channelId, deleted: false },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { username: true, content: true },
  })
  const result = await moderateTextContent({ content: text, context: recent.reverse(), surface: "message_edit" })
  if (result.decision !== "allow") {
    const banned = await enforceRejectedModeration(me.id, result)
    return NextResponse.json(moderationPublicError(result, banned), { status: moderationHttpStatus(result, banned) })
  }

  const editedAt = new Date()
  await db.messageEditHistory.create({ data: { messageId: id, editorId: me.id, oldContent: msg.content, newContent: text, editedAt } })
  const updated = await db.message.update({
    where: { id },
    data: { content: text, edited: true, editedAt },
  })
  return NextResponse.json({ ok: true, message: updated })
}
