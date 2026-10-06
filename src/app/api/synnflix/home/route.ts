import { NextRequest, NextResponse } from "next/server"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { tmdbMetadataProvider, SynnFlixUpstreamError } from "@/lib/synnflix-tmdb"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const limit = consumeRequestLimit(request, "synnflix-home", 30, 60_000)
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many SynnFlix refreshes. Try again shortly." }, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    })
  }
  const page = Number(request.nextUrl.searchParams.get("page") || "1")
  if (!Number.isSafeInteger(page) || page < 1 || page > 500) return NextResponse.json({ error: "Invalid catalogue page" }, { status: 400 })
  try {
    const animeOnly = request.nextUrl.searchParams.get("mode") === "anime"
      || request.nextUrl.searchParams.get("anime") === "1"
    return NextResponse.json(await tmdbMetadataProvider.home({ animeOnly, page }), {
      headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=240" },
    })
  } catch (error) {
    if (error instanceof SynnFlixUpstreamError) return NextResponse.json({ error: error.message }, { status: error.status, headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {} })
    console.error("[synnflix/home] failed", error)
    return NextResponse.json({ error: "SynnFlix could not load right now" }, { status: 500 })
  }
}
