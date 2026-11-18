import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"

// GET /api/infractions/user/[id] — get a user's infraction history (self or mod+)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params

  // Members can view their own history; cross-account history is owner-only.
  if (id !== me.id && me.role !== "OWNER") {
    return NextResponse.json({ error: "Only the owner can view another account's moderation history." }, { status: 403 })
  }

  const infractions = await db.infraction.findMany({
    where: { userId: id },
    include: { issuer: true },
    orderBy: { createdAt: "desc" },
  })

  return NextResponse.json({ infractions: infractions.map((row) => ({ ...row, issuer: row.issuer ? toSafeUser(row.issuer) : null })) })
}
