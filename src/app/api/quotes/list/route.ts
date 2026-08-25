import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"

// GET /api/quotes/list — list my saved quotes
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const quotes = await db.quote.findMany({
    where: { saverId: me.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
  return NextResponse.json({ quotes })
}
