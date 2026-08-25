import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { CLOUD_GAMES } from "@/lib/cloud-games"
import {
  ensureFriendshipBond,
  friendshipLevel,
  friendshipLevelCeiling,
  friendshipLevelFloor,
  friendshipPairKey,
  unlockedFriendshipTitles,
} from "@/lib/friendship-social"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function clean(value: unknown, max = 500) { return typeof value === "string" ? value.trim().slice(0, max) : "" }
function validId(value: unknown) { const out = clean(value, 128); return /^[A-Za-z0-9_-]{1,128}$/.test(out) ? out : "" }
function fail(error: string, status = 400) { return NextResponse.json({ error }, { status }) }
function jaccard(a: Set<string>, b: Set<string>) {
  const union = new Set([...a, ...b])
  if (!union.size) return 0
  let shared = 0
  for (const value of a) if (b.has(value)) shared += 1
  return Math.round((shared / union.size) * 100)
}

async function acceptedPair(meId: string, friendId: string) {
  return db.friendship.findFirst({
    where: { status: "ACCEPTED", OR: [{ requesterId: meId, receiverId: friendId }, { requesterId: friendId, receiverId: meId }] },
    select: { id: true, createdAt: true },
  })
}

async function compatibility(meId: string, friendId: string) {
  const [myGames, theirGames, myLists, theirLists, myPlaylists, theirPlaylists] = await Promise.all([
    db.gameFavorite.findMany({ where: { userId: meId }, select: { gameId: true } }),
    db.gameFavorite.findMany({ where: { userId: friendId }, select: { gameId: true } }),
    db.mediaList.findMany({ where: { userId: meId, kind: { in: ["watchlist", "favorite"] } }, select: { id: true } }),
    db.mediaList.findMany({ where: { userId: friendId, kind: { in: ["watchlist", "favorite"] } }, select: { id: true } }),
    db.musicPlaylist.findMany({ where: { userId: meId }, select: { id: true } }),
    db.musicPlaylist.findMany({ where: { userId: friendId }, select: { id: true } }),
  ])

  const [myMedia, theirMedia, myTracks, theirTracks] = await Promise.all([
    myLists.length ? db.mediaListItem.findMany({ where: { listId: { in: myLists.map((row) => row.id) } }, select: { mediaType: true, mediaId: true, title: true } }) : [],
    theirLists.length ? db.mediaListItem.findMany({ where: { listId: { in: theirLists.map((row) => row.id) } }, select: { mediaType: true, mediaId: true, title: true } }) : [],
    myPlaylists.length ? db.musicPlaylistTrack.findMany({ where: { playlistId: { in: myPlaylists.map((row) => row.id) } }, select: { artist: true } }) : [],
    theirPlaylists.length ? db.musicPlaylistTrack.findMany({ where: { playlistId: { in: theirPlaylists.map((row) => row.id) } }, select: { artist: true } }) : [],
  ])

  const myGameSet = new Set(myGames.map((row) => row.gameId))
  const theirGameSet = new Set(theirGames.map((row) => row.gameId))
  const gameNames = new Map<string, string>(CLOUD_GAMES.map((game) => [game.game_key, game.name]))
  const sharedGames = [...myGameSet].filter((id) => theirGameSet.has(id)).slice(0, 12).map((id) => ({ id, name: gameNames.get(id) || id }))

  const mediaKey = (row: { mediaType: string; mediaId: string }) => `${row.mediaType}:${row.mediaId}`
  const myMediaMap = new Map(myMedia.map((row) => [mediaKey(row), row.title] as const))
  const theirMediaMap = new Map(theirMedia.map((row) => [mediaKey(row), row.title] as const))
  const myMediaSet = new Set(myMediaMap.keys())
  const theirMediaSet = new Set(theirMediaMap.keys())
  const sharedMedia = [...myMediaSet].filter((key) => theirMediaSet.has(key)).slice(0, 12).map((key) => myMediaMap.get(key) || theirMediaMap.get(key) || key)

  const normalizeArtist = (value: string) => value.trim().toLocaleLowerCase()
  const myArtistNames = new Map(myTracks.filter((row) => row.artist.trim()).map((row) => [normalizeArtist(row.artist), row.artist.trim()] as const))
  const theirArtistNames = new Map(theirTracks.filter((row) => row.artist.trim()).map((row) => [normalizeArtist(row.artist), row.artist.trim()] as const))
  const myArtists = new Set(myArtistNames.keys())
  const theirArtists = new Set(theirArtistNames.keys())
  const sharedArtists = [...myArtists].filter((artist) => theirArtists.has(artist)).slice(0, 12).map((artist) => myArtistNames.get(artist) || theirArtistNames.get(artist) || artist)

  return {
    games: { score: jaccard(myGameSet, theirGameSet), shared: sharedGames, mine: myGameSet.size, theirs: theirGameSet.size, source: "Synnical game favourites" },
    movies: { score: jaccard(myMediaSet, theirMediaSet), shared: sharedMedia, mine: myMediaSet.size, theirs: theirMediaSet.size, source: "SynnFlix watchlists and favourites" },
    music: { score: jaccard(myArtists, theirArtists), shared: sharedArtists, mine: myArtists.size, theirs: theirArtists.size, source: "Artists in saved Synnical playlists" },
  }
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const url = new URL(req.url)
  const friendId = validId(url.searchParams.get("friendId"))
  if (!friendId || friendId === me.id) return fail("Friend not found", 404)
  const friendship = await acceptedPair(me.id, friendId)
  if (!friendship) return fail("Friend not found", 404)
  const friend = await db.user.findUnique({ where: { id: friendId } })
  if (!friend) return fail("Friend not found", 404)
  const bond = await ensureFriendshipBond(me.id, friendId)
  if (!bond) return fail("Friendship unavailable", 404)
  const pairKey = friendshipPairKey(me.id, friendId)
  const [memories, goals, milestones, meta, match] = await Promise.all([
    db.friendshipMemory.findMany({ where: { pairKey }, orderBy: [{ happenedAt: "desc" }, { createdAt: "desc" }], take: 60 }),
    db.friendshipGoal.findMany({ where: { pairKey }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 30 }),
    db.friendshipMilestone.findMany({ where: { pairKey }, orderBy: { achievedAt: "desc" }, take: 30 }),
    db.friendMeta.findUnique({ where: { userId_friendId: { userId: me.id, friendId } } }),
    compatibility(me.id, friendId),
  ])
  const level = friendshipLevel(bond.xp)
  const now = new Date()
  const todayMonth = now.getUTCMonth(); const todayDate = now.getUTCDate(); const todayYear = now.getUTCFullYear()
  const lastInteraction = bond.lastInteractionAt || friendship.createdAt
  const daysSinceInteraction = Math.max(0, Math.floor((Date.now() - lastInteraction.getTime()) / 86_400_000))

  return NextResponse.json({
    friend: toSafeUser(friend),
    friendMeta: { label: meta?.label || "" },
    friendshipSince: friendship.createdAt,
    bond: {
      ...bond,
      level,
      levelFloor: friendshipLevelFloor(level),
      levelCeiling: friendshipLevelCeiling(level),
      unlockedTitles: unlockedFriendshipTitles(bond.xp, bond.messageCount),
      daysSinceInteraction,
      reconnectSuggested: daysSinceInteraction >= 14,
    },
    memories: memories.map((row) => ({
      ...row,
      onThisDay: row.happenedAt.getUTCFullYear() < todayYear && row.happenedAt.getUTCMonth() === todayMonth && row.happenedAt.getUTCDate() === todayDate,
      canDelete: row.creatorId === me.id,
    })),
    goals: goals.map((row) => ({ ...row, canDelete: row.creatorId === me.id })),
    milestones,
    compatibility: match,
  }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = clean(body.action, 40)
  const friendId = validId(body.friendId)
  if (!friendId || friendId === me.id || !await acceptedPair(me.id, friendId)) return fail("Friend not found", 404)
  const bond = await ensureFriendshipBond(me.id, friendId)
  if (!bond) return fail("Friendship unavailable", 404)
  const pairKey = friendshipPairKey(me.id, friendId)

  if (action === "update-duo") {
    const data: { duoName?: string; title?: string; bannerOwnerId?: string | null } = {}
    if (typeof body.duoName === "string") data.duoName = clean(body.duoName, 40)
    if (typeof body.title === "string") {
      const title = clean(body.title, 60)
      const unlocked = unlockedFriendshipTitles(bond.xp, bond.messageCount)
      if (title && !unlocked.includes(title)) return fail("That duo title is not unlocked yet", 403)
      data.title = title
    }
    if (body.bannerOwnerId === null || body.bannerOwnerId === "") data.bannerOwnerId = null
    else if (typeof body.bannerOwnerId === "string") {
      if (![me.id, friendId].includes(body.bannerOwnerId)) return fail("Invalid duo banner")
      data.bannerOwnerId = body.bannerOwnerId
    }
    const updated = await db.friendshipBond.update({ where: { id: bond.id }, data })
    return NextResponse.json({ bond: updated })
  }

  if (action === "add-memory") {
    const note = clean(body.note, 500)
    if (!note) return fail("Memory note required")
    const count = await db.friendshipMemory.count({ where: { pairKey } })
    if (count >= 200) return fail("Friendship scrapbook limit reached", 409)
    const happenedAt = body.happenedAt ? new Date(String(body.happenedAt)) : new Date()
    if (!Number.isFinite(happenedAt.getTime()) || happenedAt.getTime() > Date.now() + 60_000) return fail("Memory date is invalid")
    const memory = await db.friendshipMemory.create({ data: { pairKey, creatorId: me.id, note, happenedAt } })
    return NextResponse.json({ memory })
  }

  if (action === "delete-memory") {
    const id = validId(body.id)
    if (!id) return fail("Memory not found", 404)
    const deleted = await db.friendshipMemory.deleteMany({ where: { id, pairKey, creatorId: me.id } })
    if (!deleted.count) return fail("Memory not found or not yours", 404)
    return NextResponse.json({ deleted: true })
  }

  if (action === "add-goal") {
    const title = clean(body.title, 100)
    const target = Math.max(1, Math.min(100000, Math.round(Number(body.target) || 1)))
    if (!title) return fail("Goal title required")
    const active = await db.friendshipGoal.count({ where: { pairKey, status: "active" } })
    if (active >= 20) return fail("Too many active friendship goals", 409)
    let dueAt: Date | null = null
    if (body.dueAt) {
      const parsed = new Date(String(body.dueAt))
      if (!Number.isFinite(parsed.getTime())) return fail("Invalid due date")
      dueAt = parsed
    }
    const goal = await db.friendshipGoal.create({ data: { pairKey, creatorId: me.id, title, target, dueAt } })
    return NextResponse.json({ goal })
  }

  if (action === "update-goal") {
    const id = validId(body.id)
    const goal = id ? await db.friendshipGoal.findFirst({ where: { id, pairKey } }) : null
    if (!goal) return fail("Goal not found", 404)
    const current = Math.max(0, Math.min(goal.target, Math.round(Number(body.current ?? goal.current))))
    const requestedStatus = clean(body.status, 20)
    const status = requestedStatus === "cancelled" ? "cancelled" : current >= goal.target || requestedStatus === "completed" ? "completed" : "active"
    const updated = await db.friendshipGoal.update({ where: { id }, data: { current: status === "completed" ? goal.target : current, status } })
    return NextResponse.json({ goal: updated })
  }

  if (action === "delete-goal") {
    const id = validId(body.id)
    if (!id) return fail("Goal not found", 404)
    const deleted = await db.friendshipGoal.deleteMany({ where: { id, pairKey, creatorId: me.id } })
    if (!deleted.count) return fail("Goal not found or not yours", 404)
    return NextResponse.json({ deleted: true })
  }

  return fail("Unknown friendship action")
}
