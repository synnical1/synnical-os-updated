"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Gift, Trophy, Flame, Ticket, Receipt, Star, Sparkles, Loader2, Clock3, TrendingUp, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import type { Role } from "@/lib/api"

type EconomyState = {
  progress: { xp: number; level: number; loginStreak: number; totalGameSeconds: number }
  achievements: Array<{ achievementId: string; earnedAt: string; achievement?: { name?: string; description?: string } | null }>
  challenges: Array<{ id: string; name: string; description: string; target: number; rewardCoins: number; rewardXp: number }>
  challengeProgress: Array<{ challengeId: string; progress: number; completedAt?: string | null; periodKey: string }>
  wishlist: Array<{ id: string; itemType: string; itemId: string; priceAtAdded: number; currentPrice: number | null; priceChanged: boolean; item?: { name?: string; price?: number } | null }>
  gifts: { sent: Array<any>; received: Array<any> }
  transactions: Array<{ id: string; amount: number; type: string; description: string; createdAt: string; refundEligibleUntil?: string | null; refundable?: boolean }>
  redemptions: Array<any>
  serials: Array<{ id: string; itemType: string; itemId: string; serialNumber: number; acquiredAt: string }>
  seasonalRotation: Array<any>
}

async function request(body?: any) {
  const res = await fetch("/api/features/economy", body ? { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "include", cache: "no-store" })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || "Economy request failed")
  return json
}

