import { NextResponse } from "next/server"
import { runtimeHealthSnapshot } from "@/lib/runtime-health"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const now = Date.now()
  return NextResponse.json({
    onlineCount: runtimeHealthSnapshot().onlineUsers,
    updatedAt: new Date(now).toISOString(),
  }, {
    headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" },
  })
}
