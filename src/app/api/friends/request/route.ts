import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"

// POST /api/friends/request — send a friend request by username
export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { username } = await req.json()
  if (typeof username !== "string") {
    return NextResponse.json({ error: "username required" }, { status: 400 })
  }
  const target = await db.user.findUnique({ where: { username: username.trim().toLowerCase() } })
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })
  if (target.id === me.id) {
    return NextResponse.json({ error: "Can't friend yourself" }, { status: 400 })
  }

  // Check existing
  const existing = await db.friendship.findFirst({
    where: {
      OR: [
        { requesterId: me.id, receiverId: target.id },
        { requesterId: target.id, receiverId: me.id },
      ],
    },
  })
  if (existing) {
    if (existing.status === "ACCEPTED") return NextResponse.json({ error: "Already friends" }, { status: 409 })
    if (existing.status === "PENDING") return NextResponse.json({ error: "Request already pending" }, { status: 409 })
  }

  await db.friendship.create({
    data: { requesterId: me.id, receiverId: target.id, status: "PENDING" },
  })
  return NextResponse.json({ ok: true, user: toSafeUser(target) })
}
