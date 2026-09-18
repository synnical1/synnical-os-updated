import { NextRequest, NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import type { MusicTrack } from "@/lib/music-types"
const kinds = ["music-favorite", "music-history"]
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Sign in to use your music library" }, { status: 401 })
  const rows = await db.featureRecord.findMany({ where: { userId: user.id, kind: { in: kinds } }, orderBy: { updatedAt: "desc" }, take: 500 })
  return NextResponse.json({ favorites: rows.filter(row => row.kind === kinds[0]).map(row => JSON.parse(row.dataJson)), history: rows.filter(row => row.kind === kinds[1]).map(row => JSON.parse(row.dataJson)) }, { headers: { "Cache-Control": "private, no-store" } })
}
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Sign in to save music" }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || !["favorite", "history"].includes(body.action) || typeof body.track?.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(body.track.id) || body.track.provider !== "audius") return NextResponse.json({ error: "Invalid Audius track" }, { status: 400 })
  const input = body.track
  const track: MusicTrack = { id: input.id, provider: "audius", title: String(input.title || input.id).slice(0,300), artist: String(input.artist || "Unknown artist").slice(0,300), duration: Number.isFinite(input.duration) ? Math.max(0,Math.min(86400,input.duration)) : 0, artwork: typeof input.artwork === "string" && /^https:\/\//.test(input.artwork) ? input.artwork.slice(0,2000) : null }
  const kind = `music-${body.action}`
  const id = createHash("sha256").update(`${user.id}\0${kind}\0${track.id}`).digest("hex")
  if (body.action === "favorite" && body.remove === true) await db.featureRecord.deleteMany({ where: { id, userId: user.id } })
  else await db.featureRecord.upsert({ where: { id }, create: { id, userId: user.id, kind, scopeKey: track.id, dataJson: JSON.stringify(track) }, update: { dataJson: JSON.stringify(track) } })
  return NextResponse.json({ ok: true })
}
