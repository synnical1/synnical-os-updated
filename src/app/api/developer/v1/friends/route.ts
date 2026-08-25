import { NextRequest, NextResponse } from "next/server"
import { authenticateDeveloperRequest } from "@/lib/developer-auth"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await authenticateDeveloperRequest(req, "read:friends")
  if (!auth) return NextResponse.json({ error: "Invalid token or missing read:friends permission" }, { status: 401 })
  const rows = await db.friendship.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: auth.user.id }, { receiverId: auth.user.id }] },
    select: { requesterId: true, receiverId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  })
  const ids = [...new Set(rows.map((row) => row.requesterId === auth.user.id ? row.receiverId : row.requesterId))]
  const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, displayName: true, pfpUrl: true, role: true } }) : []
  const userMap = new Map(users.map((user) => [user.id, user]))
  return NextResponse.json({ friends: ids.map((id) => userMap.get(id)).filter(Boolean) }, { headers: { "Cache-Control": "private, no-store" } })
}
