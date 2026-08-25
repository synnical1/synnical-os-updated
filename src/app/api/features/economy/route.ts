import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { isStaffRole } from "@/lib/shop-economy"
import { SHOP_CATALOG, getShopItem, currentSeasonalRotation, REFUND_WINDOW_MS } from "@/lib/shop"
import { getProgress, ensureFeatureSeeds, earnAchievement } from "@/lib/feature-platform"

export const dynamic = "force-dynamic"

const clean = (value: unknown, max = 120) => typeof value === "string" ? value.trim().slice(0, max) : ""
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

async function stateFor(userId: string) {
  await ensureFeatureSeeds()
  const now = new Date()
  const [progress, achievements, challenges, challengeProgress, wishlist, giftsSent, giftsReceived, transactions, inventory, redemptions, serials] = await Promise.all([
    getProgress(userId),
    db.userAchievement.findMany({ where: { userId }, orderBy: { earnedAt: "desc" } }),
    db.challenge.findMany({ where: { active: true }, orderBy: { id: "asc" } }),
    db.challengeProgress.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } }),
    db.shopWishlist.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    db.giftRecord.findMany({ where: { giverId: userId }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.giftRecord.findMany({ where: { recipientId: userId }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.currencyTransaction.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.userInventory.findMany({ where: { userId }, orderBy: { purchasedAt: "desc" } }),
    db.promoRedemption.findMany({ where: { userId }, orderBy: { redeemedAt: "desc" }, take: 100 }),
    db.cosmeticSerial.findMany({ where: { userId }, orderBy: { acquiredAt: "desc" } }),
  ])
  const achievementDefs = achievements.length ? await db.achievement.findMany({ where: { id: { in: achievements.map((a) => a.achievementId) } } }) : []
  const aMap = new Map(achievementDefs.map((a) => [a.id, a]))
  const inventoryByName = new Map(inventory.map((row) => [row.itemName, row]))
  const refunds = transactions.map((tx) => {
    const match = tx.type === "purchase" ? inventoryByName.get(tx.description.replace(/^Purchased\s+/, "")) : null
    const refundEligibleUntil = match ? new Date(match.purchasedAt.getTime() + REFUND_WINDOW_MS) : null
    return { ...tx, refundEligibleUntil, refundable: Boolean(refundEligibleUntil && refundEligibleUntil > now) }
  })
  return {
    progress,
    achievements: achievements.map((row) => ({ ...row, achievement: aMap.get(row.achievementId) || null })),
    challenges,
    challengeProgress,
    wishlist: wishlist.map((row) => {
      const item = getShopItem(row.itemId, row.itemType as any)
      return { ...row, item: item || null, currentPrice: item?.price ?? null, priceChanged: item ? item.price !== row.priceAtAdded : true }
    }),
    gifts: { sent: giftsSent, received: giftsReceived },
    transactions: refunds,
    redemptions,
    serials,
    seasonalRotation: currentSeasonalRotation(),
  }
}

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  return NextResponse.json(await stateFor(me.id), { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const body = await req.json().catch(() => ({}))
  const action = clean(body.action, 64)

  if (action === "toggle-wishlist") {
    const itemType = clean(body.itemType, 40)
    const itemId = clean(body.itemId, 160)
    const item = getShopItem(itemId, itemType as any)
    if (!item) return fail("Shop item not found", 404)
    const key = { userId_itemType_itemId: { userId: me.id, itemType, itemId } }
    const existing = await db.shopWishlist.findUnique({ where: key })
    if (existing) await db.shopWishlist.delete({ where: { id: existing.id } })
    else await db.shopWishlist.create({ data: { userId: me.id, itemType, itemId, priceAtAdded: item.price } })
    return NextResponse.json({ active: !existing })
  }

  if (action === "redeem-promo") {
    const code = clean(body.code, 64).toUpperCase()
    if (!code) return fail("Promo code required")
    const result = await db.$transaction(async (tx) => {
      const promo = await tx.promoCode.findUnique({ where: { code } })
      if (!promo || !promo.active) throw new Error("Promo code is invalid")
      if (promo.expiresAt && promo.expiresAt <= new Date()) throw new Error("Promo code has expired")
      if (await tx.promoRedemption.findUnique({ where: { promoId_userId: { promoId: promo.id, userId: me.id } } })) throw new Error("You already redeemed this code")
      const used = await tx.promoRedemption.count({ where: { promoId: promo.id } })
      if (promo.maxRedemptions !== null && used >= promo.maxRedemptions) throw new Error("Promo code redemption limit reached")
      if (promo.itemType && promo.itemId) {
        const item = getShopItem(promo.itemId, promo.itemType as any)
        if (!item) throw new Error("Promo reward is no longer available")
        await tx.userInventory.upsert({ where: { userId_itemType_itemId: { userId: me.id, itemType: promo.itemType, itemId: promo.itemId } }, update: {}, create: { userId: me.id, itemType: promo.itemType, itemId: promo.itemId, itemName: item.name, price: 0 } })
      }
      if (promo.rewardCoins > 0) {
        await tx.user.update({ where: { id: me.id }, data: { coins: { increment: promo.rewardCoins } } })
        await tx.currencyTransaction.create({ data: { userId: me.id, amount: promo.rewardCoins, type: "promo", description: `Redeemed promo ${promo.code}` } })
      }
      await tx.promoRedemption.create({ data: { promoId: promo.id, userId: me.id } })
      return promo
    }).catch((e) => { throw e })
    return NextResponse.json({ ok: true, promo: { code: result.code, rewardCoins: result.rewardCoins, itemType: result.itemType, itemId: result.itemId } })
  }

  if (action === "create-promo") {
    if (!isStaffRole(me.role)) return fail("Staff only", 403)
    const code = clean(body.code, 64).toUpperCase()
    if (!/^[A-Z0-9_-]{3,64}$/.test(code)) return fail("Promo code must be 3-64 letters, numbers, _ or -")
    const rewardCoins = Math.max(0, Math.min(1_000_000, Math.round(Number(body.rewardCoins) || 0)))
    const itemType = clean(body.itemType, 40) || null
    const itemId = clean(body.itemId, 160) || null
    if ((itemType || itemId) && (!itemType || !itemId || !getShopItem(itemId, itemType as any))) return fail("Promo item is invalid")
    const maxRedemptions = body.maxRedemptions === null || body.maxRedemptions === "" ? null : Math.max(1, Math.min(1_000_000, Math.round(Number(body.maxRedemptions) || 1)))
    let expiresAt: Date | null = null
    if (body.expiresAt) {
      expiresAt = new Date(String(body.expiresAt))
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) return fail("Promo expiry must be in the future")
    }
    const promo = await db.promoCode.upsert({ where: { code }, update: { rewardCoins, itemType, itemId, maxRedemptions, expiresAt, active: true }, create: { code, rewardCoins, itemType, itemId, maxRedemptions, expiresAt, createdById: me.id } })
    return NextResponse.json({ promo })
  }

  if (action === "seed-limited-edition") {
    if (!isStaffRole(me.role)) return fail("Staff only", 403)
    const itemType = clean(body.itemType, 40)
    const itemId = clean(body.itemId, 160)
    if (!getShopItem(itemId, itemType as any)) return fail("Shop item not found", 404)
    const maxSupply = Math.max(1, Math.min(1_000_000, Math.round(Number(body.maxSupply) || 1)))
    const edition = await db.cosmeticEdition.upsert({ where: { itemType_itemId: { itemType, itemId } }, update: { maxSupply }, create: { itemType, itemId, maxSupply } })
    return NextResponse.json({ edition })
  }

  if (action === "refresh-achievements") {
    const inventoryCount = await db.userInventory.count({ where: { userId: me.id } })
    if (inventoryCount >= 5) await earnAchievement(me.id, "collector-five").catch(() => {})
    return NextResponse.json(await stateFor(me.id))
  }

  return fail("Unknown action", 404)
}
