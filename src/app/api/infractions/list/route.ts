import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { canModerate } from "@/lib/auth"

// GET /api/infractions/list — list all infractions (mod+ only)
// ?type=WARN filters by type
export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!canModerate(me.role)) {
    return NextResponse.json({ error: "Only moderators can view all infractions" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const typeFilter = searchParams.get("type")

  const infractions = await db.infraction.findMany({
    where: typeFilter && typeFilter !== "ALL" ? { type: typeFilter } : {},
    include: { user: true, issuer: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  })

  return NextResponse.json({ infractions })
}
