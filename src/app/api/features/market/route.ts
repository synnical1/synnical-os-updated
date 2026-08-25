import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/auth-server"
import { getShopItem } from "@/lib/shop"
import { isAccountLockedDown } from "@/lib/security-policy"
import { acceptedFriend, boundedJson, cleanText, safeJson, validId } from "@/lib/r10-platform"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })
const integer = (value: unknown, min: number, max: number) => { const n = Math.round(Number(value)); return Number.isSafeInteger(n) ? Math.max(min, Math.min(max, n)) : min }
const TRADE_COOLDOWN_MS = 30 * 60_000
const MAX_TRADE_COINS = 1_000_000

async function recentTransfer(userId: string, itemType: string, itemId: string) {
  return db.cosmeticOwnershipEvent.findFirst({ where: { toUserId: userId, itemType, itemId, eventType: { in: ["market_purchase", "trade"] }, createdAt: { gt: new Date(Date.now() - TRADE_COOLDOWN_MS) } }, orderBy: { createdAt: "desc" } })
}

async function resolveUser(value: unknown) {
  const key = cleanText(value, 80)
  if (!key) return null
  return db.user.findFirst({ where: { OR: [{ id: key }, { username: key.toLowerCase() }] }, select: { id: true, username: true, displayName: true, pfpUrl: true, role: true, coins: true } })
}

