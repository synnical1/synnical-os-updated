import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { getPreference, setPreference } from "@/lib/feature-platform"
import { OS_DEFAULTS, sanitizeOsSettings } from "@/lib/os-settings"

export const dynamic = "force-dynamic"

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ settings: OS_DEFAULTS, signedIn: false })
  const saved = await getPreference<Record<string, unknown> | null>(me.id, "os.settings", null)
  return NextResponse.json({ settings: sanitizeOsSettings(saved || OS_DEFAULTS), signedIn: true, hasSaved: Boolean(saved), accountId: me.id })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const current = await getPreference<Record<string, unknown>>(me.id, "os.settings", {})
  const patch = body?.settings && typeof body.settings === "object" ? body.settings as Record<string, unknown> : {}
  const settings = sanitizeOsSettings({ ...current, ...patch })
  await setPreference(me.id, "os.settings", settings)
  return NextResponse.json({ settings })
}
