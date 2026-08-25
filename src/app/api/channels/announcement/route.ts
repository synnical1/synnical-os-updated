import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { moderateTextContent } from "@/lib/content-moderation"
import { enforceRejectedModeration, moderationHttpStatus, moderationPublicError } from "@/lib/moderation-enforcement"
import { PUBLIC_CHANNEL_ROLES } from "@/lib/channel-permissions"
import { auditData } from "@/lib/audit-log"

// POST /api/channels/announcement — owner/admin creates an announcement channel
// body: { name }
export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (me.role !== "OWNER" && me.role !== "HEAD_ADMIN" && me.role !== "ADMIN") {
    return NextResponse.json({ error: "Only admins can create announcement channels" }, { status: 403 })
  }
  const { name } = await req.json()
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 32) {
    return NextResponse.json({ error: "Invalid channel name" }, { status: 400 })
  }
  const clean = name.trim().toLowerCase().replace(/\s+/g, "-")
  const moderation = await moderateTextContent({ content: clean, surface: "profile" })
  if (moderation.decision !== "allow") {
    const banned = await enforceRejectedModeration(me.id, moderation)
    return NextResponse.json(moderationPublicError(moderation, banned), { status: moderationHttpStatus(moderation, banned) })
  }
  const existing = await db.channel.findUnique({ where: { name: clean } })
  if (existing) return NextResponse.json({ error: "Channel exists" }, { status: 409 })
  const channel = await db.$transaction(async (tx) => {
    const created = await tx.channel.create({
      data: { name: clean, isAnnouncement: true, creatorId: me.id, allowedRoles: JSON.stringify(PUBLIC_CHANNEL_ROLES) },
    })
    await tx.auditLog.create({ data: auditData({
      category: "CHANNELS",
      action: "ANNOUNCEMENT_CHANNEL_CREATED",
      actor: me,
      after: { channelId: created.id, name: created.name, isAnnouncement: true },
    }) })
    return created
  })
  return NextResponse.json({ channel })
}
