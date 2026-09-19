import { NextRequest, NextResponse } from "next/server"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { audiusSearch, safeMusicError } from "@/lib/music-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const limit = consumeRequestLimit(request, "music-audius-search", 50, 60_000)
  if (!limit.allowed) return NextResponse.json({ error: "Too many music searches" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } })
  const query = (request.nextUrl.searchParams.get("q") || "").trim().replace(/\s+/g, " ")
  if (query.length < 1 || query.length > 120) return NextResponse.json({ error: "Search must be between 1 and 120 characters" }, { status: 400 })
  const offset = Math.max(0, Math.min(1_000, Number.parseInt(request.nextUrl.searchParams.get("offset") || "0", 10) || 0))
  const pageSize = Math.max(1, Math.min(40, Number.parseInt(request.nextUrl.searchParams.get("limit") || "30", 10) || 30))
  try {
    const tracks = await audiusSearch(query, pageSize, offset)
    return NextResponse.json({
      tracks,
      offset,
      nextOffset: offset + tracks.length,
      hasMore: tracks.length === pageSize,
    }, { headers: { "Cache-Control": "public, max-age=20, stale-while-revalidate=90" } })
  } catch (error) {
    const safe = safeMusicError(error)
    return NextResponse.json({ error: safe.message }, { status: safe.status })
  }
}
