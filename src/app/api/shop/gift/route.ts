import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth-server"
import { consumeRequestLimit } from "@/lib/request-rate-limit"
import { giftFromShop, type ShopGift } from "@/lib/shop-economy"
import type { ShopItemType } from "@/lib/shop"

const TYPES = new Set<ShopItemType>(["avatar_deco", "profile_effect"])

export async function POST(request: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const limit = consumeRequestLimit(request, "shop-gift", 20, 10 * 60_000)
  if (!limit.allowed) return NextResponse.json({ error: "Too many gifts. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } })
  const body = await request.json().catch(() => ({}))
  if (!body || typeof body.recipientId !== "string" || !["coins", "item"].includes(body.kind)) return NextResponse.json({ error: "Invalid gift" }, { status: 400 })
  let gift: ShopGift
  if (body.kind === "coins") gift = { kind: "coins", recipientId: body.recipientId, amount: Number(body.amount) }
  else {
    const itemType = body.itemType as ShopItemType
    if (!TYPES.has(itemType) || typeof body.itemId !== "string") return NextResponse.json({ error: "Invalid gift item" }, { status: 400 })
    gift = { kind: "item", recipientId: body.recipientId, itemType, itemId: body.itemId }
  }
  try { return NextResponse.json(await giftFromShop(me.id, gift)) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Gift failed" }, { status: 400 }) }
}
