import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"

// DELETE /api/quotes/delete — delete a saved quote
export async function DELETE(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await req.json()
  if (typeof id !== "string") return NextResponse.json({ error: "id required" }, { status: 400 })
  await db.quote.deleteMany({ where: { id, saverId: me.id } })
  return NextResponse.json({ ok: true })
}
