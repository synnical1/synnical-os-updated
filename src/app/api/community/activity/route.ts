import { NextResponse } from "next/server"
import { getSimulatedOnlineCount } from "@/lib/simulated-community-activity"

export const dynamic = "force-dynamic"

export async function GET() {
  const now = Date.now()
  return NextResponse.json({
    onlineCount: getSimulatedOnlineCount(Math.floor(now / 60_000)),
    allTimePeak: 1064,
    simulated: true,
    updatedAt: new Date(now).toISOString(),
  }, {
    headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" },
  })
}
