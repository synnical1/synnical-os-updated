import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { cleanupExpiredBlocks } from "@/lib/blocks"

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await cleanupExpiredBlocks(me.id)
  const blocks = await db.block.findMany({ where: { blockerId: me.id }, include: { blocked: true }, orderBy: { createdAt: "desc" } })
  return NextResponse.json({
    blocks: blocks.map((block) => toSafeUser(block.blocked)),
    blockDetails: blocks.map((block) => ({ userId: block.blockedId, source: block.source, expiresAt: block.expiresAt?.toISOString() || null })),
  })
}
