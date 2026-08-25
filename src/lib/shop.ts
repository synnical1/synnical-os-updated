import { db } from "@/lib/db"
import { AVATAR_DECORATIONS } from "@/lib/avatar-decoration-catalog"
import { PROFILE_EFFECTS } from "@/lib/profile-effect-catalog"

if (typeof window !== "undefined") {
  throw new Error("shop economy must only run on the server")
}

export type ShopItemType = "avatar_deco" | "profile_effect"

export const REFUND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export interface ShopItem {
  id: string
  type: ShopItemType
  name: string
  price: number
  category: ShopItemType
  description: string
  mediaUrl?: string
  giftSurchargePercent: 10
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary"
  season: "core" | "seasonal"
}

function catalogMeta(id: string, index: number) {
  let hash = 0
  for (const ch of id) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0
  const bucket = hash % 100
  const rarity: ShopItem["rarity"] = bucket < 45 ? "common" : bucket < 70 ? "uncommon" : bucket < 86 ? "rare" : bucket < 96 ? "epic" : "legendary"
  return { rarity, season: index % 4 === 0 ? "seasonal" as const : "core" as const }
}

export const SHOP_CATALOG: ShopItem[] = [
  ...AVATAR_DECORATIONS.map((item, index) => ({
    id: item.id,
    type: "avatar_deco" as const,
    name: item.name,
    price: item.price,
    category: "avatar_deco" as const,
    description: "Permanent animated avatar decoration.",
    mediaUrl: item.mediaUrl,
    giftSurchargePercent: 10 as const,
    ...catalogMeta(item.id, index),
  })),
  ...PROFILE_EFFECTS.map((item, index) => ({
    id: item.id,
    type: "profile_effect" as const,
    name: item.name,
    price: item.price,
    category: "profile_effect" as const,
    description: "Permanent animated profile effect.",
    mediaUrl: item.mediaUrl,
    giftSurchargePercent: 10 as const,
    ...catalogMeta(item.id, index + AVATAR_DECORATIONS.length),
  })),
]

export function currentSeasonalRotation(now = new Date()): string[] {
  const seasonal = SHOP_CATALOG.filter((item) => item.season === "seasonal")
  if (seasonal.length <= 12) return seasonal.map((item) => `${item.type}:${item.id}`)
  const week = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 604800000)
  const start = week % seasonal.length
  return Array.from({ length: Math.min(12, seasonal.length) }, (_, offset) => {
    const item = seasonal[(start + offset) % seasonal.length]
    return `${item.type}:${item.id}`
  })
}

export function getShopItem(itemId: string, itemType: ShopItemType): ShopItem | undefined {
  return SHOP_CATALOG.find((item) => item.id === itemId && item.type === itemType)
}

export async function userOwnsItem(userId: string, itemType: string, itemId: string): Promise<boolean> {
  const owned = await db.userInventory.findUnique({
    where: { userId_itemType_itemId: { userId, itemType, itemId } },
  })
  return !!owned
}

export async function getUserInventory(userId: string) {
  return db.userInventory.findMany({ where: { userId }, orderBy: { purchasedAt: "desc" } })
}

export async function recordTransaction(userId: string, amount: number, type: string, description: string) {
  return db.currencyTransaction.create({ data: { userId, amount, type, description } })
}

const DAILY_REWARD = 100
const DAILY_STREAK_BONUS = 10

export async function claimDaily(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { lastDailyClaim: true, coins: true } })
  if (!user) throw new Error("User not found")
  const now = new Date()
  const lastClaim = user.lastDailyClaim
  if (lastClaim) {
    const hoursSince = (now.getTime() - lastClaim.getTime()) / 3_600_000
    if (hoursSince < 20) {
      const nextClaim = new Date(lastClaim.getTime() + 24 * 60 * 60 * 1000)
      return { success: false, message: `You can claim again in ${Math.max(1, Math.ceil((nextClaim.getTime() - now.getTime()) / 3_600_000))} hours`, nextClaim: nextClaim.toISOString(), coins: user.coins }
    }
  }
  let streakBonus = 0
  if (lastClaim && (now.getTime() - lastClaim.getTime()) / 3_600_000 < 48) streakBonus = DAILY_STREAK_BONUS
  const reward = DAILY_REWARD + streakBonus
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { coins: { increment: reward }, lastDailyClaim: now } }),
    db.currencyTransaction.create({ data: { userId, amount: reward, type: "daily", description: `Daily reward${streakBonus ? " (streak bonus)" : ""}` } }),
  ])
  const updated = await db.user.findUnique({ where: { id: userId }, select: { coins: true } })
  return { success: true, message: `You claimed ${reward} coins!${streakBonus ? " (streak bonus)" : ""}`, coins: updated?.coins || 0 }
}

