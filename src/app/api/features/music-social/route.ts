import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { acceptedFriend, boundedJson, cleanMultiline, cleanText, safeJson, validId } from "@/lib/r10-platform"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const KINDS = new Set([
  "music-daily-song", "music-blind-rating", "music-battle", "music-bracket", "music-month-soundtrack",
  "music-day-journal", "music-memory", "music-friend-dare", "music-first-listen", "music-album-checklist",
])
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

function publicRecord(row: any) {
  return { ...row, data: safeJson(row.dataJson, {}), dataJson: undefined }
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const friendId = validId(req.nextUrl.searchParams.get("friendId"))
  const mine = await db.featureRecord.findMany({ where: { userId: me.id, kind: { in: [...KINDS] } }, orderBy: { updatedAt: "desc" }, take: 300 })
  let friendRecords: any[] = []
  if (friendId && await acceptedFriend(me.id, friendId)) {
    friendRecords = await db.featureRecord.findMany({ where: { userId: friendId, kind: { in: [...KINDS] }, visibility: { in: ["friends", "public"] } }, orderBy: { updatedAt: "desc" }, take: 100 })
  }
  const playlists = await db.musicPlaylist.findMany({ where: { userId: me.id }, orderBy: { updatedAt: "desc" }, take: 100 })
  const playlistIds = playlists.map((playlist) => playlist.id)
  const tracks = playlistIds.length ? await db.musicPlaylistTrack.findMany({ where: { playlistId: { in: playlistIds } }, orderBy: [{ playlistId: "asc" }, { position: "asc" }], take: 5000 }) : []
  const artistCounts = new Map<string, number>()
  for (const track of tracks) {
    const artist = cleanText(track.artist, 160)
    if (artist) artistCounts.set(artist.toLowerCase(), (artistCounts.get(artist.toLowerCase()) || 0) + 1)
  }
  const topArtists = [...artistCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([artist, count]) => ({ artist, count }))
  return NextResponse.json({ records: mine.map(publicRecord), friendRecords: friendRecords.map(publicRecord), topArtists })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = cleanText(body.action, 64)

  if (action === "save") {
    const kind = cleanText(body.kind, 64)
    if (!KINDS.has(kind)) return fail("Unsupported music social feature")
    const title = cleanText(body.title, 180)
    if (!title) return fail("Title required")
    const visibility = body.visibility === "friends" || body.visibility === "public" ? body.visibility : "private"
    const data = body.data && typeof body.data === "object" ? body.data : {}
    const scopeKey = cleanText(body.scopeKey, 128)
    const id = validId(body.id)
    if (id) {
      const existing = await db.featureRecord.findFirst({ where: { id, userId: me.id, kind } })
      if (!existing) return fail("Record not found", 404)
      const row = await db.featureRecord.update({ where: { id }, data: { title, dataJson: boundedJson(data), visibility, scopeKey } })
      return NextResponse.json({ record: publicRecord(row) })
    }
    const row = await db.featureRecord.create({ data: { userId: me.id, kind, title, dataJson: boundedJson(data), visibility, scopeKey } })
    return NextResponse.json({ record: publicRecord(row) })
  }

  if (action === "delete") {
    const id = validId(body.id)
    if (!id) return fail("Record id required")
    const result = await db.featureRecord.deleteMany({ where: { id, userId: me.id, kind: { in: [...KINDS] } } })
    return NextResponse.json({ deleted: result.count > 0 })
  }

  if (action === "friend-dare") {
    const friendId = validId(body.friendId)
    if (!friendId || !await acceptedFriend(me.id, friendId)) return fail("Choose one of your friends", 403)
    const challenge = cleanMultiline(body.challenge, 500)
    if (!challenge) return fail("Dare required")
    const actor = await db.user.findUnique({ where: { id: me.id }, select: { username: true, displayName: true } })
    const row = await db.featureRecord.create({ data: { userId: friendId, kind: "music-friend-dare", title: `Listening dare from ${actor?.displayName || actor?.username || "a friend"}`, visibility: "private", scopeKey: me.id, dataJson: boundedJson({ fromUserId: me.id, challenge, completed: false }) } })
    return NextResponse.json({ dare: publicRecord(row) })
  }

  if (action === "complete-dare") {
    const id = validId(body.id)
    const row = await db.featureRecord.findFirst({ where: { id, userId: me.id, kind: "music-friend-dare" } })
    if (!row) return fail("Dare not found", 404)
    const data = safeJson<any>(row.dataJson, {})
    const updated = await db.featureRecord.update({ where: { id }, data: { dataJson: boundedJson({ ...data, completed: true, completedAt: new Date().toISOString() }) } })
    return NextResponse.json({ dare: publicRecord(updated) })
  }

  return fail("Unknown action", 404)
}
