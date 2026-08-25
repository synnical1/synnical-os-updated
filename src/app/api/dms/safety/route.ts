import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { getDmSafetyNotice } from "@/lib/dm-safety"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const channelId = new URL(req.url).searchParams.get("channelId")
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 })
  return NextResponse.json({ notice: await getDmSafetyNotice(channelId, me.id) }, { headers: { "Cache-Control": "private, no-store" } })
}
