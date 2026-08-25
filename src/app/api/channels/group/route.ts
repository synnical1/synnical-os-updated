import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { moderateTextContent } from "@/lib/content-moderation"
import { enforceRejectedModeration, moderationHttpStatus, moderationPublicError } from "@/lib/moderation-enforcement"

// POST /api/channels/group — create a group chat
// body: { name, memberIds: string[] }
export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const { name, memberIds } = (body || {}) as { name?: unknown; memberIds?: unknown }
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 32) {
    return NextResponse.json({ error: "Invalid group name" }, { status: 400 })
  }
  if (!Array.isArray(memberIds) || memberIds.length < 1 || memberIds.length > 20) {
    return NextResponse.json({ error: "Need at least 1 member" }, { status: 400 })
  }
  if (!memberIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)) {
    return NextResponse.json({ error: "Invalid member list" }, { status: 400 })
  }

  const moderation = await moderateTextContent({ content: name.trim(), surface: "profile" })
  if (moderation.decision !== "allow") {
    const banned = await enforceRejectedModeration(me.id, moderation)
    return NextResponse.json(moderationPublicError(moderation, banned), { status: moderationHttpStatus(moderation, banned) })
  }

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chat"
  const clean = `group-${slug}-${Date.now().toString(36)}`

  // Deduplicate ids and verify that every requested account exists before any
  // channel row is written. This avoids orphaned groups and membership abuse.
  const allIds = [...new Set([me.id, ...(memberIds as string[])])]
  const members = await db.user.findMany({
    where: { id: { in: allIds } },
  })
  if (members.length !== allIds.length) {
    return NextResponse.json({ error: "One or more members do not exist" }, { status: 400 })
  }

  const channel = await db.$transaction(async (tx) => {
    const created = await tx.channel.create({ data: { name: clean, isGroup: true } })
    await tx.membership.createMany({
      data: allIds.map((userId) => ({ userId, channelId: created.id })),
    })
    return created
  })

  return NextResponse.json({
    id: channel.id,
    name: name.trim(),
    members: members.map(toSafeUser),
  })
}
