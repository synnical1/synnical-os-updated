import { NextRequest, NextResponse } from "next/server"
import { messageEditDenied } from "@/lib/message-edit-policy"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { moderateTextContent } from "@/lib/content-moderation"
import { enforceRejectedModeration, moderationHttpStatus, moderationPublicError } from "@/lib/moderation-enforcement"

// PATCH /api/messages/edit — edit your own message
// body: { id, content }
export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const rate = consumeRequestLimit(req, "message-edit", 30, 60_000, me.id)
  if (!rate.allowed) return NextResponse.json({ error: "Too many edits" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } })
  const { id, content } = await req.json().catch(() => ({}))
  if (typeof id !== "string" || typeof content !== "string") {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 })
  }
  const text = content.trim()
  if (text.length === 0 || text.length > 2000) {
    return NextResponse.json({ error: "Invalid content" }, { status: 400 })
  }

  const msg = await db.message.findUnique({ where: { id } })
  if (!msg || msg.deleted) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (msg.userId !== me.id) {
    return NextResponse.json({ error: "Can only edit your own messages" }, { status: 403 })
  }

  const denied = await messageEditDenied(me, msg.channelId)
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })

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
  const updated = await db.$transaction(async (tx) => {
    const current = await tx.message.findUnique({ where: { id } })
    if (!current || current.deleted || current.userId !== me.id) return null
    await tx.messageEditHistory.create({ data: { messageId: id, editorId: me.id, oldContent: current.content, newContent: text, editedAt } })
    return tx.message.update({ where: { id }, data: { content: text, edited: true, editedAt } })
  })
  if (!updated) return NextResponse.json({ error: "Message no longer available" }, { status: 409 })
  return NextResponse.json({ ok: true, message: updated })
}
