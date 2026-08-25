import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { getPreference, setPreference } from "@/lib/feature-platform"

export const dynamic = "force-dynamic"

const PREFERENCE_KEY = "runtime.settings.v1"
const MAX_SETTINGS = 2000
const MAX_SERIALIZED_BYTES = 256 * 1024
const VALID_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/

type SettingValue = string | number | boolean

function sanitizeSettings(value: unknown): Record<string, SettingValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const result: Record<string, SettingValue> = {}
  for (const [key, setting] of Object.entries(value as Record<string, unknown>).slice(0, MAX_SETTINGS)) {
    if (!VALID_KEY.test(key)) continue
    if (typeof setting === "string") result[key] = setting.slice(0, 4096)
    else if (typeof setting === "boolean") result[key] = setting
    else if (typeof setting === "number" && Number.isFinite(setting)) result[key] = setting
  }
  return result
}

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const saved = await getPreference<Record<string, unknown>>(me.id, PREFERENCE_KEY, {})
  return NextResponse.json({ settings: sanitizeSettings(saved) }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null)
  const patch = sanitizeSettings(body?.settings)
  if (Buffer.byteLength(JSON.stringify(patch), "utf8") > MAX_SERIALIZED_BYTES) {
    return NextResponse.json({ error: "Settings payload is too large" }, { status: 413 })
  }

  const current = sanitizeSettings(await getPreference<Record<string, unknown>>(me.id, PREFERENCE_KEY, {}))
  const settings = sanitizeSettings({ ...current, ...patch })
  if (Buffer.byteLength(JSON.stringify(settings), "utf8") > MAX_SERIALIZED_BYTES) {
    return NextResponse.json({ error: "Account settings limit reached" }, { status: 413 })
  }
  await setPreference(me.id, PREFERENCE_KEY, settings)
  return NextResponse.json({ settings }, { headers: { "Cache-Control": "private, no-store" } })
}
