"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Coins, Gift, Loader2, Receipt, Search, ShoppingCart, Sparkles, Heart } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"
import { api, type SafeUser } from "@/lib/api"
import { AvatarWithDeco, DisplayName, RoleBadge } from "@/components/role-ui"
import { ProfileCardPreview } from "@/components/profile-card-preview"
import { ProfileEffectThumbnail } from "@/components/profile-effects"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { EconomyDashboard } from "@/components/economy-dashboard"

type Transaction = { id: string; amount: number; type: string; description: string; createdAt: string }
type ItemType = "avatar_deco" | "profile_effect"
type CatalogItem = {
  id: string
  type: ItemType
  name: string
  description: string
  price: number
  mediaUrl?: string
  giftSurchargePercent: number
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary"
  season: "core" | "seasonal"
}
type InventoryItem = { id: string; itemType: string; itemId: string; price: number; purchasedAt: string }
type ShopData = {
  catalog: CatalogItem[]
  inventory: InventoryItem[]
  coins: number
  staffDecorationAccess: boolean
  staffProfileEffectAccess: boolean
  lastDailyClaim: string | null
  seasonalRotation: string[]
  user?: SafeUser
}

export function ShopPanel() {
  const { user, setUser } = useAuth()
  const [loading, setLoading] = useState(true)
  const [coins, setCoins] = useState(user?.coins || 0)
  const [staffDecorationAccess, setStaffDecorationAccess] = useState(false)
  const [staffProfileEffectAccess, setStaffProfileEffectAccess] = useState(false)
  const [lastDailyClaim, setLastDailyClaim] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [tab, setTab] = useState<"shop" | "gift" | "history" | "rewards">("shop")
  const [catalogTab, setCatalogTab] = useState<"decorations" | "effects">("decorations")
  const [busy, setBusy] = useState("")
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [users, setUsers] = useState<SafeUser[]>([])
  const [recipientId, setRecipientId] = useState("")
  const [userQuery, setUserQuery] = useState("")
  const [giftAmount, setGiftAmount] = useState("100")
  const [previewDeco, setPreviewDeco] = useState<string | null>(user?.avatarDeco || null)
  const [previewEffect, setPreviewEffect] = useState<string | null>(user?.profileEffect || null)
  const [wishlistKeys, setWishlistKeys] = useState<Set<string>>(new Set())
  const [seasonalRotation, setSeasonalRotation] = useState<string[]>([])
  const [catalogFilter, setCatalogFilter] = useState<"all" | "seasonal">("all")

  const refresh = useCallback(async () => {
    try {
      const [shop, directory] = await Promise.all([api.getShop() as Promise<ShopData>, api.listChatUsers()])
      setCatalog(shop.catalog)
      setInventory(shop.inventory)
      setCoins(shop.coins)
      setStaffDecorationAccess(shop.staffDecorationAccess)
      setStaffProfileEffectAccess(shop.staffProfileEffectAccess)
      setLastDailyClaim(shop.lastDailyClaim)
      setSeasonalRotation(Array.isArray(shop.seasonalRotation) ? shop.seasonalRotation : [])
      setUsers(directory.users.filter((candidate) => candidate.id !== user?.id))
      if (shop.user) {
        setUser(shop.user)
        setPreviewDeco(shop.user.avatarDeco)
        setPreviewEffect(shop.user.profileEffect)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Shop failed to load")
    } finally {
      setLoading(false)
    }
  }, [setUser, user?.id])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const handler = () => setTab("shop")
    window.addEventListener("synnical-shop-focus", handler)
    return () => window.removeEventListener("synnical-shop-focus", handler)
  }, [])

  const refreshWishlist = useCallback(async () => {
    if (!user?.id) return
    try {
      const res = await fetch("/api/features/economy", { credentials: "include", cache: "no-store" })
      const body = await res.json().catch(() => ({}))
      if (res.ok) setWishlistKeys(new Set((body.wishlist || []).map((row: any) => `${row.itemType}:${row.itemId}`)))
    } catch {}
  }, [user?.id])
  useEffect(() => { void refreshWishlist() }, [refreshWishlist])

  const toggleWishlist = async (item: CatalogItem) => {
    try {
      const res = await fetch("/api/features/economy", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "toggle-wishlist", itemType: item.type, itemId: item.id }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Could not update wishlist")
      await refreshWishlist()
      toast.success(body.active ? "Added to wishlist" : "Removed from wishlist")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update wishlist") }
  }

  const selectedUser = users.find((candidate) => candidate.id === recipientId) || null
  const filteredUsers = useMemo(() => {
    const query = userQuery.trim().toLowerCase()
    return users.filter((candidate) => !query || candidate.username.toLowerCase().includes(query) || candidate.displayName.toLowerCase().includes(query)).slice(0, 80)
  }, [userQuery, users])
  const ownedDecorations = useMemo(() => new Set(inventory.filter((item) => item.itemType === "avatar_deco").map((item) => item.itemId)), [inventory])
  const ownedEffects = useMemo(() => new Set(inventory.filter((item) => item.itemType === "profile_effect").map((item) => item.itemId)), [inventory])
  const rotationKeys = useMemo(() => new Set(seasonalRotation), [seasonalRotation])
  const decorations = catalog.filter((item) => item.type === "avatar_deco")
  const effects = catalog.filter((item) => item.type === "profile_effect")
  const typeItems = catalogTab === "decorations" ? decorations : effects
  const visibleItems = catalogFilter === "seasonal" ? typeItems.filter((item) => rotationKeys.has(`${item.type}:${item.id}`)) : typeItems

  const claimDaily = async () => {
    setBusy("daily")
    try { const result = await api.claimDaily(); if (!result.success) throw new Error(result.message); toast.success(result.message); await refresh() }
    catch (error) { toast.error(error instanceof Error ? error.message : "Daily claim failed") }
    finally { setBusy("") }
  }

  const buy = async (item: CatalogItem) => {
    setBusy(`buy:${item.id}`)
    try { const result = await api.buyItem(item.type, item.id); toast.success(result.message); await refresh() }
    catch (error) { toast.error(error instanceof Error ? error.message : "Purchase failed") }
    finally { setBusy("") }
  }

  const equipPreview = async () => {
    const isEffect = catalogTab === "effects"
    const selected = isEffect ? previewEffect : previewDeco
    const allowed = !selected || (isEffect ? staffProfileEffectAccess || ownedEffects.has(selected) : staffDecorationAccess || ownedDecorations.has(selected))
    if (!allowed) return toast.error(`Purchase this ${isEffect ? "profile effect" : "decoration"} before equipping it`)
    setBusy("equip")
    try {
      const result = isEffect ? await api.setProfileEffect(previewEffect) : await api.setDeco(previewDeco)
      setUser(result.user)
      toast.success(isEffect ? (previewEffect ? "Profile effect equipped" : "Profile effect removed") : (previewDeco ? "Avatar decoration equipped" : "Avatar decoration removed"))
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not equip item") }
    finally { setBusy("") }
  }

  const clearPreview = () => catalogTab === "effects" ? setPreviewEffect(null) : setPreviewDeco(null)

  const giftCoins = async () => {
    if (!selectedUser) return toast.error("Select who should receive the gift")
    const amount = Number(giftAmount)
    if (!Number.isInteger(amount) || amount < 1 || amount > 1_000_000) return toast.error("Enter a whole amount from 1 to 1,000,000")
    setBusy("gift:coins")
    try { const result = await api.giftShop({ kind: "coins", recipientId: selectedUser.id, amount }); toast.success(result.message); setCoins(result.coins) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Coin gift failed") }
    finally { setBusy("") }
  }

  const giftItem = async (item: CatalogItem) => {
    if (!selectedUser) return toast.error("Select who should receive the gift")
    setBusy(`gift:${item.id}`)
    try { const result = await api.giftShop({ kind: "item", recipientId: selectedUser.id, itemType: item.type, itemId: item.id }); toast.success(result.message); setCoins(result.coins) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Item gift failed") }
    finally { setBusy("") }
  }

  const loadHistory = async () => {
    setTab("history")
    try { setTransactions((await api.getTransactions()).transactions) }
    catch { toast.error("Transaction history failed to load") }
  }

  if (loading || !user) return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--synnical-accent)]" /></div>

  const selectedPreviewId = catalogTab === "effects" ? previewEffect : previewDeco
  const selectedPreviewItem = visibleItems.find((item) => item.id === selectedPreviewId) || null
  const selectedOwned = !selectedPreviewId || (catalogTab === "effects" ? staffProfileEffectAccess || ownedEffects.has(selectedPreviewId) : staffDecorationAccess || ownedDecorations.has(selectedPreviewId))

  return (
    <div className="h-full overflow-y-auto custom-scroll">
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="flex items-center gap-2 text-2xl font-bold"><ShoppingCart className="h-6 w-6" />Shop</h1><p className="mt-1 text-sm text-[var(--synnical-muted)]">Permanent avatar decorations and profile effects, with full previews before you spend.</p></div>
          <div className="flex flex-wrap items-center gap-2"><div className="flex items-center gap-2 rounded-lg border border-[var(--synnical-border)] bg-[var(--synnical-surface)] px-4 py-2"><Coins className="h-4 w-4 text-amber-400" /><strong className="text-lg">{coins.toLocaleString()}</strong><span className="text-xs text-[var(--synnical-muted)]">credits</span></div><Button onClick={() => void claimDaily()} disabled={busy === "daily" || Boolean(lastDailyClaim && Date.now() - new Date(lastDailyClaim).getTime() < 20 * 60 * 60 * 1000)}>{busy === "daily" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}Daily</Button></div>
        </header>

        <nav className="flex gap-1 border-b border-[var(--synnical-border)]"><button onClick={() => setTab("shop")} className={cn("-mb-px border-b-2 px-4 py-2 text-sm", tab === "shop" ? "border-white text-white" : "border-transparent text-[var(--synnical-muted)]")}>Shop</button><button onClick={() => setTab("gift")} className={cn("-mb-px border-b-2 px-4 py-2 text-sm", tab === "gift" ? "border-white text-white" : "border-transparent text-[var(--synnical-muted)]")}>Gift</button><button onClick={() => void loadHistory()} className={cn("-mb-px border-b-2 px-4 py-2 text-sm", tab === "history" ? "border-white text-white" : "border-transparent text-[var(--synnical-muted)]")}>History</button><button onClick={() => setTab("rewards")} className={cn("-mb-px border-b-2 px-4 py-2 text-sm", tab === "rewards" ? "border-white text-white" : "border-transparent text-[var(--synnical-muted)]")}>Rewards</button></nav>

        {tab === "shop" && (
          <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
            <aside className="h-fit rounded-xl border border-[var(--synnical-border)] bg-black p-5 lg:sticky lg:top-4">
              <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-[var(--synnical-muted)]">Live profile preview</p>
              <div data-synnical-cosmetic-preview className="flex justify-center"><ProfileCardPreview user={user} avatarDeco={previewDeco} profileEffect={previewEffect} /></div>
              <p className="mt-4 text-center text-sm font-medium">{selectedPreviewItem?.name || (catalogTab === "effects" ? "No profile effect" : "No decoration")}</p>
              <p className="mt-1 text-center text-xs text-[var(--synnical-muted)]">Preview does not change your public profile until you press Equip.</p>
              <div className="mt-4 flex gap-2"><Button className="flex-1" onClick={() => void equipPreview()} disabled={busy === "equip" || !selectedOwned || (catalogTab === "effects" ? previewEffect === user.profileEffect : previewDeco === user.avatarDeco)}>{busy === "equip" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Equip</Button><Button variant="outline" onClick={clearPreview}>None</Button></div>
              {!selectedOwned ? <p className="mt-2 text-center text-xs text-amber-300">Buy this item before equipping it.</p> : null}
            </aside>

            <main>
              <div className="mb-4 flex gap-1 rounded-lg border border-[var(--synnical-border)] bg-black p-1"><button type="button" onClick={() => setCatalogTab("decorations")} className={cn("flex-1 rounded-md px-3 py-2 text-sm", catalogTab === "decorations" ? "bg-white text-black" : "text-[var(--synnical-muted)]")}>Avatar decorations · 1,000</button><button type="button" onClick={() => setCatalogTab("effects")} className={cn("flex-1 rounded-md px-3 py-2 text-sm", catalogTab === "effects" ? "bg-white text-black" : "text-[var(--synnical-muted)]")}>Profile effects · 2,000</button></div>
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-lg font-semibold">{catalogTab === "effects" ? "Profile effects" : "Avatar decorations"}</h2><p className="text-xs text-[var(--synnical-muted)]">Purchased items stay in your inventory permanently. Seasonal rotation changes weekly without removing owned items.</p></div><div className="flex items-center gap-2"><div className="flex rounded-md border border-[var(--synnical-border)] bg-black p-0.5"><button type="button" onClick={() => setCatalogFilter("all")} className={cn("rounded px-2 py-1 text-[10px]", catalogFilter === "all" ? "bg-white text-black" : "text-[var(--synnical-muted)]")}>All</button><button type="button" onClick={() => setCatalogFilter("seasonal")} className={cn("rounded px-2 py-1 text-[10px]", catalogFilter === "seasonal" ? "bg-white text-black" : "text-[var(--synnical-muted)]")}>This week</button></div><span className="text-xs text-[var(--synnical-muted)]">{visibleItems.length} available</span></div></div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {visibleItems.map((item) => {
                  const isEffect = item.type === "profile_effect"
                  const owned = isEffect ? staffProfileEffectAccess || ownedEffects.has(item.id) : staffDecorationAccess || ownedDecorations.has(item.id)
                  const equipped = isEffect ? user.profileEffect === item.id : user.avatarDeco === item.id
                  const previewed = isEffect ? previewEffect === item.id : previewDeco === item.id
                  return <article key={`${item.type}:${item.id}`} className={cn("rounded-xl border bg-[var(--synnical-surface)] p-3", previewed ? "border-white ring-1 ring-white/35" : "border-[var(--synnical-border)]")}>
                    <button className="w-full" onClick={() => isEffect ? setPreviewEffect(item.id) : setPreviewDeco(item.id)} aria-label={`Preview ${item.name}`}>
                      {isEffect ? <ProfileEffectThumbnail effect={item.id} className="max-h-52 rounded-lg" /> : <div className="mx-auto flex h-24 items-center justify-center"><AvatarWithDeco src={user.pfpUrl} name={user.displayName} role={user.role} avatarDeco={item.id} size="lg" /></div>}
                      <p className="mt-2 truncate text-sm font-medium">{item.name}</p>
                    </button>
                    <div className="mt-1 flex flex-wrap gap-1"><span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#aaa]">{item.rarity}</span>{rotationKeys.has(`${item.type}:${item.id}`) && <span className="rounded border border-amber-300/20 bg-amber-300/8 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-200">Weekly rotation</span>}{item.season === "seasonal" && !rotationKeys.has(`${item.type}:${item.id}`) && <span className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[#666]">Seasonal</span>}</div>
                    <div className="mt-2 flex items-center justify-between text-xs text-[var(--synnical-muted)]"><span>{item.price.toLocaleString()} credits</span>{equipped ? <span className="text-white">Equipped</span> : owned ? <span className="text-emerald-300">{(isEffect ? staffProfileEffectAccess : staffDecorationAccess) ? "Staff" : "Owned"}</span> : null}</div>
                    <div className="mt-3 flex gap-2"><Button size="icon" variant="outline" className="h-8 w-8 shrink-0" title="Wishlist" aria-label={`Wishlist ${item.name}`} onClick={() => void toggleWishlist(item)}><Heart className={cn("h-4 w-4", wishlistKeys.has(`${item.type}:${item.id}`) && "text-pink-300")} fill={wishlistKeys.has(`${item.type}:${item.id}`) ? "currentColor" : "none"} /></Button>{!owned && <Button className="flex-1" size="sm" onClick={() => void buy(item)} disabled={busy === `buy:${item.id}`}>{busy === `buy:${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}Buy</Button>}</div>
                  </article>
                })}
              </div>
            </main>
          </div>
        )}

        {tab === "gift" && (
          <section className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
              <div className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4"><div className="mb-3 flex items-center gap-2"><Gift className="h-4 w-4" /><h2 className="font-semibold">Choose a recipient</h2></div><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--synnical-muted)]" /><Input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} placeholder="Search username or display name" className="pl-9" /></div><div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-[var(--synnical-border)] custom-scroll">{filteredUsers.map((candidate) => <button key={candidate.id} onClick={() => setRecipientId(candidate.id)} className={cn("flex w-full items-center gap-2 px-3 py-2 text-left", recipientId === candidate.id ? "bg-[#111111]" : "hover:bg-[#111111]")}><AvatarWithDeco src={candidate.pfpUrl} name={candidate.displayName} role={candidate.role} avatarDeco={candidate.avatarDeco} size="xs" /><span className="min-w-0 flex-1"><DisplayName name={candidate.displayName} role={candidate.role} className="block truncate text-sm" /><span className="text-xs text-[var(--synnical-muted)]">@{candidate.username}</span></span><RoleBadge role={candidate.role} tags={candidate.tags} /></button>)}</div></div>
              <div className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4"><h2 className="font-semibold">Direct credit transfer {selectedUser ? `to @${selectedUser.username}` : ""}</h2><p className="mb-3 mt-1 text-xs text-[var(--synnical-muted)]">No transfer fee. Staff accounts use the same finite stored balance as everyone else.</p><div className="flex gap-2"><Input type="number" min={1} max={1000000} step={1} value={giftAmount} onChange={(event) => setGiftAmount(event.target.value)} /><Button onClick={() => void giftCoins()} disabled={!selectedUser || busy === "gift:coins"}>{busy === "gift:coins" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}Send</Button></div></div>
            </div>
            <div><h2 className="text-lg font-semibold">Gift a profile cosmetic</h2><p className="mb-3 text-xs text-[var(--synnical-muted)]">Avatar decorations and profile effects use the existing 10% cosmetic gift surcharge.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{catalog.map((item) => { const total = Math.ceil(item.price * (1 + item.giftSurchargePercent / 100)); return <article key={`gift:${item.type}:${item.id}`} className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4"><div className="flex gap-3">{item.type === "avatar_deco" ? <AvatarWithDeco src={selectedUser?.pfpUrl || user.pfpUrl} name={selectedUser?.displayName || user.displayName} role={selectedUser?.role || user.role} avatarDeco={item.id} size="md" /> : <div className="w-16 shrink-0"><ProfileEffectThumbnail effect={item.id} className="max-h-16 rounded" /></div>}<div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{item.name}</p><p className="text-xs text-[var(--synnical-muted)]">{item.type === "profile_effect" ? "Profile effect" : "Avatar decoration"} · {item.giftSurchargePercent}% surcharge</p></div></div><div className="mt-3 flex items-center justify-between gap-2"><span className="text-sm">{total.toLocaleString()} credits</span><Button size="sm" onClick={() => void giftItem(item)} disabled={!selectedUser || busy === `gift:${item.id}`}>{busy === `gift:${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}Gift</Button></div></article> })}</div></div>
          </section>
        )}

        {tab === "rewards" && <EconomyDashboard role={user.role} />}

        {tab === "history" && <div className="space-y-2">{transactions.length === 0 ? <div className="py-16 text-center text-sm text-[var(--synnical-muted)]"><Receipt className="mx-auto mb-3 h-10 w-10" />No transactions yet.</div> : transactions.map((transaction) => <div key={transaction.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--synnical-border)] bg-[var(--synnical-surface)] px-4 py-3"><div className="min-w-0"><p className="truncate text-sm">{transaction.description}</p><p className="text-xs text-[var(--synnical-muted)]">{new Date(transaction.createdAt).toLocaleString()}</p></div><span className={cn("font-semibold", transaction.amount > 0 ? "text-green-400" : transaction.amount < 0 ? "text-red-400" : "text-[var(--synnical-muted)]")}>{transaction.amount > 0 ? "+" : ""}{transaction.amount}</span></div>)}</div>}
      </div>
    </div>
  )
}
