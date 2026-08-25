import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { isStaffRole } from "@/lib/shop-economy"
import { resolveMediaProfile } from "@/lib/synnflix-profiles-server"

export const dynamic = "force-dynamic"
const clean = (v: unknown, max = 500) => typeof v === "string" ? v.trim().slice(0, max) : ""
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const validType = (v: unknown): v is "movie" | "tv" => v === "movie" || v === "tv"
const positive = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null }

async function ensureNamedList(userId: string, profileId: string, kind: string, name: string) {
  return db.mediaList.upsert({
    where: { userId_profileId_kind_name: { userId, profileId, kind, name } },
    update: {},
    create: { userId, profileId, kind, name },
  })
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const profile = await resolveMediaProfile(me, req.nextUrl.searchParams.get("profileId"))
  const profileId = profile.id
  const partyId = clean(req.nextUrl.searchParams.get("partyId"), 128)
  const mediaType = req.nextUrl.searchParams.get("mediaType")
  const mediaId = clean(req.nextUrl.searchParams.get("mediaId"), 40)
  const season = positive(req.nextUrl.searchParams.get("season"))
  const episode = positive(req.nextUrl.searchParams.get("episode"))
  const [lists, ratings, preference, hosted, memberships, progressRows] = await Promise.all([
    db.mediaList.findMany({ where: { userId: me.id, profileId }, orderBy: [{ kind: "asc" }, { updatedAt: "desc" }] }),
    db.mediaRating.findMany({ where: { userId: me.id, profileId }, orderBy: { updatedAt: "desc" }, take: 500 }),
    db.mediaPreference.upsert({ where: { userId: me.id }, update: {}, create: { userId: me.id } }),
    db.watchParty.findMany({ where: { hostId: me.id, status: "active" }, orderBy: { updatedAt: "desc" }, take: 20 }),
    db.watchPartyMember.findMany({ where: { userId: me.id }, orderBy: { joinedAt: "desc" }, take: 30 }),
    db.mediaProgress.findMany({ where: { userId: me.id, profileId }, orderBy: { updatedAt: "desc" }, take: 500 }),
  ])
  const listIds = lists.map((row) => row.id)
  const items = listIds.length ? await db.mediaListItem.findMany({ where: { listId: { in: listIds } }, orderBy: { createdAt: "desc" }, take: 2000 }) : []
  const memberPartyIds = memberships.map((row) => row.partyId)
  const joinedParties = memberPartyIds.length ? await db.watchParty.findMany({ where: { id: { in: memberPartyIds }, status: "active" }, orderBy: { updatedAt: "desc" } }) : []
  let party: any = null
  if (partyId) {
    const row = await db.watchParty.findUnique({ where: { id: partyId } })
    if (row) {
      const member = row.hostId === me.id || Boolean(await db.watchPartyMember.findUnique({ where: { partyId_userId: { partyId, userId: me.id } } }))
      if (member) party = { ...row, memberCount: await db.watchPartyMember.count({ where: { partyId } }) + 1 }
    }
  }
  const introMarker = validType(mediaType) && mediaId ? await db.introMarker.findFirst({ where: { mediaType, mediaId, season, episode } }) : null
  const focusProgress = validType(mediaType) && mediaId ? progressRows.find((row) => row.mediaType === mediaType && row.mediaId === mediaId && row.season === (season || 0) && row.episode === (episode || 0)) || null : null
  const focusRecords = validType(mediaType) && mediaId ? await db.featureRecord.findMany({ where: { userId: me.id, scopeKey: `${profileId}:${mediaType}:${mediaId}`, kind: { in: ["media-journal", "scene-note", "media-bingo"] } }, orderBy: { updatedAt: "desc" }, take: 100 }) : []
  return NextResponse.json({
    lists: lists.map((list) => ({ ...list, items: items.filter((item) => item.listId === list.id) })),
    ratings,
    preference,
    parties: [...hosted, ...joinedParties.filter((party) => !hosted.some((host) => host.id === party.id))],
    party,
    introMarker,
    progress: progressRows,
    focusProgress,
    focusRecords: focusRecords.map((row) => ({ ...row, data: (() => { try { return JSON.parse(row.dataJson) } catch { return {} } })() })),
    meId: me.id,
    profile,
    staff: isStaffRole(me.role),
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = clean(body.action, 64)
  const profile = await resolveMediaProfile(me, body.profileId)
  const profileId = profile.id

  if (action === "create-list") {
    const name = clean(body.name, 80)
    const kind = clean(body.kind, 40) || "custom"
    if (!name) return fail("List name required")
    if (!new Set(["custom", "watchlist", "favorite"]).has(kind)) return fail("Invalid list kind")
    const count = await db.mediaList.count({ where: { userId: me.id, profileId } })
    if (count >= 100) return fail("Media list limit reached", 409)
    return NextResponse.json({ list: await ensureNamedList(me.id, profileId, kind, name) })
  }
  if (action === "delete-list") {
    const id = clean(body.id, 128)
    const list = await db.mediaList.findFirst({ where: { id, userId: me.id, profileId } })
    if (!list) return fail("List not found", 404)
    await db.$transaction([db.mediaListItem.deleteMany({ where: { listId: id } }), db.mediaList.delete({ where: { id } })])
    return NextResponse.json({ deleted: true })
  }
  if (action === "toggle-item") {
    const mediaType = body.mediaType
    const mediaId = clean(body.mediaId, 40)
    const title = clean(body.title, 240)
    if (!validType(mediaType) || !mediaId || !title) return fail("Valid media item required")
    let list: Awaited<ReturnType<typeof ensureNamedList>> | null = null
    const listId = clean(body.listId, 128)
    if (listId) list = await db.mediaList.findFirst({ where: { id: listId, userId: me.id, profileId } })
    else {
      const kind = body.kind === "favorite" ? "favorite" : "watchlist"
      list = await ensureNamedList(me.id, profileId, kind, kind === "favorite" ? "Favourites" : "Watchlist")
    }
    if (!list) return fail("List not found", 404)
    const season = positive(body.season)
    const episode = positive(body.episode)
    const existing = await db.mediaListItem.findFirst({ where: { listId: list.id, mediaType, mediaId, season, episode } })
    if (existing) { await db.mediaListItem.delete({ where: { id: existing.id } }); return NextResponse.json({ active: false, listId: list.id }) }
    const item = await db.mediaListItem.create({ data: { listId: list.id, mediaType, mediaId, title, poster: clean(body.poster, 500) || null, season, episode } })
    return NextResponse.json({ active: true, item, listId: list.id })
  }
  if (action === "rate") {
    const mediaType = body.mediaType; const mediaId = clean(body.mediaId, 40); const rating = Math.round(Number(body.rating))
    if (!validType(mediaType) || !mediaId || !Number.isInteger(rating) || rating < 1 || rating > 10) return fail("Rating must be 1-10")
    const row = await db.mediaRating.upsert({ where: { userId_profileId_mediaType_mediaId: { userId: me.id, profileId, mediaType, mediaId } }, update: { rating, review: clean(body.review, 3000) }, create: { userId: me.id, profileId, mediaType, mediaId, rating, review: clean(body.review, 3000) } })
    await db.mediaProgress.updateMany({ where: { userId: me.id, profileId, mediaType, mediaId }, data: { actualRating: rating } }).catch(() => {})
    return NextResponse.json({ rating: row })
  }
  if (action === "reset-progress") {
    const mediaType = body.mediaType; const mediaId = clean(body.mediaId, 40)
    if (!validType(mediaType) || !mediaId) return fail("Valid media progress required")
    const season = positive(body.season) || 0; const episode = positive(body.episode) || 0
    await db.mediaProgress.deleteMany({ where: { userId: me.id, profileId, mediaType, mediaId, season, episode } })
    return NextResponse.json({ reset: true })
  }
  if (action === "progress") {
    const mediaType = body.mediaType; const mediaId = clean(body.mediaId, 40); const title = clean(body.title, 240)
    if (!validType(mediaType) || !mediaId) return fail("Valid media progress required")
    const season = positive(body.season) || 0; const episode = positive(body.episode) || 0
    const hasPlaybackUpdate = Object.prototype.hasOwnProperty.call(body, "currentTime") || Object.prototype.hasOwnProperty.call(body, "duration") || body.completed === true
    const currentTime = Math.max(0, Math.min(86400 * 10, Number(body.currentTime) || 0))
    const duration = Math.max(0, Math.min(86400 * 10, Number(body.duration) || 0))
    const poster = clean(body.poster, 500) || null
    const backdrop = clean(body.backdrop, 500) || null
    const episodeName = clean(body.episodeName, 240) || null
    const completed = body.completed === true || (duration > 0 && currentTime >= duration * 0.92)
    const predictionRaw = Number(body.ratingPrediction)
    const ratingPrediction = Number.isInteger(predictionRaw) && predictionRaw >= 1 && predictionRaw <= 10 ? predictionRaw : undefined
    const key = { userId_profileId_mediaType_mediaId_season_episode: { userId: me.id, profileId, mediaType, mediaId, season, episode } }
    const existing = await db.mediaProgress.findUnique({ where: key })
    const playbackUpdate = hasPlaybackUpdate ? {
      // Durable playback progress is monotonic. A delayed ad/player event is
      // not allowed to rewind the furthest credible point reached.
      currentTime: Math.max(existing?.currentTime || 0, currentTime),
      duration: Math.max(existing?.duration || 0, duration),
      completed: Boolean(existing?.completed || completed),
    } : {}
    const row = await db.mediaProgress.upsert({
      where: key,
      update: { title, poster, backdrop, episodeName, ...playbackUpdate, ...(ratingPrediction ? { ratingPrediction } : {}) },
      create: { userId: me.id, profileId, mediaType, mediaId, season, episode, title, poster, backdrop, episodeName, currentTime, duration, completed, ...(ratingPrediction ? { ratingPrediction } : {}) },
    })
    return NextResponse.json({ progress: row })
  }
  if (action === "add-journal" || action === "add-scene-note" || action === "save-bingo") {
    const mediaType = body.mediaType; const mediaId = clean(body.mediaId, 40); const title = clean(body.title, 240)
    if (!validType(mediaType) || !mediaId) return fail("Valid media title required")
    const kind = action === "add-journal" ? "media-journal" : action === "add-scene-note" ? "scene-note" : "media-bingo"
    const data = action === "add-scene-note"
      ? { note: clean(body.note, 2000), timestamp: Math.max(0, Number(body.timestamp) || 0), season: positive(body.season), episode: positive(body.episode) }
      : action === "add-journal"
        ? { note: clean(body.note, 5000), season: positive(body.season), episode: positive(body.episode) }
        : { cells: Array.isArray(body.cells) ? body.cells.slice(0, 25).map((cell: unknown) => clean(cell, 120)).filter(Boolean) : [] }
    if ((kind === "media-journal" || kind === "scene-note") && !data.note) return fail("Write something first")
    const record = await db.featureRecord.create({ data: { userId: me.id, kind, scopeKey: `${profileId}:${mediaType}:${mediaId}`, title, dataJson: JSON.stringify(data), visibility: "private" } })
    return NextResponse.json({ record: { ...record, data } })
  }
  if (action === "delete-record") {
    const id = clean(body.id, 128)
    const row = id ? await db.featureRecord.findFirst({ where: { id, userId: me.id, scopeKey: { startsWith: `${profileId}:` }, kind: { in: ["media-journal", "scene-note", "media-bingo"] } } }) : null
    if (!row) return fail("Entry not found", 404)
    await db.featureRecord.delete({ where: { id: row.id } })
    return NextResponse.json({ deleted: true })
  }
  if (action === "set-preference") {
    const row = await db.mediaPreference.upsert({ where: { userId: me.id }, update: { ...(typeof body.episodeAutoplay === "boolean" ? { episodeAutoplay: body.episodeAutoplay } : {}), ...(typeof body.skipIntroEnabled === "boolean" ? { skipIntroEnabled: body.skipIntroEnabled } : {}) }, create: { userId: me.id, episodeAutoplay: typeof body.episodeAutoplay === "boolean" ? body.episodeAutoplay : true, skipIntroEnabled: typeof body.skipIntroEnabled === "boolean" ? body.skipIntroEnabled : true } })
    return NextResponse.json({ preference: row })
  }
  if (action === "create-party") {
    const mediaType = body.mediaType; const mediaId = clean(body.mediaId, 40); const title = clean(body.title, 240)
    if (!validType(mediaType) || !mediaId || !title) return fail("Valid title required")
    const party = await db.watchParty.create({ data: { hostId: me.id, mediaType, mediaId, title, season: positive(body.season), episode: positive(body.episode), currentTime: Math.max(0, Number(body.currentTime) || 0), playing: Boolean(body.playing) } })
    return NextResponse.json({ party })
  }
  if (action === "join-party") {
    const partyId = clean(body.partyId, 128); const party = await db.watchParty.findFirst({ where: { id: partyId, status: "active" } })
    if (!party) return fail("Watch party not found", 404)
    if (party.hostId !== me.id) await db.watchPartyMember.upsert({ where: { partyId_userId: { partyId, userId: me.id } }, update: {}, create: { partyId, userId: me.id } })
    return NextResponse.json({ party })
  }
  if (action === "leave-party") {
    const partyId = clean(body.partyId, 128); const party = await db.watchParty.findUnique({ where: { id: partyId } })
    if (!party) return fail("Watch party not found", 404)
    if (party.hostId === me.id) await db.watchParty.update({ where: { id: partyId }, data: { status: "closed", playing: false } })
    else await db.watchPartyMember.deleteMany({ where: { partyId, userId: me.id } })
    return NextResponse.json({ left: true })
  }
  if (action === "party-state") {
    const partyId = clean(body.partyId, 128); const party = await db.watchParty.findFirst({ where: { id: partyId, hostId: me.id, status: "active" } })
    if (!party) return fail("Host watch party not found", 404)
    const updated = await db.watchParty.update({ where: { id: partyId }, data: { currentTime: Math.max(0, Math.min(86400, Number(body.currentTime) || 0)), playing: Boolean(body.playing), season: positive(body.season) ?? party.season, episode: positive(body.episode) ?? party.episode } })
    return NextResponse.json({ party: updated })
  }
  if (action === "add-intro-marker") {
    if (!isStaffRole(me.role)) return fail("Staff only", 403)
    const mediaType = body.mediaType; const mediaId = clean(body.mediaId, 40); const endSeconds = Number(body.endSeconds); const startSeconds = Math.max(0, Number(body.startSeconds) || 0); const source = clean(body.source, 1000)
    if (!validType(mediaType) || !mediaId || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || !/^https?:\/\//.test(source)) return fail("A valid externally sourced intro marker is required")
    const season = positive(body.season); const episode = positive(body.episode); const markerKey = `${mediaType}:${mediaId}:${season || 0}:${episode || 0}`
    const marker = await db.introMarker.upsert({ where: { markerKey }, update: { startSeconds, endSeconds, source }, create: { markerKey, mediaType, mediaId, season, episode, startSeconds, endSeconds, source } })
    return NextResponse.json({ marker })
  }
  return fail("Unknown action", 404)
}
