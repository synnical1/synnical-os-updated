import { NextRequest, NextResponse } from "next/server"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { cobaltResolve, safeMusicError } from "@/lib/music-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  const limit = consumeRequestLimit(request, "music-cobalt-resolve", 15, 60_000)
  if (!limit.allowed) return NextResponse.json({ error: "Too many media resolves" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } })
  const body = await request.json().catch(() => ({})) as { url?: unknown }
  const url = typeof body.url === "string" ? body.url.trim() : ""
  if (!url || url.length > 2_000) return NextResponse.json({ error: "Enter a valid media URL" }, { status: 400 })
  try {
    return NextResponse.json({ url: await cobaltResolve(url) }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const safe = safeMusicError(error)
    return NextResponse.json({ error: safe.message }, { status: safe.status })
  }
}
