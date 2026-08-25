import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"

export const dynamic = "force-dynamic"
const clean = (v: unknown, max = 500) => typeof v === "string" ? v.trim().slice(0, max) : ""
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const providers = new Set(["audius", "piped", "invidious", "cobalt"])

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const [playlists, activity] = await Promise.all([
    db.musicPlaylist.findMany({ where: { userId: me.id }, orderBy: { updatedAt: "desc" } }),
    db.musicActivity.upsert({ where: { userId: me.id }, update: {}, create: { userId: me.id } }),
  ])
  const ids = playlists.map((row) => row.id)
  const tracks = ids.length ? await db.musicPlaylistTrack.findMany({ where: { playlistId: { in: ids } }, orderBy: [{ playlistId: "asc" }, { position: "asc" }] }) : []
  return NextResponse.json({ playlists: playlists.map((playlist) => ({ ...playlist, tracks: tracks.filter((track) => track.playlistId === playlist.id) })), activity })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = clean(body.action, 64)
  if (action === "save-playlist") {
    const name = clean(body.name, 100)
    if (!name) return fail("Playlist name required")
    const incoming = Array.isArray(body.tracks) ? body.tracks.slice(0, 500) : []
    const seen = new Set<string>()
    const tracks = incoming.map((track: any) => {
      const provider = providers.has(track.provider) ? track.provider : "audius"
      const id = clean(track.id, 200)
      if (!id) return null
      const key = `${provider}:${id}`
      if (seen.has(key)) return null
      seen.add(key)
      return { trackId: id, provider, title: clean(track.title, 300) || id, artist: clean(track.artist, 300), artwork: clean(track.artwork, 1000) || null, streamUrl: clean(track.sourceUrl, 2000) || null, duration: Math.max(0, Math.min(86400, Math.round(Number(track.duration) || 0))) }
    }).filter(Boolean) as Array<{ trackId: string; provider: string; title: string; artist: string; artwork: string | null; streamUrl: string | null; duration: number }>
    const playlist = await db.musicPlaylist.upsert({ where: { userId_name: { userId: me.id, name } }, update: {}, create: { userId: me.id, name } })
    await db.$transaction(async (tx) => {
      await tx.musicPlaylistTrack.deleteMany({ where: { playlistId: playlist.id } })
      if (tracks.length) await tx.musicPlaylistTrack.createMany({ data: tracks.map((track, position) => ({ playlistId: playlist.id, ...track, position })) })
      await tx.musicPlaylist.update({ where: { id: playlist.id }, data: { updatedAt: new Date() } })
    })
    return NextResponse.json({ playlistId: playlist.id, tracks: tracks.length })
  }
  if (action === "delete-playlist") {
    const id = clean(body.id, 128)
    const playlist = await db.musicPlaylist.findFirst({ where: { id, userId: me.id } })
    if (!playlist) return fail("Playlist not found", 404)
    await db.$transaction([db.musicPlaylistTrack.deleteMany({ where: { playlistId: id } }), db.musicPlaylist.delete({ where: { id } })])
    return NextResponse.json({ deleted: true })
  }
  if (action === "activity") {
    const track = body.track && typeof body.track === "object" ? body.track : null
    const shareEnabled = typeof body.shareEnabled === "boolean" ? body.shareEnabled : undefined
    const shouldClear = body.clear === true || (!track && body.isPlaying === false)
    const row = await db.musicActivity.upsert({
      where: { userId: me.id },
      update: {
        ...(track
          ? {
              trackId: `${clean(track.provider, 30)}:${clean(track.id, 200)}`,
              title: clean(track.title, 300),
              artist: clean(track.artist, 300),
              artwork: clean(track.artwork, 1000) || null,
              isPlaying: Boolean(body.isPlaying),
            }
          : shouldClear
            ? { trackId: null, title: null, artist: null, artwork: null, isPlaying: false }
            : { isPlaying: Boolean(body.isPlaying) }),
        ...(shareEnabled !== undefined ? { shareEnabled } : {}),
      },
      create: {
        userId: me.id,
        trackId: track ? `${clean(track.provider, 30)}:${clean(track.id, 200)}` : null,
        title: track ? clean(track.title, 300) : null,
        artist: track ? clean(track.artist, 300) : null,
        artwork: track ? clean(track.artwork, 1000) || null : null,
        isPlaying: Boolean(body.isPlaying),
        shareEnabled: shareEnabled ?? true,
      },
    })
    return NextResponse.json({ activity: row })
  }
  return fail("Unknown action", 404)
}
