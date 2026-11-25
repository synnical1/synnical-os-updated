import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { forwardRustChat } from "@/lib/rust-chat"

export const dynamic = "force-dynamic"

// GET /api/chat/messages?channelId=...&before=<ISO timestamp>
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (user.role !== "OWNER") return NextResponse.json({ error: "Chat is available only to the owner" }, { status: 403 })
  return forwardRustChat("/v1/chat/messages", req)
}
