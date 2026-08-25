import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"

// POST /api/friends/remove — body: { userId }
export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { userId } = await req.json()
  if (typeof userId !== "string") {
    return NextResponse.json({ error: "userId required" }, { status: 400 })
  }
  await db.friendship.deleteMany({
    where: {
      OR: [
        { requesterId: me.id, receiverId: userId },
        { requesterId: userId, receiverId: me.id },
      ],
    },
  })
  return NextResponse.json({ ok: true })
}
