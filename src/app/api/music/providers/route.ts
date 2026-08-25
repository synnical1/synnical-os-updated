import { NextResponse } from "next/server"
import { providerStatus } from "@/lib/music-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.json(providerStatus(), { headers: { "Cache-Control": "private, max-age=30" } })
}
