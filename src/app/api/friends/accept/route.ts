import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { advanceChallenge, earnAchievement } from "@/lib/feature-platform"

// POST /api/friends/accept — body: { requesterId }
export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { requesterId } = await req.json()
  if (typeof requesterId !== "string") {
    return NextResponse.json({ error: "requesterId required" }, { status: 400 })
  }
  const fr = await db.friendship.findFirst({
    where: { requesterId, receiverId: me.id, status: "PENDING" },
  })
  if (!fr) return NextResponse.json({ error: "Request not found" }, { status: 404 })
  await db.friendship.update({ where: { id: fr.id }, data: { status: "ACCEPTED" } })
  await Promise.all([
    advanceChallenge(me.id, "social_actions", 1),
    advanceChallenge(requesterId, "social_actions", 1),
  ]).catch(() => {})
  const counts = await Promise.all([
    db.friendship.count({ where: { status: "ACCEPTED", OR: [{ requesterId: me.id }, { receiverId: me.id }] } }),
    db.friendship.count({ where: { status: "ACCEPTED", OR: [{ requesterId }, { receiverId: requesterId }] } }),
  ])
  if (counts[0] >= 5) await earnAchievement(me.id, "social-five").catch(() => {})
  if (counts[1] >= 5) await earnAchievement(requesterId, "social-five").catch(() => {})
  return NextResponse.json({ ok: true })
}
