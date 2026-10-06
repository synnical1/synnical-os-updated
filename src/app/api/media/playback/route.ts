import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { mediaPlaybackProvider } from "@/lib/media-playback-server"
import { consumeRequestLimit } from "@/lib/request-rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const rate = consumeRequestLimit(req, "media-playback", 60, 60_000, me.id)
  if (!rate.allowed) return NextResponse.json({ error: "Too many playback requests" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } })
  const type = req.nextUrl.searchParams.get("type")
  const id = Number(req.nextUrl.searchParams.get("id"))
  const season = Number(req.nextUrl.searchParams.get("season"))
  const episode = Number(req.nextUrl.searchParams.get("episode"))
  if (!["movie", "tv"].includes(type || "") || !Number.isSafeInteger(id) || id < 1 || (type === "tv" && (!Number.isSafeInteger(season) || season < 0 || season > 999 || !Number.isSafeInteger(episode) || episode < 1 || episode > 10000))) return NextResponse.json({ error: "Invalid playback title" }, { status: 400 })
  const source = type === "movie" ? await mediaPlaybackProvider.getMovieSource(id) : await mediaPlaybackProvider.getEpisodeSource(id, season, episode)
  return NextResponse.json({ source, available: Boolean(source), ...(!source ? { reason: "Playback unavailable", message: "Under Construction — no authorized playback source is configured for this title." } : {}) }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } })
}
