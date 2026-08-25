import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { requesterId } = await req.json().catch(() => ({}))
  if (typeof requesterId !== "string") return NextResponse.json({ error: "requesterId required" }, { status: 400 })

  const pending = await db.friendship.findFirst({ where: { requesterId, receiverId: me.id, status: "PENDING" }, select: { id: true } })
  if (!pending) return NextResponse.json({ error: "Pending request not found" }, { status: 404 })
  const blockedUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

  await db.$transaction(async (tx) => {
    await tx.friendship.delete({ where: { id: pending.id } })
    const existing = await tx.block.findUnique({ where: { blockerId_blockedId: { blockerId: me.id, blockedId: requesterId } } })
    if (!(existing?.expiresAt === null && existing.source === "manual")) {
      await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId: me.id, blockedId: requesterId } },
        update: { source: "friend_decline", expiresAt: blockedUntil },
        create: { blockerId: me.id, blockedId: requesterId, source: "friend_decline", expiresAt: blockedUntil },
      })
    }
  })

  return NextResponse.json({ ok: true, blockedUntil: blockedUntil.toISOString() })
}
