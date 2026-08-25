import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"

// GET /api/chat/messages?channelId=...&before=<iso> — message history (paginated, persisted)
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const channelId = searchParams.get("channelId")
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 })

  const before = searchParams.get("before")
  const take = 50

  const messages = await db.message.findMany({
    where: {
      channelId,
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
  })

  return NextResponse.json({ messages: messages.reverse() })
}
