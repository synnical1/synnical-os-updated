import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { refundItem, type ShopItemType } from "@/lib/shop"

const TYPES = new Set<ShopItemType>(["avatar_deco", "profile_effect"])

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { itemType, itemId } = await req.json().catch(() => ({}))
  if (!TYPES.has(itemType as ShopItemType) || typeof itemId !== "string") {
    return NextResponse.json({ error: "Invalid item" }, { status: 400 })
  }
  try {
    return NextResponse.json(await refundItem(me.id, itemType as ShopItemType, itemId))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Refund failed" }, { status: 500 })
  }
}
