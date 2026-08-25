import { NextRequest, NextResponse } from "next/server"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { getSynnFlixSeason, SynnFlixUpstreamError } from "@/lib/synnflix-tmdb"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const limit = consumeRequestLimit(request, "synnflix-season", 60, 60_000)
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many SynnFlix requests. Try again shortly." }, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    })
  }

  const id = Number(request.nextUrl.searchParams.get("id"))
  const season = Number(request.nextUrl.searchParams.get("season"))
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(season) || season < 0 || season > 999) {
    return NextResponse.json({ error: "Invalid SynnFlix season" }, { status: 400 })
  }

  try {
    return NextResponse.json({ season: await getSynnFlixSeason(id, season) }, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=900" },
    })
  } catch (error) {
    if (error instanceof SynnFlixUpstreamError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("[synnflix/season] failed", error)
    return NextResponse.json({ error: "SynnFlix could not load that season" }, { status: 500 })
  }
}
