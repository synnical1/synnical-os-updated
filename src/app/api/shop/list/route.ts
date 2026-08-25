import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { hasAllDecorations, hasAllProfileEffects } from "@/lib/shop-economy"
import { SHOP_CATALOG, currentSeasonalRotation, getUserInventory } from "@/lib/shop"
import { toSafeUser } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json({
    catalog: SHOP_CATALOG,
    seasonalRotation: currentSeasonalRotation(),
    inventory: await getUserInventory(me.id),
    coins: me.coins,
    staffDecorationAccess: hasAllDecorations(me.role),
    staffProfileEffectAccess: hasAllProfileEffects(me.role),
    lastDailyClaim: me.lastDailyClaim?.toISOString() || null,
    user: toSafeUser(me),
  }, { headers: { "Cache-Control": "private, no-store" } })
}
