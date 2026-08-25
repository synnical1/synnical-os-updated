import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { getPreference, setPreference } from "@/lib/feature-platform"
import { DEFAULT_PRESENCE_CONFIG, normalizePresenceConfig } from "@/lib/presence"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const KEY = "presence.config"

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const stored = await getPreference(me.id, KEY, DEFAULT_PRESENCE_CONFIG)
  return NextResponse.json({ config: normalizePresenceConfig(stored) })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const current = normalizePresenceConfig(await getPreference(me.id, KEY, DEFAULT_PRESENCE_CONFIG))
  const next = normalizePresenceConfig({ ...current, ...(body && typeof body === "object" ? body : {}) })
  await setPreference(me.id, KEY, next)
  return NextResponse.json({ config: next })
}
