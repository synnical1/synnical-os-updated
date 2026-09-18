import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { moderateAccount, ModerationError } from "@/lib/moderation-service"
export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  try {
    return NextResponse.json(await moderateAccount(me.id, { ...body, type: "MUTE", reason: body.reason || "Staff action" }))
  } catch (error) {
    if (error instanceof ModerationError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("[moderation] action failed", error)
    return NextResponse.json({ error: "Moderation action failed. Please retry." }, { status: 500 })
  }
}
