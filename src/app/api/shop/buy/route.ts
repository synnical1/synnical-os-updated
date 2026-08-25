import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { purchaseItemWithStaffBalance } from "@/lib/shop-economy"
import type { ShopItemType } from "@/lib/shop"

const TYPES = new Set<ShopItemType>(["avatar_deco", "profile_effect"])

export async function POST(request: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const itemType = body.itemType as ShopItemType
  const itemId = body.itemId
  if (!TYPES.has(itemType) || typeof itemId !== "string") return NextResponse.json({ error: "Invalid shop item" }, { status: 400 })
  try {
    return NextResponse.json(await purchaseItemWithStaffBalance(me.id, me.role, itemType, itemId))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Purchase failed" }, { status: 400 })
  }
}