function groupTransactions(rows: Array<{ amount: number; type: string; createdAt: Date }>) {
  const byDay: Record<string, number> = {}; const byType: Record<string, number> = {}
  for (const row of rows) { const day=row.createdAt.toISOString().slice(0,10); byDay[day]=(byDay[day]||0)+row.amount; byType[row.type]=(byType[row.type]||0)+row.amount }
  return { byDay, byType, earned: rows.filter(r=>r.amount>0).reduce((a,b)=>a+b.amount,0), spent: Math.abs(rows.filter(r=>r.amount<0).reduce((a,b)=>a+b.amount,0)) }
}

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0,0,0,0)
  const [listings, mine, incoming, outgoing, inventory, vault, goals, pots, contributions, monthTx, watches] = await Promise.all([
    db.marketplaceListing.findMany({ where: { status: "active", sellerId: { not: me.id } }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.marketplaceListing.findMany({ where: { sellerId: me.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.tradeOffer.findMany({ where: { recipientId: me.id, status: "pending" }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.tradeOffer.findMany({ where: { senderId: me.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.userInventory.findMany({ where: { userId: me.id }, orderBy: { purchasedAt: "desc" } }),
    db.creditVault.upsert({ where: { userId: me.id }, update: {}, create: { userId: me.id } }),
    db.creditGoal.findMany({ where: { userId: me.id }, orderBy: { updatedAt: "desc" }, take: 50 }),
    db.sharedCreditPot.findMany({ where: { OR: [{ ownerId: me.id }, { id: { in: (await db.sharedCreditContribution.findMany({ where: { userId: me.id }, select: { potId: true }, distinct: ["potId"] })).map(r=>r.potId) } }] }, orderBy: { updatedAt: "desc" }, take: 50 }),
    db.sharedCreditContribution.findMany({ where: { userId: me.id }, orderBy: { createdAt: "desc" }, take: 200 }),
    db.currencyTransaction.findMany({ where: { userId: me.id, createdAt: { gte: since } }, orderBy: { createdAt: "asc" }, take: 5000 }),
    db.featureRecord.findMany({ where: { userId: me.id, kind: "market-watch" }, orderBy: { updatedAt: "desc" }, take: 200 }),
  ])
  const tradeIds = [...incoming, ...outgoing].map(row=>row.id)
  const tradeItems = tradeIds.length ? await db.tradeOfferItem.findMany({ where: { tradeId: { in: tradeIds } } }) : []
  const userIds = [...new Set([...listings.map(r=>r.sellerId), ...incoming.flatMap(r=>[r.senderId,r.recipientId]), ...outgoing.flatMap(r=>[r.senderId,r.recipientId]), ...pots.map(r=>r.ownerId)])]
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, displayName: true, pfpUrl: true } }) : []
  const userMap = new Map(users.map(u=>[u.id,u]))
  const serializeTrade = (row:any) => ({ ...row, sender:userMap.get(row.senderId)||null, recipient:userMap.get(row.recipientId)||null, items:tradeItems.filter(i=>i.tradeId===row.id) })
  const watchData = watches.map(row=>({ ...row, data:safeJson(row.dataJson,{}) }))
  const watchedKeys = new Map(watchData.map(row=>[row.scopeKey,row]))
  const alerts = listings.filter(row=>{const w:any=watchedKeys.get(`${row.itemType}:${row.itemId}`); return w && row.price <= Number(w.data?.targetPrice||0)}).slice(0,50)
  return NextResponse.json({
    meId: me.id, coins: me.coins, listings:listings.map(row=>({...row,seller:userMap.get(row.sellerId)||null})), mine,
    trades:{incoming:incoming.map(serializeTrade),outgoing:outgoing.map(serializeTrade)}, inventory,
    vault, goals, pots:pots.map(row=>({...row,owner:userMap.get(row.ownerId)||null,myContribution:contributions.filter(c=>c.potId===row.id).reduce((n,c)=>n+c.amount,0)})),
    statement: groupTransactions(monthTx), watches:watchData, alerts,
  }, { headers: { "Cache-Control": "private, no-store" } })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return fail("Unauthorized", 401)
  if (await isAccountLockedDown(me.id)) return fail("Account lockdown is on. Turn it off in Security before moving credits or cosmetics.", 423)
  const body = await req.json().catch(() => ({})); const action = cleanText(body.action, 50)

  if (action === "trade-recipient-inventory") {
    const recipient = await resolveUser(body.recipient)
    if (!recipient || recipient.id === me.id) return fail("Choose another account", 404)
    if (!await acceptedFriend(me.id, recipient.id)) return fail("Trades are limited to accepted friends", 403)
    const inventory = await db.userInventory.findMany({ where: { userId: recipient.id }, orderBy: { purchasedAt: "desc" }, take: 500 })
    return NextResponse.json({ recipient, inventory: inventory.map(({ userId: _userId, ...item }) => item) })
  }

  if (action === "vault-deposit" || action === "vault-withdraw") {
    const amount = integer(body.amount, 1, 1_000_000)
    try {
      const result = await db.$transaction(async tx => {
        const [user,vault] = await Promise.all([tx.user.findUnique({where:{id:me.id},select:{coins:true}}),tx.creditVault.upsert({where:{userId:me.id},update:{},create:{userId:me.id}})])
        if (!user) throw new Error("Account not found")
        if (action === "vault-deposit") {
          if (user.coins < amount) throw new Error("Not enough credits")
          await tx.user.update({where:{id:me.id},data:{coins:{decrement:amount}}}); await tx.creditVault.update({where:{userId:me.id},data:{balance:{increment:amount}}})
          await tx.currencyTransaction.create({data:{userId:me.id,amount:-amount,type:"vault_deposit",description:`Moved ${amount} credits into savings`}})
        } else {
          if (vault.lockedUntil && vault.lockedUntil > new Date()) throw new Error(`Savings are locked until ${vault.lockedUntil.toISOString()}`)
          if (vault.balance < amount) throw new Error("Not enough saved credits")
          await tx.creditVault.update({where:{userId:me.id},data:{balance:{decrement:amount}}}); await tx.user.update({where:{id:me.id},data:{coins:{increment:amount}}})
          await tx.currencyTransaction.create({data:{userId:me.id,amount:amount,type:"vault_withdraw",description:`Withdrew ${amount} credits from savings`}})
        }
        return { user:await tx.user.findUnique({where:{id:me.id},select:{coins:true}}), vault:await tx.creditVault.findUnique({where:{userId:me.id}}) }
      })
      return NextResponse.json(result)
    } catch(e){ return fail(e instanceof Error?e.message:"Savings transfer failed",409) }
  }

  if (action === "vault-lock") {
    const until = body.until ? new Date(String(body.until)) : null
    if (until && (!Number.isFinite(until.getTime()) || until <= new Date() || until.getTime() > Date.now()+365*86400000)) return fail("Choose a future lock date within one year")
    const current = await db.creditVault.upsert({where:{userId:me.id},update:{},create:{userId:me.id}})
    if (current.lockedUntil && current.lockedUntil > new Date()) return fail("An active savings lock cannot be shortened or removed",409)
    return NextResponse.json({vault:await db.creditVault.update({where:{userId:me.id},data:{lockedUntil:until}})})
  }

  if (action === "goal-save") {
    const id=validId(body.id); const name=cleanText(body.name,80); const target=integer(body.target,1,10_000_000)
    if(!name)return fail("Goal name required")
    if(id){const row=await db.creditGoal.findFirst({where:{id,userId:me.id}});if(!row)return fail("Goal not found",404);return NextResponse.json({goal:await db.creditGoal.update({where:{id},data:{name,target}})})}
    return NextResponse.json({goal:await db.creditGoal.create({data:{userId:me.id,name,target}})})
  }
  if (action === "goal-delete") { const id=validId(body.id); const result=await db.creditGoal.deleteMany({where:{id,userId:me.id}}); return result.count?NextResponse.json({deleted:true}):fail("Goal not found",404) }

  if (action === "pot-create") {
    const name=cleanText(body.name,80); const target=integer(body.target,1,10_000_000); if(!name)return fail("Pot name required")
    return NextResponse.json({pot:await db.sharedCreditPot.create({data:{ownerId:me.id,name,target}})})
  }
  if (action === "pot-contribute") {
    const potId=validId(body.potId); const amount=integer(body.amount,1,1_000_000); const pot=potId?await db.sharedCreditPot.findFirst({where:{id:potId,status:"active"}}):null
    if(!pot)return fail("Shared pot not found",404); if(pot.ownerId!==me.id && !await acceptedFriend(me.id,pot.ownerId))return fail("Only the owner's friends can contribute",403)
    try{await db.$transaction(async tx=>{const user=await tx.user.findUnique({where:{id:me.id},select:{coins:true}});if(!user||user.coins<amount)throw new Error("Not enough credits");await tx.user.update({where:{id:me.id},data:{coins:{decrement:amount}}});await tx.sharedCreditPot.update({where:{id:pot.id},data:{balance:{increment:amount}}});await tx.sharedCreditContribution.create({data:{potId:pot.id,userId:me.id,amount}});await tx.currencyTransaction.create({data:{userId:me.id,amount:-amount,type:"shared_savings",description:`Contributed ${amount} credits to ${pot.name}`}})});return NextResponse.json({ok:true})}catch(e){return fail(e instanceof Error?e.message:"Contribution failed",409)}
  }
  if (action === "pot-claim") {
    const potId=validId(body.potId); const pot=potId?await db.sharedCreditPot.findFirst({where:{id:potId,ownerId:me.id,status:"active"}}):null;if(!pot)return fail("Shared pot not found",404);if(pot.balance<pot.target)return fail("The shared goal has not been reached yet",409)
    await db.$transaction([db.user.update({where:{id:me.id},data:{coins:{increment:pot.balance}}}),db.currencyTransaction.create({data:{userId:me.id,amount:pot.balance,type:"shared_pot_claim",description:`Claimed completed shared goal: ${pot.name}`}}),db.sharedCreditPot.update({where:{id:pot.id},data:{status:"claimed"}})])
    return NextResponse.json({claimed:true,amount:pot.balance})
  }
  if (action === "pot-cancel") {
    const potId=validId(body.potId); const pot=potId?await db.sharedCreditPot.findFirst({where:{id:potId,ownerId:me.id,status:"active"}}):null;if(!pot)return fail("Shared pot not found",404)
    try{const refunded=await db.$transaction(async tx=>{const rows=await tx.sharedCreditContribution.groupBy({by:["userId"],where:{potId:pot.id},_sum:{amount:true}});let total=0;for(const row of rows){const amount=Math.max(0,row._sum.amount||0);if(!amount)continue;const restored=await tx.user.updateMany({where:{id:row.userId},data:{coins:{increment:amount}}});if(restored.count){total+=amount;await tx.currencyTransaction.create({data:{userId:row.userId,amount,type:"shared_pot_refund",description:`Refund from cancelled shared goal: ${pot.name}`}})}}await tx.sharedCreditPot.update({where:{id:pot.id},data:{status:"cancelled",balance:0}});return total});return NextResponse.json({cancelled:true,refunded})}catch(e){return fail(e instanceof Error?e.message:"Could not cancel shared pot",409)}
  }

  if (action === "create-listing") {
    const inventoryId=validId(body.inventoryId); const owned=inventoryId?await db.userInventory.findFirst({where:{id:inventoryId,userId:me.id}}):null
    if(!owned)return fail("Owned cosmetic not found",404); if(await recentTransfer(me.id,owned.itemType,owned.itemId))return fail("Recently traded cosmetics have a 30-minute safety cooldown",409)
    const catalog=getShopItem(owned.itemId,owned.itemType as any); const maxPrice=Math.max(1000,(catalog?.price||owned.price||1000)*10); const price=integer(body.price,1,maxPrice)
    if(await db.marketplaceListing.findFirst({where:{sellerId:me.id,itemType:owned.itemType,itemId:owned.itemId,status:"active"}}))return fail("That cosmetic is already listed",409)
    if(await db.tradeOfferItem.findFirst({where:{itemType:owned.itemType,itemId:owned.itemId,side:"sender", tradeId:{in:(await db.tradeOffer.findMany({where:{senderId:me.id,status:"pending"},select:{id:true}})).map(r=>r.id)}}}))return fail("That cosmetic is already locked in a pending trade",409)
    return NextResponse.json({listing:await db.marketplaceListing.create({data:{sellerId:me.id,itemType:owned.itemType,itemId:owned.itemId,itemName:owned.itemName,price}}),maxPrice})
  }
  if (action === "cancel-listing") { const id=validId(body.id); const row=id?await db.marketplaceListing.findFirst({where:{id,sellerId:me.id,status:"active"}}):null;if(!row)return fail("Listing not found",404);return NextResponse.json({listing:await db.marketplaceListing.update({where:{id},data:{status:"cancelled",cancelledAt:new Date()}})}) }

  if (action === "buy-listing") {
    const id=validId(body.id)
    try{const result=await db.$transaction(async tx=>{const listing=id?await tx.marketplaceListing.findUnique({where:{id}}):null;if(!listing||listing.status!=="active")throw new Error("Listing is no longer available");if(listing.sellerId===me.id)throw new Error("You cannot buy your own listing");const reserved=await tx.marketplaceListing.updateMany({where:{id:listing.id,status:"active"},data:{status:"processing"}});if(!reserved.count)throw new Error("Listing is already being purchased");const [buyer,seller,owned,already]=await Promise.all([tx.user.findUnique({where:{id:me.id},select:{coins:true,username:true}}),tx.user.findUnique({where:{id:listing.sellerId},select:{coins:true,username:true}}),tx.userInventory.findUnique({where:{userId_itemType_itemId:{userId:listing.sellerId,itemType:listing.itemType,itemId:listing.itemId}}}),tx.userInventory.findUnique({where:{userId_itemType_itemId:{userId:me.id,itemType:listing.itemType,itemId:listing.itemId}}})]);if(!buyer||!seller||!owned)throw new Error("Listing ownership changed; refresh the market");if(already)throw new Error("You already own this cosmetic");if(buyer.coins<listing.price)throw new Error("Not enough credits");await tx.userInventory.delete({where:{id:owned.id}});await tx.userInventory.create({data:{userId:me.id,itemType:owned.itemType,itemId:owned.itemId,itemName:owned.itemName,price:listing.price,purchasedAt:new Date()}});await tx.cosmeticSerial.updateMany({where:{userId:listing.sellerId,itemType:owned.itemType,itemId:owned.itemId},data:{userId:me.id}});await tx.user.update({where:{id:me.id},data:{coins:{decrement:listing.price}}});await tx.user.update({where:{id:listing.sellerId},data:{coins:{increment:listing.price}}});await tx.currencyTransaction.createMany({data:[{userId:me.id,amount:-listing.price,type:"market_buy",description:`Bought ${owned.itemName} from @${seller.username}`},{userId:listing.sellerId,amount:listing.price,type:"market_sale",description:`Sold ${owned.itemName} to @${buyer.username}`}]});await tx.cosmeticOwnershipEvent.create({data:{itemType:owned.itemType,itemId:owned.itemId,fromUserId:listing.sellerId,toUserId:me.id,eventType:"market_purchase",referenceId:listing.id}});await tx.marketplaceListing.update({where:{id:listing.id},data:{status:"sold",buyerId:me.id,soldAt:new Date()}});return {itemName:owned.itemName,price:listing.price}});return NextResponse.json(result)}catch(e){return fail(e instanceof Error?e.message:"Purchase failed",409)}
  }

  if (action === "trade-create") {
    const recipient=await resolveUser(body.recipient); if(!recipient||recipient.id===me.id)return fail("Choose another account",404)
    if(!await acceptedFriend(me.id,recipient.id))return fail("Trades are limited to accepted friends",403)
    const senderCoins=integer(body.senderCoins||0,0,MAX_TRADE_COINS); const recipientCoins=integer(body.recipientCoins||0,0,MAX_TRADE_COINS)
    const rawSenderIds: string[] = Array.isArray(body.senderInventoryIds) ? body.senderInventoryIds.map((value: unknown) => validId(value)).filter((id: string) => id.length > 0).slice(0,20) : []; const senderIds: string[] = [...new Set<string>(rawSenderIds)]
    if(senderIds.length!==rawSenderIds.length)return fail("Do not add the same cosmetic twice",409)
    const recipientItemKeys=Array.isArray(body.recipientItems)?body.recipientItems.slice(0,20):[]
    const senderItems=senderIds.length?await db.userInventory.findMany({where:{userId:me.id,id:{in:senderIds}}}):[]; if(senderItems.length!==senderIds.length)return fail("One of your offered cosmetics is unavailable",409)
    const pendingSenderTradeIds=(await db.tradeOffer.findMany({where:{senderId:me.id,status:"pending"},select:{id:true}})).map(r=>r.id)
    for(const item of senderItems){if(await recentTransfer(me.id,item.itemType,item.itemId))return fail(`${item.itemName} is still in its trade safety cooldown`,409);if(await db.marketplaceListing.findFirst({where:{sellerId:me.id,itemType:item.itemType,itemId:item.itemId,status:"active"}}))return fail(`${item.itemName} is currently listed in the marketplace`,409);if(pendingSenderTradeIds.length&&await db.tradeOfferItem.findFirst({where:{tradeId:{in:pendingSenderTradeIds},side:"sender",itemType:item.itemType,itemId:item.itemId}}))return fail(`${item.itemName} is already in a pending trade`,409)}
    const wanted:Array<{itemType:string;itemId:string;itemName:string}>=[]; const wantedKeys=new Set<string>()
    for(const raw of recipientItemKeys as any[]){const itemType=cleanText(raw?.itemType,40),itemId=cleanText(raw?.itemId,160),key=`${itemType}:${itemId}`;if(!itemType||!itemId||wantedKeys.has(key))return fail("Requested cosmetics must be unique",409);wantedKeys.add(key);const item=await db.userInventory.findUnique({where:{userId_itemType_itemId:{userId:recipient.id,itemType,itemId}}});if(!item)return fail("One requested cosmetic is no longer owned by the recipient",409);wanted.push({itemType,itemId,itemName:item.itemName})}
    if(!senderItems.length&&!wanted.length&&!senderCoins&&!recipientCoins)return fail("A trade must include credits or at least one cosmetic",400)
    const offer=await db.tradeOffer.create({data:{senderId:me.id,recipientId:recipient.id,senderCoins,recipientCoins,note:cleanText(body.note,300),expiresAt:new Date(Date.now()+24*3600000)}})
    if(senderItems.length||wanted.length)await db.tradeOfferItem.createMany({data:[...senderItems.map(i=>({tradeId:offer.id,side:"sender",itemType:i.itemType,itemId:i.itemId,itemName:i.itemName})),...wanted.map(i=>({tradeId:offer.id,side:"recipient",...i}))]})
    return NextResponse.json({offer})
  }

  if (action === "trade-decline" || action === "trade-cancel") {
    const id=validId(body.id); const where=action==="trade-decline"?{id,recipientId:me.id,status:"pending"}:{id,senderId:me.id,status:"pending"};const row=await db.tradeOffer.findFirst({where});if(!row)return fail("Trade not found",404);return NextResponse.json({offer:await db.tradeOffer.update({where:{id:row.id},data:{status:action==="trade-decline"?"declined":"cancelled"}})})
  }

  if (action === "trade-accept") {
    const id=validId(body.id)
    try{const result=await db.$transaction(async tx=>{const offer=id?await tx.tradeOffer.findUnique({where:{id}}):null;if(!offer||offer.recipientId!==me.id||offer.status!=="pending")throw new Error("Trade is no longer available");if(offer.expiresAt&&offer.expiresAt<new Date())throw new Error("Trade expired");const reserved=await tx.tradeOffer.updateMany({where:{id:offer.id,status:"pending"},data:{status:"processing"}});if(!reserved.count)throw new Error("Trade is already being processed");const lines=await tx.tradeOfferItem.findMany({where:{tradeId:offer.id}});const [sender,recipient]=await Promise.all([tx.user.findUnique({where:{id:offer.senderId},select:{coins:true,username:true}}),tx.user.findUnique({where:{id:offer.recipientId},select:{coins:true,username:true}})]);if(!sender||!recipient)throw new Error("Trade account unavailable");if(sender.coins<offer.senderCoins||recipient.coins<offer.recipientCoins)throw new Error("One side no longer has the offered credits");const otherOffers=await tx.tradeOffer.findMany({where:{id:{not:offer.id},status:"pending",OR:[{senderId:{in:[offer.senderId,offer.recipientId]}},{recipientId:{in:[offer.senderId,offer.recipientId]}}]},select:{id:true,senderId:true,recipientId:true}});const otherOfferIds=otherOffers.map(row=>row.id);const otherLines=otherOfferIds.length?await tx.tradeOfferItem.findMany({where:{tradeId:{in:otherOfferIds}}}):[];const moves:Array<{from:string;to:string;item:any}>=[];for(const line of lines){const from=line.side==="sender"?offer.senderId:offer.recipientId,to=line.side==="sender"?offer.recipientId:offer.senderId;const item=await tx.userInventory.findUnique({where:{userId_itemType_itemId:{userId:from,itemType:line.itemType,itemId:line.itemId}}});if(!item)throw new Error(`${line.itemName} is no longer available`);const duplicate=await tx.userInventory.findUnique({where:{userId_itemType_itemId:{userId:to,itemType:line.itemType,itemId:line.itemId}}});if(duplicate)throw new Error(`The other side already owns ${line.itemName}`);const cooldown=await tx.cosmeticOwnershipEvent.findFirst({where:{toUserId:from,itemType:line.itemType,itemId:line.itemId,eventType:{in:["market_purchase","trade"]},createdAt:{gt:new Date(Date.now()-TRADE_COOLDOWN_MS)}}});if(cooldown)throw new Error(`${line.itemName} is still in its trade safety cooldown`);const activeListing=await tx.marketplaceListing.findFirst({where:{sellerId:from,itemType:line.itemType,itemId:line.itemId,status:"active"}});if(activeListing)throw new Error(`${line.itemName} is currently listed in the marketplace`);const committedElsewhere=otherLines.some((otherLine)=>{if(otherLine.itemType!==line.itemType||otherLine.itemId!==line.itemId)return false;const otherOffer=otherOffers.find((row)=>row.id===otherLine.tradeId);if(!otherOffer)return false;const owner=otherLine.side==="sender"?otherOffer.senderId:otherOffer.recipientId;return owner===from});if(committedElsewhere)throw new Error(`${line.itemName} is already committed to another pending trade`);moves.push({from,to,item})}
      for(const move of moves){await tx.userInventory.delete({where:{id:move.item.id}});await tx.userInventory.create({data:{userId:move.to,itemType:move.item.itemType,itemId:move.item.itemId,itemName:move.item.itemName,price:move.item.price,purchasedAt:new Date()}});await tx.cosmeticSerial.updateMany({where:{userId:move.from,itemType:move.item.itemType,itemId:move.item.itemId},data:{userId:move.to}});await tx.cosmeticOwnershipEvent.create({data:{itemType:move.item.itemType,itemId:move.item.itemId,fromUserId:move.from,toUserId:move.to,eventType:"trade",referenceId:offer.id}})}
      const netToRecipient=offer.senderCoins-offer.recipientCoins;if(netToRecipient!==0){if(netToRecipient>0){await tx.user.update({where:{id:offer.senderId},data:{coins:{decrement:netToRecipient}}});await tx.user.update({where:{id:offer.recipientId},data:{coins:{increment:netToRecipient}}})}else{const n=-netToRecipient;await tx.user.update({where:{id:offer.recipientId},data:{coins:{decrement:n}}});await tx.user.update({where:{id:offer.senderId},data:{coins:{increment:n}}})}}
      if(offer.senderCoins)await tx.currencyTransaction.createMany({data:[{userId:offer.senderId,amount:-offer.senderCoins,type:"trade",description:`Trade with @${recipient.username}`},{userId:offer.recipientId,amount:offer.senderCoins,type:"trade",description:`Trade with @${sender.username}`}]});if(offer.recipientCoins)await tx.currencyTransaction.createMany({data:[{userId:offer.recipientId,amount:-offer.recipientCoins,type:"trade",description:`Trade with @${sender.username}`},{userId:offer.senderId,amount:offer.recipientCoins,type:"trade",description:`Trade with @${recipient.username}`}]});await tx.tradeOffer.update({where:{id:offer.id},data:{status:"accepted"}});return {accepted:true}});return NextResponse.json(result)}catch(e){return fail(e instanceof Error?e.message:"Trade failed",409)}
  }

  if (action === "watch") {
    const itemType=cleanText(body.itemType,40),itemId=cleanText(body.itemId,160);if(!itemType||!itemId)return fail("Item required");const scopeKey=`${itemType}:${itemId}`;const existing=await db.featureRecord.findFirst({where:{userId:me.id,kind:"market-watch",scopeKey}});if(existing){await db.featureRecord.delete({where:{id:existing.id}});return NextResponse.json({active:false})}const targetPrice=integer(body.targetPrice,1,10_000_000);await db.featureRecord.create({data:{userId:me.id,kind:"market-watch",scopeKey,title:cleanText(body.itemName,120),dataJson:boundedJson({targetPrice}),visibility:"private"}});return NextResponse.json({active:true})
  }

  return fail("Unknown market action",404)
}
