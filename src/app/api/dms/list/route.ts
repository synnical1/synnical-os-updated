import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"

export const dynamic = "force-dynamic"

const DISABLED_NOTICE = "Direct messaging is temporarily unavailable while Synnical reviews and strengthens its safety, safeguarding and moderation measures."

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({ disabled: true, error: DISABLED_NOTICE, dms: [], groups: [] }, {
    status: 503,
    headers: { "Cache-Control": "private, no-store" },
  })
}

export async function POST() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({ disabled: true, error: DISABLED_NOTICE }, {
    status: 503,
    headers: { "Cache-Control": "private, no-store" },
  })
}