export function EconomyDashboard({ role }: { role: Role }) {
  const [state, setState] = useState<EconomyState | null>(null)
  const [busy, setBusy] = useState("")
  const [promo, setPromo] = useState("")
  const [staffCode, setStaffCode] = useState("")
  const [staffCoins, setStaffCoins] = useState("0")

  const load = useCallback(async () => { try { setState(await request()) } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load rewards") } }, [])
  useEffect(() => { void load() }, [load])

  const act = async (key: string, body: any, success: string) => {
    setBusy(key)
    try { await request(body); toast.success(success); await load() }
    catch (error) { toast.error(error instanceof Error ? error.message : "Request failed") }
    finally { setBusy("") }
  }

  const challengeById = useMemo(() => new Map((state?.challengeProgress || []).map((row) => [row.challengeId, row])), [state?.challengeProgress])
  const staff = role === "OWNER" || role === "HEAD_ADMIN" || role === "ADMIN" || role === "MOD"
  if (!state) return <div className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin" /></div>

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat icon={TrendingUp} label="Level" value={String(state.progress.level)} detail={`${state.progress.xp.toLocaleString()} XP`} />
      <Stat icon={Flame} label="Login streak" value={`${state.progress.loginStreak} day${state.progress.loginStreak === 1 ? "" : "s"}`} detail="Recorded on real account login" />
      <Stat icon={Trophy} label="Achievements" value={String(state.achievements.length)} detail="Permanent account achievements" />
      <Stat icon={Clock3} label="Game time" value={`${Math.floor(state.progress.totalGameSeconds / 3600)}h ${Math.floor((state.progress.totalGameSeconds % 3600) / 60)}m`} detail="Cumulative completed sessions" />
    </div>

    <section className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4">
      <h3 className="text-sm font-semibold">Weekly challenges</h3>
      <div className="mt-3 grid gap-2 md:grid-cols-2">{state.challenges.map((challenge) => { const progress = challengeById.get(challenge.id); const amount = Math.min(challenge.target, progress?.progress || 0); return <div key={challenge.id} className="rounded-lg border border-[#222] bg-black/40 p-3"><div className="flex justify-between gap-3"><div><p className="text-sm font-medium">{challenge.name}</p><p className="text-xs text-[#777]">{challenge.description}</p></div><span className="text-xs text-[#888]">{amount}/{challenge.target}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#1b1b1b]"><div className="h-full bg-white" style={{ width: `${Math.min(100, challenge.target ? amount / challenge.target * 100 : 0)}%` }} /></div><p className="mt-2 text-[11px] text-[#666]">Reward: {challenge.rewardCoins} credits · {challenge.rewardXp} XP{progress?.completedAt ? " · Completed" : ""}</p></div> })}</div>
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><Trophy className="h-4 w-4" />Achievements</h3><div className="mt-3 space-y-2">{state.achievements.length ? state.achievements.map((row) => <div key={row.achievementId} className="rounded-lg border border-[#222] bg-black/40 p-3"><p className="text-xs font-medium">{row.achievement?.name || row.achievementId}</p><p className="mt-1 text-[11px] text-[#777]">{row.achievement?.description || "Earned achievement"} · {new Date(row.earnedAt).toLocaleDateString()}</p></div>) : <p className="text-xs text-[#777]">No achievements earned yet.</p>}</div></div>
      <div className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><Ticket className="h-4 w-4" />Promo codes</h3><div className="mt-3 flex gap-2"><Input value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} placeholder="CODE" /><Button onClick={() => void act("promo", { action: "redeem-promo", code: promo }, "Promo redeemed")} disabled={!promo || busy === "promo"}>Redeem</Button></div>{staff && <div className="mt-4 border-t border-[#222] pt-3"><p className="mb-2 flex items-center gap-1.5 text-xs text-[#888]"><ShieldCheck className="h-3.5 w-3.5" />Staff promo creator</p><div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]"><Input value={staffCode} onChange={(e) => setStaffCode(e.target.value.toUpperCase())} placeholder="NEWCODE" /><Input type="number" min={0} value={staffCoins} onChange={(e) => setStaffCoins(e.target.value)} placeholder="Credits" /><Button variant="outline" onClick={() => void act("create-promo", { action: "create-promo", code: staffCode, rewardCoins: Number(staffCoins) || 0 }, "Promo created")}>Create</Button></div></div>}</div>
    </section>

    <section className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><Star className="h-4 w-4" />Wishlist & seasonal rotation</h3><div className="mt-3 grid gap-2 md:grid-cols-2">{state.wishlist.length ? state.wishlist.map((row) => <div key={row.id} className="flex items-center gap-3 rounded-lg border border-[#222] bg-black/40 p-3"><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{row.item?.name || row.itemId}</p><p className="text-[11px] text-[#777]">Added at {row.priceAtAdded.toLocaleString()} · now {row.currentPrice?.toLocaleString() ?? "unavailable"}{row.priceChanged ? " · price changed" : ""}</p></div><Button size="sm" variant="ghost" onClick={() => void act(`wish:${row.id}`, { action: "toggle-wishlist", itemType: row.itemType, itemId: row.itemId }, "Wishlist updated")}>Remove</Button></div>) : <p className="text-xs text-[#777]">Use the heart buttons in the Shop tab to add items.</p>}</div><p className="mt-3 text-[11px] text-[#666]">Seasonal rotation currently contains {state.seasonalRotation.length} catalog item{state.seasonalRotation.length === 1 ? "" : "s"}. Owned items remain permanent.</p></section>

    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><Gift className="h-4 w-4" />Gift history</h3><p className="mt-2 text-xs text-[#777]">Sent {state.gifts.sent.length} · Received {state.gifts.received.length}</p><div className="mt-3 max-h-60 space-y-2 overflow-y-auto">{[...state.gifts.received.map((x) => ({ ...x, direction: "Received" })), ...state.gifts.sent.map((x) => ({ ...x, direction: "Sent" }))].sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()).slice(0,50).map((row) => <div key={`${row.direction}:${row.id}`} className="rounded-lg border border-[#222] bg-black/40 px-3 py-2"><p className="text-xs">{row.direction} · {row.itemName || (row.kind === "coins" ? `${row.amount} credits` : row.kind)}</p><p className="text-[11px] text-[#666]">{new Date(row.createdAt).toLocaleString()}{row.surcharge ? ` · ${row.surcharge} surcharge` : ""}</p></div>)}</div></div>
      <div className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4" />Limited serials</h3><div className="mt-3 max-h-60 space-y-2 overflow-y-auto">{state.serials.length ? state.serials.map((row) => <div key={row.id} className="rounded-lg border border-[#222] bg-black/40 px-3 py-2"><p className="text-xs">{row.itemId}</p><p className="text-[11px] text-[#777]">Serial #{String(row.serialNumber).padStart(4, "0")} · {new Date(row.acquiredAt).toLocaleDateString()}</p></div>) : <p className="text-xs text-[#777]">No limited-edition serials owned.</p>}</div></div>
    </section>

    <section className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><Receipt className="h-4 w-4" />Receipts & refund eligibility</h3><div className="mt-3 max-h-80 space-y-2 overflow-y-auto">{state.transactions.map((tx) => <div key={tx.id} className="flex items-start justify-between gap-3 rounded-lg border border-[#222] bg-black/40 p-3"><div className="min-w-0"><p className="truncate text-xs">{tx.description}</p><p className="text-[11px] text-[#666]">{new Date(tx.createdAt).toLocaleString()}{tx.refundEligibleUntil ? tx.refundable ? ` · refundable until ${new Date(tx.refundEligibleUntil).toLocaleString()}` : " · refund window expired" : ""}</p></div><span className={tx.amount > 0 ? "text-xs text-emerald-300" : "text-xs text-red-300"}>{tx.amount > 0 ? "+" : ""}{tx.amount}</span></div>)}</div></section>
  </div>
}

function Stat({ icon: Icon, label, value, detail }: { icon: typeof Trophy; label: string; value: string; detail: string }) { return <div className="rounded-xl border border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-4"><p className="flex items-center gap-2 text-xs text-[#777]"><Icon className="h-3.5 w-3.5" />{label}</p><p className="mt-2 text-xl font-semibold">{value}</p><p className="mt-1 text-[11px] text-[#5f5f5f]">{detail}</p></div> }