async function mintEditionSerial(tx: any, userId: string, itemType: string, itemId: string) {
  const edition = await tx.cosmeticEdition.findUnique({ where: { itemType_itemId: { itemType, itemId } } })
  if (!edition) return null
  const existing = await tx.cosmeticSerial.findUnique({ where: { userId_itemType_itemId: { userId, itemType, itemId } } })
  if (existing) return existing
  if (edition.totalMinted >= edition.maxSupply) throw new Error("This limited edition has sold out")
  const next = edition.totalMinted + 1
  await tx.cosmeticEdition.update({ where: { id: edition.id }, data: { totalMinted: next } })
  return tx.cosmeticSerial.create({ data: { userId, itemType, itemId, serialNumber: next } })
}

export async function purchaseItem(userId: string, itemType: ShopItemType, itemId: string) {
  const item = getShopItem(itemId, itemType)
  if (!item) throw new Error("Item not found in shop catalog")

  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { coins: true } })
    if (!user) throw new Error("User not found")
    if (user.coins < item.price) return { success: false, message: `Not enough coins. You need ${item.price - user.coins} more.`, coins: user.coins }

    const alreadyOwned = await tx.userInventory.findUnique({ where: { userId_itemType_itemId: { userId, itemType, itemId } } })
    if (alreadyOwned) return { success: false, message: "You already own this item", coins: user.coins }
    await tx.userInventory.create({ data: { userId, itemType, itemId, itemName: item.name, price: item.price } })
    const serial = await mintEditionSerial(tx, userId, itemType, itemId)

    await tx.user.update({ where: { id: userId }, data: { coins: { decrement: item.price } } })
    await tx.currencyTransaction.create({ data: { userId, amount: -item.price, type: "purchase", description: `Purchased ${item.name}` } })
    const updated = await tx.user.findUnique({ where: { id: userId }, select: { coins: true } })
    return { success: true, message: `Purchased ${item.name}!`, coins: updated?.coins || 0, item, serial }
  })
}

export async function rewardMessage(userId: string) {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } })
    if (!user || user.role !== "MEMBER") return 0
    await tx.user.update({ where: { id: userId }, data: { coins: { increment: 1 } } })
    await tx.currencyTransaction.create({ data: { userId, amount: 1, type: "message_reward", description: "1 credit for a successfully saved message" } })
    return 1
  })
}

export async function refundItem(userId: string, itemType: ShopItemType, itemId: string) {
  const inv = await db.userInventory.findUnique({ where: { userId_itemType_itemId: { userId, itemType, itemId } } })
  if (!inv) return { success: false, message: "Item not found in your inventory" }

  if (Date.now() - inv.purchasedAt.getTime() > REFUND_WINDOW_MS) {
    return { success: false, message: "Refund window expired (7 days)" }
  }

  const user = await db.user.findUnique({ where: { id: userId }, select: { avatarDeco: true, profileEffect: true } })
  if (itemType === "avatar_deco" && user?.avatarDeco === itemId) return { success: false, message: "Unequip this decoration before refunding it" }
  if (itemType === "profile_effect" && user?.profileEffect === itemId) return { success: false, message: "Unequip this profile effect before refunding it" }

  const refundAmount = Math.floor(inv.price * 0.5)
  await db.$transaction([
    db.userInventory.delete({ where: { id: inv.id } }),
    db.user.update({ where: { id: userId }, data: { coins: { increment: refundAmount } } }),
    db.currencyTransaction.create({ data: { userId, amount: refundAmount, type: "refund", description: `Refunded ${inv.itemName} (50%)` } }),
  ])
  const updated = await db.user.findUnique({ where: { id: userId }, select: { coins: true } })
  return { success: true, message: `Refunded ${inv.itemName} for ${refundAmount} coins`, coins: updated?.coins || 0 }
}
