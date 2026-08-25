"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { SafeUser } from "@/lib/api"
import { useAuth } from "@/hooks/use-auth"
import { AvatarWithDeco, DisplayName, RoleBadge } from "@/components/role-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AuditLogPanel } from "@/components/audit-log-panel"
import { InfractionsPanel } from "@/components/infractions-panel"
import { Ban, Check, ChevronLeft, ChevronRight, Coins, FileWarning, History, Images, Loader2, Search, Shield, Trash2, Users, X } from "lucide-react"
import { toast } from "sonner"

const rank: Record<string, number> = { MEMBER: 0, MOD: 1, ADMIN: 2, HEAD_ADMIN: 3, OWNER: 4 }
const roles = ["ALL", "MEMBER", "MOD", "ADMIN", "HEAD_ADMIN", "OWNER"] as const

type PendingMedia = {
  id: string
  userId: string
  username: string
  type: "pfp" | "banner"
  animated: boolean
  automatedCode: string
  createdAt: string
}

type Tab = "members" | "actions" | "media" | "audit"

export function StaffAccountsPanel() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>("members")
  const [users, setUsers] = useState<SafeUser[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState("")
  const [role, setRole] = useState("ALL")
  const [status, setStatus] = useState("ALL")
  const [media, setMedia] = useState<PendingMedia[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [loadingMedia, setLoadingMedia] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(query.trim()); setPage(1) }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const loadUsers = useCallback(async () => {
    if (!user) return
    setLoadingUsers(true)
    setError("")
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" })
      if (search) params.set("q", search)
      if (role !== "ALL") params.set("role", role)
      if (status !== "ALL") params.set("status", status)
      const response = await fetch(`/api/roles/users?${params.toString()}`, { credentials: "include", cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not load accounts")
      setUsers(data.users)
      setTotal(data.total)
      setHasMore(data.hasMore)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Staff controls could not load")
    } finally {
      setLoadingUsers(false)
    }
  }, [user, page, search, role, status])

  const loadMedia = useCallback(async () => {
    setLoadingMedia(true)
    try {
      const response = await fetch("/api/moderation/media", { credentials: "include", cache: "no-store" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Could not load media approvals")
      setMedia(data.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load media approvals")
    } finally {
      setLoadingMedia(false)
    }
  }, [])

  useEffect(() => { if (tab === "members") void loadUsers() }, [tab, loadUsers])
  useEffect(() => { if (tab === "media") void loadMedia() }, [tab, loadMedia])

  const remove = async (target: SafeUser, action: "delete" | "ban") => {
    if (!confirm(`${action === "ban" ? "Ban and delete" : "Delete"} @${target.username}? Their username will become available immediately.`)) return
    setBusy(`account:${target.id}`)
    setError("")
    try {
      const response = await fetch("/api/moderation/accounts", {
        method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: target.id, action }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Account could not be removed")
      toast.success(action === "ban" ? "Account banned and removed" : "Account removed")
      await loadUsers()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Account could not be removed")
    } finally { setBusy("") }
  }


  const unban = async (target: SafeUser) => {
    if (!confirm(`Unban @${target.username}? Active permanent BAN/AUTO_BAN records and identity bans sourced from this account will be revoked, while unrelated active mutes stay in place.`)) return
    setBusy(`unban:${target.id}`)
    setError("")
    try {
      const response = await fetch("/api/moderation/unban", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: target.id }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Account could not be unbanned")
      toast.success(`@${target.username} unbanned`)
      await loadUsers()
    } catch (e) { setError(e instanceof Error ? e.message : "Account could not be unbanned") } finally { setBusy("") }
  }

  const adjustCredits = async (target: SafeUser, direction: "add" | "remove") => {
    const raw = window.prompt(`${direction === "add" ? "Add" : "Remove"} how many credits for @${target.username}?`)?.trim()
    if (!raw) return
    const amount = Number(raw)
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1_000_000) return toast.error("Enter a whole number from 1 to 1,000,000")
    const reason = window.prompt("Reason for this credit adjustment?", "Staff adjustment")?.trim() || "Staff adjustment"
    const delta = direction === "add" ? amount : -amount
    setBusy(`credits:${target.id}`)
    try {
      const response = await fetch("/api/moderation/credits", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: target.id, delta, reason }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Credit adjustment failed")
      setUsers((current) => current.map((entry) => entry.id === target.id ? data.user : entry))
      toast.success(`${direction === "add" ? "Added" : "Removed"} ${amount.toLocaleString()} credits ${direction === "add" ? "to" : "from"} @${target.username}`)
    } catch (e) { setError(e instanceof Error ? e.message : "Credit adjustment failed") } finally { setBusy("") }
  }

  const review = async (id: string, action: "approve" | "decline") => {
    setBusy(`media:${id}`)
    try {
      const response = await fetch("/api/moderation/media", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "Review failed")
      setMedia((items) => items.filter((item) => item.id !== id))
      toast.success(action === "approve" ? "Media approved" : "Media declined")
    } catch (e) { setError(e instanceof Error ? e.message : "Review failed") } finally { setBusy("") }
  }

  const pages = useMemo(() => Math.max(1, Math.ceil(total / 25)), [total])
  if (!user) return null

  const tabs: Array<{ id: Tab; label: string; icon: typeof Users }> = [
    { id: "members", label: "Members", icon: Users },
    { id: "actions", label: "Reports & Actions", icon: FileWarning },
    { id: "media", label: "Media", icon: Images },
    { id: "audit", label: "Audit Logs", icon: History },
  ]

  return <div className="h-full overflow-y-auto bg-black custom-scroll">
    <div className="sticky top-0 z-20 border-b border-[var(--synnical-border)] bg-black/95 px-4 py-3 backdrop-blur sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center gap-2"><Shield className="h-5 w-5" /><h1 className="text-lg font-semibold">Moderation</h1><span className="text-xs text-[var(--synnical-muted)]">Staff workspace</span></div>
        <div className="mt-3 flex gap-1 overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon }) => <Button key={id} size="sm" variant={tab === id ? "default" : "ghost"} onClick={() => setTab(id)}><Icon className="h-3.5 w-3.5" />{label}</Button>)}
        </div>
      </div>
    </div>

    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      {error && <p className="mb-4 rounded-lg border border-red-500/30 bg-[#160606] p-3 text-sm text-red-300">{error}</p>}

      {tab === "members" && <section className="space-y-4">
        <div>
          <h2 className="text-sm font-semibold">Member directory</h2>
          <p className="mt-1 text-xs text-[var(--synnical-muted)]">Server-side search and paging. Search username, display name, account ID or role without loading every account into the browser.</p>
        </div>
        <div className="grid gap-2 md:grid-cols-[1fr_160px_160px]">
          <div className="relative"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--synnical-muted)]" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search members…" className="pl-8" /></div>
          <Select value={role} onValueChange={(value) => { setRole(value); setPage(1) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{roles.map((item) => <SelectItem key={item} value={item}>{item === "ALL" ? "All roles" : item === "HEAD_ADMIN" ? "Head Admin" : item[0] + item.slice(1).toLowerCase()}</SelectItem>)}</SelectContent></Select>
          <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All accounts</SelectItem><SelectItem value="ACTIVE">Not muted</SelectItem><SelectItem value="MUTED">Muted</SelectItem><SelectItem value="STAFF">Staff only</SelectItem><SelectItem value="MEMBERS">Members only</SelectItem></SelectContent></Select>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--synnical-border)] bg-[var(--synnical-surface)]">
          {loadingUsers ? <div className="flex items-center justify-center gap-2 p-10 text-sm text-[var(--synnical-muted)]"><Loader2 className="h-4 w-4 animate-spin" />Loading accounts…</div> : users.length === 0 ? <div className="p-10 text-center text-sm text-[var(--synnical-muted)]">No matching accounts.</div> : users.map((target) => {
            const allowed = user.id !== target.id && rank[user.role] > rank[target.role]
            return <div key={target.id} className="flex flex-wrap items-center gap-3 border-b border-[var(--synnical-border)] p-3 last:border-0">
              <AvatarWithDeco src={target.pfpUrl} name={target.displayName} role={target.role} avatarDeco={target.avatarDeco} size="sm" />
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><DisplayName name={target.displayName || target.username} role={target.role} className="truncate font-medium" /><RoleBadge role={target.role} tags={target.tags} /></div><p className="text-xs text-[var(--synnical-muted)]">@{target.username} · {(target.coins || 0).toLocaleString()} coins{target.banned ? " · banned" : target.muted ? " · muted" : ""}</p></div>
              {allowed && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy === `credits:${target.id}`} onClick={() => void adjustCredits(target, "add")}><Coins className="h-3.5 w-3.5" />Add credits</Button><Button size="sm" variant="outline" disabled={busy === `credits:${target.id}`} onClick={() => void adjustCredits(target, "remove")}><Coins className="h-3.5 w-3.5" />Remove credits</Button>{target.banned ? <Button size="sm" variant="outline" disabled={busy === `unban:${target.id}`} onClick={() => void unban(target)}><Check className="h-3.5 w-3.5" />Unban</Button> : <Button size="sm" variant="destructive" disabled={busy === `account:${target.id}`} onClick={() => void remove(target, "ban")}><Ban className="h-3.5 w-3.5" />Ban</Button>}<Button size="sm" variant="outline" disabled={busy === `account:${target.id}`} onClick={() => void remove(target, "delete")}><Trash2 className="h-3.5 w-3.5" />Delete</Button></div>}
            </div>
          })}
        </div>
        <div className="flex items-center justify-between text-xs text-[var(--synnical-muted)]"><span>{total.toLocaleString()} account{total === 1 ? "" : "s"} · page {page} of {pages}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || loadingUsers} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-3.5 w-3.5" />Previous</Button><Button size="sm" variant="outline" disabled={!hasMore || loadingUsers} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight className="h-3.5 w-3.5" /></Button></div></div>
      </section>}

      {tab === "actions" && <InfractionsPanel embedded />}

      {tab === "media" && <section className="space-y-4"><div><h2 className="text-sm font-semibold">Media approvals · {media.length}</h2><p className="mt-1 text-xs text-[var(--synnical-muted)]">Review profile images waiting for staff approval.</p></div>{loadingMedia ? <div className="flex justify-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div> : <div className="grid gap-3 sm:grid-cols-2">{media.map((item) => <div key={item.id} className="overflow-hidden rounded-lg border border-[var(--synnical-border)] bg-[var(--synnical-surface)]"><img src={`/api/moderation/media?preview=${encodeURIComponent(item.id)}`} alt={`${item.type} submitted by ${item.username}`} className={item.type === "banner" ? "h-32 w-full object-cover" : "mx-auto mt-4 h-28 w-28 rounded-full object-cover"} /><div className="p-3"><p className="text-sm font-medium">@{item.username} · {item.type}</p><p className="mt-1 text-xs text-[var(--synnical-muted)]">{item.animated ? "Animated · " : ""}{new Date(item.createdAt).toLocaleString()}</p><div className="mt-3 flex gap-2"><Button size="sm" variant="outline" className="flex-1 border-emerald-500/35 text-emerald-300" disabled={busy === `media:${item.id}`} onClick={() => void review(item.id, "approve")}><Check className="h-3.5 w-3.5" />Approve</Button><Button size="sm" variant="outline" className="flex-1 border-red-500/35 text-red-300" disabled={busy === `media:${item.id}`} onClick={() => void review(item.id, "decline")}><X className="h-3.5 w-3.5" />Decline</Button></div></div></div>)}{media.length === 0 && <p className="text-sm text-[var(--synnical-muted)]">No media waiting for review.</p>}</div>}</section>}

      {tab === "audit" && <AuditLogPanel />}
    </div>
  </div>
}
