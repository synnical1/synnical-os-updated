import { NextRequest, NextResponse } from "next/server"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { getTmdbDetails, getTmdbHome, getTmdbSeason, searchTmdb, TmdbCatalogError } from "@/lib/tmdb-catalog-server"
import type { SynnFlixMediaType } from "@/lib/synnflix-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const fail = (error: string, status: number) => NextResponse.json({ error }, {
  status,
  headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
})
const modeValue = (value: string | null): "movies" | "anime" | null =>
  value === "movies" || value === "anime" ? value : null
const mediaTypeValue = (value: string | null): SynnFlixMediaType | null =>
  value === "movie" || value === "tv" ? value : null
function positiveInteger(value: string | null): number | null {
  if (!value || !/^\d{1,9}$/.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

export async function GET(req: NextRequest) {
  // Catalogue browsing is deliberately available to guests, matching the app
  // navigation. The server token remains private and requests are IP-limited.
  const origin = req.headers.get("origin")
  if (origin) {
    try {
      if (new URL(origin).origin !== req.nextUrl.origin) return fail("Cross-origin catalogue requests are not allowed.", 403)
    } catch {
      return fail("Invalid request origin.", 403)
    }
  }
  const rate = consumeRequestLimit(req, "tmdb-catalog", 45, 60_000)
  if (!rate.allowed) return NextResponse.json({ error: "Too many catalogue requests. Please wait a moment." }, {
    status: 429,
    headers: { "Retry-After": String(rate.retryAfterSeconds), "Cache-Control": "private, no-store" },
  })

  const params = req.nextUrl.searchParams
  const action = params.get("action")
  const mode = modeValue(params.get("mode") || "movies")
  if (!mode) return fail("Invalid catalogue mode.", 400)

  try {
    if (action === "home") return NextResponse.json(await getTmdbHome(mode), { headers: { "Cache-Control": "private, no-store" } })
    if (action === "search") {
      const query = (params.get("query") || "").trim()
      if (!query || query.length > 100) return fail("Enter a search between 1 and 100 characters.", 400)
      return NextResponse.json(await searchTmdb(query, mode), { headers: { "Cache-Control": "private, no-store" } })
    }
    if (action === "details") {
      const type = mediaTypeValue(params.get("type"))
      const id = positiveInteger(params.get("id"))
      if (!type || !id) return fail("Invalid title identity.", 400)
      return NextResponse.json(await getTmdbDetails(type, id), { headers: { "Cache-Control": "private, no-store" } })
    }
    if (action === "season") {
      const id = positiveInteger(params.get("id"))
      const rawSeason = params.get("season")
      const season = rawSeason !== null && /^\d{1,3}$/.test(rawSeason) ? Number(rawSeason) : -1
      if (!id || !Number.isSafeInteger(season) || season < 0 || season > 999) return fail("Invalid season identity.", 400)
      return NextResponse.json(await getTmdbSeason(id, season), { headers: { "Cache-Control": "private, no-store" } })
    }
    return fail("Unknown catalogue action.", 400)
  } catch (error) {
    if (error instanceof TmdbCatalogError) return fail(error.message, error.code === "not_configured" ? 503 : 502)
    return fail("The catalogue request failed. Please try again.", 502)
  }
}
