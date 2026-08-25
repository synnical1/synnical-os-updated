import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { cleanupExpiredBlocks } from "@/lib/blocks"

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { userId, mode = "toggle" } = await req.json().catch(() => ({}))
  if (typeof userId !== "string") return NextResponse.json({ error: "userId required" }, { status: 400 })
  if (userId === me.id) return NextResponse.json({ error: "Can't block yourself" }, { status: 400 })
  if (!["toggle", "block", "unblock"].includes(mode)) return NextResponse.json({ error: "Invalid block mode" }, { status: 400 })
  await cleanupExpiredBlocks(me.id)
  const existing = await db.block.findUnique({ where: { blockerId_blockedId: { blockerId: me.id, blockedId: userId } } })
  if (mode === "unblock" || (mode === "toggle" && existing)) {
    if (existing) await db.block.delete({ where: { id: existing.id } })
    return NextResponse.json({ ok: true, blocked: false })
  }
  await db.block.upsert({
    where: { blockerId_blockedId: { blockerId: me.id, blockedId: userId } },
    update: { source: "manual", expiresAt: null },
    create: { blockerId: me.id, blockedId: userId, source: "manual", expiresAt: null },
  })
  return NextResponse.json({ ok: true, blocked: true })
}
