import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { toSafeUser, type SafeUser } from "@/lib/auth"
import { getCurrentUser } from "@/lib/auth-server"
import { privacyViewFor } from "@/lib/privacy"

export const dynamic = "force-dynamic"

/** Account directory keeps identity visible but redacts profile-only fields server-side. */
export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (me.role !== "OWNER") return NextResponse.json({ error: "Chat is available only to the owner" }, { status: 403 })
  const users = await db.user.findMany({ orderBy: [{ role: "asc" }, { username: "asc" }] })
  const safe: SafeUser[] = []
  for (const user of users) {
    const view = await privacyViewFor(user.id, me.id)
    const base = toSafeUser(user)
    safe.push(view.profile ? base : { ...base, bio: "", status: "", bannerUrl: null, bannerIsGif: false, profileEffect: null })
  }
  return NextResponse.json({ users: safe }, { headers: { "Cache-Control": "private, no-store" } })
}
