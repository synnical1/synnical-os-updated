import { NextRequest, NextResponse } from "next/server"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { bridgeSearch, safeMusicError } from "@/lib/music-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const limit = consumeRequestLimit(request, "music-bridge-search", 30, 60_000)
  if (!limit.allowed) return NextResponse.json({ error: "Too many bridge searches" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } })
  const query = (request.nextUrl.searchParams.get("q") || "").trim().replace(/\s+/g, " ")
  if (query.length < 1 || query.length > 120) return NextResponse.json({ error: "Search must be between 1 and 120 characters" }, { status: 400 })
  try {
    return NextResponse.json(await bridgeSearch(query), { headers: { "Cache-Control": "private, max-age=20" } })
  } catch (error) {
    const safe = safeMusicError(error)
    return NextResponse.json({ error: safe.message }, { status: safe.status })
  }
}
