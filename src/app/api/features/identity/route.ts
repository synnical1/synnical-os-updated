import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { db } from "@/lib/db"
import { accountSerial } from "@/lib/identity-profile"
import { safeJson } from "@/lib/feature-platform"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function text(value: unknown, max = 300) { return typeof value === "string" ? value.trim().slice(0, max) : "" }
function fail(error: string, status = 400) { return NextResponse.json({ error }, { status }) }
function cleanAudience(value: unknown) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {}
  return { everyone: input.everyone !== false, closeFriends: input.closeFriends === true, userIds: Array.isArray(input.userIds) ? [...new Set(input.userIds.map((x) => text(x, 128)).filter(Boolean))].slice(0, 100) : [] }
}
async function acceptedFriend(a: string, b: string) {
  return Boolean(await db.friendship.findFirst({ where: { status: "ACCEPTED", OR: [{ requesterId: a, receiverId: b }, { requesterId: b, receiverId: a }] }, select: { id: true } }))
}

async function maybeSnapshot(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (!user) return
  const latest = await db.featureRecord.findFirst({ where: { userId: user.id, kind: "profile-snapshot" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } })
  if (latest && Date.now() - latest.createdAt.getTime() < 7 * 86400000) return
  await db.featureRecord.create({ data: { userId: user.id, kind: "profile-snapshot", scopeKey: new Date().toISOString().slice(0, 10), title: "Profile snapshot", visibility: "private", dataJson: JSON.stringify({ displayName: user.displayName, bio: user.bio, pfpUrl: user.pfpUrl, bannerUrl: user.bannerUrl, avatarDeco: user.avatarDeco, profileThemePrimary: user.profileThemePrimary, profileThemeAccent: user.profileThemeAccent }) } }).catch(() => {})
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  await maybeSnapshot(me)
  const targetId = req.nextUrl.searchParams.get("userId") || me.id
  const target = targetId === me.id ? me : await db.user.findUnique({ where: { id: targetId } })
  if (!target) return fail("User not found", 404)
  const self = target.id === me.id
  const friend = self || await acceptedFriend(me.id, target.id)
  const [personas, records, snapshots, friendCount, gameFavs, mediaLists, playlists] = await Promise.all([
    self ? db.persona.findMany({ where: { userId: me.id }, orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }] }) : Promise.resolve([]),
    db.featureRecord.findMany({ where: { userId: target.id, kind: { in: ["profile-icebreaker", "profile-skill", "profile-shelf", "profile-riddle", "profile-hidden-section"] }, ...(self ? {} : { visibility: { in: friend ? ["public", "friends"] : ["public"] } }) }, orderBy: { updatedAt: "desc" }, take: 100 }),
    self ? db.featureRecord.findMany({ where: { userId: me.id, kind: "profile-snapshot" }, orderBy: { createdAt: "desc" }, take: 24 }) : Promise.resolve([]),
    db.friendship.count({ where: { status: "ACCEPTED", OR: [{ requesterId: target.id }, { receiverId: target.id }] } }),
    db.gameFavorite.count({ where: { userId: target.id } }),
    db.mediaList.count({ where: { userId: target.id } }),
    db.musicPlaylist.count({ where: { userId: target.id } }),
  ])
  const createdAt = target.createdAt
  const years = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / (365.25 * 86400000)))
  const dna = {
    social: Math.min(100, friendCount * 8 + Math.min(40, Math.floor((target.messageCount || 0) / 100))),
    gamer: Math.min(100, gameFavs * 12 + (target.gameStatus ? 20 : 0)),
    cinephile: Math.min(100, mediaLists * 8),
    music: Math.min(100, playlists * 10),
    accountYears: years,
  }
  return NextResponse.json({
    self, friend, personas,
    records: records.map((r) => ({ ...r, data: safeJson(r.dataJson, {}) })),
    snapshots: snapshots.map((r) => ({ id: r.id, createdAt: r.createdAt, data: safeJson(r.dataJson, {}) })),
    serial: accountSerial(createdAt, target.id), generation: `${createdAt.getUTCFullYear()} Generation`, dna,
    dynamic: { localTime: new Date().toISOString(), gameStatus: target.gameStatus || "" },
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = text(body.action, 64)

  if (action === "persona-save") {
    const id = text(body.id, 128)
    const name = text(body.name, 40), displayName = text(body.displayName, 32)
    if (!name || !displayName) return fail("Persona name and display name are required")
    const data = { name, displayName, bio: text(body.bio, 500), pfpUrl: text(body.pfpUrl, 1000) || null, bannerUrl: text(body.bannerUrl, 1000) || null, mood: text(body.mood, 50), accent: text(body.accent, 20), audienceJson: JSON.stringify(cleanAudience(body.audience)) }
    if (id) {
      const result = await db.persona.updateMany({ where: { id, userId: me.id }, data })
      if (!result.count) return fail("Persona not found", 404)
      return NextResponse.json({ ok: true })
    }
    if (await db.persona.count({ where: { userId: me.id } }) >= 10) return fail("Maximum 10 personas")
    const count = await db.persona.count({ where: { userId: me.id } })
    const persona = await db.persona.create({ data: { userId: me.id, ...data, isActive: count === 0 } })
    return NextResponse.json({ persona })
  }
  if (action === "persona-switch") {
    const id = text(body.id, 128)
    const row = await db.persona.findFirst({ where: { id, userId: me.id } })
    if (!row) return fail("Persona not found", 404)
    await db.$transaction([db.persona.updateMany({ where: { userId: me.id }, data: { isActive: false } }), db.persona.update({ where: { id }, data: { isActive: true } })])
    return NextResponse.json({ ok: true })
  }
  if (action === "persona-delete") {
    const id = text(body.id, 128)
    const row = await db.persona.findFirst({ where: { id, userId: me.id } })
    if (!row) return fail("Persona not found", 404)
    await db.persona.delete({ where: { id } })
    if (row.isActive) { const next = await db.persona.findFirst({ where: { userId: me.id }, orderBy: { updatedAt: "desc" } }); if (next) await db.persona.update({ where: { id: next.id }, data: { isActive: true } }) }
    return NextResponse.json({ ok: true })
  }
  if (["profile-icebreaker", "profile-skill", "profile-shelf", "profile-riddle", "profile-hidden-section"].includes(action)) {
    const maxByKind: Record<string, number> = { "profile-icebreaker": 10, "profile-skill": 30, "profile-shelf": 20, "profile-riddle": 10, "profile-hidden-section": 10 }
    if (await db.featureRecord.count({ where: { userId: me.id, kind: action } }) >= (maxByKind[action] || 10)) return fail("You reached the limit for this profile section")
    const title = text(body.title, 120)
    if (!title) return fail("Title is required")
    const data = body.data && typeof body.data === "object" ? body.data as Record<string, unknown> : {}
    const serialized = JSON.stringify(data)
    if (serialized.length > 12000) return fail("Profile card is too large")
    const record = await db.featureRecord.create({ data: { userId: me.id, kind: action, scopeKey: "profile", title, dataJson: serialized, visibility: body.visibility === "friends" ? "friends" : body.visibility === "private" ? "private" : "public" } })
    return NextResponse.json({ record })
  }
  if (action === "delete-record") {
    const deleted = await db.featureRecord.deleteMany({ where: { id: text(body.id, 128), userId: me.id, kind: { in: ["profile-icebreaker", "profile-skill", "profile-shelf", "profile-riddle", "profile-hidden-section"] } } })
    return NextResponse.json({ ok: deleted.count === 1 })
  }
  if (action === "visitor-question" || action === "visitor-sticker") {
    const targetId = text(body.targetId, 128)
    if (!targetId || targetId === me.id) return fail("Choose another profile")
    if (!await acceptedFriend(me.id, targetId)) return fail("Only friends can leave profile questions or stickers", 403)
    const kind = action === "visitor-question" ? "profile-question" : "profile-sticker"
    const since = new Date(Date.now() - 86400000)
    if (await db.featureRecord.count({ where: { userId: me.id, kind, scopeKey: targetId, createdAt: { gte: since } } }) >= 10) return fail("Daily limit reached")
    const title = text(body.text, action === "visitor-question" ? 300 : 80)
    if (!title) return fail("Write something first")
    await db.featureRecord.create({ data: { userId: me.id, kind, scopeKey: targetId, title, visibility: "friends", dataJson: JSON.stringify({ targetId }) } })
    return NextResponse.json({ ok: true })
  }
  return fail("Unknown action", 404)
}
