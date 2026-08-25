import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { normalizeConnections, parseStoredConnections } from "@/lib/connections"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Not logged in" }, { status: 401 })
  const row = await db.user.findUnique({ where: { id: me.id }, select: { connectionsJson: true } })
  return NextResponse.json({ connections: parseStoredConnections(row?.connectionsJson) })
}

export async function PUT(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Not logged in" }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { connections?: unknown }
  const connections = normalizeConnections(body.connections)
  await db.user.update({ where: { id: me.id }, data: { connectionsJson: JSON.stringify(connections) } })
  return NextResponse.json({ connections })
}
