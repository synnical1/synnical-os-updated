import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { toSafeUser } from "@/lib/auth"
import { AVATAR_DECORATION_IDS } from "@/lib/avatar-decoration-catalog"
import { PROFILE_EFFECT_IDS } from "@/lib/profile-effect-catalog"
import { hasAllDecorations, hasAllProfileEffects } from "@/lib/shop-economy"

export async function PATCH(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const hasAvatarDeco = Object.prototype.hasOwnProperty.call(body, "avatarDeco")
  const hasProfileEffect = Object.prototype.hasOwnProperty.call(body, "profileEffect")
  if (!hasAvatarDeco && !hasProfileEffect) {
    return NextResponse.json({ error: "Choose a decoration or profile effect to update" }, { status: 400 })
  }

  const data: { avatarDeco?: string | null; profileEffect?: string | null } = {}

  if (hasAvatarDeco) {
    const raw = body.avatarDeco
    const avatarDeco = raw === null || raw === undefined || raw === "" || raw === "none" ? null : raw
    if (avatarDeco !== null && (typeof avatarDeco !== "string" || !AVATAR_DECORATION_IDS.has(avatarDeco))) {
      return NextResponse.json({ error: "Unknown avatar decoration" }, { status: 400 })
    }
    if (avatarDeco && !hasAllDecorations(me.role)) {
      const owned = await db.userInventory.findUnique({
        where: { userId_itemType_itemId: { userId: me.id, itemType: "avatar_deco", itemId: avatarDeco } },
        select: { id: true },
      })
      if (!owned) return NextResponse.json({ error: "Buy this decoration before equipping it" }, { status: 403 })
    }
    data.avatarDeco = avatarDeco
  }

  if (hasProfileEffect) {
    const raw = body.profileEffect
    const profileEffect = raw === null || raw === undefined || raw === "" || raw === "none" ? null : raw
    if (profileEffect !== null && (typeof profileEffect !== "string" || !PROFILE_EFFECT_IDS.has(profileEffect))) {
      return NextResponse.json({ error: "Unknown profile effect" }, { status: 400 })
    }
    if (profileEffect && !hasAllProfileEffects(me.role)) {
      const owned = await db.userInventory.findUnique({
        where: { userId_itemType_itemId: { userId: me.id, itemType: "profile_effect", itemId: profileEffect } },
        select: { id: true },
      })
      if (!owned) return NextResponse.json({ error: "Buy this profile effect before equipping it" }, { status: 403 })
    }
    data.profileEffect = profileEffect
  }

  const updated = await db.user.update({ where: { id: me.id }, data })
  return NextResponse.json({ user: toSafeUser(updated) })
}
