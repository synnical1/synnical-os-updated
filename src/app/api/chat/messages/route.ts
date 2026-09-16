import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { requireChannelAccess } from "@/lib/feature-auth"

// GET /api/chat/messages?channelId=...&before=<iso> — message history (paginated, persisted)
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const channelId = searchParams.get("channelId")
  if (!channelId) return NextResponse.json({ error: "channelId required" }, { status: 400 })
  if (!await requireChannelAccess(channelId, user.id, user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const before = searchParams.get("before")
  if (before && !Number.isFinite(new Date(before).getTime())) return NextResponse.json({ error: "Invalid cursor" }, { status: 400 })
  const take = 50

  const messages = await db.message.findMany({
    where: {
      channelId,
      deleted: false,
      ...(before ? { createdAt: { lt: new Date(before) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
  })

  return NextResponse.json({ messages: messages.reverse() })
}
