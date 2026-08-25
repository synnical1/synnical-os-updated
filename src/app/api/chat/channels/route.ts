import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { moderateTextContent } from "@/lib/content-moderation"
import { enforceRejectedModeration, moderationHttpStatus, moderationPublicError } from "@/lib/moderation-enforcement"
import {
  canAccessPublicChannel,
  canManageChannels,
  channelAudienceFromStoredRoles,
  channelRolesForAudience,
  normalizeChannelAudience,
  parseChannelRoles,
} from "@/lib/channel-permissions"

function publicChannel<T extends { allowedRoles: string }>(channel: T) {
  return {
    ...channel,
    allowedRoles: parseChannelRoles(channel.allowedRoles),
    audience: channelAudienceFromStoredRoles(channel.allowedRoles),
  }
}

// GET /api/chat/channels — return only channels the authenticated account may
// know exist. Staff-only channels are removed before any metadata is serialized.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const channels = await db.channel.findMany({
    where: { isDM: false, isGroup: false },
    orderBy: [{ isAnnouncement: "desc" }, { createdAt: "asc" }],
    include: { _count: { select: { messages: true } } },
  })

  return NextResponse.json({
    channels: channels
      .filter((channel) => canAccessPublicChannel(channel.allowedRoles, user.role))
      .map(publicChannel),
  })
}

// POST /api/chat/channels — create a staff-managed public channel.
// New clients send audience=MEMBERS|STAFF. The server derives the exact role
// set; it never accepts an arbitrary role list as the source of truth.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canManageChannels(user.role)) {
    return NextResponse.json({ error: "Only owners and administrators can create channels" }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const name = body.name
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 32) {
    return NextResponse.json({ error: "Invalid channel name" }, { status: 400 })
  }

  // Transitional compatibility for tabs that were open before this update:
  // an old role-array request is reduced to the same two safe audiences. An
  // empty/malformed array fails closed to STAFF, never to public MEMBER access.
  let audience = normalizeChannelAudience(body.audience)
  if (!audience && Array.isArray(body.allowedRoles)) {
    audience = body.allowedRoles.includes("MEMBER") ? "MEMBERS" : "STAFF"
  }
  if (!audience) {
    return NextResponse.json({ error: "Channel audience must be MEMBERS or STAFF" }, { status: 400 })
  }

  const clean = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "")
  if (!clean) return NextResponse.json({ error: "Invalid channel name" }, { status: 400 })

  const moderation = await moderateTextContent({ content: clean, surface: "profile" })
  if (moderation.decision !== "allow") {
    const banned = await enforceRejectedModeration(user.id, moderation)
    return NextResponse.json(moderationPublicError(moderation, banned), { status: moderationHttpStatus(moderation, banned) })
  }

  const existing = await db.channel.findUnique({ where: { name: clean } })
  if (existing) return NextResponse.json({ error: "Channel exists" }, { status: 409 })

  const channel = await db.channel.create({
    data: {
      name: clean,
      allowedRoles: JSON.stringify(channelRolesForAudience(audience)),
      creatorId: user.id,
    },
  })

  return NextResponse.json({ channel: publicChannel(channel) })
}

// DELETE /api/chat/channels — remove any public channel, including former defaults.
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canManageChannels(user.role)) {
    return NextResponse.json({ error: "Only owners and administrators can delete channels" }, { status: 403 })
  }

  let id: unknown
  try { ({ id } = await req.json()) } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (typeof id !== "string" || id.length < 1 || id.length > 128) {
    return NextResponse.json({ error: "Invalid channel" }, { status: 400 })
  }

  const channel = await db.channel.findUnique({ where: { id } })
  if (!channel || channel.isDM || channel.isGroup) {
    return NextResponse.json({ error: "Channel not found" }, { status: 404 })
  }

  const audience = channelAudienceFromStoredRoles(channel.allowedRoles)
  await db.channel.delete({ where: { id } })
  return NextResponse.json({ ok: true, id, audience })
}
