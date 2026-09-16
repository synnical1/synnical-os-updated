import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { getPreference } from "@/lib/feature-platform"
import { db } from "@/lib/db"
import { MAX_SERIALIZED_BYTES, readSettingsBody, sanitizeSettings, validSettings, type SettingValue } from "@/lib/settings-validation"

export const dynamic = "force-dynamic"

const PREFERENCE_KEY = "runtime.settings.v1"

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const saved = await getPreference<Record<string, unknown>>(me.id, PREFERENCE_KEY, {})
  return NextResponse.json({ settings: sanitizeSettings(saved) }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await readSettingsBody(req)
  if (body instanceof Response) return body
  if (body.accountId && body.accountId !== me.id) return NextResponse.json({ error: "Account changed; reload settings" }, { status: 409 })
  const patch = body.settings
  if (Buffer.byteLength(JSON.stringify(patch), "utf8") > MAX_SERIALIZED_BYTES) {
    return NextResponse.json({ error: "Settings payload is too large" }, { status: 413 })
  }

  const settings = await db.$transaction(async (tx) => {
    const row = await tx.userPreference.findUnique({ where: { userId_key: { userId: me.id, key: PREFERENCE_KEY } } })
    let saved: unknown = {}
    try { saved = row ? JSON.parse(row.value) : {} } catch {}
    const merged: Record<string, SettingValue> = { ...sanitizeSettings(saved), ...patch }
    if (!validSettings(merged) || Buffer.byteLength(JSON.stringify(merged), "utf8") > MAX_SERIALIZED_BYTES) return null
    const value = JSON.stringify(merged)
    await tx.userPreference.upsert({ where: { userId_key: { userId: me.id, key: PREFERENCE_KEY } }, update: { value }, create: { userId: me.id, key: PREFERENCE_KEY, value } })
    return merged
  })
  if (!settings) return NextResponse.json({ error: "Account settings limit reached" }, { status: 413 })
  return NextResponse.json({ settings }, { headers: { "Cache-Control": "private, no-store" } })
}
