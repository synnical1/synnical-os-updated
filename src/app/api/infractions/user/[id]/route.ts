import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"

// GET /api/infractions/user/[id] — get a user's infraction history (self or mod+)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  // Can view own infractions, or mod+ can view anyone's
  if (id !== me.id) {
    const rank = (r: string) => r === "OWNER" ? 5 : r === "HEAD_ADMIN" ? 4 : r === "ADMIN" ? 3 : r === "MOD" ? 2 : 1
    if (rank(me.role) < 2) {
      return NextResponse.json({ error: "Can't view others' infractions" }, { status: 403 })
    }
  }

  const infractions = await db.infraction.findMany({
    where: { userId: id },
    include: { issuer: true },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ infractions })
}
