import { NextRequest, NextResponse } from "next/server"
import { authenticateDeveloperRequest } from "@/lib/developer-auth"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await authenticateDeveloperRequest(req, "read:games")
  if (!auth) return NextResponse.json({ error: "Invalid token or missing read:games permission" }, { status: 401 })
  const [favorites, history] = await Promise.all([
    db.gameFavorite.findMany({ where: { userId: auth.user.id }, orderBy: { createdAt: "desc" }, take: 500 }),
    db.gameSession.findMany({ where: { userId: auth.user.id }, orderBy: { startedAt: "desc" }, take: 100 }),
  ])
  return NextResponse.json({ favorites, recentSessions: history }, { headers: { "Cache-Control": "private, no-store" } })
}
