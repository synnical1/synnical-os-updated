import { NextResponse } from "next/server"
import { getCurrentSession } from "@/lib/auth-server"
import { issueProxyTicket } from "@/lib/proxy-ticket"

export const dynamic = "force-dynamic"

export async function POST() {
  const session = await getCurrentSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const ticket = issueProxyTicket(session.id)
  return NextResponse.json(ticket, {
    headers: { "Cache-Control": "no-store, private" },
  })
}
