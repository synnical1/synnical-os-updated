import { NextRequest } from "next/server"
import { fetchAudiusStream, safeMusicError } from "@/lib/music-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FORWARDED_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"] as const

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const upstream = await fetchAudiusStream(id, request.headers.get("range"))
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
