import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { normalizeProfileColor, normalizeProfileThemeStyle } from "@/lib/profile-theme"

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const primary = normalizeProfileColor(body.primary, "")
  const accent = normalizeProfileColor(body.accent, "")
  if (!primary || !accent) return NextResponse.json({ error: "Choose valid 6-digit hex profile colors" }, { status: 400 })
  if (body.style !== "solid" && body.style !== "gradient") {
    return NextResponse.json({ error: "Profile theme must be solid or gradient" }, { status: 400 })
  }

  const updated = await db.user.update({
    where: { id: me.id },
    data: {
      profileThemePrimary: primary,
      profileThemeAccent: accent,
      profileThemeStyle: normalizeProfileThemeStyle(body.style),
    },
  })
  return NextResponse.json({ user: toSafeUser(updated) })
}
