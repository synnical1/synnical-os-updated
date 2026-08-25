import { NextRequest, NextResponse } from "next/server"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { searchSynnFlix, SynnFlixUpstreamError } from "@/lib/synnflix-tmdb"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const limit = consumeRequestLimit(request, "synnflix-search", 40, 60_000)
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many SynnFlix searches. Try again shortly." }, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    })
  }

  const query = (request.nextUrl.searchParams.get("q") || "").trim().replace(/\s+/g, " ")
  if (query.length < 1 || query.length > 100) {
    return NextResponse.json({ error: "Search must be between 1 and 100 characters" }, { status: 400 })
  }

  try {
    const animeOnly = request.nextUrl.searchParams.get("mode") === "anime"
      || request.nextUrl.searchParams.get("anime") === "1"
    return NextResponse.json({ results: await searchSynnFlix(query, { animeOnly }) }, {
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" },
    })
  } catch (error) {
    if (error instanceof SynnFlixUpstreamError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("[synnflix/search] failed", error)
    return NextResponse.json({ error: "SynnFlix search failed" }, { status: 500 })
  }
}
