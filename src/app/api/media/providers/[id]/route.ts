import { NextRequest, NextResponse } from "next/server"
import { isMediaProviderId, mediaProviderStatus, mediaProviders } from "@/lib/media-providers"
import { consumeRequestLimit } from "@/lib/request-rate-limit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!isMediaProviderId(id)) return NextResponse.json({ error: "Unknown media provider" }, { status: 404 })
  const limit = consumeRequestLimit(request, `media-provider-${id}`, 30, 60_000)
  if (!limit.allowed) return NextResponse.json({ error: "Too many provider checks" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } })
  try {
    const upstream = await fetch(new URL(mediaProviders[id].homePath, mediaProviders[id].origin), { redirect: "manual", signal: AbortSignal.timeout(7_000), headers: { "User-Agent": "Synnical media provider status check" } })
    return NextResponse.json(mediaProviderStatus(id, {
      status: upstream.status,
      location: upstream.headers.get("location"),
      xFrameOptions: upstream.headers.get("x-frame-options"),
      contentSecurityPolicy: upstream.headers.get("content-security-policy"),
    }), { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" } })
  } catch {
    return NextResponse.json(mediaProviderStatus(id, { status: 503 }), { headers: { "Cache-Control": "no-store" } })
  }
}
