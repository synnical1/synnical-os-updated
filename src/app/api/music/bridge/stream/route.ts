import { NextRequest } from "next/server"
import { assertBridgeProvider, bridgeAudioSource, proxyExternalAudio, safeMusicError } from "@/lib/music-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FORWARDED_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"] as const

export async function GET(request: NextRequest) {
  try {
    const provider = assertBridgeProvider(request.nextUrl.searchParams.get("provider") || "")
    const id = request.nextUrl.searchParams.get("id") || ""
    const source = await bridgeAudioSource(provider, id)
    const upstream = await proxyExternalAudio(source, request.headers.get("range"))
    const headers = new Headers({ "Cache-Control": "private, no-store" })
    for (const key of FORWARDED_HEADERS) {
      const value = upstream.headers.get(key)
      if (value) headers.set(key, value)
    }
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch (error) {
    const safe = safeMusicError(error)
    return Response.json({ error: safe.message }, { status: safe.status })
  }
}
