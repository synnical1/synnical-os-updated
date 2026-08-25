import { NextRequest, NextResponse } from "next/server"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { audiusTrending, safeMusicError } from "@/lib/music-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const limit = consumeRequestLimit(request, "music-audius-discover", 40, 60_000)
  if (!limit.allowed) return NextResponse.json({ error: "Too many music refreshes" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } })
  try {
    return NextResponse.json({ tracks: await audiusTrending(30) }, { headers: { "Cache-Control": "public, max-age=45, stale-while-revalidate=180" } })
  } catch (error) {
    const safe = safeMusicError(error)
    return NextResponse.json({ error: safe.message }, { status: safe.status })
  }
}
