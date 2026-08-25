import { db } from "@/lib/db"
import { getShopItem, purchaseItem, type ShopItemType } from "@/lib/shop"
import { isAccountLockedDown } from "@/lib/security-policy"

if (typeof window !== "undefined") {
  throw new Error("shop-economy must only run on the server")
}

const STAFF_ROLES = new Set(["MOD", "ADMIN", "HEAD_ADMIN", "OWNER"])
const MAX_GIFT_COINS = 1_000_000
const MAX_STORED_COINS = 2_000_000_000

export function isStaffRole(role: string | null | undefined): boolean {
  return typeof role === "string" && STAFF_ROLES.has(role)
}

export function hasAllDecorations(role: string | null | undefined): boolean {
  return isStaffRole(role)
}

export function hasAllProfileEffects(role: string | null | undefined): boolean {
  return isStaffRole(role)
}

export async function purchaseItemWithStaffBalance(userId: string, role: string, itemType: ShopItemType, itemId: string) {
  const item = getShopItem(itemId, itemType)
  if (!item) throw new Error("Item not found in shop catalog")
  if (isStaffRole(role)) {
    const account = await db.user.findUnique({ where: { id: userId }, select: { coins: true } })
    return { success: true, message: `${item.name} is already available to staff`, coins: account?.coins || 0, item }
  }
  return purchaseItem(userId, itemType, itemId)
}

type CoinGift = { kind: "coins"; recipientId: string; amount: number }
type ItemGift = { kind: "item"; recipientId: string; itemType: ShopItemType; itemId: string }
export type ShopGift = CoinGift | ItemGift

function giftPrice(base: number, surchargePercent: number): number {
  return Math.ceil(base * (100 + surchargePercent) / 100)
}

export async function giftFromShop(senderId: string, gift: ShopGift) {
  if (gift.recipientId === senderId) throw new Error("Choose another account to receive the gift")
  if (await isAccountLockedDown(senderId)) throw new Error("Account lockdown is on. Turn it off in Security before sending gifts or credits.")

  return db.$transaction(async (tx) => {
    const [sender, recipient] = await Promise.all([
      tx.user.findUnique({ where: { id: senderId }, select: { id: true, username: true, role: true, coins: true } }),
      tx.user.findUnique({ where: { id: gift.recipientId }, select: { id: true, username: true, role: true, coins: true } }),
    ])
    if (!sender) throw new Error("Sender account not found")
    if (!recipient) throw new Error("Recipient account not found")

    if (gift.kind === "coins") {
      if (!Number.isSafeInteger(gift.amount) || gift.amount < 1 || gift.amount > MAX_GIFT_COINS) throw new Error(`Coin gifts must be between 1 and ${MAX_GIFT_COINS.toLocaleString()}`)
      if (sender.coins < gift.amount) throw new Error("You do not have enough coins for that transfer")
      if (recipient.coins > MAX_STORED_COINS - gift.amount) throw new Error("That transfer would exceed the recipient's coin limit")
      await tx.user.update({ where: { id: sender.id }, data: { coins: { decrement: gift.amount } } })
      await tx.user.update({ where: { id: recipient.id }, data: { coins: { increment: gift.amount } } })
      await tx.currencyTransaction.createMany({ data: [
        { userId: sender.id, amount: -gift.amount, type: "gift_sent", description: `Transferred ${gift.amount.toLocaleString()} coins to @${recipient.username}` },
        { userId: recipient.id, amount: gift.amount, type: "gift_received", description: `Received ${gift.amount.toLocaleString()} coins from @${sender.username}` },
      ] })
      await tx.giftRecord.create({ data: { giverId: sender.id, recipientId: recipient.id, kind: "coins", amount: gift.amount } })
      const current = await tx.user.findUnique({ where: { id: sender.id }, select: { coins: true } })
      return { success: true, message: `Transferred ${gift.amount.toLocaleString()} coins to @${recipient.username}`, coins: current?.coins || 0 }
    }

    const item = getShopItem(gift.itemId, gift.itemType)
    if (!item) throw new Error("Item not found in shop catalog")
    const charge = giftPrice(item.price, item.giftSurchargePercent)
    if (sender.coins < charge) throw new Error(`You need ${charge.toLocaleString()} coins to gift ${item.name}`)
    if (isStaffRole(recipient.role)) throw new Error(`@${recipient.username} is staff and already has access to every profile cosmetic`)

    const owned = await tx.userInventory.findUnique({ where: { userId_itemType_itemId: { userId: recipient.id, itemType: item.type, itemId: item.id } } })
    if (owned) throw new Error(`@${recipient.username} already owns ${item.name}`)
    await tx.userInventory.create({ data: { userId: recipient.id, itemType: item.type, itemId: item.id, itemName: item.name, price: 0 } })
    const edition = await tx.cosmeticEdition.findUnique({ where: { itemType_itemId: { itemType: item.type, itemId: item.id } } })
    if (edition) {
      const existingSerial = await tx.cosmeticSerial.findUnique({ where: { userId_itemType_itemId: { userId: recipient.id, itemType: item.type, itemId: item.id } } })
      if (!existingSerial) {
        if (edition.totalMinted >= edition.maxSupply) throw new Error("This limited edition has sold out")
        const serialNumber = edition.totalMinted + 1
        await tx.cosmeticEdition.update({ where: { id: edition.id }, data: { totalMinted: serialNumber } })
        await tx.cosmeticSerial.create({ data: { userId: recipient.id, itemType: item.type, itemId: item.id, serialNumber } })
      }
    }

    await tx.user.update({ where: { id: sender.id }, data: { coins: { decrement: charge } } })
    await tx.currencyTransaction.createMany({ data: [
      { userId: sender.id, amount: -charge, type: "gift_sent", description: `Gifted ${item.name} to @${recipient.username} (${item.giftSurchargePercent}% gift surcharge)` },
      { userId: recipient.id, amount: 0, type: "gift_received", description: `Received ${item.name} from @${sender.username}` },
    ] })
    await tx.giftRecord.create({ data: { giverId: sender.id, recipientId: recipient.id, kind: "item", itemType: item.type, itemId: item.id, itemName: item.name, amount: item.price, surcharge: charge - item.price } })
    const current = await tx.user.findUnique({ where: { id: sender.id }, select: { coins: true } })
    return { success: true, message: `Gifted ${item.name} to @${recipient.username}`, coins: current?.coins || 0, charged: charge }
  })
}
