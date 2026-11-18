import { NextResponse } from "next/server"
import { addOnlineMembersToBaseline, getSimulatedOnlineCount } from "@/lib/simulated-community-activity"
import { runtimeHealthSnapshot } from "@/lib/runtime-health"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const now = Date.now()
  const generatedOnlineCount = getSimulatedOnlineCount(Math.floor(now / 60_000))
  const onlineMembers = runtimeHealthSnapshot().onlineMembers
  return NextResponse.json({
    onlineCount: addOnlineMembersToBaseline(generatedOnlineCount, onlineMembers),
    generatedOnlineCount,
    realOnlineCount: onlineMembers,
    allTimePeak: 1064,
    updatedAt: new Date(now).toISOString(),
  }, {
    headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" },
  })
}
