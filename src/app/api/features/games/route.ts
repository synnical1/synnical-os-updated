import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { recordGameSeconds, safeJson } from "@/lib/feature-platform"
import { promises as fs } from "fs"
import path from "path"
import { uploadsDir } from "@/lib/uploads"
import { runAutomationTrigger } from "@/lib/automation-engine"

export const dynamic = "force-dynamic"
const clean = (value: unknown, max = 180) => typeof value === "string" ? value.trim().slice(0, max) : ""
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

const GAME_SESSION_STALE_MS = 120_000

async function closeGameSessions(userId: string, sessions: Array<{ id: string; startedAt: Date; updatedAt: Date }>, result: string) {
  const now = new Date()
  for (const session of sessions) {
    const lastSeen = session.updatedAt.getTime()
    const endedAt = lastSeen < now.getTime() - GAME_SESSION_STALE_MS ? session.updatedAt : now
    const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000))
    const changed = await db.gameSession.updateMany({
      where: { id: session.id, userId, status: "active" },
      data: { endedAt, durationSeconds, result, status: "ended" },
    })
    if (changed.count > 0 && durationSeconds > 0) await recordGameSeconds(userId, durationSeconds).catch(() => {})
  }
}

async function reconcileGameSessions(user: { id: string; gameStatusSessionId: string | null }) {
  const active = await db.gameSession.findMany({
    where: { userId: user.id, status: "active" },
    select: { id: true, startedAt: true, updatedAt: true },
  })
  if (!active.length) return
  const cutoff = Date.now() - GAME_SESSION_STALE_MS
  const stale = active.filter((session) => session.id !== user.gameStatusSessionId || session.updatedAt.getTime() < cutoff)
  if (!stale.length) return
  await closeGameSessions(user.id, stale, "interrupted")
  if (user.gameStatusSessionId && stale.some((session) => session.id === user.gameStatusSessionId)) {
    await db.user.updateMany({
      where: { id: user.id, gameStatusSessionId: user.gameStatusSessionId },
      data: { gameStatus: "", gameStatusGameId: null, gameStatusSessionId: null },
    })
  }
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  // Session history is persisted, so browser closes and failed cleanup calls can
  // otherwise leave zombie rows marked active forever. Only the current,
  // recently-heartbeating session is allowed to remain active.
  await reconcileGameSessions({ id: me.id, gameStatusSessionId: me.gameStatusSessionId })
  const [collections, items, sessions, presets, screenshots, history, favorites, socialRecords] = await Promise.all([
    db.gameCollection.findMany({ where: { userId: me.id }, orderBy: { updatedAt: "desc" } }),
    db.gameCollectionItem.findMany({ where: { collectionId: { in: (await db.gameCollection.findMany({ where: { userId: me.id }, select: { id: true } })).map((row) => row.id) } }, orderBy: { createdAt: "desc" } }),
    db.gameSession.findMany({ where: { userId: me.id }, orderBy: { startedAt: "desc" }, take: 100 }),
    db.gamePreset.findMany({ where: { userId: me.id } }),
    db.gameScreenshot.findMany({ where: { userId: me.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.gameHistory.findMany({ where: { userId: me.id }, orderBy: { playedAt: "desc" }, take: 100 }),
    db.gameFavorite.findMany({ where: { userId: me.id }, orderBy: { createdAt: "desc" } }),
    db.featureRecord.findMany({ where: { userId: me.id, kind: { in: ["game-backlog", "game-goal", "game-journal", "game-plan", "game-match", "game-rivalry", "game-prediction", "game-clip-entry"] } }, orderBy: { updatedAt: "desc" }, take: 300 }),
  ])
  const itemsByCollection = new Map<string, string[]>()
  for (const item of items) itemsByCollection.set(item.collectionId, [...(itemsByCollection.get(item.collectionId) || []), item.gameId])
  const durationByGame = new Map<string, number>()
  for (const session of sessions) durationByGame.set(session.gameId, (durationByGame.get(session.gameId) || 0) + session.durationSeconds)
  const lastPlayed = new Map<string, Date>()
  for (const row of history) if (!lastPlayed.has(row.gameId)) lastPlayed.set(row.gameId, row.playedAt)
  const backlogIds = socialRecords.filter((row) => row.kind === "game-backlog").map((row) => row.scopeKey).filter(Boolean)
  const abandonedGames = backlogIds.filter((gameId) => { const played = lastPlayed.get(gameId); return !played || Date.now() - played.getTime() > 30 * 86400000 }).slice(0, 20)
  const friendId = clean(req.nextUrl.searchParams.get("friendId"), 128)
  let friendComparison: unknown = null
  if (friendId) {
    const accepted = await db.friendship.findFirst({ where: { status: "ACCEPTED", OR: [{ requesterId: me.id, receiverId: friendId }, { requesterId: friendId, receiverId: me.id }] }, select: { id: true } })
    if (accepted) {
      const [friendFavs, friendSessions] = await Promise.all([db.gameFavorite.findMany({ where: { userId: friendId }, select: { gameId: true } }), db.gameSession.findMany({ where: { userId: friendId, status: "ended" }, orderBy: { startedAt: "desc" }, take: 100 })])
      const mine = new Set(favorites.map((row) => row.gameId)), theirs = new Set(friendFavs.map((row) => row.gameId))
      const shared = [...mine].filter((id) => theirs.has(id))
      const myLatency = sessions.filter((x) => x.latencyMs != null).map((x) => x.latencyMs as number)
      const theirLatency = friendSessions.filter((x) => x.latencyMs != null).map((x) => x.latencyMs as number)
      friendComparison = { sharedFavorites: shared, compatibility: Math.round((shared.length / Math.max(1, new Set([...mine, ...theirs]).size)) * 100), myAverageLatency: myLatency.length ? Math.round(myLatency.reduce((a,b)=>a+b,0)/myLatency.length) : null, friendAverageLatency: theirLatency.length ? Math.round(theirLatency.reduce((a,b)=>a+b,0)/theirLatency.length) : null }
    }
  }
  return NextResponse.json({
    collections: collections.map((row) => ({ ...row, gameIds: itemsByCollection.get(row.id) || [] })),
    sessions,
    presets: presets.map((row) => ({ ...row, controller: JSON.parse(row.controllerJson || "{}"), audio: JSON.parse(row.audioJson || "{}") })),
    screenshots: screenshots.map((row) => ({ ...row, fileUrl: `/api/features/games/screenshot/${encodeURIComponent(row.id)}` })),
    history,
    favorites: favorites.map((row) => row.gameId),
    socialRecords: socialRecords.map((row) => ({ id: row.id, kind: row.kind, gameId: row.scopeKey, title: row.title, data: safeJson(row.dataJson, {}), visibility: row.visibility, createdAt: row.createdAt, updatedAt: row.updatedAt })),
    abandonedGames,
    friendComparison,
    durationByGame: Object.fromEntries(durationByGame),
    continuePlaying: sessions.filter((row) => row.durationSeconds > 0).filter((row, index, all) => all.findIndex((other) => other.gameId === row.gameId) === index).slice(0, 20),
    capabilities: {
      providerBitrateControl: false,
      providerBitrateReason: "The current Stratus provider does not expose a bitrate-control parameter.",
      sameProviderSessionInvite: false,
      sameProviderSessionInviteReason: "The current provider does not expose a share/join-session token.",
      streamReconnect: true,
      screenshotCapture: "upload",
    },
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = clean(body.action, 64)

  if (action === "create-collection") {
    const name = clean(body.name, 60)
    if (!name) return fail("Collection name required")
    const count = await db.gameCollection.count({ where: { userId: me.id } })
    if (count >= 50) return fail("Game collection limit reached", 409)
    const collection = await db.gameCollection.upsert({ where: { userId_name: { userId: me.id, name } }, update: {}, create: { userId: me.id, name } })
    return NextResponse.json({ collection })
  }
  if (action === "delete-collection") {
    const id = clean(body.id, 128)
    const owned = await db.gameCollection.findFirst({ where: { id, userId: me.id } })
    if (!owned) return fail("Collection not found", 404)
    await db.$transaction([db.gameCollectionItem.deleteMany({ where: { collectionId: id } }), db.gameCollection.delete({ where: { id } })])
    return NextResponse.json({ deleted: true })
  }
  if (action === "toggle-collection-game") {
    const collectionId = clean(body.collectionId, 128)
    const gameId = clean(body.gameId, 120)
    if (!gameId || !await db.gameCollection.findFirst({ where: { id: collectionId, userId: me.id } })) return fail("Collection not found", 404)
    const existing = await db.gameCollectionItem.findUnique({ where: { collectionId_gameId: { collectionId, gameId } } })
    if (existing) await db.gameCollectionItem.delete({ where: { id: existing.id } })
    else await db.gameCollectionItem.create({ data: { collectionId, gameId } })
    return NextResponse.json({ active: !existing })
  }
  if (action === "save-preset") {
    const gameId = clean(body.gameId, 120)
    if (!gameId) return fail("Game id required")
    const controller = body.controller && typeof body.controller === "object" ? body.controller : {}
    const audio = body.audio && typeof body.audio === "object" ? body.audio : {}
    const preset = await db.gamePreset.upsert({ where: { userId_gameId: { userId: me.id, gameId } }, update: { controllerJson: JSON.stringify(controller).slice(0, 5000), audioJson: JSON.stringify(audio).slice(0, 5000) }, create: { userId: me.id, gameId, controllerJson: JSON.stringify(controller).slice(0, 5000), audioJson: JSON.stringify(audio).slice(0, 5000) } })
    return NextResponse.json({ preset })
  }
  if (action === "save-social-record") {
    const kind = clean(body.kind, 64)
    const allowed = new Set(["game-backlog", "game-goal", "game-journal", "game-plan", "game-match", "game-rivalry", "game-prediction", "game-clip-entry"])
    if (!allowed.has(kind)) return fail("Unsupported game record")
    const gameId = clean(body.gameId, 120)
    const title = clean(body.title, 180) || gameId || kind.replace("game-", "")
    const input = body.data && typeof body.data === "object" ? body.data : {}
    const dataJson = JSON.stringify(input)
    if (dataJson.length > 20000) return fail("Game record is too large")
    const id = clean(body.id, 128)
    if (id) {
      const updated = await db.featureRecord.updateMany({ where: { id, userId: me.id, kind }, data: { scopeKey: gameId, title, dataJson, visibility: body.visibility === "friends" ? "friends" : "private" } })
      if (!updated.count) return fail("Game record not found", 404)
      return NextResponse.json({ ok: true })
    }
    if (await db.featureRecord.count({ where: { userId: me.id, kind } }) >= 200) return fail("Game record limit reached")
    const record = await db.featureRecord.create({ data: { userId: me.id, kind, scopeKey: gameId, title, dataJson, visibility: body.visibility === "friends" ? "friends" : "private" } })
    return NextResponse.json({ record })
  }
  if (action === "delete-social-record") {
    const deleted = await db.featureRecord.deleteMany({ where: { id: clean(body.id, 128), userId: me.id, kind: { in: ["game-backlog", "game-goal", "game-journal", "game-plan", "game-match", "game-rivalry", "game-prediction", "game-clip-entry"] } } })
    return NextResponse.json({ ok: deleted.count === 1 })
  }
  if (action === "group-game-match") {
    const spaceId = clean(body.spaceId, 128)
    const member = await db.socialSpaceMember.findUnique({ where: { spaceId_userId: { spaceId, userId: me.id } } })
    if (!member) return fail("Space not found", 404)
    const members = await db.socialSpaceMember.findMany({ where: { spaceId }, select: { userId: true }, take: 50 })
    const favs = await db.gameFavorite.findMany({ where: { userId: { in: members.map((m) => m.userId) } }, select: { userId: true, gameId: true } })
    const sets = members.map((m) => new Set(favs.filter((f) => f.userId === m.userId).map((f) => f.gameId)))
    const common = sets.length ? [...sets[0]].filter((id) => sets.every((set) => set.has(id))) : []
    return NextResponse.json({ common, memberCount: members.length, source: "Synnical game favourites" })
  }
  if (action === "session-start") {
    const gameId = clean(body.gameId, 120)
    const providerSessionId = clean(body.providerSessionId, 180) || null
    if (!gameId) return fail("Game id required")
    let session = providerSessionId ? await db.gameSession.findFirst({ where: { userId: me.id, providerSessionId, status: "active" } }) : null
    const previous = await db.gameSession.findMany({
      where: { userId: me.id, status: "active", ...(session ? { id: { not: session.id } } : {}) },
      select: { id: true, startedAt: true, updatedAt: true },
    })
    if (previous.length) await closeGameSessions(me.id, previous, "replaced")
    if (!session) session = await db.gameSession.create({ data: { userId: me.id, gameId, providerSessionId, latencyMs: Number.isFinite(Number(body.latencyMs)) ? Math.max(0, Math.min(60000, Math.round(Number(body.latencyMs)))) : null } })
    else session = await db.gameSession.update({ where: { id: session.id }, data: { gameId } })
    await db.user.update({ where: { id: me.id }, data: { gameStatus: `Playing ${clean(body.gameName, 120) || gameId}`, gameStatusGameId: gameId, gameStatusSessionId: session.id } })
    await runAutomationTrigger(me.id, "game_launch", { gameId, gameName: clean(body.gameName, 120) || gameId }).catch(() => {})
    await db.gameHistory.create({ data: { userId: me.id, gameId } })
    return NextResponse.json({ session })
  }
  if (action === "session-failure") {
    const gameId = clean(body.gameId, 120)
    const providerSessionId = clean(body.providerSessionId, 180) || null
    const errorCode = clean(body.errorCode, 120) || "GAME_LAUNCH_FAILED"
    const result = clean(body.result, 80) || "launch-failed"
    if (!gameId) return fail("Game id required")
    if (providerSessionId) {
      const existing = await db.gameSession.findFirst({ where: { userId: me.id, providerSessionId } })
      if (existing) return NextResponse.json({ session: existing, alreadyRecorded: true })
    }
    const now = new Date()
    const session = await db.gameSession.create({ data: { userId: me.id, gameId, providerSessionId, startedAt: now, endedAt: now, durationSeconds: 0, result, errorCode, status: "ended" } })
    await db.gameHistory.create({ data: { userId: me.id, gameId } }).catch(() => {})
    return NextResponse.json({ session })
  }
  if (action === "session-heartbeat") {
    const id = clean(body.id, 128)
    const changed = await db.gameSession.updateMany({ where: { id, userId: me.id, status: "active" }, data: { result: "active" } })
    return NextResponse.json({ updated: changed.count > 0 })
  }
  if (action === "session-latency") {
    const id = clean(body.id, 128)
    const latencyMs = Math.max(0, Math.min(60000, Math.round(Number(body.latencyMs) || 0)))
    const changed = await db.gameSession.updateMany({ where: { id, userId: me.id, status: "active" }, data: { latencyMs } })
    return NextResponse.json({ updated: changed.count > 0 })
  }
  if (action === "session-end") {
    const id = clean(body.id, 128)
    const session = await db.gameSession.findFirst({ where: { id, userId: me.id } })
    if (!session) return fail("Game session not found", 404)
    if (session.status !== "active") return NextResponse.json({ session, alreadyEnded: true })
    const endedAt = new Date()
    const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000))
    const updated = await db.gameSession.update({ where: { id }, data: { endedAt, durationSeconds, result: clean(body.result, 80) || "ended", errorCode: clean(body.errorCode, 120) || null, status: "ended" } })
    await recordGameSeconds(me.id, durationSeconds).catch(() => {})
    await db.user.updateMany({ where: { id: me.id, gameStatusSessionId: id }, data: { gameStatus: "", gameStatusGameId: null, gameStatusSessionId: null } })
    return NextResponse.json({ session: updated })
  }
  if (action === "delete-screenshot") {
    const id = clean(body.id, 128)
    const shot = await db.gameScreenshot.findFirst({ where: { id, userId: me.id } })
    if (!shot) return fail("Screenshot not found", 404)
    await db.gameScreenshot.delete({ where: { id } })
    const root = path.resolve(uploadsDir())
    const full = path.resolve(root, shot.fileUrl)
    if (full.startsWith(root + path.sep)) await fs.unlink(full).catch(() => undefined)
    return NextResponse.json({ deleted: true })
  }
  return fail("Unknown action", 404)
}
