"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChevronLeft, ChevronRight, History, Loader2, Search } from "lucide-react"

export type StaffAuditEntry = {
  id: string
  category: string
  action: string
  actorIdSnapshot: string
  actorUsernameSnapshot: string
  actorRoleSnapshot: string
  targetUserIdSnapshot: string | null
  targetUsernameSnapshot: string | null
  reason: string
  createdAt: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  metadata: Record<string, unknown>
}

type AuditResponse = {
  entries: StaffAuditEntry[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
  categories: string[]
  actions: string[]
}

const pretty = (value: string) => value.toLowerCase().split("_").map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ")
const displayValue = (value: unknown) => {
  if (value === null) return "null"
  if (value === undefined) return ""
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 497)}…` : value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
  try {
    const seen = new WeakSet<object>()
    const rendered = JSON.stringify(value, (_key, item) => {
      if (typeof item === "object" && item !== null) {
        if (seen.has(item)) return "[Circular]"
        seen.add(item)
      }
      return item
    })
    return rendered && rendered.length > 900 ? `${rendered.slice(0, 897)}…` : rendered || String(value)
  } catch {
    return "[Unserializable value]"
  }
}

function compactObject(value: Record<string, unknown>) {
  return Object.entries(value).filter(([, item]) => item !== undefined).slice(0, 8)
}

function ValueChanges({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).slice(0, 10)
  if (!keys.length) return null
  return <div className="mt-2 grid gap-1 text-[11px] text-[var(--synnical-muted)] sm:grid-cols-2">
    {keys.map((key) => {
      const from = before[key]
      const to = after[key]
      return <div key={key} className="rounded border border-[var(--synnical-border)] bg-black/25 px-2 py-1.5">
        <span className="font-medium text-[var(--synnical-text)]">{pretty(key)}:</span>{" "}
        {from !== undefined && <span>{displayValue(from)}</span>}
        {from !== undefined && to !== undefined && <span> → </span>}
        {to !== undefined && <span>{displayValue(to)}</span>}
      </div>
    })}
  </div>
}

export function AuditLogPanel() {
  const [entries, setEntries] = useState<StaffAuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [category, setCategory] = useState("ALL")
  const [action, setAction] = useState("ALL")
  const [categories, setCategories] = useState<string[]>([])
  const [actions, setActions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebouncedQuery(query.trim()); setPage(1) }, 250)
    return () => window.clearTimeout(timer)
  }, [query])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "30" })
      if (debouncedQuery) params.set("q", debouncedQuery)
      if (category !== "ALL") params.set("category", category)
      if (action !== "ALL") params.set("action", action)
      const response = await fetch(`/api/moderation/audit?${params.toString()}`, { credentials: "include", cache: "no-store" })
      const data = await response.json() as AuditResponse & { error?: string }
      if (!response.ok) throw new Error(data.error || "Could not load audit logs")
      setEntries(data.entries)
      setTotal(data.total)
      setHasMore(data.hasMore)
      setCategories(data.categories)
      setActions(data.actions)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load audit logs")
    } finally {
      setLoading(false)
    }
  }, [page, debouncedQuery, category, action])

  useEffect(() => { void load() }, [load])
  const pageCount = useMemo(() => Math.max(1, Math.ceil(total / 30)), [total])

  return <div className="space-y-4">
    <div>
      <div className="flex items-center gap-2"><History className="h-4 w-4" /><h2 className="text-sm font-semibold">Staff Audit Logs</h2></div>
      <p className="mt-1 text-xs text-[var(--synnical-muted)]">Append-only history of staff actions. Search by staff member, target, action, reason or account ID.</p>
    </div>

    <div className="grid gap-2 md:grid-cols-[1fr_180px_220px]">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--synnical-muted)]" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search audit logs…" className="pl-8" />
      </div>
      <Select value={category} onValueChange={(value) => { setCategory(value); setPage(1) }}>
        <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
        <SelectContent><SelectItem value="ALL">All categories</SelectItem>{categories.map((item) => <SelectItem key={item} value={item}>{pretty(item)}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={action} onValueChange={(value) => { setAction(value); setPage(1) }}>
        <SelectTrigger><SelectValue placeholder="Action" /></SelectTrigger>
        <SelectContent><SelectItem value="ALL">All actions</SelectItem>{actions.map((item) => <SelectItem key={item} value={item}>{pretty(item)}</SelectItem>)}</SelectContent>
      </Select>
    </div>

    {error && <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">{error}</div>}
    {loading ? <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div> : entries.length === 0 ?
      <div className="rounded-lg border border-[var(--synnical-border)] p-8 text-center text-sm text-[var(--synnical-muted)]">No matching audit entries.</div> :
      <div className="overflow-hidden rounded-lg border border-[var(--synnical-border)]">
        {entries.map((entry) => <details key={entry.id} className="group border-b border-[var(--synnical-border)] bg-[var(--synnical-surface)] p-3 last:border-0">
          <summary className="cursor-pointer list-none">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{pretty(entry.category)}</Badge>
              <span className="text-sm font-semibold">{pretty(entry.action)}</span>
              <span className="text-xs text-[var(--synnical-muted)]">by <span className="text-[var(--synnical-text)]">@{entry.actorUsernameSnapshot}</span> ({pretty(entry.actorRoleSnapshot)})</span>
              {entry.targetUsernameSnapshot && <span className="text-xs text-[var(--synnical-muted)]">→ <span className="text-[var(--synnical-text)]">@{entry.targetUsernameSnapshot}</span></span>}
              <span className="ml-auto text-[10px] text-[var(--synnical-muted)]">{new Date(entry.createdAt).toLocaleString()}</span>
            </div>
            {entry.reason && <p className="mt-1 line-clamp-1 text-xs text-[var(--synnical-muted)]">{entry.reason}</p>}
          </summary>
          <div className="mt-3 border-t border-[var(--synnical-border)] pt-3">
            {entry.reason && <p className="text-xs"><span className="font-semibold">Reason:</span> {entry.reason}</p>}
            <ValueChanges before={entry.before || {}} after={entry.after || {}} />
            {compactObject(entry.metadata || {}).length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{compactObject(entry.metadata).map(([key, value]) => <span key={key} className="rounded border border-[var(--synnical-border)] px-2 py-1 text-[10px] text-[var(--synnical-muted)]"><span className="text-[var(--synnical-text)]">{pretty(key)}:</span> {displayValue(value)}</span>)}</div>}
          </div>
        </details>)}
      </div>}

    <div className="flex items-center justify-between text-xs text-[var(--synnical-muted)]">
      <span>{total.toLocaleString()} entr{total === 1 ? "y" : "ies"} · page {page} of {pageCount}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-3.5 w-3.5" />Previous</Button>
        <Button size="sm" variant="outline" disabled={!hasMore || loading} onClick={() => setPage((value) => value + 1)}>Next<ChevronRight className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  </div>
}
