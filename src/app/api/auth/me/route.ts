import { NextRequest, NextResponse } from "next/server"
import { getCurrentSession, isTrustedSvgClient } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"

export async function GET(req: NextRequest) {
  const session = await getCurrentSession()
  if (!session) return NextResponse.json({ user: null })

  return NextResponse.json({
    user: toSafeUser(session.user),
    ...(isTrustedSvgClient(req) ? { token: session.token } : {}),
  })
}
