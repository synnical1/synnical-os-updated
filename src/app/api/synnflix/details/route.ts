import { NextRequest, NextResponse } from "next/server"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { getSynnFlixDetails, SynnFlixUpstreamError } from "@/lib/synnflix-tmdb"
import type { SynnFlixMediaType } from "@/lib/synnflix-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const limit = consumeRequestLimit(request, "synnflix-details", 60, 60_000)
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many SynnFlix requests. Try again shortly." }, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    })
  }

  const type = request.nextUrl.searchParams.get("type")
  const id = Number(request.nextUrl.searchParams.get("id"))
  if ((type !== "movie" && type !== "tv") || !Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid SynnFlix title" }, { status: 400 })
  }

  try {
    return NextResponse.json({ details: await getSynnFlixDetails(type as SynnFlixMediaType, id) }, {
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=900" },
    })
  } catch (error) {
    if (error instanceof SynnFlixUpstreamError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("[synnflix/details] failed", error)
    return NextResponse.json({ error: "SynnFlix could not load that title" }, { status: 500 })
  }
}
