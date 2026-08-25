import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import {
  SOCIAL_ITEM_KINDS, SOCIAL_SPACE_KINDS, boundedJson, canReadSpace, cleanMultiline,
  cleanText, closeExpiredSpaces, inviteCode, safeJson, touchSpaceMember, validId,
} from "@/lib/r10-platform"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const boundedNumber = (value: unknown, min: number, max: number, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

async function spacePayload(spaceId: string, userId: string) {
  const access = await canReadSpace(spaceId, userId)
  if (!access) return null
  await touchSpaceMember(spaceId, userId)
  const [members, items] = await Promise.all([
    db.socialSpaceMember.findMany({ where: { spaceId }, orderBy: { joinedAt: "asc" } }),
    db.socialSpaceItem.findMany({ where: { spaceId }, orderBy: [{ kind: "asc" }, { position: "asc" }, { updatedAt: "asc" }], take: 500 }),
  ])
  const userIds = [...new Set([access.space.ownerId, ...members.map((row) => row.userId)])]
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, displayName: true, pfpUrl: true, role: true } }) : []
  const byId = new Map(users.map((row) => [row.id, row]))
  return {
    space: access.space,
    role: access.role,
    meId: userId,
    members: members.map((row) => ({ ...row, user: byId.get(row.userId) || null })),
    owner: byId.get(access.space.ownerId) || null,
    items: items.map((row) => ({ ...row, data: safeJson(row.dataJson, {}) })),
  }
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  await closeExpiredSpaces().catch(() => {})
  const url = new URL(req.url)
  const spaceId = validId(url.searchParams.get("spaceId"))
  if (spaceId) {
    const payload = await spacePayload(spaceId, me.id)
    return payload ? NextResponse.json(payload, { headers: { "Cache-Control": "private, no-store" } }) : fail("Space not found", 404)
  }
  const memberships = await db.socialSpaceMember.findMany({ where: { userId: me.id }, select: { spaceId: true } })
  const ids = memberships.map((row) => row.spaceId)
  const spaces = await db.socialSpace.findMany({
    where: { status: "active", OR: [{ ownerId: me.id }, ...(ids.length ? [{ id: { in: ids } }] : [])] },
    orderBy: { updatedAt: "desc" }, take: 100,
  })
  return NextResponse.json({ spaces }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = cleanText(body.action, 40)

  if (action === "create") {
    const name = cleanText(body.name, 80)
    const kind = cleanText(body.kind, 30)
    if (!name || !SOCIAL_SPACE_KINDS.has(kind)) return fail("Choose a valid room name and type")
    const ttlMinutes = Math.round(boundedNumber(body.ttlMinutes, 15, 24 * 60, 180))
    const temporary = body.temporary !== false
    const expiresAt = temporary ? new Date(Date.now() + ttlMinutes * 60_000) : null
    let code = inviteCode()
    for (let i = 0; i < 5 && await db.socialSpace.findUnique({ where: { inviteCode: code }, select: { id: true } }); i++) code = inviteCode()
    const space = await db.socialSpace.create({ data: {
      ownerId: me.id, kind, name, description: cleanMultiline(body.description, 1000),
      background: cleanText(body.background, 300), inviteCode: code, inviteOnly: body.inviteOnly !== false,
      temporary, expiresAt,
    } })
    await db.socialSpaceMember.create({ data: { spaceId: space.id, userId: me.id, role: "owner" } })
    return NextResponse.json({ space })
  }

  if (action === "join") {
    const code = cleanText(body.inviteCode, 30).toUpperCase()
    const space = await db.socialSpace.findFirst({ where: { inviteCode: code, status: "active" } })
    if (!space || (space.expiresAt && space.expiresAt.getTime() <= Date.now())) return fail("Room not found or expired", 404)
    await db.socialSpaceMember.upsert({ where: { spaceId_userId: { spaceId: space.id, userId: me.id } }, update: { lastSeenAt: new Date() }, create: { spaceId: space.id, userId: me.id } })
    return NextResponse.json({ space })
  }

  const spaceId = validId(body.spaceId)
  if (!spaceId) return fail("Space required")
  const access = await canReadSpace(spaceId, me.id)
  if (!access) return fail("Space not found", 404)
  const isOwner = access.space.ownerId === me.id

  if (action === "leave") {
    if (isOwner) {
      const count = await db.socialSpaceMember.count({ where: { spaceId } })
      if (access.space.temporary || count <= 1) {
        await db.socialSpace.update({ where: { id: spaceId }, data: { status: "closed", archivedAt: new Date() } })
        return NextResponse.json({ closed: true })
      }
      return fail("Archive the room before leaving while other members are still inside", 409)
    }
    await db.socialSpaceMember.deleteMany({ where: { spaceId, userId: me.id } })
    const remaining = await db.socialSpaceMember.count({ where: { spaceId } })
    if (access.space.temporary && remaining === 0) await db.socialSpace.update({ where: { id: spaceId }, data: { status: "closed", archivedAt: new Date() } })
    return NextResponse.json({ left: true })
  }

  if (action === "update-space") {
    if (!isOwner) return fail("Room owner only", 403)
    const patch: { name?: string; description?: string; background?: string; inviteOnly?: boolean; temporary?: boolean; expiresAt?: Date | null } = {}
    if (typeof body.name === "string") patch.name = cleanText(body.name, 80) || access.space.name
    if (typeof body.description === "string") patch.description = cleanMultiline(body.description, 1000)
    if (typeof body.background === "string") patch.background = cleanText(body.background, 300)
    if (typeof body.inviteOnly === "boolean") patch.inviteOnly = body.inviteOnly
    if (body.convertPermanent === true) { patch.temporary = false; patch.expiresAt = null }
    const space = await db.socialSpace.update({ where: { id: spaceId }, data: patch })
    return NextResponse.json({ space })
  }

  if (action === "archive") {
    if (!isOwner) return fail("Room owner only", 403)
    const recapItems = await db.socialSpaceItem.findMany({ where: { spaceId }, orderBy: { createdAt: "asc" }, take: 500 })
    const recap = await db.featureRecord.create({ data: {
      userId: me.id, kind: "room-memory", scopeKey: spaceId, title: access.space.name,
      visibility: "private", dataJson: boundedJson({ kind: access.space.kind, description: access.space.description, createdAt: access.space.createdAt, items: recapItems.map((row) => ({ kind: row.kind, title: row.title, data: safeJson(row.dataJson, {}) })) }, 100_000),
    } })
    await db.socialSpace.update({ where: { id: spaceId }, data: { status: "archived", temporary: false, archivedAt: new Date(), expiresAt: null } })
    return NextResponse.json({ archived: true, memoryId: recap.id })
  }

  if (action === "ready") {
    const ready = body.ready === true
    await db.socialSpaceMember.update({ where: { spaceId_userId: { spaceId, userId: me.id } }, data: { ready, lastSeenAt: new Date() } })
    return NextResponse.json({ ready })
  }

  if (action === "add-item") {
    const kind = cleanText(body.kind, 30)
    if (!SOCIAL_ITEM_KINDS.has(kind)) return fail("Unsupported room tool")
    const title = cleanText(body.title, 120)
    const data = body.data && typeof body.data === "object" ? body.data : {}
    const count = await db.socialSpaceItem.count({ where: { spaceId } })
    if (count >= 500) return fail("Room item limit reached", 409)
    const item = await db.socialSpaceItem.create({ data: { spaceId, creatorId: me.id, kind, title, dataJson: boundedJson(data), position: Math.floor(boundedNumber(body.position, -10000, 10000, 0)) } })
    await db.socialSpace.update({ where: { id: spaceId }, data: { updatedAt: new Date() } })
    return NextResponse.json({ item: { ...item, data } })
  }

  if (action === "update-item") {
    const itemId = validId(body.itemId)
    const item = itemId ? await db.socialSpaceItem.findFirst({ where: { id: itemId, spaceId } }) : null
    if (!item) return fail("Room item not found", 404)
    const ownerControlled = new Set(["timer", "countdown", "recap"])
    if (item.creatorId !== me.id && !isOwner && ownerControlled.has(item.kind)) return fail("Only its creator or room owner can change this", 403)
    const patch: { title?: string; dataJson?: string; position?: number } = {}
    if (typeof body.title === "string") patch.title = cleanText(body.title, 120)
    if (body.data && typeof body.data === "object") patch.dataJson = boundedJson(body.data)
    if (Number.isFinite(Number(body.position))) patch.position = Math.floor(boundedNumber(body.position, -10000, 10000, item.position))
    const updated = await db.socialSpaceItem.update({ where: { id: item.id }, data: patch })
    await db.socialSpace.update({ where: { id: spaceId }, data: { updatedAt: new Date() } })
    return NextResponse.json({ item: { ...updated, data: safeJson(updated.dataJson, {}) } })
  }

  if (action === "toggle-vote") {
    const itemId = validId(body.itemId)
    const optionId = cleanText(body.optionId, 80)
    const item = itemId ? await db.socialSpaceItem.findFirst({ where: { id: itemId, spaceId, kind: { in: ["vote", "jukebox", "trivia", "reaction", "mood"] } } }) : null
    if (!item || !optionId) return fail("Vote option not found", 404)
    const data = safeJson<any>(item.dataJson, {})
    const options = Array.isArray(data.options) ? data.options.slice(0, 50) : []
    let found = false
    const next = options.map((option: any) => {
      const id = cleanText(option?.id, 80)
      const voters = Array.isArray(option?.voters) ? option.voters.filter((value: unknown) => typeof value === "string" && value !== me.id).slice(0, 500) : []
      if (id !== optionId) return { ...option, id, voters }
      found = true
      const had = Array.isArray(option?.voters) && option.voters.includes(me.id)
      return { ...option, id, voters: had ? voters : [...voters, me.id] }
    })
    if (!found) return fail("Vote option not found", 404)
    const updatedData = { ...data, options: next }
    const updated = await db.socialSpaceItem.update({ where: { id: item.id }, data: { dataJson: boundedJson(updatedData) } })
    await db.socialSpace.update({ where: { id: spaceId }, data: { updatedAt: new Date() } })
    return NextResponse.json({ item: { ...updated, data: updatedData } })
  }

  if (action === "score-delta") {
    const itemId = validId(body.itemId)
    const key = cleanText(body.key, 60)
    const delta = Math.round(boundedNumber(body.delta, -1000, 1000, 0))
    const item = itemId ? await db.socialSpaceItem.findFirst({ where: { id: itemId, spaceId, kind: "score" } }) : null
    if (!item || !key || !delta) return fail("Score entry not found", 404)
    const data = safeJson<any>(item.dataJson, {})
    const scores = data.scores && typeof data.scores === "object" ? { ...data.scores } : {}
    scores[key] = Math.max(-999999, Math.min(999999, Math.round(Number(scores[key]) || 0) + delta))
    const updatedData = { ...data, scores }
    const updated = await db.socialSpaceItem.update({ where: { id: item.id }, data: { dataJson: boundedJson(updatedData) } })
    await db.socialSpace.update({ where: { id: spaceId }, data: { updatedAt: new Date() } })
    return NextResponse.json({ item: { ...updated, data: updatedData } })
  }

  if (action === "delete-item") {
    const itemId = validId(body.itemId)
    const item = itemId ? await db.socialSpaceItem.findFirst({ where: { id: itemId, spaceId } }) : null
    if (!item) return fail("Room item not found", 404)
    if (item.creatorId !== me.id && !isOwner) return fail("Only its creator or room owner can remove it", 403)
    await db.socialSpaceItem.delete({ where: { id: item.id } })
    await db.socialSpace.update({ where: { id: spaceId }, data: { updatedAt: new Date() } })
    return NextResponse.json({ deleted: true })
  }

  return fail("Unknown space action", 404)
}
